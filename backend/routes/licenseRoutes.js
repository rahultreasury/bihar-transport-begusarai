const express = require('express');
const router = express.Router();
const { db } = require('../config/database');

// Search license by license number
router.get('/search/:licenseNumber', (req, res) => {
  const { licenseNumber } = req.params;
  
  // First check in drivers table (our registered drivers)
  const sql = `
    SELECT 
      d.driver_id,
      d.license_number,
      d.license_expiry,
      d.aadhar_number,
      d.date_of_birth,
      d.gender,
      d.is_verified,
      d.rating,
      d.total_deliveries,
      u.first_name || ' ' || u.last_name as holder_name,
      u.email,
      u.phone,
      'permanent' as license_type,
      'Bihar' as state,
      'RTO Begusarai' as issuing_authority,
      CASE 
        WHEN d.license_expiry > date('now') THEN 'active'
        ELSE 'expired'
      END as status
    FROM drivers d
    LEFT JOIN users u ON d.user_id = u.user_id
    WHERE d.license_number = ?
  `;
  
  db.get(sql, [licenseNumber], (err, license) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({
        success: false,
        message: 'Database error'
      });
    }
    
    if (license) {
      const today = new Date();
      const expiry = new Date(license.license_expiry);
      const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
      
      let expiry_status = 'valid';
      if (diffDays < 0) expiry_status = 'expired';
      else if (diffDays <= 30) expiry_status = 'expiring_soon';
      
      return res.json({
        success: true,
        data: {
          ...license,
          issue_date: '2020-01-15',
          expiry_date: license.license_expiry,
          expiry_status,
          blood_group: 'O+',
          contact: {
            email: license.email,
            phone: license.phone
          }
        }
      });
    }
    
    // If not found in our database, return mock data for demo purposes
    const mockLicenses = {
      'DL/BR/012345/2020': {
        license_number: 'DL/BR/012345/2020',
        license_type: 'permanent',
        state: 'Bihar',
        issuing_authority: 'RTO Begusarai',
        holder_name: 'Rahul Kumar',
        date_of_birth: '1990-05-15',
        gender: 'male',
        blood_group: 'O+',
        issue_date: '2020-01-15',
        expiry_date: '2030-06-15',
        status: 'active',
        expiry_status: 'valid'
      },
      'DL/BR/067890/2021': {
        license_number: 'DL/BR/067890/2021',
        license_type: 'permanent',
        state: 'Bihar',
        issuing_authority: 'RTO Patna',
        holder_name: 'Priya Singh',
        date_of_birth: '1992-08-22',
        gender: 'female',
        blood_group: 'A+',
        issue_date: '2021-03-20',
        expiry_date: '2031-03-20',
        status: 'active',
        expiry_status: 'valid'
      },
      'DL/BR/023456/2019': {
        license_number: 'DL/BR/023456/2019',
        license_type: 'commercial',
        state: 'Bihar',
        issuing_authority: 'RTO Muzaffarpur',
        holder_name: 'Amit Pandey',
        date_of_birth: '1988-12-01',
        gender: 'male',
        blood_group: 'B+',
        issue_date: '2019-11-10',
        expiry_date: '2029-11-10',
        status: 'active',
        expiry_status: 'valid'
      },
      'DL/BR/078901/2023': {
        license_number: 'DL/BR/078901/2023',
        license_type: 'learner',
        state: 'Bihar',
        issuing_authority: 'RTO Bhagalpur',
        holder_name: 'Sanjay Kumar',
        date_of_birth: '1995-03-10',
        gender: 'male',
        blood_group: 'AB+',
        issue_date: '2023-06-01',
        expiry_date: '2024-06-01',
        status: 'expired',
        expiry_status: 'expired'
      }
    };
    
    const mockLicense = mockLicenses[licenseNumber.toUpperCase()];
    if (mockLicense) {
      return res.json({
        success: true,
        data: mockLicense
      });
    }
    
    return res.status(404).json({
      success: false,
      message: 'License not found'
    });
  });
});

// Get all licenses (admin)
router.get('/', (req, res) => {
  const sql = `
    SELECT d.*, u.first_name, u.last_name, u.email, u.phone
    FROM drivers d
    LEFT JOIN users u ON d.user_id = u.user_id
  `;
  
  db.all(sql, [], (err, licenses) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    res.json({ success: true, data: licenses });
  });
});

module.exports = router;

