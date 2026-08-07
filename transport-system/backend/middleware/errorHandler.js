const {
  AppError,
} = require('../utils/AppError');
const { logger } = require('../utils/logger');

function isAppError(err) {
  return err instanceof AppError || (err && typeof err === 'object' && err.errorCode && err.statusCode);
}

function toErrorDetails(err) {
  if (err && Array.isArray(err.details)) return err.details;
  return [];
}

module.exports = function errorHandler(err, req, res, next) {
  // eslint-disable-line no-unused-vars
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

