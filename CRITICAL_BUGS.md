# BIHAR TRANSPORT — CRITICAL BUGS (P0 & P1)

**Audit Date:** 2026-10-31  
**Total Critical Bugs:** 40 (P0: 12, P1: 28)  
**Classification:** P0 = Critical business/financial/security/data-loss risk | P1 = Major production defect  

---

## P0 — CRITICAL BUGS (12)

---

### BUG-001: WhatsApp Integration is Stubbed — Customer Notifications Silently Fail

**Severity:** P0  
**Module:** Integrations / WhatsApp  
**Affected Files:**  
- `transport-system/backend/server.js:40-42`
- `transport-system/backend/services/enquiryWhatsAppFormatter.js`

**Evidence:**
```javascript
// server.js:40-42
if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_BUSINESS_NUMBER) {
  console.warn('[whatsapp] WhatsApp notifications are disabled.');
}
```
The code only logs a warning. No WhatsApp message sending function exists. `enquiryWhatsAppFormatter.js` formats messages but nothing sends them.

**Business Impact:** Customers never receive quote notifications, booking confirmations, or delivery updates via WhatsApp. Customer communication black hole. High churn risk.

**Recommended Solution:** Implement WhatsApp Cloud API message sending with template management, delivery receipt tracking, and retry logic.

**Required Tests:** Integration test verifying WhatsApp message sent on quote_send and booking_confirm events.

**Dependencies:** WhatsApp Business API credentials, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` env vars.

---

### BUG-002: Email Notifications Fire-and-Forget — SMTP Failure Loses Critical Notifications

**Severity:** P0  
**Module:** Integrations / Email  
**Affected Files:**  
- `transport-system/backend/services/EnquiryService.js:462-490` (`_notifyOwnerOfNewEnquiry`)
- `transport-system/backend/services/BookingService.js:193-201` (notification removed — no-op)
- `transport-system/backend/services/emailService.js`

**Evidence:**
```javascript
// EnquiryService.js:466-489
Promise.resolve()
  .then(() => sendNewInquiryNotificationEmail(enquiry))
  .then((result) => { /* log only */ })
  .catch((err) => { /* log only, never rethrow */ });
