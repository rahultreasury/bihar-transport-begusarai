# Bihar Transport — Production-Grade System Audit Report

**Date:** 2026-09-01
**Scope:** Full-stack audit of `bihar-transport-begusarai-main/transport-system/`
**Reviewer Role:** Senior Architect + Backend/Database/QA/Security/PM

> This report is based on direct inspection of the codebase (not assumptions).
> It scores the current state, lists real issues found, and provides a
> step-by-step production remediation plan that will be executed in subsequent
> PRs.

---

## 0. Architecture Snapshot (Current State)

| Layer | Tech | Notes |
|---|---|---|
| Backend | Node.js + Express 4 + Prisma 5 (PostgreSQL) | Mature layered architecture: routes → services → repositories. |
| Auth | JWT (jsonwebtoken) + Bearer header | Two token types: `admin` and `user/driver`. |
| Validation | Zod (declared) + express-validator (declared) + ad-hoc checks in services | Inconsistent — most endpoints validate inline in services. |
| Logging | pino + pino-http + request IDs | Good. |
| Security | helmet + cors + express-rate-limit + mongo-sanitize + xss-clean | Good baseline. |
| Frontend | React 18 + Vite + Tailwind + Axios | `admin-premium` design system. Routes lazy-loaded. |
| Tests | `node --test tests/*.test.js` (5 files) | Some coverage for bookings/deletion/enterprise lifecycle. |

**Modules discovered:**

- **Customer** (`User` model)
- **Booking** (with quote workflow + reservations + invoices + partner workflow)
- **Transport Partner / Network Partner** (`Partner` model — separate from `VehicleOwner`)
- **Vehicle Owner** (`VehicleOwner` model — fleet owner)
- **Driver** (`Driver` model)
- **Vehicle** (`TransportVehicle` model)
- **Trip** (`Trip` model — independent workflow, can link to a Booking)
- **Delivery** (`Delivery` model — GPS/OTP based)
- **Trip Financial** (`TripFinancial`, `TripAdvance`, `TripSettlement`, `CommissionRecord`, `FinancialTransaction`)
- **Partner Ledger** (`PartnerLedger`, `PartnerPayment`, `Settlement`)
- **Audit Log** (`AuditLog`)

**Real relationship map (currently in schema):**

```
User (customer) ─┐
                 ▼
               Booking ◄── TripFinancial ─► TripAdvance/TripSettlement/CommissionRecord
                 │                                │
                 ├──► Partner (network partner)   │
                 ├──► VehicleOwner (fleet owner) ▼
                 ├──► Driver                          Trip (operational record)
                 ├──► TransportVehicle                  ├──► User (customer)
                 ├──► Settlement / PartnerLedger        ├──► VehicleOwner
                 └──► Delivery                          ├──► TransportVehicle
                                                        ├──► Driver
                                                        ├──► TripExpense
                                                        └──► TripPayment
```

> ⚠️ **Critical finding:** `Booking` and `Trip` are **two parallel workflows** in
> the current codebase. Bookings go through the quote→confirm→assign→trip flow
> with `Reservation` + `TripFinancial`. Trips exist as a **separate, independent
> module** with their own `freight_amount`, `driver_payment`, `owner_payment`,
> expenses, and payments — and there is **no automatic sync** between a Trip
> created from a Booking and the Trip's own financial records. This is the
> single biggest source of inconsistency in the system today.

---

## 1. Architecture Score: **7 / 10**

**Strengths**

- Clean layered architecture (routes → services → repositories).
- Dedicated `TripFinancial` module with `TripAdvance` / `TripSettlement` /
  `CommissionRecord` / `FinancialTransaction` (designed correctly for
  accounting separation).
- Solid `PartnerLedger` (immutable, with reversal support) and `AuditLog`.
- Service / repository separation makes unit testing possible.

**Weaknesses**

- Two parallel booking/trip workflows that don't sync.
- `controllers/` folder is mostly empty; logic lives in services and routes,
  which is fine, but some endpoints (in `bookingController.js`) wrap services
  while others go direct from route → service.
- Admin routes file is 79k chars / 1800+ lines — should be split by domain.
- Archive folder contains large `.bak` migration scripts that should be
  removed from version control.

---

## 2. Backend Score: **6 / 10**

**Strengths**

