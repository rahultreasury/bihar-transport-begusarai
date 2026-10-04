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
const { logger } = require('./utils/logger');
const pinoHttp = require('pino-http');

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
const vehicleOwnerRoutes = require('./routes/vehicleOwnerRoutes');
const clientRoutes = require('./routes/clientRoutes');
const licenseRoutes = require('./routes/licenseRoutes');
const challanRoutes = require('./routes/challanRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const mapsRoutes = require('./routes/maps');
const bookingMvpRoutes = require('./routes/bookingMvpRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const testEmailRoutes = require('./routes/testEmailRoutes');
const driverManagementRoutes = require('./routes/driverManagementRoutes');
const partnerRoutes = require('./routes/partnerRoutes');
const partnerApplicationRoutes = require('./routes/partnerApplicationRoutes');
const partnerSettlementRoutes = require('./routes/partnerSettlementRoutes');
const partnerSelfServiceRoutes = require('./routes/partnerSelfServiceRoutes');
const tripFinancialRoutes = require('./routes/tripFinancialRoutes');
const tripRoutes = require('./routes/tripRoutes');
// Phase 9 — the Dispatch Workspace API. Mounted AFTER tripRoutes /
// tripFinancialRoutes; every path it owns is new, so nothing is shadowed.
const dispatchRoutes = require('./routes/dispatchRoutes');
const financialRoutes = require('./routes/financialRoutes');
// Enquiry module (pre-booking customer intake → admin quote → acceptance)
const enquiryRoutes = require('./routes/enquiryRoutes');
const adminEnquiryRoutes = require('./routes/adminEnquiryRoutes');
const driverEnquiryRoutes = require('./routes/driverEnquiryRoutes');
const realtime = require('./realtime/enquiryRealtime');
const emailService = require('./services/emailService');

const app = express();

// Trust the first hop behind Render's reverse proxy so Express uses the real
// client IP (X-Forwarded-For) for req.ip. Without this, every request appears
// to come from the proxy's internal IP, collapsing all admin traffic into a
// single shared rate-limit bucket and causing production-only HTTP 429s.
app.set('trust proxy', 1);

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

// In development, allow all origins to avoid CORS friction between
// frontend (5173/5174) and backend (3000). In production, restrict to
// FRONTEND_URL if provided.
const isDev = process.env.NODE_ENV !== 'production';
app.use(cors({
  origin: isDev ? '*' : (process.env.FRONTEND_URL || '*'),
  credentials: true,
}));

app.use(compression());

// PHASE 9 — document uploads arrive as base64 inside a JSON body, so the trip
// paths need a larger body limit than the 2 MB default. This parser is
// registered FIRST and only for /api/trips; body-parser marks the request as
// parsed (`req._body`), so the global 2 MB parser below skips it instead of
// rejecting a perfectly legitimate 4 MB scan of an LR. Every other route keeps
// the tighter default.
app.use('/api/trips', express.json({ limit: '12mb' }));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (Pino with request IDs)
app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const provided = req.headers['x-request-id'];
    if (provided) return provided;
    let id = req.id;
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      req.id = id;
    }
    return id;
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
  },
  customLogLevel(req, res, err) {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
}));

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

/**
 * The PUBLIC, UNAUTHENTICATED booking-creation budget.
 *
 * This is deliberately scoped to POST /api/booking — the single route
 * bookingMvpRoutes actually serves. It used to be attached to the whole `/api`
 * namespace, which meant EVERY request under /api — admin reads, admin writes,
 * customer reads, even /api/health — spent a token from this public bucket
 * before its own limiter ever ran. bookingMvpRoutes falls through with next()
 * for anything that is not POST /booking, but the token was already spent.
 *
 * The consequence was that ordinary admin/customer traffic could exhaust a
 * bucket that exists to protect an anonymous write endpoint, and the next
 * request was rejected with 429 before it reached its own route handler:
 * GET /api/admin/enquiries then reported "Failed to load enquiries" for a
 * reason that had nothing to do with the admin session.
 */
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Apply bookingLimiter ONLY to POST /api/booking.
 *
 * Everything else under /api falls straight through to its own mount, which is
 * where the correctly-scoped limiters live: adminLimiter + the per-router
 * readLimiter/writeLimiter behind protect + adminOnly for /api/admin, and the
 * per-router limiters on /api/enquiries, /api/bookings, /api/trips and so on.
 * No protection is removed — the public write keeps its exact same budget.
 */
