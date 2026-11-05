const express = require('express');
const router = express.Router();

// Search challans by vehicle number
router.get('/search/:vehicleNumber', (req, res) => {
  const { vehicleNumber } = req.params;
  
  // Check if there's any data in our bookings table that could relate to challans
  // For demo, we'll return mock data
  
  // Mock challan data for demo purposes
  const mockChallans = {
    'BR01AB1234': [
      {
        challan_id: 1,
        challan_number: 'CHL/BR/2024/001234',
        vehicle_number: 'BR01AB1234',
        violation_date: '2024-01-15 14:30:00',
        violation_type: 'Parking in No Parking Zone',
        violation_location: 'Main Market Road, Begusarai',
        fine_amount: 500,
        penalty_amount: 0,
        total_amount: 500,
        status: 'paid',
        payment_date: '2024-01-16 10:00:00'
      },
      {
        challan_id: 2,
        challan_number: 'CHL/BR/2024/001567',
        vehicle_number: 'BR01AB1234',
        violation_date: '2024-02-20 09:15:00',
        violation_type: 'Overspeeding',
        violation_location: 'NH31, Begusarai Bypass',
        fine_amount: 1000,
        penalty_amount: 200,
        total_amount: 1200,
        status: 'pending',
        payment_date: null
      }
    ],
    'BR01CD5678': [
      {
        challan_id: 3,
        challan_number: 'CHL/BR/2024/002345',
        vehicle_number: 'BR01CD5678',
        violation_date: '2024-03-10 16:45:00',
        violation_type: 'Red Light Violation',
        violation_location: 'Railway Station Crossing, Patna',
        fine_amount: 1500,
        penalty_amount: 0,
        total_amount: 1500,
        status: 'overdue',
        payment_date: null
      }
    ],
    'BR01EF9012': [
      {
        challan_id: 4,
        challan_number: 'CHL/BR/2024/003456',
        vehicle_number: 'BR01EF9012',
        violation_date: '2024-01-05 11:20:00',
        violation_type: 'Driving without Valid Documents',
        violation_location: 'Gandhi Chowk, Muzaffarpur',
        fine_amount: 2000,
        penalty_amount: 500,
        total_amount: 2500,
        status: 'paid',
        payment_date: '2024-01-10 14:30:00'
      }
    ],
    'BR01GH3456': []
  };
  
  const challans = mockChallans[vehicleNumber.toUpperCase()] || [];
  
  if (challans.length > 0) {
    return res.json({
      success: true,
      data: challans
    });
  }
  
  // Return empty array for unknown vehicles (no challans found)
  return res.json({
    success: true,
    data: []
  });
});

// Pay a challan
router.put('/:challanId/pay', (req, res) => {
  const { challanId } = req.params;
  const { payment_mode } = req.body;
  
  // In a real app, this would update the database
  // For demo, we'll simulate a successful payment
  
  console.log(`Processing payment for challan ${challanId} via ${payment_mode}`);
  
  return res.json({
    success: true,
    message: 'Challan paid successfully',
    data: {
      challan_id: challanId,
      status: 'paid',
      payment_date: new Date().toISOString(),
      payment_mode
    }
  });
});

// Get all challans (admin)
router.get('/', (req, res) => {
  // Return all mock challans
  const allChallans = [
    {
      challan_id: 1,
      challan_number: 'CHL/BR/2024/001234',
      vehicle_number: 'BR01AB1234',
      violation_date: '2024-01-15 14:30:00',
      violation_type: 'Parking in No Parking Zone',
      violation_location: 'Main Market Road, Begusarai',
      total_amount: 500,
      status: 'paid'
    },
    {
      challan_id: 2,
      challan_number: 'CHL/BR/2024/001567',
      vehicle_number: 'BR01AB1234',
      violation_date: '2024-02-20 09:15:00',
      violation_type: 'Overspeeding',
      violation_location: 'NH31, Begusarai Bypass',
      total_amount: 1200,
      status: 'pending'
    },
    {
      challan_id: 3,
      challan_number: 'CHL/BR/2024/002345',
      vehicle_number: 'BR01CD5678',
      violation_date: '2024-03-10 16:45:00',
      violation_type: 'Red Light Violation',
      violation_location: 'Railway Station Crossing, Patna',
      total_amount: 1500,
      status: 'overdue'
    },
    {
      challan_id: 4,
      challan_number: 'CHL/BR/2024/003456',
      vehicle_number: 'BR01EF9012',
      violation_date: '2024-01-05 11:20:00',
      violation_type: 'Driving without Valid Documents',
      violation_location: 'Gandhi Chowk, Muzaffarpur',
      total_amount: 2500,
      status: 'paid'
    }
  ];
  
  res.json({ success: true, data: allChallans });
});

module.exports = router;

