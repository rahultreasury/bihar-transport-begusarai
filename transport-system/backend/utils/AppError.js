class AppError extends Error {
  constructor({
    message,
    errorCode = 'INTERNAL_ERROR',
    statusCode = 500,
    details = [],
    isOperational = true,
    stack,
  }) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = isOperational;

    if (stack) this.stack = stack;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor({ message = 'Bad Request', details = [] } = {}) {
    super({
      message,
      errorCode: 'BAD_REQUEST',
      statusCode: 400,
      details,
      isOperational: true,
    });
  }
}

class UnauthorizedError extends AppError {
  constructor({ message = 'Unauthorized', details = [] } = {}) {
    super({
      message,
      errorCode: 'UNAUTHORIZED',
      statusCode: 401,
      details,
      isOperational: true,
    });
  }
}

class ForbiddenError extends AppError {
  constructor({ message = 'Forbidden', details = [] } = {}) {
    super({
      message,
      errorCode: 'FORBIDDEN',
      statusCode: 403,
      details,
      isOperational: true,
    });
  }
}

class NotFoundError extends AppError {
  constructor({ message = 'Not Found', details = [] } = {}) {
    super({
      message,
      errorCode: 'NOT_FOUND',
      statusCode: 404,
      details,
      isOperational: true,
    });
  }
}

class ValidationError extends AppError {
  constructor({ message = 'Validation failed', details = [] } = {}) {
    super({
      message,
      errorCode: 'VALIDATION_ERROR',
      statusCode: 400,
      details,
      isOperational: true,
    });
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
};