function bookingCreationOnly(req, res, next) {
  if (req.method === 'POST' && req.path === '/booking') {
    return bookingLimiter(req, res, next);
  }
  return next();
}

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// API Routes
app.use('/api/auth', loginLimiter, authRoutes);
app.use('/api/bookings', bookingLimiter, bookingRoutes);

// Canonical booking creation (POST /api/booking). The public limiter is applied
// to that one endpoint only — see bookingCreationOnly above for why the /api
// namespace must not be charged to the public bucket.
app.use('/api', bookingCreationOnly, bookingMvpRoutes);

// Driver Management Routes (admin-limited and admin-checked internally).
// MUST be mounted BEFORE /api/admin so this module is the single source of
// truth for GET /api/admin/drivers and is never shadowed by adminRoutes.
app.use('/api/admin/drivers', adminLimiter, driverManagementRoutes);

// Admin Enquiry Routes (Transport Enquiries workspace).
// MUST be mounted BEFORE /api/admin so /api/admin/enquiries/* is handled here
// and never swallowed by the catch-all admin router.
app.use('/api/admin/enquiries', adminLimiter, adminEnquiryRoutes);

app.use('/api/admin', adminLimiter, adminRoutes);

// Customer Enquiry Routes — the login-free enquiry intake + quote acceptance.
//
// No outer bookingLimiter here. This router already applies its own, stricter,
// purpose-built limit to every route it serves (see routes/enquiryRoutes.js):
//   POST /                     createLimiter   10 / 15 min  (public intake)
//   POST /:id/accept|reject|…  actionLimiter   30 / 10 min
//   GET  /:id, /:id/quote, …   readLimiter    300 /  5 min
//
// Mounting bookingLimiter in front of the whole router meant every customer poll
// spent a token from the budget reserved for anonymous booking creation — the
// same cross-contamination that was breaking the admin enquiries screen. Every
// customer route is now met by a limit TIGHTER than the one it replaces, and
// the public booking budget is spent only on public booking creation.
app.use('/api/enquiries', enquiryRoutes);

// Driver Enquiry Routes — assigned jobs, issue reporting, reassignment requests.
app.use('/api/driver/enquiries', bookingLimiter, driverEnquiryRoutes);
app.use('/api/drivers', bookingLimiter, driverRoutes);
app.use('/api/delivery', bookingLimiter, deliveryRoutes);
app.use('/api/vehicles', bookingLimiter, vehicleRoutes);
app.use('/api/licenses', bookingLimiter, licenseRoutes);
app.use('/api/challans', bookingLimiter, challanRoutes);
app.use('/api/appointments', bookingLimiter, appointmentRoutes);
app.use('/api', mapsRoutes);

// Partner Management Routes
app.use('/api/admin/partners', adminLimiter, partnerRoutes);
app.use('/api/partner', partnerSelfServiceRoutes);
app.use('/api/partner', partnerApplicationRoutes);
app.use('/api/admin/partner-applications', adminLimiter, partnerApplicationRoutes);
app.use('/api/admin/settlements', adminLimiter, partnerSettlementRoutes);

// Vehicle Owner Management Routes
app.use('/api/admin/vehicle-owners', adminLimiter, vehicleOwnerRoutes);

// Client Management Routes (Offline Corporate Clients)
app.use('/api/admin/clients', adminLimiter, clientRoutes);

// Trip Management Routes (CRUD + expenses + payments)
app.use('/api/trips', bookingLimiter, tripRoutes);

// Trip Financial Routes (role-based financial data)
// Mounted after tripRoutes to avoid route conflicts
app.use('/api/trips', bookingLimiter, tripFinancialRoutes);

