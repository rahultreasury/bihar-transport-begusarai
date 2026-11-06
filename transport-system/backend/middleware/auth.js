const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');

// Prisma / PostgreSQL connection-error codes that indicate the database is
// temporarily unreachable. These MUST be treated as infrastructure failures
// (503 Service Unavailable), never as invalid credentials (401).
const DB_CONNECTION_ERROR_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database connection timed out
  'P1003', // Database connection was closed
  'P1008', // Operations timed out
  'P1010', // Can't reach database server (connection limit)
  'P1011', // Connection acquisition timed out
  'P1012', // Connection pool timeout
  'P1013', // Connection closed
  'P2034', // Too many database connections
]);

function isDatabaseConnectionError(err) {
  if (!err) return false;
  // PrismaClientKnownRequestError carries a .code (P1001, etc.)
  if (err.code && DB_CONNECTION_ERROR_CODES.has(err.code)) return true;
  // PrismaClientInitializationError has no .code when the client cannot even
  // establish its first connection (e.g. Neon pooler unreachable). Match by
  // name and message instead.
  if (err.name === 'PrismaClientInitializationError') return true;
  if (typeof err.message === 'string' && err.message.includes("Can't reach database server")) return true;
  return false;
}

// Protect routes - verify JWT token (for users and drivers)
const protect = async (req, res, next) => {
  let token;

  console.log('[AUTH] protect middleware entered');

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      console.log('[AUTH] Token extracted, verifying...');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('[AUTH] Token decoded, type:', decoded.type, 'id:', decoded.id);

      // Check if it's an admin token (has type: 'admin') or user token
      if (decoded.type === 'admin') {
        console.log('[AUTH] Looking up admin by id:', decoded.id);
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
          console.log('[AUTH] Admin not found for id:', decoded.id);
          return res.status(401).json({
            success: false,
            message: 'Admin not found',
          });
        }

        console.log('[AUTH] Admin found:', admin.full_name, 'role:', admin.role);
        req.user = {
          kind: 'admin',
          user_id: admin.admin_id,
          first_name: admin.full_name,
          email: admin.email,
          role: admin.role,
        };
        console.log('[AUTH] Calling next() for admin');
        next();
        return;
      } else {
        console.log('[AUTH] Looking up user by id:', decoded.id);
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
          console.log('[AUTH] User not found for id:', decoded.id);
          return res.status(401).json({
            success: false,
            message: 'User not found',
          });
        }

        console.log('[AUTH] User found:', user.first_name, 'role:', user.role);
        req.user = {
          kind: 'user',
          user_id: user.user_id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          phone: user.phone,
          role: user.role,
        };
        console.log('[AUTH] Calling next() for user');
        next();
        return;
      }
    } catch (error) {
      console.error('[AUTH] Auth middleware error:', error.code || error.name, error.message);

      // Database connection failures are infrastructure issues, not auth failures.
      // Never treat a temporarily unreachable database as proof of invalid credentials.
      if (isDatabaseConnectionError(error)) {
        return res.status(503).json({
          success: false,
          message: 'Authentication service temporarily unavailable. Please try again shortly.',
          errorCode: 'SERVICE_UNAVAILABLE',
        });
      }

      // JWT verification failures (expired, malformed, wrong secret, etc.) are
      // genuine authentication failures.
      if (
        error.name === 'JsonWebTokenError' ||
        error.name === 'TokenExpiredError' ||
        error.name === 'NotBeforeError'
      ) {
        return res.status(401).json({
          success: false,
          message: 'Not authorized, token failed',
        });
      }

      // Unexpected internal error — do not leak details, do not treat as 401.
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  if (!token) {
    console.log('[AUTH] No token provided');
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token',
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
      message: 'Access denied. Admin only.',
    });
  }
};

// Generate JWT token (for users and drivers)
const generateToken = (id, type = 'user') => {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

module.exports = { protect, adminOnly, generateToken, isDatabaseConnectionError };
