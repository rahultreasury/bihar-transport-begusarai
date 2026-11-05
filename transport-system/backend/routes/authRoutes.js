const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { generateToken, protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/prisma');
const { sendPasswordResetEmail } = require('../services/emailService');
const { sendOtpController, verifyOtpController } = require('../controllers/otpController');

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
  body('license_expiry').optional({ values: 'falsy' }).notEmpty().withMessage('License expiry date is required'),
  // Phase 2: transport_owner_id is REQUIRED. Every driver must belong to
  // a Transport Owner. If the user is registering themselves as a
  // Self-Owner, the public site should first POST /api/vehicle-owners
  // (or the public partner-apply endpoint) and then pass that owner's
  // id here. We do NOT auto-create owners on this path.
  body('transport_owner_id')
    .notEmpty().withMessage('Transport Owner is required. Every driver must belong to exactly one Transport Owner.')
    .bail()
    .isInt({ min: 1 }).withMessage('Transport Owner id must be a positive integer.'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { first_name, last_name, email, phone, password, license_number, license_expiry, address, city, transport_owner_id } = req.body;

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
    // Phase 2: transport_owner_id is required and is provided by the caller
    // after they have already registered / selected their Transport Owner
    // through the appropriate public endpoint.
    await prisma.driver.create({
      data: {
        user_id,
        driver_name: `${first_name} ${last_name}`,
        mobile: phone,
        license_number: license_number || null,
        license_expiry: license_expiry || null,
        transport_owner_id: parseInt(transport_owner_id, 10),
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
  const loginStart = Date.now();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user (Prisma/PostgreSQL) — email is indexed, select only required fields.
    const dbLookupStart = Date.now();
    const user = await prisma.user.findUnique({
      where: { email: email },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        role: true,
        city: true,
        address: true,
        is_active: true,
        password_hash: true,
      }
    });
    const dbLookupMs = Date.now() - dbLookupStart;

    if (!user) {
      console.log(`AUTH_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms result=invalid_credentials`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const passwordVerifyStart = Date.now();
    const isMatch = await bcrypt.compare(password, user.password_hash);
    const passwordVerifyMs = Date.now() - passwordVerifyStart;

    if (!isMatch) {
      console.log(`AUTH_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms result=invalid_credentials`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      console.log(`AUTH_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms result=deactivated`);
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const tokenGenStart = Date.now();
    const token = generateToken(user.user_id);
    const tokenGenMs = Date.now() - tokenGenStart;

    // Get driver details if user is driver via Prisma
    let driverData = null;
    if (user.role === 'driver') {
      driverData = await prisma.driver.findFirst({
        where: { user_id: user.user_id },
      });
    }

    const totalMs = Date.now() - loginStart;
    console.log(`AUTH_LOGIN duration=${totalMs}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms tokenGen=${tokenGenMs}ms result=success role=${user.role}`);

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

// @route   POST /api/auth/send-otp
// @desc    Send OTP to customer's phone for login
// @access  Public
router.post('/send-otp', [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .bail()
    .matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number required')
], sendOtpController);

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and authenticate customer
// @access  Public
router.post('/verify-otp', [
  body('phone')
    .notEmpty().withMessage('Phone number is required')
    .bail()
    .matches(/^[0-9]{10}$/).withMessage('Valid 10-digit phone number required'),
  body('otp')
    .notEmpty().withMessage('OTP is required')
    .bail()
    .matches(/^\d{6}$/).withMessage('OTP must be 6 digits')
], verifyOtpController);

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

// @route   POST /api/auth/forgot-password
// @desc    Request password reset link
// @access  Public
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email } = req.body;

    // Find user by email (User table covers customer, driver, partner)
    const user = await prisma.user.findUnique({
      where: { email },
      select: { user_id: true, first_name: true, last_name: true, email: true, role: true, is_active: true }
    });

    // Always return generic response to prevent email enumeration
    const genericResponse = {
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    };

    // Only proceed if user exists and is active
    if (user && user.is_active) {
      // Invalidate any existing unused reset tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: {
          user_id: user.user_id,
          used_at: null,
          expires_at: { gt: new Date() }
        },
        data: { used_at: new Date() }
      });

      // Generate cryptographically secure random token
      const rawToken = crypto.randomBytes(32).toString('hex');
      // Hash token for storage
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      // Token expires in 30 minutes
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      // Save token hash to database
      await prisma.passwordResetToken.create({
        data: {
          user_id: user.user_id,
          token_hash: tokenHash,
          expires_at: expiresAt
        }
      });

      // Construct reset URL
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

      // Send reset email (fire-and-forget, don't block response)
      const userName = `${user.first_name} ${user.last_name}`.trim();
      sendPasswordResetEmail({ email: user.email, resetUrl, userName })
        .then(result => {
          if (!result.success) {
            console.error(`[auth] Failed to send password reset email to ${email}:`, result.message);
          }
        })
        .catch(err => {
          console.error(`[auth] Error sending password reset email to ${email}:`, err.message);
        });
    }

    // Always return generic response
    res.json(genericResponse);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
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

    const { token, password } = req.body;

    // Hash the supplied token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find matching reset token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
      include: { user: { select: { user_id: true, email: true, is_active: true } } }
    });

    if (!resetToken) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Verify token is not expired
    if (resetToken.expires_at < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Reset token has expired'
      });
    }

    // Verify token has not been used
    if (resetToken.used_at) {
      return res.status(400).json({
        success: false,
        message: 'Reset token has already been used'
      });
    }

    // Verify user exists and is active
    if (!resetToken.user || !resetToken.user.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Update user's password
    await prisma.user.update({
      where: { user_id: resetToken.user.user_id },
      data: { password_hash: passwordHash }
    });

    // Mark reset token as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used_at: new Date() }
    });

    // Invalidate any other active reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        user_id: resetToken.user.user_id,
        used_at: null,
        expires_at: { gt: new Date() },
        id: { not: resetToken.id }
      },
      data: { used_at: new Date() }
    });

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
});

