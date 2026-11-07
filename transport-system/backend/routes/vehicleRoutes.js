const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');
const { protect, adminOnly } = require('../middleware/auth');
const { lookupVehicle, lookupStatus } = require('../controllers/vehicleLookupController');

// RC lookup via the backend-only Parse CarInfo proxy.
// `PARSE_API_KEY` is read server-side (backend/.env) and is never exposed to the
// client — the React app always calls this endpoint, never Parse directly.
router.get('/lookup/status', protect, adminOnly, lookupStatus);
router.get('/lookup', protect, adminOnly, lookupVehicle);

// Search vehicle by registration number (public - redacted)
router.get('/search/:registrationNumber', async (req, res) => {
  try {
    const { registrationNumber } = req.params;
    
    // First check in transport_vehicles table (our drivers' vehicles)
    const vehicle = await prisma.transportVehicle.findFirst({
      where: { vehicle_number: registrationNumber },
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_type: true,
        vehicle_name: true,
        vehicle_make: true,
        vehicle_model: true,
        manufacturing_year: true,
        registration_date: true,
        insurance_number: true,
        insurance_expiry: true,
        permit_number: true,
        permit_expiry: true,
        pollution_certificate: true,
        pollution_expiry: true,
        is_verified: true,
        current_status: true,
        base_location: true,
      },
    });
    
    if (vehicle) {
      const today = new Date().toISOString().split('T')[0];
      const insuranceValid = vehicle.insurance_expiry && vehicle.insurance_expiry > today;
      const permitValid = vehicle.permit_expiry && vehicle.permit_expiry > today;
      
      return res.json({
        success: true,
        data: {
          vehicle_id: vehicle.vehicle_id,
          registration_number: vehicle.vehicle_number,
          vehicle_type: vehicle.vehicle_type,
          vehicle_name: vehicle.vehicle_name,
          vehicle_make: vehicle.vehicle_make,
          vehicle_model: vehicle.vehicle_model,
          manufacturing_year: vehicle.manufacturing_year,
          registration_date: vehicle.registration_date,
          insurance_number: vehicle.insurance_number,
          insurance_expiry: vehicle.insurance_expiry,
          pollution_validity: vehicle.pollution_certificate,
          permit_number: vehicle.permit_number,
          permit_expiry: vehicle.permit_expiry,
          is_verified: vehicle.is_verified,
          current_status: vehicle.current_status,
          base_location: vehicle.base_location,
          status: (insuranceValid && permitValid) ? 'active' : (!insuranceValid || !permitValid) ? 'expired' : 'suspended',
          registration_validity: vehicle.permit_expiry,
        },
      });
    }
    
    // If not found in our database, return mock data for demo purposes (redacted)
    const mockVehicles = {
      'BR01AB1234': {
        registration_number: 'BR01AB1234',
        vehicle_type: 'four_wheeler',
        vehicle_make: 'Maruti',
        vehicle_model: 'Swift Dzire',
        manufacturing_year: 2020,
        registration_date: '2020-05-15',
        registration_validity: '2040-05-14',
        insurance_validity: '2025-06-15',
        pollution_validity: '2025-04-20',
        owner_name: 'Vehicle Owner',
        status: 'active',
        owner: { email: '***@***.com', phone: '**********' }
      },
      'BR01CD5678': {
        registration_number: 'BR01CD5678',
        vehicle_type: 'commercial',
        vehicle_make: 'Tata',
        vehicle_model: 'Ace',
        manufacturing_year: 2021,
        registration_date: '2021-03-10',
        registration_validity: '2041-03-09',
        insurance_validity: '2025-08-20',
        pollution_validity: '2025-07-15',
        owner_name: 'Vehicle Owner',
        status: 'active',
        owner: { email: '***@***.com', phone: '**********' }
      },
      'BR01EF9012': {
        registration_number: 'BR01EF9012',
        vehicle_type: 'four_wheeler',
        vehicle_make: 'Hyundai',
        vehicle_model: 'Creta',
        manufacturing_year: 2019,
        registration_date: '2019-11-20',
        registration_validity: '2039-11-19',
        insurance_validity: '2024-12-01',
        pollution_validity: '2024-10-15',
        owner_name: 'Vehicle Owner',
        status: 'expired',
        owner: { email: '***@***.com', phone: '**********' }
      },
      'BR01GH3456': {
        registration_number: 'BR01GH3456',
        vehicle_type: 'heavy_vehicle',
        vehicle_make: 'BharatBenz',
        vehicle_model: '2820R',
        manufacturing_year: 2018,
        registration_date: '2018-08-05',
        registration_validity: '2038-08-04',
        insurance_validity: '2025-02-28',
        pollution_validity: '2025-01-20',
        owner_name: 'Vehicle Owner',
        status: 'active',
        owner: { email: '***@***.com', phone: '**********' }
      }
    };
    
    const mockVehicle = mockVehicles[registrationNumber.toUpperCase()];
    if (mockVehicle) {
      return res.json({
        success: true,
        data: mockVehicle
      });
    }
    
    return res.status(404).json({
      success: false,
      message: 'Vehicle not found'
    });
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({
      success: false,
      message: 'Database error',
    });
  }
});

// Get all vehicles (public - redacted)
router.get('/', async (req, res) => {
  try {
    const vehicles = await prisma.transportVehicle.findMany({
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_type: true,
        vehicle_name: true,
        capacity_kg: true,
        capacity_volume: true,
        vehicle_make: true,
        vehicle_model: true,
        manufacturing_year: true,
        registration_date: true,
        insurance_number: true,
        insurance_expiry: true,
        permit_number: true,
        permit_expiry: true,
        pollution_certificate: true,
        pollution_expiry: true,
        is_available: true,
        is_verified: true,
        current_status: true,
        base_location: true,
        hourly_rate: true,
        per_km_rate: true,
        created_at: true,
        updated_at: true,
      },
    });

    res.json({ success: true, data: vehicles });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

module.exports = router;

