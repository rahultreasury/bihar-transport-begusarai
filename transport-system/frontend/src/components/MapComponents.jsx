import { useCallback, useState, useMemo, useEffect } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, StandaloneSearchBox } from '@react-google-maps/api';

// Bihar region center coordinates
const BIHAR_CENTER = { lat: 25.6200, lng: 85.8900 };

// Default map options
const defaultMapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true,
};

// Libraries for Places API and Distance Matrix
const libraries = ['places', 'geometry', 'distanceMatrix'];

export function useGoogleMaps() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries: apiKey && apiKey.length > 10 ? libraries : [],
  });

  return { isLoaded, loadError, hasApiKey: apiKey && apiKey.length > 10 };
}

// Custom hook for distance calculation using Google Distance Matrix API
export function useDistanceCalculator() {
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { isLoaded, hasApiKey } = useGoogleMaps();

  const calculateDistance = useCallback(async (origin, destination) => {
    if (!origin || !destination) {
      setDistance(0);
      setDuration(0);
      return null;
    }

    // If no API key, use fallback calculation
    if (!hasApiKey || !isLoaded) {
      // Calculate straight-line distance as fallback
      const R = 6371; // Earth's radius in km
      const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
      const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((origin.lat * Math.PI) / 180) *
          Math.cos((destination.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const straightLineDistance = R * c;
      const roadDistance = straightLineDistance * 1.3; // Add 30% for road distance
      
      setDistance(Math.round(roadDistance));
      setDuration(Math.round(roadDistance / 40 * 60)); // Assume 40 km/h avg speed
      return roadDistance;
    }

    setLoading(true);
    setError(null);

    try {
      const service = new window.google.maps.DistanceMatrixService();
      
      const results = await new Promise((resolve, reject) => {
        service.getDistanceMatrix(
          {
            origins: [new window.google.maps.LatLng(origin.lat, origin.lng)],
            destinations: [new window.google.maps.LatLng(destination.lat, destination.lng)],
            travelMode: window.google.maps.TravelMode.DRIVING,
            unitSystem: window.google.maps.UnitSystem.METRIC,
          },
          (response, status) => {
            if (status === window.google.maps.DistanceMatrixStatus.OK) {
              resolve(response);
            } else {
              reject(new Error(`Distance Matrix failed: ${status}`));
            }
          }
        );
      });

      if (results.rows[0].elements[0].status === 'OK') {
        const distValue = results.rows[0].elements[0].distance.value;
        const durValue = results.rows[0].elements[0].duration.value;
        
        setDistance(Math.round(distValue / 1000)); // Convert to km
        setDuration(Math.round(durValue / 60)); // Convert to minutes
        return distValue / 1000;
      } else {
        throw new Error('Distance calculation failed');
      }
    } catch (err) {
      setError(err.message);
      // Fallback to straight-line calculation
      const R = 6371;
      const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
      const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((origin.lat * Math.PI) / 180) *
          Math.cos((destination.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const roadDistance = R * c * 1.3;
      
      setDistance(Math.round(roadDistance));
      return roadDistance;
    } finally {
      setLoading(false);
    }
  }, [hasApiKey, isLoaded]);

  return { distance, duration, loading, error, calculateDistance };
}

// Pricing calculation hook
export function usePriceCalculator() {
  const calculatePrice = (distanceKm, vehicleType) => {
    const rates = {
      'truck': 25,      // ₹25 per km
      'mini_truck': 15, // ₹15 per km
      'pickup': 12,     // ₹12 per km
      'tempo': 18,      // ₹18 per km
      'lorry': 25       // ₹25 per km
    };
    
    const rate = rates[vehicleType] || rates['pickup'];
    return Math.round(distanceKm * rate);
  };

  return { calculatePrice };
}

// Location Search Component with Autocomplete
export function LocationSearch({ placeholder, onSelect, value, label, icon }) {
  const [searchBox, setSearchBox] = useState(null);
  const { isLoaded, hasApiKey } = useGoogleMaps();

  const onLoad = useCallback((ref) => {
    setSearchBox(ref);
  }, []);

  const onPlacesChanged = useCallback(() => {
    if (searchBox) {
      const places = searchBox.getPlaces();
      if (places && places.length > 0) {
        const place = places[0];
        const location = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          address: place.formatted_address,
          name: place.name,
        };
        onSelect(location);
      }
    }
  }, [searchBox, onSelect]);

  // Fallback to simple input if no API key or not loaded
  if (!hasApiKey || !isLoaded) {
    return (
      <div>
        <label className="label">{label}</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
            {icon || '📍'}
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => onSelect({ address: e.target.value, name: e.target.value })}
            placeholder={placeholder}
            className="input-field pl-10"
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="label">{label}</label>
      <StandaloneSearchBox
        onLoad={onLoad}
        onPlacesChanged={onPlacesChanged}
      >
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 z-10">
            {icon || '📍'}
          </span>
          <input
            type="text"
            defaultValue={value}
            placeholder={placeholder}
            className="input-field pl-10"
          />
        </div>
      </StandaloneSearchBox>
    </div>
  );
}

// Booking Map Component - Shows route between pickup and drop
export function BookingMap({ pickupLocation, dropLocation, onDistanceChange }) {
  const [map, setMap] = useState(null);
  const [directions, setDirections] = useState(null);
  const { isLoaded, hasApiKey } = useGoogleMaps();
  const { distance, loading, calculateDistance } = useDistanceCalculator();

  const center = useMemo(() => {
    if (pickupLocation?.lat && dropLocation?.lat) {
      return {
        lat: (pickupLocation.lat + dropLocation.lat) / 2,
        lng: (pickupLocation.lng + dropLocation.lng) / 2,
      };
    }
    return pickupLocation?.lat ? pickupLocation : BIHAR_CENTER;
  }, [pickupLocation, dropLocation]);

  const onLoad = useCallback((map) => {
    setMap(map);
  }, []);

  // Calculate distance when locations change
  useEffect(() => {
    if (pickupLocation?.lat && dropLocation?.lat) {
      calculateDistance(pickupLocation, dropLocation).then((dist) => {
        if (onDistanceChange && dist) {
          onDistanceChange(dist);
        }
      });
    }
  }, [pickupLocation, dropLocation, calculateDistance, onDistanceChange]);

  // Calculate route when locations change
  useMemo(() => {
    if (!hasApiKey || !isLoaded || !pickupLocation?.lat || !dropLocation?.lat) {
      return;
    }

    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: pickupLocation.lat, lng: pickupLocation.lng },
        destination: { lat: dropLocation.lat, lng: dropLocation.lng },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          setDirections(result);
        }
      }
    );
  }, [pickupLocation, dropLocation, hasApiKey, isLoaded]);

  // Fallback map when no API key
  if (!hasApiKey || !isLoaded) {
    return (
      <div className="w-full h-64 bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center p-4">
          <div className="text-4xl mb-2">🗺️</div>
          <p className="text-gray-600 text-sm">Map Preview</p>
          <p className="text-gray-500 text-xs mt-1">
            Add Google Maps API key for interactive map
          </p>
          {pickupLocation?.lat && dropLocation?.lat && distance > 0 && (
            <p className="text-amber-500 font-semibold mt-2">
              Estimated Distance: {distance} km
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {loading && (
        <div className="text-center py-2 text-sm text-gray-500">
          Calculating route...
        </div>
      )}
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '300px', borderRadius: '0.75rem' }}
        center={center}
        zoom={10}
        options={defaultMapOptions}
        onLoad={onLoad}
      >
        {pickupLocation?.lat && (
          <Marker
            position={{ lat: pickupLocation.lat, lng: pickupLocation.lng }}
            label="A"
            title={pickupLocation.name || 'Pickup Location'}
          />
        )}
        {dropLocation?.lat && (
          <Marker
            position={{ lat: dropLocation.lat, lng: dropLocation.lng }}
            label="B"
            title={dropLocation.name || 'Drop Location'}
          />
        )}
        {directions && (
          <DirectionsRenderer
            directions={directions}
            options={{
              suppressMarkers: true,
              polylineOptions: {
                strokeColor: '#f59e0b',
                strokeWeight: 4,
              },
            }}
          />
        )}
      </GoogleMap>
    </div>
  );
}

