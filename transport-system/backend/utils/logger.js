/**
 * Structured logging using Pino.
 *
 * Provides a singleton Pino logger with base fields (service, env) and an
 * optional Request ID. All modules should import this logger instead of using
 * console.log / console.error so that production logs are structured, tagged
 * with a request id, and safely serialized.
 */

const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: {
    service: 'bihar-transport-backend',
    env: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      'password_hash',
      'token',
      '*.password',
      '*.password_hash',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,service,env',
        },
      },
});

/**
 * Create a child logger bound to a request id.
 * @param {string} requestId
 */
function createRequestLogger(requestId) {
  return logger.child({ requestId });
}

module.exports = { logger, createRequestLogger };
