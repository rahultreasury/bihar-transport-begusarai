const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/AppError');

function validateRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({ field: e.param, message: e.msg }));
    throw new ValidationError({ message: 'Validation failed', details });
  }
}

module.exports = { validateRequest };