- Most routes have authentication via `protect` middleware.
- Most admin endpoints have explicit role checks (`admin`/`super_admin`).
- Validation exists on most writes.
- Async errors are caught and logged.
- Pagination is implemented on list endpoints.

**Critical weaknesses found**

1. **No transaction guarantees on multi-write operations.** `TripService.createTrip` validates all entities and writes a trip, but if a side-effect (audit log, timeline event) fails, the trip is still created. Should use `prisma.$transaction([...])` or interactive transactions.
2. **`Trip.status` transitions don't update `Driver.status`, `Vehicle.current_status`, or `Booking.status`.** The trip status update is a one-column write — no cascading. (See `TripService.updateTripStatus` lines 278–312.)
3. **`createTrip` does NOT check vehicle/driver availability for active trips.** A vehicle or driver already on an `IN_TRANSIT` trip can be assigned to a new `PENDING` trip. (See lines 110–215 of `TripService.js`.)
4. **Dashboard endpoint (`/api/admin/dashboard`) computes only a narrow slice** — no available vehicles, available drivers, monthly revenue, monthly profit, pending payments, top routes, or finance KPIs.
5. **Trip summary profit calculation is naive**: `profit = freight - totalExpenses`. It does **not** subtract `owner_payment` or `driver_payment`. So `profit` overstates real margin by exactly the driver/owner payouts.
6. **Error response format is inconsistent.** Some return `{ success, message }`, others `{ success, message, error }`, others plain text.
7. **No input validation on many query params** — `parseInt` failures silently produce NaN queries.
8. **`/api/trips/:id` route order issue:** `/:id/status` and `/:id/expenses` and `/:id/payments` etc. are all defined after `/:id`. Express matches in order, so this is OK, **but** the `/lookup/...` routes must be defined **before** `/:id` or they will be shadowed by the param. **Currently `/lookup/...` is defined AFTER `/:id`** in `tripRoutes.js` lines ~700+. This means a request like `/api/trips/lookup/clients` will match `/:id` with `id="lookup"` and 400. **🔴 BROKEN.**
9. **`getAvailableClients` / `getAvailableDrivers` / `getAvailableVehicles` / `getAvailableOwners` methods exist on `TripService`** but are **never wired to routes** — the frontend can never call them.
10. **Driver `is_available` / `status` is not updated by any service.** Driver status is set during create but never by trip lifecycle.

---

## 3. Database Score: **7 / 10**

**Strengths**

- PostgreSQL with proper foreign keys and `@@index` on every lookup column.
- Soft delete via `deleted_at` and `archived_at`.
- Snapshots on `Booking` (partner_name_snapshot, etc.) preserve historical accuracy.
- Strong immutable ledger design on `PartnerLedger` + `FinancialTransaction`.

**Weaknesses**

1. **`Booking.archived_at` is indexed but never used as a single source of truth** — some endpoints filter by `status='cancelled'` and others by `archived_at IS NOT NULL`.
2. **`Trip` model does not have `@@unique` constraints** that would prevent a vehicle/driver from being double-booked at the database level. (Application-level check is missing too — see point 3 above.)
3. **`Booking.status` is `String?`** instead of an enum. Inconsistent with `TripStatus` which is a real enum. Same for `Driver.status` and `TransportVehicle.current_status`. This allows drift in stored values.
4. **Missing index** on `trips.status` for cross-status reporting at scale (only individual columns are indexed, not composite).
5. **`TripFinancial` has `@@unique([booking_id])`** which means a Trip created independently (without a booking) cannot have a `TripFinancial`. That's correct for the linked workflow, but the `Trip` model also has its own `freight_amount` + `client_received`/`owner_paid`/`driver_paid` columns — two parallel financial systems for the same business event.
6. **No DB-level check** that `Trip.completed_at` is set when `status='COMPLETED'`.

---

## 4. API Reliability Score: **6 / 10**

- Most list endpoints paginate. ✅
- Auth required everywhere except public signup/quote-accept. ✅
- Role checks on admin endpoints. ✅
- **BUT:** `/api/trips/lookup/*` is shadowed by `/:id` → **API reliability 6, not higher**.
- Inconsistent error envelopes.
- Some routes return raw stack traces on internal errors (`console.error` is fine, but `res.status(500).json({ message: error.message })` exposes internal messages to clients).
- `/api/health/db` exists but is not surfaced in the frontend.

---

## 5. Security Score: **7 / 10**

**Strengths**