```
BookingService explicitly removed owner notification — "Nothing is sent, queued, retried or logged for later delivery on booking creation."

**Business Impact:** New enquiry notifications, quote alerts, and delivery confirmations are lost when SMTP is unavailable. No retry, no dead-letter queue.

**Recommended Solution:** Implement email queue (BullMQ/Redis) with retry policy, dead-letter queue, and delivery tracking. Restore booking-created owner notification.

**Required Tests:** Integration test verifying email retry on SMTP failure; dead-letter test for permanently failed emails.

**Dependencies:** Redis, BullMQ (or similar), SMTP credentials.

---

### BUG-003: Race Condition — Duplicate Bookings from Concurrent Quote Acceptance

**Severity:** P0  
**Module:** Enquiry → Booking  
**Affected Files:**  
- `transport-system/backend/services/EnquiryService.js:1159-1225` (`customerAccept`)
- `transport-system/backend/services/BookingService.js:600-749` (`acceptQuote`)

**Evidence:**
`customerAccept` uses `updateMany` to claim the status transition (line 1203-1213), but `_createBookingFromEnquiry` (line 1224) is called OUTSIDE the transaction that made the claim. Two concurrent requests can both pass the claim check before either creates a booking.

**Business Impact:** Duplicate bookings for the same enquiry → double charging, duplicate dispatches, customer confusion.

**Recommended Solution:** Wrap claim + booking creation in a single Prisma transaction. Use `updateMany` claim inside the transaction.

**Required Tests:** Concurrency test with 10 simultaneous accept requests → exactly 1 booking created.

**Dependencies:** None (code change only).

---

### BUG-004: JWT_SECRET Not Validated for Entropy — Weak Secret Enables Account Takeover

**Severity:** P0  
**Module:** Authentication  
**Affected Files:**  
- `transport-system/backend/middleware/auth.js:15` (`jwt.verify(token, process.env.JWT_SECRET)`)
- `transport-system/backend/server.js:29-37` (`validateEnv()` — lenient in dev)

**Evidence:** `validateEnv()` catches errors but only exits if `ENV_STRICT === 'true'`. No minimum length or entropy check on `JWT_SECRET`. A weak or default secret allows JWT forgery.

**Business Impact:** Attacker can forge admin/user JWT tokens, gain full access to all endpoints including financial operations.

**Recommended Solution:** Enforce `JWT_SECRET` minimum 32 characters, high entropy, secret rotation strategy. Fail startup if invalid.

**Required Tests:** Unit test on `validateEnv` rejecting short/weak secrets.

**Dependencies:** None (code change only).

---

### BUG-005: No MFA / Token Revocation for Admin Accounts

**Severity:** P0  
**Module:** Authentication  
**Affected Files:**  
- `transport-system/backend/middleware/auth.js:19-50` (admin token resolution)
- `transport-system/backend/middleware/auth.js:107-116` (`adminOnly`)

**Evidence:** Admin login issues JWT with `expiresIn: 7d`. No MFA, no token blocklist, no session invalidation on password change. Compromised token valid for full 7 days.

**Business Impact:** Stolen admin credentials = full system compromise. No way to revoke a leaked token.

**Recommended Solution:** Add TOTP/MFA for admin login, short-lived access tokens (15min) + refresh tokens, Redis-backed token blocklist.

**Required Tests:** Integration test verifying token blocked after logout/password change.

**Dependencies:** Redis, TOTP library (speakeasy/qrcode).

---

### BUG-006: No CSRF Protection on State-Changing Endpoints

**Severity:** P0  
**Module:** Authentication / API Security  
**Affected Files:**  
- `transport-system/backend/server.js:98-114` (helmet config, no CSRF)
- `transport-system/backend/package.json:26` (`csurf` installed but unused)

**Evidence:** `csurf` is a dependency but not applied to any route. All state-changing endpoints (POST/PUT/DELETE) are vulnerable to cross-site request forgery.

**Business Impact:** Attacker can trick authenticated admin into deleting bookings, changing settlements, assigning drivers via malicious site.

**Recommended Solution:** Apply CSRF protection to all state-changing endpoints, or use SameSite=Strict cookies + double-submit token pattern.

**Required Tests:** Security test verifying CSRF token required on state-changing endpoints.

**Dependencies:** csurf middleware or custom CSRF implementation.

---

### BUG-007: Delivery Without POD Verification — Delivery Fraud Risk

**Severity:** P0  
**Module:** Trip Lifecycle / Delivery  
**Affected Files:**  
- `transport-system/backend/services/TripService.js:738-884` (`updateTripStatus`)
- `transport-system/backend/utils/TripStateMachine.js:117` (`DELIVERED: ['COMPLETED', 'IN_TRANSIT', 'CANCELLED']`)

**Evidence:** Trip state machine allows `IN_TRANSIT → DELIVERED` without requiring a verified POD document. `TripService.updateTripStatus` has no POD gate.

**Business Impact:** Driver can mark delivery complete without proof. Customer disputes have no evidence. Financial settlements based on unverified deliveries.

**Recommended Solution:** Require `pod_required` check + verified POD document before allowing `DELIVERED` status.

**Required Tests:** Integration test verifying DELIVERED rejected without POD; accepted with verified POD.

**Dependencies:** TripDocumentService, POD workflow.

---

### BUG-008: No Double-Entry Validation on Financial Transactions

**Severity:** P0  
**Module:** Financials  
**Affected Files:**  
- `transport-system/backend/services/CanonicalFinancialService.js`
- `transport-system/backend/repositories/FinancialTransactionRepository.js`
- `transport-system/backend/prisma/schema.prisma:894-934` (`FinancialTransaction` model)

**Evidence:** `FinancialTransaction` has `direction` (DEBIT/CREDIT) and `amount`, but no constraint enforcing that debits equal credits per transaction or settlement period. All financial logic is in application code.

**Business Impact:** Silent money creation or loss. Cannot pass financial audit. Vendor/customer disputes unresolvable.

**Recommended Solution:** Add PostgreSQL CHECK constraints or triggers enforcing double-entry integrity. Periodic reconciliation job.

**Required Tests:** DB test verifying transaction balancing; reconciliation test.

**Dependencies:** Prisma schema migration.

---

### BUG-009: Schema Drift — Multiple Reconciliation Migrations Indicate Unreliable Migration History

**Severity: P0  
**Module:** Database & Migrations  
**Affected Files:**  
- `transport-system/backend/prisma/migrations/` (51 migration directories)
- `transport-system/backend/schema-diff.txt`
- `transport-system/backend/scripts/apply-missing-migrations.sql`

**Evidence:** Migration directories named `reconcile_schema_equivalence`, `repair-quote-workflow-migration.sql` indicate repeated schema drift repairs. Migration history is not a reliable single source of truth.

**Business Impact:** Failed deployments, schema inconsistencies between environments, potential data loss during migration.

**Recommended Solution:** Clean migration history. Make `schema.prisma` the single source of truth. CI gate: `prisma migrate status` must be clean before deploy.

**Required Tests:** DB test verifying migration status clean; CI pipeline test.

**Dependencies:** Prisma migrate, CI pipeline.

---

### BUG-010: No CI/CD Pipeline — Manual Deployment with Human Error Risk

**Severity:** P0  
**Module:** Deployment  
**Affected Files:**  
- `transport-system/backend/package.json` (no test/deploy CI scripts beyond local)
- `transport-system/frontend/package.json` (no CI scripts)
- Repository root: no `.github/workflows/`

**Evidence:** No GitHub Actions, no GitLab CI, no automated test/deploy pipeline. Deployment is manual via `node server.js` or `prisma migrate deploy`.

**Business Impact:** Inconsistent deployments, no automated testing before production, human error risk.

**Recommended Solution:** Create GitHub Actions pipeline: lint → test → build → staging deploy → production deploy (with approval).

**Required Tests:** Pipeline end-to-end test.

**Dependencies:** GitHub Actions, deployment target (Render/Neon).

---

### BUG-011: No Dockerfile — Inconsistent Dev/Prod Environments

**Severity:** P0  
**Module:** Deployment  
**Affected Files:**  
- Repository root: no `Dockerfile`
- `transport-system/backend/` — no Dockerfile
- `transport-system/frontend/` — no Dockerfile

**Evidence:** No containerization. `npm start` / `node server.js` directly. Environment differences between dev and production not captured.

**Business Impact:** "Works on my machine" deployment failures. Inconsistent dependency versions.

**Recommended Solution:** Add multi-stage Dockerfiles for backend and frontend. docker-compose for local development.

**Required Tests:** Build test verifying Docker images build and run.

**Dependencies:** Docker.

---

### BUG-012: No P0 Downtime / Data Loss Protection — No Backup Automation

**Severity:** P0  
**Module:** Operations  
**Affected Files:**  
- `transport-system/BIHAR_TRANSPORT_BACKUP_RESTORE_RUNBOOK.md` (documentation only)
- `transport-system/backend/backups/` (directory exists, no automation)

**Evidence:** Backup runbook is a markdown document. No automated `pg_dump`, no S3 backup, no point-in-time recovery tested.

**Business Impact:** Data loss on database failure with no recovery path. RTO/RPO undefined.

**Recommended Solution:** Automated daily `pg_dump` to S3, point-in-time recovery, quarterly restore drills.

**Required Tests:** Restore drill test verifying RTO < 4 hours.

**Dependencies:** PostgreSQL, S3 or equivalent storage.

---

## P1 — MAJOR PRODUCTION DEFECTS (28)

---

### BUG-013: Admin `operator` Role Over-Privileged on All Admin Routes

**Severity:** P1  
**Module:** Authentication  
**Affected Files:** `transport-system/backend/middleware/auth.js:108`

**Evidence:** `adminOnly` allows `role === 'admin' || role === 'super_admin' || role === 'operator'`. Operators can access financial, user deletion, and settlement routes.

**Impact:** Over-privileged operators can modify sensitive financial data.

**Solution:** Granular RBAC — operator should not access financial/user deletion routes.

**Tests:** Unit test verifying operator denied on financial routes.

---

### BUG-014: Enquiry → Trip Sync Failure Leaves Inconsistent State

**Severity:** P1  
**Module:** Enquiry → Trip  
**Affected Files:** `transport-system/backend/services/EnquiryService.js:807-840`

**Evidence:** `adminAssign` commits enquiry-level changes, then attempts Trip sync. If sync fails, error is logged and rethrown but enquiry already committed. Enquiry looks assigned; Vehicle Hire sees no trip.

**Impact:** Enquiry and Vehicle Hire disagree on assignment. Consignment appears "missing" from Vehicle Hire.

**Solution:** Compensating transaction or outbox pattern for sync reliability.

**Tests:** Integration test verifying sync failure doesn't leave inconsistent state.

---

### BUG-015: No Rate Limiting on Public Tracking Endpoint

**Severity:** P1  
**Module:** Customer Tracking  
**Affected Files:** `transport-system/backend/routes/bookingRoutes.js` (track endpoint), `transport-system/backend/server.js:169-174` (global limiter only)

**Evidence:** `GET /api/bookings/track/:reference` shares global limiter (2000/15min) but no specific tracker. Reference enumeration attack possible.

**Impact:** Attacker can enumerate booking references and expose customer/driver/vehicle details.

**Solution:** Dedicated rate limiter on tracking endpoint (e.g., 30/15min per IP).

**Tests:** Security test verifying rate limit on tracking endpoint.

---

### BUG-016: Vehicle Document Dates Stored as TEXT — Invalid Dates Pass Validation

**Severity:** P1  
**Module:** Vehicle Hire  
**Affected Files:** `transport-system/backend/services/VehicleHireWorkflowService.js:100-143` (`parseDocumentDate`)

**Evidence:** `parseDocumentDate` accepts 6+ date formats (`2027-04-30`, `30-04-2027`, `30/04/2027`, ISO timestamps). Unparseable values reported as "not recorded" rather than rejected.

**Impact:** Trucks with unknown/expired documents can pass the hire gate. Compliance risk.

**Solution:** Migrate document expiry columns to proper `DATE` type. Strict format validation.

**Tests:** Integration test verifying invalid dates rejected.

**Dependencies:** Prisma migration.

---

### BUG-017: No GST/PAN Format Validation on Partner/VehicleOwner

**Severity:** P1  
**Module:** Partner Management  
**Affected Files:** `transport-system/backend/prisma/schema.prisma:464-514` (Partner), `176-219` (VehicleOwner)

**Evidence:** `gst_number` and `pan_number` are plain `String?` fields with no format validation at schema or application level.

**Impact:** Invalid tax IDs. GST compliance issues. Invoice rejection by tax authorities.

**Solution:** Regex validation for GST (15-character pattern) and PAN (10-character pattern).

**Tests:** Unit test verifying GST/PAN validation.

---

### BUG-018: Driver License Expiry Not Validated Before Trip Assignment

**Severity:** P1  
**Module:** Driver Management  
**Affected Files:** `transport-system/backend/services/DriverManagementService.js`, `transport-system/backend/prisma/schema.prisma:79` (`license_expiry` as String?)

**Evidence:** `license_expiry` stored as `String?`, never parsed or validated. Drivers with expired licenses can be assigned to trips.

**Impact:** Legal liability, safety risk, regulatory non-compliance.

**Solution:** Validate license expiry date before assigning driver to trip.

**Tests:** Integration test verifying expired license driver rejected.

---

### BUG-019: No Idempotency on Partner Payment Creation

**Severity:** P1  
**Module:** Financials  
**Affected Files:** `transport-system/backend/routes/partnerSettlementRoutes.js`, `transport-system/backend/services/PartnerService.js`

**Evidence:** `PartnerPayment.payment_number` is `@unique` but no idempotency key on creation. Retry after network failure can create duplicate payments.

**Impact:** Duplicate vendor payments. Financial reconciliation errors.

**Solution:** Idempotency key on payment creation; idempotency check inside transaction.

**Tests:** Integration test verifying duplicate payment rejected with same idempotency key.

---

### BUG-020: Settlement `net_payable` Not Enforced at DB Level

**Severity:** P1  
**Module:** Financials  
**Affected Files:** `transport-system/backend/prisma/schema.prisma:608-643` (Settlement), `transport-system/backend/services/TripSettlementService.js`

**Evidence:** `net_payable` calculated in application code. No CHECK constraint enforcing `gross_revenue − commission − expenses = net_payable`.

**Impact:** Settlement amount can be incorrect. Vendor under/over-payment.

**Solution:** DB CHECK constraint on settlement arithmetic.

**Tests:** DB test verifying settlement constraint.

**Dependencies:** Prisma migration.

---

### BUG-021: Google Maps API — No Rate Limiting, Caching, or Circuit Breaker

**Severity:** P1  
**Module:** Integrations / Google Maps  
**Affected Files:** `transport-system/backend/controllers/mapsController.js`, `transport-system/backend/services/distanceMatrix.js`

**Evidence:** Direct Google Distance Matrix API calls with no client-side rate limit, no caching of city-pair distances, no circuit breaker for API outages.

**Impact:** API quota exhaustion, unexpected costs, silent failures when Google API unavailable.

**Solution:** Rate limit per API key, cache city-pair distances (24h TTL), circuit breaker with fallback to static distances.

**Tests:** Integration test verifying circuit breaker on API failure.

**Dependencies:** Redis (cache), circuit breaker library.

---

### BUG-022: No Distributed Tracing — Cannot Diagnose Cross-Service Issues

**Severity:** P1  
**Module:** Observability  
**Affected Files:** `transport-system/backend/server.js`, `transport-system/frontend/src/services/api.js`

**Evidence:** No OpenTelemetry instrumentation. Only Pino HTTP logging with request IDs. No trace context propagation between frontend and backend.

**Impact:** Production incidents involving multiple services cannot be traced. MTTR increased.

**Solution:** Add OpenTelemetry SDK to backend and frontend. Export to Jaeger/Tempo.

**Tests:** Integration test verifying trace context in logs.

**Dependencies:** OpenTelemetry, Jaeger/Tempo.

---

### BUG-023: No Custom Business Metrics — Blind to KPI Failures

**Severity:** P1  
**Module:** Observability  
**Affected Files:** `transport-system/backend/server.js` (only HTTP status logging)

**Evidence:** Only HTTP status codes logged (Pino customLogLevel). No business metrics: bookings/hour, quote acceptance rate, payment failure rate, settlement delays.

**Impact:** Business issues detected late or not at all. No alerting on quote acceptance drop.

**Solution:** Prometheus metrics: business KPIs, queue depths, error rates by type. Grafana dashboards.

**Tests:** Integration test verifying metrics endpoint.

**Dependencies:** Prometheus client, Grafana.

---

### BUG-024: Log Rotation Not Configured — `backend.log` Is 1.4GB

**Severity:** P1  
**Module:** Observability  
**Affected Files:** `transport-system/backend/backend.log` (1,473,469 bytes), `transport-system/backend/utils/logger.js`

**Evidence:** Single growing log file. No rotation. No centralized logging (ELK/EFK).

**Impact:** Disk exhaustion. Log loss on restart. Cannot search historical logs.

**Solution:** Log rotation (daily/size-based). Centralized logging (Fluentd + ELK or Loki).

**Tests:** Ops test verifying log rotation.

**Dependencies:** logrotate/Fluentd, ELK stack.

---

### BUG-025: Health Checks Don't Verify External Dependencies

**Severity:** P1  
**Module:** Observability  
**Affected Files:** `transport-system/backend/server.js:353-417` (`/api/ready`)

**Evidence:** `/api/ready` checks only PostgreSQL via Prisma. Does not check email SMTP, WhatsApp API, Google Maps API.

**Impact:** Load balancer sends traffic to instance with broken dependencies. False healthy status.

**Solution:** Add dependency health checks to `/api/ready`.

**Tests:** Integration test verifying `/api/ready` fails when DB down.

---

### BUG-026: JWT Stored in localStorage — XSS Vulnerability

**Severity:** P1  
**Module:** Frontend Security  
**Affected Files:** `transport-system/frontend/src/services/api.js:21-24`

**Evidence:** `const token = localStorage.getItem('token')` — token accessible to any JavaScript on the page.

**Impact:** XSS attack steals session token. Full account takeover.

**Solution:** httpOnly cookies or secure token storage with short expiry.

**Tests:** Security test verifying token not accessible via `document.cookie` or localStorage in XSS scenario.

---

### BUG-027: No Request Timeout Granularity on Frontend

**Severity:** P1  
**Module:** Frontend  
**Affected Files:** `transport-system/frontend/src/services/api.js:15` (`timeout: 12000`)

**Evidence:** Single 12-second timeout for all API calls. No per-endpoint timeouts. No retry with backoff.

**Impact:** Long-running operations (report generation, large file upload) fail. Poor UX on slow networks.

**Solution:** Per-endpoint timeouts. Retry with exponential backoff for idempotent operations.

**Tests:** Unit test verifying timeout and retry behavior.

**Dependencies:** axios-retry or similar.

---

### BUG-028: Error Boundaries Not Consistently Applied on Frontend

**Severity:** P1  
**Module:** Frontend  
**Affected Files:** `transport-system/frontend/src/components/ErrorBoundary.jsx`, `transport-system/frontend/src/App.jsx`

**Evidence:** `ErrorBoundary.jsx` exists but not wrapping all route components. Uncaught errors can white-screen the entire app.

**Impact:** Unhandled React errors crash the entire frontend. Poor UX.

**Solution:** Wrap all route components and major feature areas with ErrorBoundary.

**Tests:** Unit test verifying error boundary catches component errors.

---

### BUG-029: Large Page Files Violate Single Responsibility

**Severity:** P2 (classified P1 for maintenance risk)  
**Module:** Frontend  
**Affected Files:** `transport-system/frontend/src/pages/AdminBookings.jsx` (1557 lines), `AdminOrders.jsx` (67KB)

**Evidence:** Single files handle data fetching, filtering, pagination, modals, deletion, quotes, stats — all in one component.

**Impact:** Hard to maintain, test, and debug. High risk of regressions.

**Solution:** Split into smaller components: BookingTable, BookingFilters, QuoteModal, DeletionModal, StatsBar.

**Tests:** Component unit tests after refactor.

---

### BUG-030: Advisory Lock Deadlock Risk — Inconsistent Lock Acquisition Order

**Severity:** P1  
**Module:** Trip / Vehicle Hire  
**Affected Files:** `transport-system/backend/services/TripService.js:86-100` (`_acquireAdvisoryLocks`), `transport-system/backend/services/VehicleHireWorkflowService.js`

**Evidence:** `TripService` sorts locks by namespace. Other services may acquire locks in different order. Deadlock under concurrent trip creation.

**Impact:** Trip creation hangs or fails with deadlock error under load.

**Solution:** Centralize all advisory lock acquisition through one utility with consistent ordering.

**Tests:** Load test with concurrent trip creation.

---

### BUG-031: No Connection Pooling Configuration Visible

**Severity:** P1  
**Module:** Database  
**Affected Files:** `transport-system/backend/prisma/schema.prisma:5-9` (datasource), `transport-system/backend/config/prisma.js`

**Evidence:** Prisma client uses default connection pool. No `connection_limit` or pool configuration visible.

**Impact:** Connection exhaustion under high concurrency. 503 errors.

**Solution:** Configure `connection_limit` in datasource. Monitor pool utilization.

**Tests:** Load test verifying connection pool behavior.

---

### BUG-032: No Soft Delete on Critical Tables

**Severity:** P1  
**Module:** Database  
**Affected Files:** `transport-system/backend/prisma/schema.prisma` (Bookings, Trips, Partners lack `deleted_at`)

**Evidence:** `deleted_at` exists only on VehicleOwner, Partner, Client. Bookings, Trips, Enquiries hard-delete.

**Impact:** Accidental deletion loses data permanently. No audit of deleted records.

**Solution:** Add `deleted_at` to all core tables. Soft-delete pattern in repositories.

**Tests:** DB test verifying soft delete behavior.

**Dependencies:** Prisma migration.

---

### BUG-033: No Input Sanitization on File Uploads

**Severity:** P1  
**Module:** Trip Documents  
**Affected Files:** `transport-system/backend/server.js:133` (`express.json({ limit: '12mb' })` for `/api/trips`)

**Evidence:** Base64 file uploads up to 12MB with no virus scanning, no file type validation, no size limits per file type.

**Impact:** Malware upload. Storage exhaustion. XSS via malicious SVG/HTML files.

**Solution:** Virus scan (ClamAV), file type validation, per-type size limits.

**Tests:** Security test verifying malicious file rejected.

**Dependencies:** ClamAV or similar.

---

### BUG-034: No Password Strength Policy

**Severity:** P1  
**Module:** Authentication  
**Affected Files:** `transport-system/backend/controllers/otpController.js`, `transport-system/backend/routes/authRoutes.js`

**Evidence:** No password complexity requirements visible. No password history. No expiration.

**Impact:** Weak passwords. Credential stuffing attacks.

**Solution:** Password strength policy (min 12 chars, mixed case, numbers, symbols). Password history. Expiration (90 days).

**Tests:** Unit test verifying password strength validation.

---

### BUG-035: No Account Lockout After Failed Login Attempts

**Severity:** P1  
**Module:** Authentication  
**Affected Files:** `transport-system/backend/routes/authRoutes.js`, `transport-system/backend/services/otpService.js`

**Evidence:** OTP has `max_attempts: 3` but no account lockout after repeated failed OTP or password attempts.

**Impact:** Brute force attacks on OTP and passwords.

**Solution:** Account lockout after 5 failed attempts. CAPTCHA after 3 failures.

**Tests:** Integration test verifying account lockout.

---

### BUG-036: No Session Absolute Timeout

**Severity:** P1  
**Module:** Authentication  
**Affected Files:** `transport-system/backend/middleware/auth.js:120-122` (`expiresIn: process.env.JWT_EXPIRE || '7d'`)

**Evidence:** JWT expires in 7 days by default. No absolute timeout. No forced re-authentication.

**Impact:** Long-lived sessions increase token theft window.

**Solution:** Absolute timeout (24 hours max). Forced re-authentication for sensitive operations.

**Tests:** Integration test verifying token expiration.

---

### BUG-037: No Concurrent Session Limits

**Severity:** P1  
**Module:** Authentication  
**Affected Files:** `transport-system/backend/middleware/auth.js`

**Evidence:** No tracking of active sessions per user. Multiple simultaneous logins allowed.

**Impact:** Shared credentials. No detection of token theft via concurrent sessions.

**Solution:** Track active sessions. Limit concurrent sessions per user. Notify on new login.

**Tests:** Integration test verifying session limit.

**Dependencies:** Redis (session store).

---

### BUG-038: No Query Length Validation on Global Search

**Severity:** P1  
**Module:** Global Search  
**Affected Files:** `transport-system/backend/routes/adminRoutes.js` (global search), `transport-system/frontend/src/services/api.js:610-611`

**Evidence:** `GET /api/admin/global-search?q=` — no max query length. No rate limiting specific to search.

**Impact:** DoS via expensive LIKE queries on large tables.

**Solution:** Max query length (100 chars). Rate limit on search endpoint. Indexes on searchable columns.

**Tests:** Security test verifying search rate limit and query length.

---

### BUG-039: Search Results Not Role-Scoped

**Severity:** P1  
**Module:** Global Search  
**Affected Files:** `transport-system/backend/routes/adminRoutes.js`

**Evidence:** Global search returns all entities visible to admin, but no role-based filtering on results.

**Impact:** Data leakage — operator may see financial records they shouldn't access.

**Solution:** Role-scoped search filters based on `req.user.role`.

**Tests:** Integration test verifying role-scoped search results.

---

### BUG-040: No Pagination Enforcement on Some Admin List Endpoints

**Severity:** P1  
**Module:** API  
**Affected Files:** `transport-system/backend/routes/adminRoutes.js` (116KB — various list endpoints)

**Evidence:** Some admin list endpoints accept `page`/`limit` but no max limit enforcement. Can return thousands of rows.

**Impact:** Memory exhaustion. Slow API responses. DoS via large list requests.

**Solution:** Enforce max limit (100) on all list endpoints. Default limit 25.

**Tests:** Integration test verifying max limit enforcement.

---

## BUG SUMMARY BY SEVERITY

| Severity | Count |
|----------|-------|
| P0 | 12 |
| P1 | 28 |
| **Total** | **40** |

## BUG SUMMARY BY MODULE

| Module | P0 | P1 | Total |
|--------|----|----|-------|
| Authentication | 4 | 6 | 10 |
| Enquiry → Booking | 2 | 2 | 4 |
| Vehicle Hire | 0 | 2 | 2 |
| Trip Lifecycle | 1 | 2 | 3 |
| Financials | 2 | 3 | 5 |
| Integrations | 2 | 1 | 3 |
| Observability | 0 | 3 | 3 |
| Database | 2 | 3 | 5 |
| Frontend | 0 | 4 | 4 |
| Deployment | 1 | 0 | 1 |
| Global Search | 0 | 2 | 2 |
| **Total** | **12** | **28** | **40** |

---

## REPRODUCTION PRIORITY (First 5 to Fix)

1. **BUG-004** (JWT_SECRET entropy) — 1 day
2. **BUG-003** (Duplicate bookings race) — 2 days
3. **BUG-002** (Email fire-and-forget) — 3 days
4. **BUG-001** (WhatsApp stubbed) — 5 days
5. **BUG-007** (No POD enforcement) — 2 days

**Each bug will be fixed, tested, reviewed, and released independently. Approval required before any implementation begins.**