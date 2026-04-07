const express = require('express');
const router = express.Router();
const { db } = require('../config/database');

// Search vehicle by registration number
router.get('/search/:registrationNumber', (req, res) => {
  const { registrationNumber } = req.params;
  
  // First check in transport_vehicles table (our drivers' vehicles)
  const sql = `
    SELECT 
      v.vehicle_id,
      v.vehicle_number as registration_number,
      v.vehicle_type,
      v.vehicle_name,
      v.vehicle_make,
      v.vehicle_model,
      v.manufacturing_year,
      v.registration_date,
      v.insurance_number,
      v.insurance_expiry,
      v.pollution_certificate as pollution_validity,
      v.permit_number,
      v.permit_expiry,
      v.is_verified,
      v.current_status,
      v.base_location,
      u.first_name || ' ' || u.last_name as owner_name,
      u.email,
      u.phone,
      CASE 
        WHEN v.insurance_expiry > date('now') AND v.permit_expiry > date('now') THEN 'active'
        WHEN v.insurance_expiry <= date('now') OR v.permit_expiry <= date('now') THEN 'expired'
        ELSE 'suspended'
      END as status
    FROM transport_vehicles v
    LEFT JOIN drivers d ON v.driver_id = d.driver_id
    LEFT JOIN users u ON d.user_id = u.user_id
    WHERE v.vehicle_number = ?
  `;
  
  db.get(sql, [registrationNumber], (err, vehicle) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error'
      });
    }
    
    if (vehicle) {
      return res.json({
        success: true,
        data: {
          ...vehicle,
          owner: {
            email: vehicle.email,
            phone: vehicle.phone
          },
          registration_validity: vehicle.permit_expiry
        }
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
  });
});

// Get all vehicles (admin)
router.get('/', (req, res) => {
  const sql = `
    SELECT v.*, u.first_name, u.last_name 
    FROM transport_vehicles v
    LEFT JOIN drivers d ON v.driver_id = d.driver_id
    LEFT JOIN users u ON d.user_id = u.user_id
  `;
  
  db.all(sql, [], (err, vehicles) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, data: vehicles });
  });
});

module.exports = router;