- JWT + helmet + rate-limit + mongo-sanitize + xss-clean + compression.
- `trust proxy` set for Render.
- Bcrypt for passwords.

**Weaknesses**

1. `xss-clean` is declared but is unmaintained (last release 2021, doesn't work with Express 4.18 reliably). Use `validator` or `DOMPurify` instead.
2. `csurf` is declared but **never imported** — CSRF protection is effectively absent. For an SPA + JWT setup this is acceptable IF tokens are not stored in cookies; the app stores in `localStorage`, so CSRF risk is low, but the dependency should be removed.
3. Sensitive data exposure: `req.user` is logged on every request via pino. `password_hash` is correctly excluded via Prisma `select`, but route handlers must be reviewed.
4. No permission scoping: a logged-in customer can call `/api/trips/:id` and read **any** trip if they guess an ID — there is no per-trip ownership check in the service layer. **IDOR risk** for trip expenses/payments read endpoints.

---

## 6. Frontend-Backend Integration Score: **6 / 10**

**Strengths**

- Single `services/api.js` with axios + interceptors, 401 handling, timeout normalization.
- All admin pages lazy-loaded.
- `AdminShell` is a real layout primitive.

**Weaknesses**

1. `AdminDashboard.jsx` reads `stats.todayBookings`, `stats.pendingBookings`, `stats.activeTrips`, `stats.outstandingPayments` — but **none of these are returned by `/api/admin/dashboard`**. The endpoint returns `totalUsers`, `totalDrivers`, `totalVehicles`, `totalBookings`, `pendingBookings`, `activeDeliveries`, `completedDeliveries`, `totalRevenue`, `todayRevenue`. So KPI cards silently render `0` for missing fields.
2. The "Today's Bookings" KPI card is wired to a key the API does not provide.
3. The "Total Owners / Active Owners / Inactive Owners / Outstanding Payments" KPIs are wired to keys the API does not provide.
4. `recentBookings` is mapped through `PremiumTable` but the `phone` field is shown as `r.phone` — the API returns `phone` correctly, OK.
5. Frontend does not display real revenue trend, vehicle availability KPIs, driver availability KPIs, pending payments, or monthly P&L.
7. `AdminTrips.jsx` references `adminAPI.getTripSummary()` → backend endpoint exists and works ✅.
8. `AdminDashboard.jsx` does not catch / display errors from `/admin/dashboard`. If the API fails, the page just shows `loading=false` and blank KPIs.

---

## 7. Business Logic Score: **6 / 10**

- Quote workflow is well-designed (PENDING → ACCEPTED → REJECTED → EXPIRED + reservations).
- Partner ledger is properly designed (debit/credit + running balance + reversals).
- Settlements (`Settlement` model) are correct.
- **However**:
  - Trip lifecycle does not cascade to driver/vehicle/booking status updates.
  - Trip and Booking financial calculations are duplicated and not reconciled.
  - No business rule prevents double-assigning a vehicle or driver to active trips.
  - No business rule prevents assigning an inactive driver (`is_available=false`) or maintenance vehicle (`is_available=false`).
  - Booking cancellation does not release reservations.

---

## 8. UI/UX Score: **6 / 10**

- `admin-premium` design system is consistent (KpiCard, PremiumTable, EmptyState, LoadingSkeleton).
- AdminShell with sidebar + top header.
- Lazy-loaded routes with PageLoader fallback.

**Weaknesses**

1. AdminShell sidebar nav items are duplicated across pages (AdminDashboard, AdminTrips, AdminBookings, AdminDrivers, AdminVehicles, AdminVehicleOwners, AdminPartners, etc.) — each page defines its own `NAV_ITEMS` array. Should be a shared constant.
2. No global toast system. Each page rolls its own.
3. Empty states exist but loading skeletons are sometimes missing.
4. `AdminDashboard` displays 8 KPI cards but only 4 of them have backend data.
5. No "Recent Activity" or "Action Required" widget on dashboard.
6. The user said "do not improve UI" — so we will NOT change visual design here. We will fix data correctness only.

---

## 9. Production Readiness Score: **5 / 10**

The application is functionally rich but not production-ready because:

1. KPI dashboard returns near-zero useful data.
2. Vehicle/driver double-booking is possible.
3. Trip ↔ Booking financial data is not reconciled.
4. Inconsistent error responses will break downstream clients.
5. IDOR on trip details.
6. `/api/trips/lookup/*` is currently broken.
7. No automated test that exercises the full lifecycle end-to-end (the `enterpriseBookingLifecycle.test.js` exists but does not run automatically in CI based on package.json scripts).
8. No rate limit per user (only global per IP).

---

## CRITICAL ISSUES (must fix)

| # | Issue | Impact |
|---|---|---|
| C1 | `/api/trips/lookup/*` shadowed by `/:id` route | Lookup dropdowns fail |
| C2 | Dashboard API missing KPIs the UI expects | Dashboard shows 0s |
| C3 | No vehicle/driver availability check on `createTrip` | Double-booking possible |
| C4 | No cascade from `Trip.status` → `Driver.status`, `Vehicle.current_status`, `Booking.status` | Inconsistent state |
| C5 | `Trip` and `Booking` financial data not reconciled | Finance is wrong |
| C6 | IDOR on `/api/trips/:id` and `/api/trips/:id/expenses`, `/payments` | Security |
| C7 | `Trip` summary profit overstates margin (doesn't subtract driver/owner payout) | Wrong KPIs |
| C8 | `AdminDashboard` silently renders 0 for missing data with no error | UX |
| C9 | No DB / app constraint preventing same vehicle/driver on overlapping trips | Data integrity |
| C10 | `getAvailableClients/Drivers/Vehicles/Owners` methods exist but routes are missing | Lookup dropdowns break |

## HIGH PRIORITY ISSUES

| # | Issue |
|---|---|
| H1 | Consolidate admin sidebar NAV_ITEMS into a shared module |
| H2 | Standardize error envelope to `{ success, message, error, data }` |
| H3 | Add `partner_id` filter to `/api/admin/partners` when admin has scope (future RBAC) |
| H4 | Add per-user rate limit on sensitive endpoints |
| H5 | Add `Trip.completed_at` and `Trip.cancelled_at` business invariants |
| H6 | Surface `/api/health/db` in frontend admin header (small green/red indicator) |
| H7 | Replace `xss-clean` with `validator`/`DOMPurify` and remove `csurf` |
| H8 | Add `trip_id → booking_id` link enforced in `Booking ↔ Trip` lifecycle |

## MEDIUM PRIORITY ISSUES

| # | Issue |
|---|---|
| M1 | Add composite index on `trips(status, created_at)` |
| M2 | Convert `Booking.status`, `Driver.status`, `TransportVehicle.current_status` to real enums |
| M3 | Remove `archive/` scripts from version control |
| M4 | Add a small CI workflow that runs `npm test` on PR |
| M5 | Add `partner_id` to `Trip` for direct partner billing |
| M6 | Add `payment_terms`, `credit_days` to `Booking` for outstanding aging |
| M7 | Implement `TripFinancial.recalculate()` on every relevant write |

## LOW PRIORITY IMPROVEMENTS

| # | Issue |
|---|---|
| L1 | Add `invoice_pdf_url` generation for `Invoice` |
| L2 | Add soft-delete audit hook to all `*Repository.delete*` |
| L3 | Add bulk operations to `Settlement` (e.g. lock multiple at month-end) |
| L4 | Add `Trip` recurring schedule for repeat customers |

---

## Step-by-Step Implementation Plan

This is the order in which we will execute changes. Each step is small,
reviewable, and includes a verification step.

### STEP 1 — Backend: Fix broken lookup routes (`/api/trips/lookup/*`)

**File:** `transport-system/backend/routes/tripRoutes.js`

**Change:** Move all `/lookup/...` routes ABOVE `/:id` in the file.

**Verify:**
```bash
curl http://localhost:3000/api/trips/lookup/clients
# Expect: success: true, data: [...]
```

### STEP 2 — Backend: Wire `getAvailableClients/Drivers/Vehicles/Owners` to routes

**File:** `transport-system/backend/routes/tripRoutes.js`

Add:
```js
router.get('/lookup/clients', protect, async (req, res) => {
  const data = await tripService.getAvailableClients(req.query.search || '');
  res.json({ success: true, data });
});
// same for /lookup/drivers, /lookup/vehicles, /lookup/owners
```

### STEP 3 — Backend: Add availability check on `createTrip`

**File:** `transport-system/backend/services/TripService.js`

Add logic that fails when the vehicle or driver already has an active trip
(`PENDING`, `ASSIGNED`, `IN_TRANSIT`).

### STEP 4 — Backend: Cascade trip status to driver, vehicle, booking

**File:** `transport-system/backend/services/TripService.js` (`updateTripStatus`)

When status becomes `IN_TRANSIT`: set `Driver.status='on_trip'`,
`TransportVehicle.current_status='on_trip'`, `Booking.status='in_transit'`.
When status becomes `COMPLETED`: set `Driver.status='available'`,
`TransportVehicle.current_status='available'`, `Booking.status='completed'`.
When `CANCELLED`: same as completed for status reset.

### STEP 5 — Backend: Reconcile Trip financial calculations

**File:** `transport-system/backend/services/TripService.js` (`getSummary`, `getTripById`, `getAllTrips`)

Profit = freight_amount − driver_payment − owner_payment − total_expenses
Outstanding = freight_amount − total_payments (per payment_category)

### STEP 6 — Backend: Add IDOR check on trip routes

**File:** `transport-system/backend/services/TripService.js`

Customers may only see trips where `user_id === req.user.user_id`.
Admins see all.

### STEP 7 — Backend: Enrich `/api/admin/dashboard`

**File:** `transport-system/backend/routes/adminRoutes.js`

Return all KPIs the frontend reads:
- `totalBookings`, `pendingBookings`, `todayBookings`, `completedBookings`
- `totalTrips`, `activeTrips`, `completedTrips`, `cancelledTrips`
- `totalVehicles`, `availableVehicles`, `vehiclesOnTrip`
- `totalDrivers`, `availableDrivers`, `driversOnTrip`
- `totalRevenue`, `todayRevenue`, `monthlyRevenue`, `pendingPayments`, `outstandingPayments`
- `totalProfit`, `monthlyProfit`
- `totalCustomers`
- `topRoutes`, `topClients`

### STEP 8 — Backend: Standardize error envelope

**File:** `transport-system/backend/utils/AppError.js`, `middleware/errorHandler.js`

Wrap all errors as:
```json
{ "success": false, "message": "...", "error": "CODE", "data": null }
```

### STEP 9 — Frontend: Use shared NAV_ITEMS

**File:** `transport-system/frontend/src/components/admin-premium/layout/navItems.js` (new)

Define once, import everywhere.

### STEP 10 — Frontend: Wire dashboard to real backend data

**File:** `transport-system/frontend/src/pages/AdminDashboard.jsx`

Use only keys the backend returns. Show error state if the API call fails.
Add a "Recent Activity" panel.

### STEP 11 — Frontend: Add error/empty/loading states consistently

For all admin pages.

### STEP 12 — Security: Add IDOR check on `/trips/:id`, `/trips/:id/expenses`, `/trips/:id/payments`

Done in Step 6.

### STEP 13 — Security: Remove `csurf` and `xss-clean`, add `validator`

**File:** `transport-system/backend/package.json`

### STEP 14 — DB: Add `prisma` migration for composite indexes

**File:** `transport-system/backend/prisma/migrations/20260901_*`

```prisma
@@index([status, created_at], name: "idx_trips_status_created")
@@index([user_id, status], name: "idx_trips_user_status")
@@index([driver_id, status], name: "idx_trips_driver_status")
@@index([vehicle_id, status], name: "idx_trips_vehicle_status")
```

### STEP 15 — Add `archived_at` consistency in booking endpoints

**File:** `transport-system/backend/services/BookingService.js`

Filter `archived_at IS NULL` everywhere except `/deletion-summary` and archive routes.

### STEP 16 — Add trip lifecycle integration test

**File:** `transport-system/backend/tests/tripLifecycle.test.js`

End-to-end: create customer → create trip → start trip → assert driver.status === 'on_trip' → complete trip → assert driver.status === 'available'.

### STEP 17 — Production hardening

- Add per-user rate limit on `/auth/*`
- Add request body size limits per route
- Add `/api/admin/audit-logs` filtering UI

### STEP 18 — Final verification

Run full `npm test`. Run `npm run dev`. Manually walk through the lifecycle.

---

## Execution Plan (What we will do NOW)

We will execute Steps 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14 in this audit
session. Steps 9, 11, 13, 15, 16, 17, 18 will follow in next iterations.

For each step we will:

1. Open the relevant file(s).
2. Make the smallest correct change.
3. Verify the file is syntactically valid (`node -c` for JS, parse for JSX).
4. Report exactly what was fixed.

Let's begin.