// Phase 9 — DISPATCH WORKSPACE. GET /:id/dispatch, PATCH /:id/dispatch, LR/GR,
// Phase 9 — the Dispatch Workspace: the dispatch act itself, the e-way bill,
// transit insurance, delivery information and document upload/download.
// Mounted AFTER tripRoutes so /api/trips/:id/dispatch/readiness and the
// document endpoints resolve here.
app.use('/api/trips', bookingLimiter, dispatchRoutes);

// Financial Management Routes (global financial control center)
app.use('/api/financials', adminLimiter, financialRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    message: 'Bihar Transport API is running',
    data: { dbReady },
    timestamp: new Date().toISOString()
  });
});

// PostgreSQL health check via Prisma (Phase 4.1)
app.get('/api/health/db', async (req, res, next) => {
  try {
    const result = await testPrismaConnection();
    if (result.success) {
      dbReady = true;
      res.json({
        success: true,
        status: 'ok',
        message: result.message,
        data: result.data,
        timestamp: new Date().toISOString(),
      });
    } else {
      dbReady = false;
      res.status(503).json({
        success: false,
        status: 'error',
        message: result.message,
        data: null,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    dbReady = false;
    next(err);
  }
});

// Middleware: reject database-dependent requests when Prisma is not ready.
// This prevents requests from silently hanging when PostgreSQL is cold or down.
app.use('/api', (req, res, next) => {
  // Auth and health endpoints are always allowed — they either don't need DB
  // or are the mechanism to check DB status.
  const alwaysAllowed = [
    '/api/health',
    '/api/health/db',
    '/api/auth/login',
    '/api/auth/admin-login',
    '/api/auth/signup',
    '/api/auth/driver-signup',
    '/api/auth/send-otp',
    '/api/auth/verify-otp',
  ];
  if (alwaysAllowed.some(path => req.path === path || req.path.startsWith(path))) {
    return next();
  }
  if (!dbReadyChecked || !dbReady) {
    return res.status(503).json({
      success: false,
      status: 'service_unavailable',
      message: 'Database is initializing. Please try again in a few seconds.',
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
  next();
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

// Database readiness state — shared across requests.
// Starts as false until the background warm-up succeeds.
let dbReady = false;
let dbReadyChecked = false;

// Start server immediately so HTTP is available even if PostgreSQL is cold.
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Server running on port ${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Socket.IO for live enquiry updates. Realtime is an ENHANCEMENT, not a
// dependency: if it cannot attach, every consumer falls back to HTTP polling
// and the enquiry feature keeps working.
realtime.initRealtime(httpServer);

// Background database warm-up — does not block server startup.
// Sets dbReady = true once Prisma connectivity is confirmed.
// Retries periodically if the database is temporarily unavailable.
const warmupDatabase = async () => {
  const attempt = async () => {
    try {
      const dbResult = await testPrismaConnection();
      if (dbResult.success) {
        if (!dbReady) {
          dbReady = true;
          console.log('[db] Prisma client connected to PostgreSQL successfully');
        }
      } else {
        if (dbReady) {
          dbReady = false;
          console.warn('[db] Prisma client connection lost:', dbResult.message);
        }
      }
    } catch (err) {
      if (dbReady) {
        dbReady = false;
        console.warn('[db] Prisma client connection error:', err.message);
      }
    } finally {
      dbReadyChecked = true;
    }
  };

  await attempt();

  // Retry every 30 seconds if the database is not ready.
  // This allows recovery from transient failures without restarting the server.
  const interval = setInterval(async () => {
    if (dbReady) {
      clearInterval(interval);
      return;
    }
    await attempt();
  }, 30000);

  // Clean up interval when the process exits.
  process.on('exit', () => clearInterval(interval));
};
warmupDatabase();

// Background SMTP verification — never blocks server startup
// eslint-disable-next-line no-async-promise-executor
const verifyEmail = async () => {
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
};
verifyEmail();

// Graceful shutdown — close realtime + disconnect Prisma on SIGTERM/SIGINT
async function shutdown(signal) {
  console.log(`[server] ${signal} received. Shutting down gracefully...`);
  try {
    await realtime.closeRealtime();
  } catch (err) {
    console.error('[server] realtime shutdown error:', err.message);
  }
  const { prisma } = require('./config/prisma');
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (err) => {
  console.error('[server] Unhandled rejection:', err);
});


