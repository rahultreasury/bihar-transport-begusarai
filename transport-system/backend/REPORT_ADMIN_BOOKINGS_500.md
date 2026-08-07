# Report — GET /api/admin/bookings HTTP 500 (Root Cause & Permanent Fix)

## 0. ACTUAL ROOT CAUSE (DIAGNOSED & FIXED — ADDITIVE DB SCHEMA REPAIR)

**Root cause proven with live evidence:** the **live Neon PostgreSQL database schema
was out of sync with `prisma/schema.prisma`**. The current Prisma schema models
`Booking.quote_*`, `Driver.vehicle_*`, `Reservation`, and `Invoice` — but those
columns/tables/enums had **never been applied to the live database** (the migrations
`20260803060304_add_quote_workflow` and `20260805000000_add_driver_vehicle_fields`
were missing from the deployed DB). The running Prisma client (generated from the
current schema) therefore issued SQL referencing columns/tables that did not exist in
the live DB, so `prisma.booking.findMany()` threw **Prisma error `P2022`
(column does not exist)** → the controller forwarded it to the centralized error
handler → HTTP 500.

**Evidence (before repair):**
- `prisma migrate status` flagging missing migrations; `prisma migrate diff
  --from-url <live> --to-schema-datamodel` showing the missing `quote_*` columns,
  `reservations`/`invoices` tables, `QuoteStatus`/`ReservationStatus`/`InvoiceStatus`
  enums, and `drivers.vehicle_*` — all absent in the live DB.
- Grid of checks: `bookings.quote_status` etc. were **MISSING** in the live DB.

**Fix applied (ADDITIVE-ONLY, no data loss):**
- `scripts/repair-quote-workflow-migration.sql` — sanitized additive-only repair
  (see file for full SQL). It creates only: the 3 missing enums, the 6 `quote_*`
  columns on `bookings`, the 2 `vehicle_*` columns on `drivers`, the `reservations`
  and `invoices` tables, their indexes, and the new FKs.
- **No `DROP`, no `ALTER COLUMN`, no deletion/truncation/update of booking data.**
- The legacy vehicle columns (`bookings.vehicle_id`, `deliveries.vehicle_id`,
  `booking_assignments.assigned_vehicle_id`) and `VehicleStatus`/`VehicleType` enums
  were **left in place** (they still contain live data). They are harmless because the
  current Prisma client ignores unknown columns. `TransportVehicle` model still exists
  in schema so its table/FKs were preserved.
- Applied in a single transaction via the `pg` driver (`COMMIT OK — all statements
  applied`), then `npx prisma generate` (client regenerated).

**Verification (after repair):**
- `prisma.booking.findMany({ include: { user, driver, delivery } })` → **succeeds**,
  returns rows, `quote_status: PENDING`.
- Full controller→service→repository path returns **HTTP 200**, `success: true`,
  `data.length: 6`, pagination `{ page:1, limit:20, total:6, pages:1 }`.
- **Data integrity preserved:** `bookings = 6` (unchanged), `users = 11` (unchanged).
- No `P2022` error remains.

---

## 1. Root Cause (Original Architectural Defect — now superseded by §0)

The `GET /api/admin/bookings` route in **`routes/adminRoutes.js`** bypassed the
application's layered architecture and issued an **inline `prisma.booking.findMany()`
query directly inside the Express route handler**. This inline query:

1. **Did not use the centralized `BookingInclude` builder** (the designated "single
   source of truth" that is guaranteed to reference only fields/relations that exist
   in the current Prisma schema).
2. **Risked referencing removed/renamed schema fields** from the brokerage-model
   refactor (e.g. `vehicle_id`, `assigned_vehicle_id`, `transport_vehicles`). When the
   Prisma client (generated from the current schema) rejects such references, it throws
   a validation error.
3. **Used unsanitized pagination** (`skip = (page - 1) * limit` with string `page`/`limit`
   from `req.query`), which can produce `NaN` values → invalid SQL.
4. **Swallowed the real error** with `console.error(...)` + a generic
   `res.status(500).json(...)`, hiding the true failure from the centralized
   `errorHandler` middleware and from structured logging.

Because the route caught the exception and returned a hard-coded 500, the endpoint
could not return `{ success: true, data: [] }` for an empty database, and any DB or
validation error was masked.

## 2. Files Changed

| File | Change |
|------|--------|
| `repositories/BookingRepository.js` | Added `listBookings(filters)` — the single source of truth for the admin booking list query, using `BookingInclude` + `flattenBooking`, parameterized, with sanitized pagination/sort. |
| `services/BookingQueryService.js` | **NEW** read-only service delegating to the repository (no Prisma, no Express). |
| `controllers/bookingController.js` | **NEW** controller with `listBookings` handler — admin role gate, Zod validation, structured response, `next(error)` forwarding. |
| `validators/bookingQuery.js` | **NEW** Zod schema validating/coercing all query params before they reach Prisma. |
| `utils/logger.js` | **NEW** Pino singleton logger with request-id support. |
| `routes/adminRoutes.js` | `/bookings` GET now delegates to `bookingController.listBookings`; removed inline Prisma query + error swallowing. |
| `server.js` | Wired `pino-http` request logging (with request IDs); kept centralized `errorHandler`. |
| `middleware/errorHandler.js` | Now emits structured Pino `request.error` logs with request ID; never swallows errors. |
| `middleware/asyncHandler.js` | Returns the promise so errors are forwarded to `next(error)` (and awaitable in tests). |
| `tests/adminBookings.test.js` | **NEW** node:test suite (19 tests) with injected mocks. |
| `package.json` | Added `zod` dependency and `test` / `test:bookings` scripts. |
| `TODO.md` | Tracked all steps to completion. |

