const { getVehiclePricing } = require('../services/vehiclePricing');
// Phase 5: the Google Maps integration was moved, unchanged, into
// services/distanceMatrix.js so pricing and trip ETA share ONE provider, one
// API key and one error shape instead of two. Behaviour of this controller is
// unchanged.
const {
  isValidLatLng,
  calculateDistanceMatrix,
} = require('../services/distanceMatrix');

const calculatePriceHandler = async (req, res) => {
  try {
    const { pickup, drop, vehicleType } = req.body ?? {};

    const pickupLat = pickup?.lat;
    const pickupLng = pickup?.lng;
    const dropLat = drop?.lat;
    const dropLng = drop?.lng;

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || '';

    if (process.env.NODE_ENV === 'development') {
      console.log('GOOGLE_MAPS_API_KEY exists:', !!process.env.GOOGLE_MAPS_API_KEY);
      console.log('Length:', process.env.GOOGLE_MAPS_API_KEY?.length);
      console.log('Preview:', process.env.GOOGLE_MAPS_API_KEY?.substring(0, 10));
    }

    // Current contract expects address fields too (even if lat/lng are used)
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

    const pricing = getVehiclePricing(vehicleType);
    if (!pricing) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicleType',
      });
    }

    const { rate, min: rateMin, max: rateMax } = pricing;

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
        rate,
        rateMin,
        rateMax,
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
      rate,
      rateMin,
      rateMax,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || 'Failed to calculate price',
    });
  }
};

module.exports = {
  calculatePriceHandler,
};

