const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { generateToken, protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/prisma');

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

    // Check if user exists (Prisma/PostgreSQL)
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email },
          { phone: phone }
        ]
      },
      select: { user_id: true }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user (Prisma/PostgreSQL)
    const newUser = await prisma.user.create({
      data: {
        first_name,
        last_name,
        email,
        phone,
        password_hash,
        address: address || null,
        city: city || 'Bihar',
        state: state || 'Bihar',
        pincode: pincode || null,
        role: 'customer',
        is_active: true,
      },
      select: { user_id: true }
    });

    const token = generateToken(newUser.user_id);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user_id: newUser.user_id,
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
  body('license_number').optional({ values: 'falsy' }).notEmpty().withMessage('License number is required'),
  body('license_expiry').optional({ values: 'falsy' }).notEmpty().withMessage('License expiry date is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { first_name, last_name, email, phone, password, license_number, license_expiry, address, city } = req.body;

    // Check if user exists (Prisma/PostgreSQL)
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: email },
          { phone: phone }
        ]
      },
      select: { user_id: true }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user as driver (Prisma/PostgreSQL)
    const newUser = await prisma.user.create({
      data: {
        first_name,
        last_name,
        email,
        phone,
        password_hash,
        address: address || null,
        city: city || 'Bihar',
        state: 'Bihar',
        role: 'driver',
        is_active: true,
      },
      select: { user_id: true }
    });

    const user_id = newUser.user_id;

    // Insert driver details via Prisma
    await prisma.driver.create({
      data: {
        user_id,
        driver_name: `${first_name} ${last_name}`,
        mobile: phone,
        license_number: license_number || null,
        license_expiry: license_expiry || null,
      },
    });

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

    // Find user (Prisma/PostgreSQL)
    const user = await prisma.user.findUnique({
      where: { email: email }
    });

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

    // Get driver details if user is driver via Prisma
    let driverData = null;
    if (user.role === 'driver') {
      driverData = await prisma.driver.findFirst({
        where: { user_id: user.user_id },
      });
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
    const user = await prisma.user.findUnique({
      where: { user_id: req.user.user_id },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        role: true,
        created_at: true,
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get driver details if user is driver via Prisma
    let driverData = null;
    if (user.role === 'driver') {
      driverData = await prisma.driver.findFirst({
        where: { user_id: user.user_id },
      });
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

// @route   GET /api/auth/admin/me
// @desc    Validate an admin JWT and return the authenticated admin.
//          Restores a persisted admin session on app startup.
//          Looks up the `admins` table (NOT the `users` table).
// @access  Private (Admin)
router.get('/admin/me', protect, async (req, res) => {
  try {
    // `protect` sets req.user. Admin tokens decode with type='admin' and are
    // looked up against the `admins` table. If the token was a user token,
    // req.user.role will not be an admin role — reject it.
    const adminRoles = ['admin', 'super_admin', 'operator'];
    if (!adminRoles.includes(req.user?.role)) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }

    return res.json({
      success: true,
      data: {
        id: req.user.user_id,
        admin_id: req.user.user_id,
        name: req.user.first_name || req.user.email || 'Administrator',
        full_name: req.user.first_name || req.user.email || 'Administrator',
        email: req.user.email,
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error('Admin me error:', error);
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { first_name, last_name, phone, address, city, state, pincode } = req.body;

    // Update user (Prisma/PostgreSQL)
    await prisma.user.update({
      where: { user_id: req.user.user_id },
      data: {
        first_name,
        last_name,
        phone,
        address,
        city,
        state,
        pincode,
      }
    });

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

    // Find admin (Prisma/PostgreSQL)
    const admin = await prisma.admin.findUnique({
      where: { email: email }
    });

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

