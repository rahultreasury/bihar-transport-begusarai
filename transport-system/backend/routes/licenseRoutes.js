const express = require('express');
const router = express.Router();
const { prisma } = require('../config/prisma');

// Search license by license number
router.get('/search/:licenseNumber', async (req, res) => {
  try {
    const { licenseNumber } = req.params;
    
    // First check in drivers table (our registered drivers)
    const license = await prisma.driver.findFirst({
      where: { license_number: licenseNumber },
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
    });
    
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
          driver_id: license.driver_id,
          license_number: license.license_number,
          license_expiry: license.license_expiry,
          is_verified: license.is_verified,
          rating: license.rating,
          total_deliveries: license.total_deliveries,
          holder_name: `${license.user.first_name} ${license.user.last_name}`,
          email: license.user.email,
          phone: license.user.phone,
          license_type: 'permanent',
          state: 'Bihar',
          issuing_authority: 'RTO Begusarai',
          status: license.license_expiry > new Date().toISOString().split('T')[0] ? 'active' : 'expired',
          issue_date: '2020-01-15',
          expiry_date: license.license_expiry,
          expiry_status,
          contact: {
            email: license.user.email,
            phone: license.user.phone,
          },
        },
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
  } catch (error) {
    console.error('Database error:', error);
    return res.status(500).json({
      success: false,
      message: 'Database error',
    });
  }
});

// Get all licenses (admin)
router.get('/', async (req, res) => {
  try {
    const licenses = await prisma.driver.findMany({
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
    });

    // Flatten to match original SQL response format
    const flattened = licenses.map((d) => ({
      driver_id: d.driver_id,
      user_id: d.user_id,
      license_number: d.license_number,
      license_expiry: d.license_expiry,
      profile_image: d.profile_image,
      is_available: d.is_available,
      is_verified: d.is_verified,
      rating: d.rating,
      total_deliveries: d.total_deliveries,
      created_at: d.created_at,
      updated_at: d.updated_at,
      first_name: d.user.first_name,
      last_name: d.user.last_name,
      email: d.user.email,
      phone: d.user.phone,
    }));

    res.json({ success: true, data: flattened });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

module.exports = router;