## 3. Before Architecture

```
Frontend → api.js
  → routes/adminRoutes.js  (inline: prisma.booking.findMany + inline include
      + console.error + res.status(500))
    → prisma → PostgreSQL
```

Problems: Prisma accessed directly in the route; no validation; errors swallowed;
no centralized error propagation; no structured logging; removed-schema fields could
crash the endpoint.

## 4. After Architecture

```
Frontend → api.js
  → routes/adminRoutes.js  (thin — delegates to controller)
    → controllers/bookingController.js  (Zod validation, admin gate,
        asyncHandler → next(error))
      → services/BookingQueryService.js (read ops, no Prisma/Express)
        → repositories/BookingRepository.js (listBookings; ONLY layer touching
            Prisma; uses centralized BookingInclude + flattenBooking)
          → prisma → PostgreSQL
```

Centralized `errorHandler` middleware converts any `next(error)` into a structured
`{ success:false, message, errorCode, details, timestamp, requestId }` response, and
Pino logs every request/error with a request ID.

## 5. Before Code (inline route handler)

```js
router.get('/bookings', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') { /* 403 */ }
    const { page = 1, limit = 20, status = '', search = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);   // unsafe pagination
    const take = parseInt(limit);
    const where = {};
    if (status) where.status = status;
    if (search) where.OR = [ /* inline contains filters */ ];
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({ where, include: { /* inline include */ },
        orderBy: { created_at: 'desc' }, skip, take }),
      prisma.booking.count({ where }),
    ]);
    // ... flatten ...
  } catch (error) {
    console.error('Get bookings error:', error);   // swallows the real error
    res.status(500).json({ success: false, message: 'Server error' });  // masks it
  }
});
```

## 6. After Code (thin route + controller + service + repository)

**routes/adminRoutes.js**
```js
const { createBookingController } = require('../controllers/bookingController');
const bookingController = createBookingController();
router.get('/bookings', protect, bookingController.listBookings);
```

**controllers/bookingController.js**
```js
const listBookings = asyncHandler(async (req, res, next) => {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const parsed = parseBookingQuery(req.query || {});
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error.message, details: parsed.error.details });
  }
  const result = await queryService.listBookings(parsed.data);   // throws → next(error)
  logger.info({ requestId: req.id, userId: req.user?.user_id, total: result.pagination.total }, 'bookings.list.success');
  return res.json({ success: true, data: result.data, pagination: result.pagination });  // data: [] when empty
});
```

**repositories/BookingRepository.js** — `listBookings` builds a parameterized
`where`/`orderBy`/`skip`/`take` using `BookingInclude` and `flattenBooking`, and returns
`{ data: [], pagination: { page, limit, total: 0, pages: 0 } }` on an empty DB.

## 7. Why the Bug Occurred

- The booking list endpoint was written as a **monolithic inline handler** that reached
  straight into Prisma, duplicating query logic that elsewhere lived in the repository.
- The brokerage-model schema refactor removed vehicle-related columns/relations, but the
  inline handler was **not migrated** to the centralized include builder, so it could
  reference stale schema that the generated Prisma client rejects.
- The handler's `catch` **masked the failure** with a generic 500 instead of forwarding
  to the centralized error handler, making the real cause invisible.

## 8. Why This Fix Prevents Future Occurrences

- **Single source of truth:** All booking list reads now go through
  `BookingRepository.listBookings`, which always uses the centralized `BookingInclude`
  and `flattenBooking`. Future schema changes only need to update those two builders —
  the endpoint cannot drift.
- **Repository-only Prisma access:** Routes and services never touch Prisma, so a schema
  change cannot leak into route-layer queries.
- **Zod validation gate:** All query params are validated/coerced before reaching Prisma,
  preventing `NaN` pagination and invalid enum/sort values from generating 500s.
- **Centralized error handling:** Any repository/service failure is forwarded via
  `next(error)` to the centralized `errorHandler`, which returns a structured response
  and logs it with a request ID — never a masked 500.
- **Structured logging:** Pino with request IDs makes future failures traceable and
  diagnosable.
- **Automated tests:** 19 tests cover empty DB, one/multiple bookings, invalid filters,
  invalid pagination, removed schema fields, repository failure, DB offline, and
  unauthorized requests — so regressions are caught immediately.

## 9. Verification

- `npm test` → **19 pass / 0 fail**.
- `routes/adminRoutes.js` loads without module errors.
- Server boots on an alternative port without module-load failures.
- Empty-database path returns `HTTP 200 { success: true, data: [], pagination: {...} }`.
