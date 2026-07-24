const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { testPrismaConnection } = require('./config/prisma');
const { validateEnv } = require('./utils/env');

const { NotFoundError } = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');

// Load environment variables (explicit backend .env path)
dotenv.config({
  path: path.join(__dirname, '.env'),
});

// Set NODE_ENV for Render
if (process.env.RENDER) {
  process.env.NODE_ENV = 'production';
  process.env.PORT = process.env.PORT || 3000;
}

// Fail fast on required env vars (can be disabled via ENV_STRICT=false)
try {
  validateEnv();
} catch (e) {
  // In dev/local we avoid hard-failing; in production strict mode we still exit.
  const strict = String(process.env.ENV_STRICT || 'true') === 'true';
  // eslint-disable-next-line no-console
  console.error('[env] Validation failed:', e.message);
  if (strict) process.exit(1);
}

// Check WhatsApp config and warn if disabled
if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_BUSINESS_NUMBER) {
  console.warn('[whatsapp] WhatsApp notifications are disabled.');
}


// Import routes
const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const driverRoutes = require('./routes/driverRoutes');
const adminRoutes = require('./routes/adminRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const licenseRoutes = require('./routes/licenseRoutes');
const challanRoutes = require('./routes/challanRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const mapsRoutes = require('./routes/maps');
const bookingMvpRoutes = require('./routes/bookingMvpRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const testEmailRoutes = require('./routes/testEmailRoutes');
const emailService = require('./services/emailService');

const app = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'connect-src': ["'self'", 'https:'],
      'img-src': ["'self'", 'data:', 'https:'],
      'script-src': ["'self'"],
      'style-src': ["'self'", 'https:'],
      'frame-ancestors': ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
  xssFilter: false,
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 2000,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// API Routes
app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/bookings', bookingLimiter, bookingRoutes);
app.use('/api', bookingLimiter, bookingMvpRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/drivers', bookingLimiter, driverRoutes);
app.use('/api/delivery', bookingLimiter, deliveryRoutes);
app.use('/api/vehicles', bookingLimiter, vehicleRoutes);
app.use('/api/licenses', bookingLimiter, licenseRoutes);
app.use('/api/challans', bookingLimiter, challanRoutes);
app.use('/api/appointments', bookingLimiter, appointmentRoutes);
app.use('/api', mapsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', message: 'Bihar Transport Begusarai API is running', data: null, timestamp: new Date().toISOString() });
});

// PostgreSQL health check via Prisma (Phase 4.1)
app.get('/api/health/db', async (req, res, next) => {
  try {
    const result = await testPrismaConnection();
    if (result.success) {
      res.json({
        success: true,
        status: 'ok',
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        success: false,
        status: 'error',
        message: result.message,
        data: null,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    next(err);
  }
});

// WhatsApp Webhook Events
app.use('/api', webhookRoutes);

// Test email endpoint — sends a test email to OWNER_EMAIL and returns SMTP response
app.use('/api', testEmailRoutes);

// 404 handler
app.use((req, res, next) => {
  next(new NotFoundError({ message: 'Route not found' }));
});

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// Start server
const startServer = async () => {
  const dbResult = await testPrismaConnection();
  if (dbResult.success) {
    console.log(dbResult.message);
  } else {
    console.warn(dbResult.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`✅ Server running on port ${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Background SMTP verification — never blocks server startup
  (async () => {
    // Verify SMTP connection only (no test email — that's done manually via /api/test/email)
    try {
      const verifyResult = await emailService.verifyConnection();
      if (verifyResult.success) {
        console.log('✓ Email Service Ready');
      } else {
        console.warn('[email] Service not available:', verifyResult.message);
      }
    } catch (err) {
      console.error('[email] SMTP verification threw:', err.message);
    }
  })();
};

startServer();


