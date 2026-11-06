const {
  AppError,
} = require('../utils/AppError');
const { logger } = require('../utils/logger');

// Prisma / PostgreSQL connection-error codes that indicate the database is
// temporarily unreachable. These MUST be treated as infrastructure failures
// (503 Service Unavailable), never as invalid credentials (401) or generic
// server errors (500).
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
  if (err.code && DB_CONNECTION_ERROR_CODES.has(err.code)) return true;
  if (err.name === 'PrismaClientInitializationError') return true;
  if (typeof err.message === 'string' && err.message.includes("Can't reach database server")) return true;
  return false;
}

function isAppError(err) {
  return err instanceof AppError || (err && typeof err === 'object' && err.errorCode && err.statusCode);
}

function toErrorDetails(err) {
  if (err && Array.isArray(err.details)) return err.details;
  return [];
}

module.exports = function errorHandler(err, req, res, next) {
  // eslint-disable-line no-unused-vars

  // Database connection failures are infrastructure issues, not application
  // errors. Return 503 so clients know to retry, and never treat them as
  // authentication failures (401) or generic server errors (500).
  if (isDatabaseConnectionError(err)) {
    const timestamp = new Date().toISOString();
    logger.error(
      {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: 503,
        errorCode: 'SERVICE_UNAVAILABLE',
        userId: req.user?.user_id || null,
        err: {
          name: err?.name,
          message: err?.message,
          code: err?.code,
          stack: err?.stack,
        },
      },
      'request.error'
    );
    return res.status(503).json({
      success: false,
      message: 'Database temporarily unavailable. Please try again shortly.',
      errorCode: 'SERVICE_UNAVAILABLE',
      details: [],
      timestamp,
      requestId: req.id,
    });
  }

  const statusCode = isAppError(err) ? err.statusCode : 500;
  const errorCode = isAppError(err) ? err.errorCode : 'INTERNAL_ERROR';
  const message = isAppError(err) ? err.message : 'Internal server error';
  const details = toErrorDetails(err);

  const timestamp = new Date().toISOString();

  // Structured logging: capture request id, method, url, and error context.
  // We never swallow errors — they are logged and forwarded as a response.
  logger.error(
    {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode,
      errorCode,
      userId: req.user?.user_id || null,
      err: {
        name: err?.name,
        message: err?.message,
        stack: err?.stack,
      },
    },
    'request.error'
  );

  // Don’t leak stack traces in production
  const devMessage = process.env.NODE_ENV === 'development' ? (err && err.message ? err.message : message) : message;

  res.status(statusCode).json({
    success: false,
    message: devMessage,
    errorCode,
    details,
    timestamp,
    requestId: req.id,
  });
};

