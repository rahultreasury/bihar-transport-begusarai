const axios = require('axios');

const GOOGLE_API_BASE = 'https://maps.googleapis.com/maps/api';

const getVehicleRate = (vehicleType) => {
  const rates = {
    truck: 25,
    mini_truck: 18,
    pickup: 15,
    tempo: 12,
    lorry: 25,
  };
  return rates[vehicleType] ?? null;
};

const formatDuration = (durationSeconds) => {
  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hours ${minutes} mins`;
};

const isValidLatLng = (lat, lng) => {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
};

const calculateDistanceMatrix = async ({ pickup, drop, apiKey }) => {
  const url = `${GOOGLE_API_BASE}/distancematrix/json`;

  const response = await axios.get(url, {
    params: {
      origins: `${pickup.lat},${pickup.lng}`,
      destinations: `${drop.lat},${drop.lng}`,
      mode: 'driving',
      units: 'metric',
      key: apiKey,
    },
    timeout: 15000,
  });

  const data = response.data;

  if (data.status !== 'OK') {
    throw new Error(`Google Distance Matrix status: ${data.status}`);
  }

  const element = data.rows?.[0]?.elements?.[0];
  const elementStatus = element?.status;

  if (elementStatus !== 'OK') {
    throw new Error(`Google Distance Matrix element status: ${elementStatus}`);
  }

  const distanceMeters = element.distance.value;
  const durationSeconds = element.duration.value;

  const distanceKm = Math.round(distanceMeters / 1000);
  const duration = formatDuration(durationSeconds);

  return { distanceKm, duration };
};

const calculatePriceHandler = async (req, res) => {
  try {
    const { pickup, drop, vehicleType } = req.body ?? {};

    const pickupLat = pickup?.lat;
    const pickupLng = pickup?.lng;
    const dropLat = drop?.lat;
    const dropLng = drop?.lng;

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || '';

    console.log("GOOGLE_MAPS_API_KEY exists:", !!process.env.GOOGLE_MAPS_API_KEY);
    console.log("Length:", process.env.GOOGLE_MAPS_API_KEY?.length);
    console.log("Preview:", process.env.GOOGLE_MAPS_API_KEY?.substring(0,10));

    if (!pickup?.address || !drop?.address) {
      return res.status(400).json({
        success: false,
        message: 'pickup.address and drop.address are required',
      });
    }

    if (!isValidLatLng(pickupLat, pickupLng) || !isValidLatLng(dropLat, dropLng)) {
      return res.status(400).json({
        success: false,
        message: 'pickup/drop lat,lng are invalid',
      });
    }

    if (pickupLat === dropLat && pickupLng === dropLng) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and Drop locations cannot be the same',
      });
    }

    const rate = getVehicleRate(vehicleType);
    if (!rate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicleType',
      });
    }

    if (!googleApiKey) {
      // Fallback when API key is missing
      const fallbackKm = Math.round(
        Math.sqrt(
          Math.pow((pickupLat - dropLat) * 111, 2) +
            Math.pow(
              (pickupLng - dropLng) *
                111 *
                Math.cos((pickupLat * Math.PI) / 180),
              2
            )
        )
      );
      const distanceKm = Math.max(fallbackKm, 1);
      const price = Math.round(distanceKm * rate);
      return res.json({
        success: true,
        distanceKm,
        duration: '0 hours 0 mins',
        price,
        warning: 'GOOGLE_MAPS_API_KEY missing - using fallback distance',
      });
    }

    const { distanceKm, duration } = await calculateDistanceMatrix({
      pickup: { lat: pickupLat, lng: pickupLng },
      drop: { lat: dropLat, lng: dropLng },
      apiKey: googleApiKey,
    });

    const price = Math.round(distanceKm * rate);

    return res.json({
      success: true,
      distanceKm,
      duration,
      price,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to calculate price',
    });
  }
};

module.exports = {
  calculatePriceHandler,
};

