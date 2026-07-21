Phase 1 (Production Foundation) - Implemented subset

Status:
- ✅ Fixed merge conflict markers in `controllers/mapsController.js` (prior step)
- ✅ Added global error handling primitives:
  - `utils/AppError.js`
  - `middleware/asyncHandler.js`
  - `middleware/errorHandler.js`
  - `middleware/validateRequest.js`
  - `utils/env.js`
- ✅ Added Helmet, compression, morgan logging, express-rate-limit, and standardized error/404 behavior in `server.js`

Known limitation:
- ❌ Env validation currently fails without `FRONTEND_URL` in strict mode.

Next required actions (to reach 100% Phase 1):
- Adjust env validation to not block server startup in local/dev unless ENV_STRICT=true.
- Standardize success responses and validation error middleware across endpoints.
- Add input sanitization middleware and remove unused/dead deps.
- Ensure rate-limiter targets correct routes without breaking existing behavior.


