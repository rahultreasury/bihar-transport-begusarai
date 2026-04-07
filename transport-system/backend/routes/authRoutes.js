const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query, run, get } = require('../config/database');
const { generateToken, protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// @route   POST /api/auth/signup
// @desc    Register a new user (customer)
// @access  Public
router.post('/signup', [
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { first_name, last_name, email, phone, password, address, city, state, pincode } = req.body;

    // Check if user exists
    const existingUser = await get(
      'SELECT user_id FROM users WHERE email = ? OR phone = ?',
      [email, phone]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await run(
      'INSERT INTO users (first_name, last_name, email, phone, password_hash, address, city, state, pincode, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [first_name, last_name, email, phone, password_hash, address || null, city || 'Bihar', state || 'Bihar', pincode || null, 'customer']
    );

    const token = generateToken(result.lastID);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user_id: result.lastID,
        first_name,
        last_name,
        email,
        phone,
        role: 'customer'
      },
      token
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @route   POST /api/auth/driver-signup
// @desc    Register a new driver
// @access  Public
router.post('/driver-signup', [
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('license_number').notEmpty().withMessage('License number is required'),
  body('license_expiry').notEmpty().withMessage('License expiry date is required'),
  body('aadhar_number').matches(/^[0-9]{12}$/).withMessage('Valid 12-digit Aadhar required'),
  body('date_of_birth').notEmpty().withMessage('Date of birth is required'),
  body('gender').isIn(['male', 'female', 'other']).withMessage('Valid gender required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { first_name, last_name, email, phone, password, license_number, license_expiry, aadhar_number, date_of_birth, gender, address, city, experience_years } = req.body;

    // Check if user exists
    const existingUser = await get(
      'SELECT user_id FROM users WHERE email = ? OR phone = ?',
      [email, phone]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user as driver
    const userResult = await run(
      'INSERT INTO users (first_name, last_name, email, phone, password_hash, address, city, state, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [first_name, last_name, email, phone, password_hash, address || null, city || 'Bihar', 'Bihar', 'driver']
    );

    const user_id = userResult.lastID;

    // Insert driver details
    await run(
      'INSERT INTO drivers (user_id, license_number, license_expiry, aadhar_number, date_of_birth, gender, experience_years) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [user_id, license_number, license_expiry, aadhar_number, date_of_birth, gender, experience_years || 0]
    );

    const token = generateToken(user_id);

    res.status(201).json({
      success: true,
      message: 'Driver registered successfully',
      data: {
        user_id,
        first_name,
        last_name,
        email,
        phone,
        role: 'driver'
      },
      token
    });
  } catch (error) {
    console.error('Driver signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during driver registration'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const token = generateToken(user.user_id);

    // Get driver details if user is driver
    let driverData = null;
    if (user.role === 'driver') {
      driverData = await get('SELECT * FROM drivers WHERE user_id = ?', [user.user_id]);
    }

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        city: user.city,
        address: user.address,
        ...(driverData && { driver: driverData })
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await get(
      'SELECT user_id, first_name, last_name, email, phone, address, city, state, pincode, role, created_at FROM users WHERE user_id = ?',
      [req.user.user_id]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get driver details if user is driver
    let driverData = null;
    if (user.role === 'driver') {
      driverData = await get('SELECT * FROM drivers WHERE user_id = ?', [user.user_id]);
    }

    res.json({
      success: true,
      data: {
        ...user,
        ...(driverData && { driver: driverData })
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { first_name, last_name, phone, address, city, state, pincode } = req.body;

    await run(
      'UPDATE users SET first_name = ?, last_name = ?, phone = ?, address = ?, city = ?, state = ?, pincode = ? WHERE user_id = ?',
      [first_name, last_name, phone, address, city, state, pincode, req.user.user_id]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   POST /api/auth/admin-login
// @desc    Login admin
// @access  Public
router.post('/admin-login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find admin
    const admin = await get('SELECT * FROM admins WHERE email = ?', [email]);

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const token = generateToken(admin.admin_id, 'admin');

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        admin_id: admin.admin_id,
        full_name: admin.full_name,
        email: admin.email,
        role: admin.role
      },
      token
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

module.exports = router;

