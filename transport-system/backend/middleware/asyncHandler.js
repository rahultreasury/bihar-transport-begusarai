module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    // Return the promise so callers/tests can await the handler. Errors are
    // forwarded to the centralized error handler via next(error).
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
};