// @route   POST /api/auth/change-password
// @desc    Change password for authenticated user
// @access  Private
router.post('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.user_id;

    // Get user with password hash
    const user = await prisma.user.findUnique({
      where: { user_id: userId },
      select: { user_id: true, password_hash: true, is_active: true }
    });

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'User not found or deactivated'
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await prisma.user.update({
      where: { user_id: userId },
      data: { password_hash: passwordHash }
    });

    // Invalidate any active reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        user_id: userId,
        used_at: null,
        expires_at: { gt: new Date() }
      },
      data: { used_at: new Date() }
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password change'
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
  const loginStart = Date.now();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find admin (Prisma/PostgreSQL) — email is indexed, select only required fields.
    const dbLookupStart = Date.now();
    const admin = await prisma.admin.findUnique({
      where: { email: email },
      select: {
        admin_id: true,
        full_name: true,
        email: true,
        role: true,
        is_active: true,
        password_hash: true,
      }
    });
    const dbLookupMs = Date.now() - dbLookupStart;

    if (!admin) {
      console.log(`AUTH_ADMIN_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms result=invalid_credentials`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const passwordVerifyStart = Date.now();
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    const passwordVerifyMs = Date.now() - passwordVerifyStart;

    if (!isMatch) {
      console.log(`AUTH_ADMIN_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms result=invalid_credentials`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.is_active) {
      console.log(`AUTH_ADMIN_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms result=deactivated`);
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const tokenGenStart = Date.now();
    const token = generateToken(admin.admin_id, 'admin');
    const tokenGenMs = Date.now() - tokenGenStart;

    const totalMs = Date.now() - loginStart;
    console.log(`AUTH_ADMIN_LOGIN duration=${totalMs}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms tokenGen=${tokenGenMs}ms result=success role=${admin.role}`);

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

// @route   POST /api/auth/partner-login
// @desc    Login partner (transport owner/vehicle owner)
// @access  Public
router.post('/partner-login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  const loginStart = Date.now();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user with partner role (Prisma/PostgreSQL)
    const dbLookupStart = Date.now();
    const user = await prisma.user.findUnique({
      where: { email: email },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        email: true,
        phone: true,
        role: true,
        city: true,
        address: true,
        is_active: true,
        password_hash: true,
      }
    });
    const dbLookupMs = Date.now() - dbLookupStart;

    if (!user) {
      console.log(`AUTH_PARTNER_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms result=invalid_credentials`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check role is partner
    if (user.role !== 'partner') {
      console.log(`AUTH_PARTNER_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms result=invalid_role`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const passwordVerifyStart = Date.now();
    const isMatch = await bcrypt.compare(password, user.password_hash);
    const passwordVerifyMs = Date.now() - passwordVerifyStart;

    if (!isMatch) {
      console.log(`AUTH_PARTNER_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms result=invalid_credentials`);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      console.log(`AUTH_PARTNER_LOGIN duration=${Date.now() - loginStart}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms result=deactivated`);
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    const tokenGenStart = Date.now();
    const token = generateToken(user.user_id);
    const tokenGenMs = Date.now() - tokenGenStart;

    const totalMs = Date.now() - loginStart;
    console.log(`AUTH_PARTNER_LOGIN duration=${totalMs}ms dbLookup=${dbLookupMs}ms passwordVerify=${passwordVerifyMs}ms tokenGen=${tokenGenMs}ms result=success role=${user.role}`);

    res.json({
      success: true,
      message: 'Partner login successful',
      data: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        city: user.city,
        address: user.address,
      },
      token
    });
  } catch (error) {
    console.error('Partner login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

module.exports = router;

