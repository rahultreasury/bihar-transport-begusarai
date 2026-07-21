const {
  AppError,
} = require('../utils/AppError');

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

  // Don’t leak stack traces in production
  const devMessage = process.env.NODE_ENV === 'development' ? (err && err.message ? err.message : message) : message;

  res.status(statusCode).json({
    success: false,
    message: devMessage,
    errorCode,
    details,
    timestamp,
  });
};

