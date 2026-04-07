const jwt = require('jsonwebtoken');
const { get } = require('../config/database');

// Protect routes - verify JWT token (for users and drivers)
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if it's an admin token (has type: 'admin') or user token
      if (decoded.type === 'admin') {
        // Get admin from token
        const admin = await get(
          'SELECT admin_id as user_id, full_name as first_name, email, role FROM admins WHERE admin_id = ?',
          [decoded.id]
        );

        if (!admin) {
          return res.status(401).json({
            success: false,
            message: 'Admin not found'
          });
        }

        req.user = admin;
        req.user.role = admin.role; // Use the admin role (super_admin, admin, operator)
        next();
      } else {
        // Get user from token
        const user = await get(
          'SELECT user_id, first_name, last_name, email, phone, role FROM users WHERE user_id = ?',
          [decoded.id]
        );

        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'User not found'
          });
        }

        req.user = user;
        next();
      }
    } catch (error) {
      console.error('Auth middleware error:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token failed'
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token'
    });
  }
};

// Admin middleware
const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'operator')) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
};

// Generate JWT token (for users and drivers)
const generateToken = (id, type = 'user') => {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

module.exports = { protect, adminOnly, generateToken };