// Live Tracking Map Component
export function LiveTrackingMap({ driverLocation, pickupLocation, dropLocation }) {
  const [map, setMap] = useState(null);
  const [directions, setDirections] = useState(null);
  const { isLoaded, hasApiKey } = useGoogleMaps();

  const center = useMemo(() => {
    if (driverLocation?.lat) return driverLocation;
    if (pickupLocation?.lat) return pickupLocation;
    return BIHAR_CENTER;
  }, [driverLocation, pickupLocation]);

  const onLoad = useCallback((map) => {
    setMap(map);
  }, []);

  // Update route when locations change
  useMemo(() => {
    if (!hasApiKey || !isLoaded) return;
    if (!driverLocation?.lat || !dropLocation?.lat) return;

    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: driverLocation.lat, lng: driverLocation.lng },
        destination: { lat: dropLocation.lat, lng: dropLocation.lng },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          setDirections(result);
        }
      }
    );
  }, [driverLocation, dropLocation, hasApiKey, isLoaded]);

  if (!hasApiKey || !isLoaded) {
    return (
      <div className="w-full h-96 bg-gray-100 rounded-lg flex items-center justify-center">
        <div className="text-center p-4">
          <div className="text-4xl mb-2">🚛</div>
          <p className="text-gray-600">Live Tracking</p>
          <p className="text-gray-500 text-xs mt-1">
            Add Google Maps API key for live tracking
          </p>
        </div>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height: '400px', borderRadius: '0.75rem' }}
      center={center}
      zoom={12}
      options={defaultMapOptions}
      onLoad={onLoad}
    >
      {pickupLocation?.lat && (
        <Marker
          position={{ lat: pickupLocation.lat, lng: pickupLocation.lng }}
          label="A"
          title="Pickup Location"
          icon={{
            url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
          }}
        />
      )}
      {dropLocation?.lat && (
        <Marker
          position={{ lat: dropLocation.lat, lng: dropLocation.lng }}
          label="B"
          title="Drop Location"
          icon={{
            url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
          }}
        />
      )}
      {driverLocation?.lat && (
        <Marker
          position={{ lat: driverLocation.lat, lng: driverLocation.lng }}
          title="Driver Location"
          icon={{
            url: 'http://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
          }}
        />
      )}
      {directions && (
        <DirectionsRenderer
          directions={directions}
          options={{
            suppressMarkers: true,
            polylineOptions: {
              strokeColor: '#f59e0b',
              strokeWeight: 4,
            },
          }}
        />
      )}
    </GoogleMap>
  );
}

// Simple Map for displaying a single location
export function SimpleMap({ location, height = '300px' }) {
  const { isLoaded, hasApiKey } = useGoogleMaps();
  const center = location?.lat ? location : BIHAR_CENTER;

  if (!hasApiKey || !isLoaded) {
    return (
      <div 
        className="w-full bg-gray-100 rounded-lg flex items-center justify-center"
        style={{ height }}
      >
        <div className="text-center p-4">
          <div className="text-4xl mb-2">📍</div>
          <p className="text-gray-600 text-sm">
            {location?.name || 'Location'}
          </p>
          <p className="text-gray-500 text-xs mt-1">
            Add Google Maps API key for map view
          </p>
        </div>
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height, borderRadius: '0.75rem' }}
      center={center}
      zoom={13}
      options={defaultMapOptions}
    >
      {location?.lat && (
        <Marker
          position={{ lat: location.lat, lng: location.lng }}
          title={location.name || 'Location'}
        />
      )}
    </GoogleMap>
  );
}

export default { useGoogleMaps, useDistanceCalculator, usePriceCalculator, LocationSearch, BookingMap, LiveTrackingMap, SimpleMap };

