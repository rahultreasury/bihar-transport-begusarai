const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');

// Search vehicle by registration number
router.get('/search/:registrationNumber', async (req, res) => {
  try {
    const { registrationNumber } = req.params;
    
    // First check in transport_vehicles table (our drivers' vehicles)
    const vehicle = await prisma.transportVehicle.findFirst({
      where: { vehicle_number: registrationNumber },
      include: {
        driver: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });
    
    if (vehicle && vehicle.driver) {
      const ownerName = `${vehicle.driver.user.first_name} ${vehicle.driver.user.last_name}`;
      
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
          owner_name: ownerName,
          email: vehicle.driver.user.email,
          phone: vehicle.driver.user.phone,
          status: (vehicle.insurance_expiry > new Date().toISOString().split('T')[0] && vehicle.permit_expiry > new Date().toISOString().split('T')[0])
            ? 'active'
            : (vehicle.insurance_expiry <= new Date().toISOString().split('T')[0] || vehicle.permit_expiry <= new Date().toISOString().split('T')[0])
              ? 'expired'
              : 'suspended',
          owner: {
            email: vehicle.driver.user.email,
            phone: vehicle.driver.user.phone,
          },
          registration_validity: vehicle.permit_expiry,
        },
      });
    }
    
    // If not found in our database, return mock data for demo purposes
    // This simulates a real vehicle registration database
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
        owner_name: 'Rajesh Kumar',
        status: 'active',
        owner: { email: 'rajesh.kumar@email.com', phone: '9876543210' }
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
        owner_name: 'Mohammad Shahnawaz',
        status: 'active',
        owner: { email: 'shahnawaz@email.com', phone: '9876543211' }
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
        owner_name: 'Priya Sharma',
        status: 'expired',
        owner: { email: 'priya.sharma@email.com', phone: '9876543212' }
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
        owner_name: 'Ramu Transport Co.',
        status: 'active',
        owner: { email: 'ramutransport@email.com', phone: '9876543213' }
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

// Get all vehicles (admin)
router.get('/', async (req, res) => {
  try {
    const vehicles = await prisma.transportVehicle.findMany({
      include: {
        driver: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    // Flatten to match original SQL response format
    const flattened = vehicles.map((v) => ({
      vehicle_id: v.vehicle_id,
      driver_id: v.driver_id,
      vehicle_number: v.vehicle_number,
      vehicle_type: v.vehicle_type,
      vehicle_name: v.vehicle_name,
      capacity_kg: v.capacity_kg,
      capacity_volume: v.capacity_volume,
      vehicle_make: v.vehicle_make,
      vehicle_model: v.vehicle_model,
      manufacturing_year: v.manufacturing_year,
      registration_date: v.registration_date,
      insurance_number: v.insurance_number,
      insurance_expiry: v.insurance_expiry,
      permit_number: v.permit_number,
      permit_expiry: v.permit_expiry,
      pollution_certificate: v.pollution_certificate,
      pollution_expiry: v.pollution_expiry,
      is_available: v.is_available,
      is_verified: v.is_verified,
      current_status: v.current_status,
      base_location: v.base_location,
      hourly_rate: v.hourly_rate,
      per_km_rate: v.per_km_rate,
      created_at: v.created_at,
      updated_at: v.updated_at,
      first_name: v.driver?.user?.first_name ?? null,
      last_name: v.driver?.user?.last_name ?? null,
    }));

    res.json({ success: true, data: flattened });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

module.exports = router;

