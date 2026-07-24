const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');

// Protect routes - verify JWT token (for users and drivers)
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if it's an admin token (has type: 'admin') or user token
      if (decoded.type === 'admin') {
        // Get admin from token via Prisma
        const admin = await prisma.admin.findUnique({
          where: { admin_id: decoded.id },
          select: {
            admin_id: true,
            full_name: true,
            email: true,
            role: true,
          },
        });

        if (!admin) {
          return res.status(401).json({
            success: false,
            message: 'Admin not found'
          });
        }

        req.user = {
          user_id: admin.admin_id,
          first_name: admin.full_name,
          email: admin.email,
          role: admin.role,
        };
        next();
      } else {
        // Get user from token via Prisma
        const user = await prisma.user.findUnique({
          where: { user_id: decoded.id },
          select: {
            user_id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            role: true,
          },
        });

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

