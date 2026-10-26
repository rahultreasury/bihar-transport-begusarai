import React, { useMemo, useState, useEffect } from 'react';
import { GoogleMap, Marker, DirectionsRenderer, useJsApiLoader } from '@react-google-maps/api';

const containerStyle = {
  width: '100%',
  height: '100%',
  minHeight: '400px',
};

const defaultCenter = {
  lat: 25.4167,
  lng: 86.1333, // Begusarai, Bihar
};

/**
 * TrackingMap - Interactive map showing pickup, destination, and vehicle location
 * @param {{ booking: Object }} props
 */
const TrackingMap = React.memo(function TrackingMap({ booking }) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
  });

  const [directions, setDirections] = useState(null);
  const [map, setMap] = useState(null);

  const pickupLocation = useMemo(() => {
    if (booking?.pickup_latitude && booking?.pickup_longitude) {
      return { lat: booking.pickup_latitude, lng: booking.pickup_longitude };
    }
    return null;
  }, [booking?.pickup_latitude, booking?.pickup_longitude]);

  const dropLocation = useMemo(() => {
    if (booking?.drop_latitude && booking?.drop_longitude) {
      return { lat: booking.drop_latitude, lng: booking.drop_longitude };
    }
    return null;
  }, [booking?.drop_latitude, booking?.drop_longitude]);

  const vehicleLocation = useMemo(() => {
    if (booking?.current_latitude && booking?.current_longitude) {
      return { lat: booking.current_latitude, lng: booking.current_longitude };
    }
    return null;
  }, [booking?.current_latitude, booking?.current_longitude]);

  // Calculate directions when pickup and drop are available
  useEffect(() => {
    if (!isLoaded || !pickupLocation || !dropLocation || !window.google) {
      setDirections(null);
      return;
    }

    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: pickupLocation,
        destination: dropLocation,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          setDirections(result);
        } else {
          console.warn('Directions request failed:', status);
          setDirections(null);
        }
      }
    );
  }, [isLoaded, pickupLocation, dropLocation]);

  // Fit map to show all markers
  useEffect(() => {
    if (!map || !isLoaded) return;

    const bounds = new window.google.maps.LatLngBounds();
    if (pickupLocation) bounds.extend(pickupLocation);
    if (dropLocation) bounds.extend(dropLocation);
    if (vehicleLocation) bounds.extend(vehicleLocation);

    if (bounds.isEmpty()) {
      map.setCenter(defaultCenter);
      map.setZoom(10);
    } else {
      map.fitBounds(bounds);
      // Add some padding
      map.setZoom(Math.min(map.getZoom(), 15));
    }
  }, [map, isLoaded, pickupLocation, dropLocation, vehicleLocation]);

  const onLoad = React.useCallback((mapInstance) => {
    setMap(mapInstance);
  }, []);

  const onUnmount = React.useCallback(() => {
    setMap(null);
  }, []);

  if (!isLoaded) {
    return (
      <div className="w-full h-full min-h-[400px] bg-slate-100 flex items-center justify-center rounded-2xl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF9500] mx-auto mb-2"></div>
          <p className="text-sm text-slate-600">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[400px] rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={defaultCenter}
        zoom={10}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          zoomControl: true,
        }}
      >
        {/* Pickup Marker */}
        {pickupLocation && (
          <Marker
            position={pickupLocation}
            icon={{
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="16" cy="16" r="12" fill="#10b981" stroke="#ffffff" stroke-width="2"/>
                  <text x="16" y="20" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="bold">P</text>
                </svg>
              `),
              scaledSize: new window.google.maps.Size(32, 32),
            }}
            title="Pickup Location"
          />
        )}

        {/* Destination Marker */}
        {dropLocation && (
          <Marker
            position={dropLocation}
            icon={{
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="16" cy="16" r="12" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
                  <text x="16" y="20" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="bold">D</text>
                </svg>
              `),
              scaledSize: new window.google.maps.Size(32, 32),
            }}
            title="Destination Location"
          />
        )}

        {/* Vehicle Marker */}
        {vehicleLocation && (
          <Marker
            position={vehicleLocation}
            icon={{
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="36" height="36" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="18" cy="18" r="14" fill="#ff9500" stroke="#ffffff" stroke-width="3"/>
                  <path d="M12 14h12v6H12zm2 0v-2h8v2" fill="#ffffff"/>
                </svg>
              `),
              scaledSize: new window.google.maps.Size(36, 36),
            }}
            title="Vehicle Location"
            animation={window.google.maps.Animation.BOUNCE}
          />
        )}

        {/* Route Directions */}
        {directions && (
          <DirectionsRenderer
            directions={directions}
            options={{
              suppressMarkers: true, // We use custom markers
              polylineOptions: {
                strokeColor: '#ff9500',
                strokeWeight: 4,
                strokeOpacity: 0.8,
              },
            }}
          />
        )}
      </GoogleMap>

      {/* Map Info Bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm p-3 border-t border-slate-200 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          {vehicleLocation && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-[#ff9500] rounded-full animate-pulse"></span>
              <span className="text-slate-700">Live vehicle location</span>
            </div>
          )}
          {booking?.last_location_update && (
            <span className="text-slate-500">
              Updated: {new Date(booking.last_location_update).toLocaleString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                day: 'numeric',
                month: 'short',
              })}
            </span>
          )}
        </div>
        <div className="text-slate-500">
          {!vehicleLocation && !pickupLocation && !dropLocation && 'No location data available'}
          {!vehicleLocation && (pickupLocation || dropLocation) && 'Live vehicle location not available yet'}
        </div>
      </div>
    </div>
  );
});

export default TrackingMap;
