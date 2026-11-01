# BIHAR TRANSPORT — MODULE WISE AUDIT

**Audit Scope:** All 14 modules defined in the audit charter  
**Method:** Implementation traced frontend → API → service → repository → database  
**Audit Date:** 2026-10-31  

---

## MODULE 1: AUTHENTICATION & AUTHORIZATION

### Files Inspected
- `transport-system/backend/middleware/auth.js`
- `transport-system/backend/controllers/otpController.js`
- `transport-system/backend/routes/authRoutes.js`
- `transport-system/backend/services/otpService.js`
- `transport-system/backend/repositories/otpRepository.js`
- `transport-system/backend/config/prisma.js`
- `transport-system/backend/server.js` (rate limiting, CORS)
- `transport-system/frontend/src/services/api.js` (authAPI, token storage)
- `transport-system/frontend/src/pages/Login.jsx`, `AdminLogin.jsx`, `PartnerLogin.jsx`
- `transport-system/frontend/src/components/ProtectedRoute.jsx`

### Architecture Summary
JWT-based stateless authentication with separate flows for users, drivers, admins, and partners. OTP-based phone verification. Admin tokens carry `type: 'admin'` and resolve through the `Admin` model. `protect` middleware validates JWT and loads principal into `req.user`. `adminOnly` middleware checks role.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| AUTH-001 | P0 | JWT_SECRET not validated for entropy or minimum length | `auth.js:15` — `jwt.verify(token, process.env.JWT_SECRET)`; no entropy check in `validateEnv()` | Full account takeover if weak/leaked secret | Enforce min 32 chars, random generation, secret rotation strategy | Unit test on `validateEnv` | ENV_STRICT |
| AUTH-002 | P0 | No MFA for admin/super_admin accounts | `auth.js` — single-factor JWT only | Privilege escalation if admin credentials compromised | Add TOTP/MFA for admin login, backup codes | Integration test | Auth middleware |
| AUTH-003 | P0 | No session invalidation on password change or role change | No token revocation list; JWT valid until expiry | Compromised token remains valid after credential rotation | Implement Redis-backed token blocklist or short JWT expiry + refresh tokens | Integration test | Redis |
| AUTH-004 | P1 | CORS origin `*` in development (`server.js:121`) | `origin: isDev ? '*' : ...` | Cross-origin request leakage in dev/staging | Restrict to specific origins even in dev | Integration test | CORS config |
| AUTH-005 | P1 | No CSRF protection on state-changing endpoints | `server.js` — helmet used but `csurf` installed yet unused | XSRF attacks on admin actions (delete, assign, settle) | Add CSRF tokens for cookie-based or same-origin state mutations | Integration test | csurf middleware |
| AUTH-006 | P1 | Admin `adminOnly` allows `operator` role on all admin routes | `auth.js:108` — `role === 'admin' || role === 'super_admin' || role === 'operator'` | Over-privileged operators can access sensitive admin functions | Granular RBAC: operator should not access financial/user deletion routes | Unit test | RBAC policy |
| AUTH-007 | P1 | Password reset tokens lack expiry enforcement at consumption | `PasswordResetToken.expires_at` exists but no check in reset flow | Stale tokens could be used after expiry | Validate `expires_at` before accepting reset | Integration test | Auth controller |
| AUTH-008 | P2 | Bcrypt default salt rounds (10) not configurable | `bcryptjs` used directly without work factor config | Slower hashing than optimal; no future-proofing | Configurable `BCRYPT_SALT_ROUNDS` env var | Unit test | bcryptjs |

### Trace: Frontend → API → Service → Repository → DB
**Login flow:** `Login.jsx` → `authAPI.login()` → `POST /api/auth/login` → `authRoutes.js` → `otpController`/auth controller → `prisma.user.findUnique` → `users` table  
**Token storage:** `localStorage.getItem('token')` → axios request interceptor adds `Bearer` header  
**Admin login:** `AdminLogin.jsx` → `authAPI.adminLogin()` → `POST /api/auth/admin-login` → resolves `Admin` model → JWT with `type: 'admin'`

### Production Risk
**HIGH** — Without MFA, token revocation, and CSRF protection, the admin surface is vulnerable to credential theft and XSRF. A compromised admin account can modify bookings, settlements, and delete data.

---

## MODULE 2: ENQUIRY → QUOTATION → BOOKING LIFECYCLE

### Files Inspected
- `transport-system/backend/services/EnquiryService.js` (100KB+)
- `transport-system/backend/services/BookingService.js`
- `transport-system/backend/services/EnquiryAssignmentService.js`
- `transport-system/backend/services/BookingNumberService.js`
- `transport-system/backend/controllers/enquiryController.js`
- `transport-system/backend/controllers/bookingController.js`
- `transport-system/backend/routes/enquiryRoutes.js`
- `transport-system/backend/routes/bookingRoutes.js`
- `transport-system/backend/utils/EnquiryStateMachine.js`
- `transport-system/backend/utils/BookingStateMachine.js`
- `transport-system/backend/repositories/BookingRepository.js`
- `transport-system/frontend/src/pages/AdminEnquiries.jsx`, `AdminEnquiryWorkspace.jsx`
- `transport-system/frontend/src/pages/AdminBookings.jsx`
- `transport-system/frontend/src/pages/BookTransport.jsx`

### Architecture Summary
Pre-booking enquiry module handles guest and authenticated customer intake. Admin assigns vehicle/driver/partner, sets final quote, sends to customer. Customer accepts/rejects. On acceptance, `BookingService.createBooking()` creates the canonical booking → trip → financial pipeline. State machines enforce monotonic forward transitions.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| ENQ-001 | P0 | Race condition: double-accept of quote could create two bookings | `EnquiryService.customerAccept` uses `updateMany` claim but `_createBookingFromEnquiry` not inside same transaction as claim | Duplicate bookings, double charging | Wrap claim + booking creation in single Prisma transaction | Integration test | BookingService |
| ENQ-002 | P0 | Enquiry → Trip sync failure swallows error silently | `EnquiryService.adminAssign:833-840` — `catch (syncError)` logs and rethrows but enquiry already committed | Enquiry looks assigned, Vehicle Hire sees no trip | Compensating transaction or outbox pattern for sync | Integration test | TripProvisioningService |
| ENQ-003 | P1 | No validation that `final_quoted_price` reflects actual market rate | `MIN_QUOTE_AMOUNT = 1`, `MAX_QUOTE_AMOUNT = 10_000_000` only | Admin could quote ₹1 trip | Business rule validation: min price per km, route-based floor | Integration test | Pricing service |
| ENQ-004 | P1 | Guest access token (`issueEnquiryAccessToken`) has no revocation | `EnquiryAccessToken` utility — JWT with no blocklist | Stale guest token can access enquiry after completion | Short expiry (24h), enquiry-scoped, blocklist on completion | Unit test | EnquiryAccessToken |
| ENQ-005 | P1 | Email notification fire-and-forget; SMTP failure loses notification | `EnquiryService._notifyOwnerOfNewEnquiry` — Promise.resolve().then(), never awaits | Owner never notified of new enquiry | Email queue with retry + dead-letter | Integration test | emailService |
| ENQ-006 | P1 | `session_key` not validated for uniqueness or format | `session_key: clean(ctx.sessionKey, 120)` | Session hijacking or collision | UUID validation, uniqueness index | Unit test | — |
| ENQ-007 | P2 | Pickup date past-validation uses `todayStart` UTC but comparison may drift | `parsePickupDate` pins to UTC midnight; `todayStart` also UTC | Edge case at midnight boundary | Add buffer (±1 hour) for DST/timezone edge cases | Unit test | — |
| ENQ-008 | P2 | No enquiry expiration / auto-abandonment | Enquiries stay in `ENQUIRY_SUBMITTED` forever | Stale enquiries clutter dashboard | Auto-expire enquiries after 30 days of inactivity | Integration test | Cron job |

### Trace
**Customer creates enquiry:** `BookTransport.jsx` → `enquiryAPI.create()` → `POST /api/enquiries` → `enquiryController` → `EnquiryService.createEnquiry()` → `prisma.enquiry.create` → `enquiries` table  
**Admin sends quote:** `AdminEnquiryWorkspace.jsx` → `adminAPI.sendQuotation()` → `POST /api/admin/enquiries/:id/quotation/send` → `EnquiryService.adminSendQuote()` → `prisma.enquiry.update` + `updateMany` claim  
**Customer accepts:** Enquiry confirmation page → `enquiryAPI.acceptQuote()` → `EnquiryService.customerAccept()` → `BookingService.createBooking()` → `bookings` + `delivery` + `invoice` tables

### Production Risk
**HIGH** — Duplicate bookings from race conditions directly cause financial overcharging and operational confusion.

---

## MODULE 3: VEHICLE HIRE & ASSIGNMENT

### Files Inspected
- `transport-system/backend/services/VehicleHireWorkflowService.js`
- `transport-system/backend/services/TripVehicleAssignmentService.js`
- `transport-system/backend/services/TripProvisioningService.js`
- `transport-system/backend/services/ResourceAvailabilityService.js`
- `transport-system/backend/routes/vehicleHireRoutes.js`
- `transport-system/backend/config/vehicleHirePolicy.js`
- `transport-system/frontend/src/pages/AdminVehicleHireList.jsx`
- `transport-system/frontend/src/pages/AdminAssignVehicle.jsx`, `AdminAssignDriver.jsx`

### Architecture Summary
Universal Vehicle Hire workflow — single writer shared by Enquiry page and Vehicle Hire page. Computes gross hire, commission, net vendor payable server-side. Document expiry evaluation. Advisory locks for double-booking prevention. Vacant-first resource ranking.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| VH-001 | P0 | `gross_hire − commission = net_vendor_payable` not enforced at DB level for all tables | Constraint exists on `vehicle_hires` (migration 20260930120100) but not on `Booking.commission_amount` / `TripFinancial` | Silent financial drift between booking and hire records | Add CHECK constraint + trigger on all financial tables | DB migration test | Prisma schema |
| VH-002 | P1 | Advisory lock namespace sorting can deadlock if locks acquired in different order elsewhere | `TripService._acquireAdvisoryLocks` sorts by ns; other services may not | Deadlock under concurrent trip creation | Centralize all advisory lock acquisition through one utility | Load test | TripService |
| VH-003 | P1 | Vehicle document dates stored as TEXT with multiple format parsing | `parseDocumentDate` handles 6+ formats | Invalid dates pass as valid; trucks with unknown papers pass hire gate | Migrate to proper DATE columns; strict format validation | Integration test | Prisma migration |
| VH-004 | P1 | No validation that hired vehicle actually belongs to the vendor being paid | `VehicleHire` links vendor via `vendor_id` FK but hire terms don't re-verify ownership at hire time | Payment to wrong vendor | Re-verify `vehicle.owner_id === vendor_id` at hire time | Integration test | — |
| VH-005 | P2 | Hire context loads enquiry with `.catch(() => null)` — silent failure | `VehicleHireWorkflowService.getHireContext:583` | Missing customer info on enquiry-raised trips | Propagate error or fallback to "Unknown" | Unit test | — |
| VH-006 | P2 | `can_hire` derived from status but no DB constraint enforcing hire-ready statuses | Application-level check only | Direct DB writes could create hire on invalid trip status | DB CHECK constraint on `vehicle_hires.status` vs `trips.status` | DB test | Prisma schema |

### Trace
**Hire vehicle:** `AdminVehicleHireList.jsx` → `adminAPI.tripOperations.dispatchVehicle()` or hire endpoint → `POST /api/vehicle-hire/provision` → `VehicleHireWorkflowService.hireVehicle()` → `prisma.vehicleHire.create` + `prisma.trip.update` + advisory locks → `vehicle_hires`, `trips` tables

### Production Risk
**MEDIUM-HIGH** — Financial drift between booking commission and hire commission can cause vendor under/over-payment.

---

## MODULE 4: TRIP LIFECYCLE (DISPATCH → DELIVERY → POD)

### Files Inspected
- `transport-system/backend/services/TripService.js`
- `transport-system/backend/services/TripOperationalService.js`
- `transport-system/backend/services/TripDispatchService.js`
- `transport-system/backend/services/TripDeliveryService.js`
- `transport-system/backend/services/TripDocumentService.js`
- `transport-system/backend/services/TripTrackingService.js`
- `transport-system/backend/routes/tripRoutes.js`
- `transport-system/backend/routes/dispatchRoutes.js`
- `transport-system/backend/routes/deliveryRoutes.js`
- `transport-system/backend/utils/TripStateMachine.js`
- `transport-system/frontend/src/pages/AdminTripProcess.jsx`
- `transport-system/frontend/src/pages/DeliveryTracking.jsx`, `TrackBooking.jsx`

### Architecture Summary
Trip operational chain: PENDING → ASSIGNED → TO_LOADING_POINT → AT_LOADING_POINT → LOADED → DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED. Legacy short-cuts preserved (ASSIGNED→IN_TRANSIT). Dispatch workspace handles LR/GR, e-way bill, insurance, delivery info, POD. Advisory locks prevent double-booking.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| TRP-001 | P0 | No validation that trip cannot be marked DELIVERED without POD | `TripService.updateTripStatus` allows DELIVERED from IN_TRANSIT | Delivery fraud, no proof of delivery | Require `pod_required` check + POD document verified before DELIVERED | Integration test | TripDocumentService |
| TRP-002 | P0 | Location updates have no rate limiting or spoofing protection | `TripService` / delivery endpoints accept `current_latitude`/`current_longitude` without bounds | Fake GPS locations, driver location spoofing | Validate coordinates within route bounds, rate limit location updates | Integration test | — |
| TRP-003 | P1 | E-way bill marked "INTERNAL RECORD ONLY — no government API integration" | Schema comment on `EwayBill` model | Not legally valid for inter-state transport | Integrate NIC e-way bill API or clearly mark as internal | Integration test | EwayBill service |
| TRP-004 | P1 | Document upload accepts base64 up to 12MB with no virus scanning | `server.js:133` — `express.json({ limit: '12mb' })` for `/api/trips` | Malware upload, storage exhaustion | Virus scan, file type validation, size limits per type | Security test | ClamAV/AV |
| TRP-005 | P1 | Trip status update allows legacy short-cuts on operational path | `TripStateMachine.validateTransition` permits ASSIGNED→IN_TRANSIT | Loading/dispatch chain bypassed, audit gaps | Separate operational endpoint uses `validateOperationalTransition` | Integration test | TripStateMachine |
| TRP-006 | P2 | No geofencing on pickup/drop locations | Location stored as Float but no geofence validation | Drivers can mark pickup/drop from anywhere | Geofence radius validation around locations | Integration test | Google Maps |
| TRP-007 | P2 | Trip deletion blocked only if financial records exist; no soft delete | `TripService.deleteTrip` hard deletes | Accidental deletion loses history | Soft delete with `deleted_at` column | Integration test | Prisma migration |

### Trace
**Dispatch trip:** `AdminTripProcess.jsx` → `adminAPI.tripOperations.dispatchVehicle()` → `POST /api/trips/:id/dispatch` → `TripDispatchService.dispatchTrip()` → advisory locks → `trip_dispatches`, `trips` tables  
**POD:** Driver app → `submitPod()` → `POST /api/trips/:id/pod` → `TripDocumentService` → `trip_documents` + POD verification workflow

### Production Risk
**HIGH** — Deliveries without POD verification enable fraud and customer disputes with no evidence.

---

## MODULE 5: FINANCIALS (LEDGERS, SETTLEMENTS, INVOICES)

### Files Inspected
- `transport-system/backend/services/CanonicalFinancialService.js`
- `transport-system/backend/services/CommissionService.js`
- `transport-system/backend/services/CommissionCalculator.js`
- `transport-system/backend/services/TripSettlementService.js`
- `transport-system/backend/services/TripFinancialService.js`
- `transport-system/backend/services/TripInvoiceService.js`
- `transport-system/backend/services/VendorLedgerService.js`
- `transport-system/backend/routes/financialRoutes.js`
- `transport-system/backend/routes/tripFinancialRoutes.js`
- `transport-system/backend/routes/tripBillingRoutes.js`
- `transport-system/backend/routes/partnerSettlementRoutes.js`
- `transport-system/backend/repositories/PartnerLedgerRepository.js`
- `transport-system/backend/repositories/FinancialTransactionRepository.js`
- `transport-system/frontend/src/pages/AdminFinancials.jsx`

### Architecture Summary
Canonical financial service computes commission, net payable, BT margin. Partner ledger tracks debits/credits with running balance. Settlements generated monthly per partner. Invoices linked to bookings/trips. FinancialTransaction records all money movements with double-entry-like fields (from_party, to_party, direction).

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| FIN-001 | P0 | No double-entry validation — debits may not equal credits | `FinancialTransaction` has `direction` but no transaction-level balancing | Silent money creation/loss | Enforce `SUM(debits) = SUM(credits)` per settlement period | DB test | FinancialTransaction |
| FIN-002 | P0 | Settlement `net_payable` computed in app, not enforced by DB | `TripSettlementService` calculates; no CHECK constraint | Settlement amount can be wrong | DB CHECK constraint on settlement arithmetic | DB test | Prisma schema |
| FIN-003 | P1 | Commission rate can be changed after settlement generated | `Partner.commission_percentage` mutable; settlements reference historical rate | Historical settlements become inconsistent | Snapshot commission rate at settlement generation | Integration test | Settlement service |
| FIN-004 | P1 | No idempotency on partner payment creation | `PartnerPayment.payment_number` unique but no idempotency key | Duplicate payments on retry | Idempotency key on payment creation | Integration test | PartnerPayment |
| FIN-005 | P1 | Invoice reconciliation only on payment path, not on invoice creation | `TripInvoiceService.reconcileInvoiceStatus` called in `addPayment` only | Invoice status drifts from actual payments | Reconcile on invoice status change events | Integration test | Invoice service |
| FIN-006 | P2 | Ledger running_balance not verified against transaction sum | `PartnerLedger.running_balance` computed in app | Running balance drift | Periodic reconciliation job | Cron job | PartnerLedger |
| FIN-007 | P2 | GST calculation fields present but no NIC/GSP integration | `Invoice.gst_number`, `gst_percentage`, `cgst`, `sgst`, `igst` filled manually | Non-compliant invoices | Integrate GSTN API or manual entry with validation | Integration test | GST service |

### Trace
**Customer pays:** `adminAPI.addTripPayment()` → `POST /api/trips/:id/payments` → `TripService.addPayment()` → `tripPayment.create` + `financialTransaction.create` + `reconcileInvoiceStatus` → `trip_payments`, `financial_transactions`, `invoices` tables  
**Partner settlement:** `adminAPI.generateSettlement()` → `POST /admin/settlements/generate` → `TripSettlementService` → `settlements`, `partner_ledger` tables

### Production Risk
**HIGH** — Without double-entry validation and DB constraints, financial data can silently drift, causing audit failures and vendor/customer disputes.

---

## MODULE 6: PARTNER & VEHICLE OWNER MANAGEMENT

### Files Inspected
- `transport-system/backend/services/PartnerService.js`
- `transport-system/backend/services/VehicleOwnerService.js`
- `transport-system/backend/routes/partnerRoutes.js`
- `transport-system/backend/routes/vehicleOwnerRoutes.js`
- `transport-system/backend/repositories/PartnerRepository.js`
- `transport-system/backend/repositories/VehicleOwnerRepository.js`
- `transport-system/frontend/src/pages/AdminPartners.jsx`, `AdminVehicleOwners.jsx`

### Architecture Summary
Partners (transport partners) and Vehicle Owners are separate master entities with linking via `partner_link`. Partner applications flow through approval workflow. Documents (GST, PAN, Aadhaar, RC, insurance) tracked with expiry. Commission percentage per partner.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| PART-001 | P1 | No GST/PAN format validation on Partner/VehicleOwner | `gst_number`, `pan_number` are plain String fields | Invalid tax IDs, compliance issues | Regex validation for GST (15 chars) and PAN (10 chars) | Unit test | — |
| PART-002 | P1 | Partner document expiry not auto-checked | `PartnerDocument.expiry_date` exists but no auto-expiry | Expired documents not flagged | Scheduled job to flag expired documents | Integration test | Cron |
| PART-003 | P1 | `partner_link` on VehicleOwner is `@unique` but no enforcement of bidirectional consistency | VehicleOwner.partner_link ↔ Partner.linkedVehicleOwner | Orphan links | DB constraint or application validation | Integration test | — |
| PART-004 | P2 | No partner performance scoring or SLA tracking | No rating/SLA fields on Partner | Cannot identify underperforming partners | Add performance metrics | Feature | — |

### Production Risk
**MEDIUM** — Invalid tax IDs and expired documents create compliance risk.

---

## MODULE 7: DRIVER MANAGEMENT

### Files Inspected
- `transport-system/backend/services/DriverManagementService.js`
- `transport-system/backend/repositories/DriverRepository.js`
- `transport-system/backend/routes/driverRoutes.js`
- `transport-system/backend/routes/driverManagementRoutes.js`
- `transport-system/frontend/src/pages/AdminDrivers.jsx`
- `transport-system/frontend/src/components/admin-premium/drivers/DriverTimeline.jsx`

### Architecture Summary
Driver CRUD, assignment to partners/vehicle owners, availability tracking, current vehicle link, balance tracking. Timeline events for driver history.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| DRV-001 | P1 | Driver mobile number not verified before trip assignment | `Driver.mobile` plain String, no OTP verification requirement | Unverified drivers on loads | Require OTP verification before first trip | Integration test | OTP service |
| DRV-002 | P1 | No license expiry validation at assignment time | `Driver.license_expiry` stored as String, not validated | Drivers with expired licenses on road | Validate license expiry before assigning to trip | Integration test | — |
| DRV-003 | P2 | Driver balance (`current_balance`) updated without transaction guard | `DriverTransaction` records balance_before/after but no atomic update | Balance drift under concurrent updates | Atomic balance update with optimistic locking | Integration test | DriverTransaction |

### Production Risk
**MEDIUM** — Unverified/expired-license drivers create liability and safety risk.

---

## MODULE 8: CUSTOMER & PUBLIC TRACKING

### Files Inspected
- `transport-system/frontend/src/pages/TrackBooking.jsx`
- `transport-system/backend/services/BookingService.js` (`getBookingForTracking`)
- `transport-system/backend/routes/bookingRoutes.js`
- `transport-system/frontend/src/services/api.js` (bookingAPI.trackBooking)

### Architecture Summary
Public tracking page accepts booking reference (no auth required). Returns booking details, driver/vehicle info gated behind quote acceptance. Driver phone intentionally masked.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| TRK-001 | P1 | Public tracking has no rate limiting | `GET /api/bookings/track/:reference` — no specific limiter | Enumeration of booking references | Rate limit tracking endpoint | Integration test | express-rate-limit |
| TRK-002 | P1 | Driver phone masked but vehicle number exposed pre-acceptance | `getBookingForTracking` returns `truck_number_snapshot` before quote accepted | Premature driver/customer contact bypassing platform | Hide vehicle/driver details until quote accepted | Unit test | BookingService |
| TRK-003 | P2 | No SMS/WhatsApp notification on tracking page load | Customer tracking page loads silently | No engagement trigger | Optional notification on first track view | Feature | WhatsApp/SMS |

### Production Risk
**MEDIUM** — Reference enumeration attack could expose booking details.

---

## MODULE 9: WHATSAPP / EMAIL / GOOGLE MAPS INTEGRATIONS

### Files Inspected
- `transport-system/backend/services/emailService.js`
- `transport-system/backend/services/smsProvider.js`
- `transport-system/backend/services/enquiryWhatsAppFormatter.js`
- `transport-system/backend/controllers/mapsController.js`
- `transport-system/backend/routes/maps.js`
- `transport-system/backend/server.js` (WhatsApp config warning)

### Architecture Summary
Email via Nodemailer SMTP. WhatsApp via Cloud API (configured but warned as disabled). Google Maps proxied through backend so API key not in frontend. Distance matrix for pricing.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| INT-001 | P0 | WhatsApp integration is stubbed — only warns if config missing | `server.js:40-42` — `console.warn('[whatsapp] WhatsApp notifications are disabled.')` | No customer notifications via WhatsApp | Implement WhatsApp message sending with template management | Integration test | WhatsApp Cloud API |
| INT-002 | P0 | Email is fire-and-forget, no queue, retry, or dead-letter | `EnquiryService._notifyOwnerOfNewEnquiry` — Promise chain, never awaits | Lost notifications (quotes, POD, settlements) | BullMQ/Redis email queue with retry + DLQ | Integration test | Redis, BullMQ |
| INT-003 | P1 | Google Maps no rate limiting, caching, or circuit breaker | `mapsController.calculatePriceHandler` — direct Google API call | API quota exhaustion, silent failures | Rate limit per key, cache city-pair distances, circuit breaker | Integration test | Redis cache |
| INT-004 | P2 | SMS provider has no delivery receipt tracking | `smsProvider.js` — sends SMS, no callback | Unknown if SMS delivered | Delivery receipt webhook + status tracking | Integration test | SMS provider |

### Production Risk
**HIGH** — Customer communication black hole for quotes, POD, and settlement notifications.

---

## MODULE 10: GLOBAL SEARCH & DASHBOARD NAVIGATION

### Files Inspected
- `transport-system/frontend/src/components/admin-premium/search/`
- `transport-system/backend/routes/adminRoutes.js` (global search)
- `transport-system/frontend/src/services/api.js` (`globalSearchAPI`)

### Architecture Summary
Global search endpoint `/api/admin/global-search` accepts `q` parameter. Admin dashboard navigation through `AdminShell` layout component.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| SRCH-001 | P1 | Global search no rate limiting, no query length validation | `GET /api/global-search` — no limiter on `q` | DoS via expensive LIKE queries | Rate limit, max query length, indexes on searchable columns | Security test | — |
| SRCH-002 | P1 | Search results not scoped by user role | Admin global search may return all entities | Data leakage across tenants | Role-scoped search filters | Integration test | — |
| SRCH-003 | P2 | No search result pagination enforcement | `limit: 10` default but no max | Large result sets | Enforce max limit (100) | Unit test | — |

### Production Risk
**MEDIUM** — Unbounded search can cause performance degradation and data exposure.

---

## MODULE 11: LOGGING, MONITORING, BACKUP & RECOVERY

### Files Inspected
- `transport-system/backend/utils/logger.js`
- `transport-system/backend/server.js` (Pino HTTP, health checks)
- `transport-system/backend/middleware/errorHandler.js`
- `transport-system/backend/BIHAR_TRANSPORT_BACKUP_RESTORE_RUNBOOK.md`
- `transport-system/backend/backend.log` (1.4GB)

### Architecture Summary
Pino structured logging with request IDs. Health check `/api/health` and readiness `/api/ready`. Error handler logs structured errors. Backup runbook exists as documentation.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| OBS-001 | P1 | No distributed tracing (OpenTelemetry absent) | No tracing instrumentation in backend or frontend | Cannot trace requests across services | Add OpenTelemetry + Jaeger/Tempo | Integration test | OTel SDK |
| OBS-002 | P1 | No custom business metrics | Only HTTP status codes logged | Blind to business KPI failures | Prometheus metrics: bookings/hour, quote acceptance rate, payment failures | Integration test | Prometheus client |
| OBS-003 | P1 | Log rotation not configured; `backend.log` is 1.4GB | Single growing log file | Disk exhaustion, log loss | Log rotation (daily/size-based), centralized logging | Ops test | logrotate/Fluentd |
| OBS-004 | P1 | Health checks don't verify external dependencies | `/api/ready` checks DB only | False healthy when email/WhatsApp down | Add dependency health checks | Integration test | — |
| OBS-005 | P2 | No alerting on error rate spikes | Error handler logs but no alert | Slow incident detection | Alert on 5xx rate > threshold | Ops test | PagerDuty/Slack |

### Production Risk
**HIGH** — Without tracing and metrics, production incidents are hard to diagnose.

---

## MODULE 12: DATABASE & MIGRATIONS

### Files Inspected
- `transport-system/backend/prisma/schema.prisma` (1949 lines)
- `transport-system/backend/prisma/migrations/` (51 migration directories)
- `transport-system/backend/config/prisma.js`
- `transport-system/backend/scripts/migrate-local-postgres-to-neon.js`
- `transport-system/backend/scripts/apply-missing-migrations.sql`
- `transport-system/backend/schema-diff.txt`

### Architecture Summary
Prisma ORM with PostgreSQL. 51 migration directories indicating significant schema evolution. Reconciliation migrations suggest schema drift. Indexes on all foreign keys and commonly queried columns.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| DB-001 | P0 | Multiple reconciliation migrations indicate schema drift | `20261028150000_reconcile_schema_equivalence`, `repair-quote-workflow-migration.sql` | Migration history unreliable, deployments may fail | Clean migration history, single source of truth (schema.prisma) | DB test | Prisma migrate |
| DB-002 | P0 | No automated migration guard in CI | `prisma migrate deploy` run manually | Failed migrations in production | CI gate: `prisma migrate status` must be clean | CI test | GitHub Actions |
| DB-003 | P1 | No connection pooling configuration visible | Prisma client default pool | Connection exhaustion under load | Configure `connection_limit` in datasource | Load test | Prisma |
| DB-004 | P1 | Soft delete missing on critical tables (Bookings, Trips, Partners) | `deleted_at` only on VehicleOwner, Partner, Client | Accidental hard deletes lose data | Add `deleted_at` to all core tables | DB test | Prisma migration |
| DB-005 | P2 | No read replicas or failover configuration | Single `DATABASE_URL` | Single point of failure | Read replica connection string | Infra test | Neon/PostgreSQL |

### Production Risk
**HIGH** — Schema drift and no migration guard create deployment risk and potential data loss.

---

## MODULE 13: FRONTEND ARCHITECTURE & ADMIN DASHBOARD

### Files Inspected
- `transport-system/frontend/src/App.jsx` (37KB)
- `transport-system/frontend/src/pages/AdminDashboard.jsx`
- `transport-system/frontend/src/pages/AdminBookings.jsx` (1557 lines)
- `transport-system/frontend/src/services/api.js` (611 lines)
- `transport-system/frontend/src/components/admin-premium/layout/AdminShell.jsx`
- `transport-system/frontend/src/components/ProtectedRoute.jsx`
- `transport-system/frontend/vite.config.js`
- `transport-system/frontend/tailwind.config.js`

### Architecture Summary
React 18 + Vite + Tailwind CSS. Admin dashboard with shell layout. Axios API client with JWT interceptor. React Router for client-side routing. ProtectedRoute for auth-guarded pages.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| FE-001 | P1 | JWT stored in `localStorage` — vulnerable to XSS | `api.js:22` — `localStorage.getItem('token')` | XSS steals session token | httpOnly cookies or secure storage | Security test | — |
| FE-002 | P1 | No request timeout handling granularity | `timeout: 12000` global | Long requests fail without retry | Per-endpoint timeouts + retry with backoff | Unit test | axios-retry |
| FE-003 | P1 | Error boundaries not consistently applied | `ErrorBoundary.jsx` exists but not wrapping all routes | Uncaught errors white-screen app | Wrap all route components with ErrorBoundary | Unit test | React ErrorBoundary |
| FE-004 | P2 | No offline support or optimistic UI | All API calls blocking | Poor UX on flaky networks | Optimistic updates + offline queue | Feature | — |
| FE-005 | P2 | Large page files (AdminBookings 1557 lines, AdminBookings.jsx) | Single-responsibility violation | Hard to maintain, test | Split into smaller components | Refactor | — |

### Production Risk
**MEDIUM** — XSS vulnerability via localStorage token storage is a significant security risk.

---

## MODULE 14: DEPLOYMENT & INFRASTRUCTURE

### Files Inspected
- `transport-system/backend/server.js` (Render detection, graceful shutdown)
- `transport-system/backend/package.json` (scripts)
- `transport-system/frontend/package.json` (build scripts)
- `transport-system/netlify.toml`
- `transport-system/STAGING_DEPLOYMENT.md`

### Architecture Summary
Node.js Express backend, Vite-built React frontend. Render-compatible (`RENDER` env check). Netlify.toml for frontend. No Docker, no Kubernetes, no CI config visible in repo root.

### Findings

| ID | Severity | Issue | Evidence | Impact | Solution | Tests | Deps |
|----|----------|-------|----------|--------|----------|-------|------|
| DEP-001 | P0 | No Dockerfile or containerization | No Dockerfile in repo | Inconsistent dev/prod environments | Add multi-stage Dockerfile | Build test | Docker |
| DEP-002 | P0 | No CI/CD pipeline visible | No `.github/workflows` for test/deploy | Manual deployment, human error | GitHub Actions: test, lint, build, deploy | CI test | GitHub Actions |
| DEP-003 | P1 | No blue-green or canary deployment | Single `app.listen()` | Zero-downtime deployment not possible | Load balancer with rolling deployment | Ops test | Render/ALB |
| DEP-004 | P1 | Environment variables not validated in production | `ENV_STRICT` defaults true but lenient | Missing config causes runtime failure | Strict env validation at startup | Unit test | — |
| DEP-005 | P2 | No backup automation documented in code | Backup runbook is separate MD | Data loss risk | Automated pg_dump + S3 backup | Ops test | cron/pg_dump |

### Production Risk
**HIGH** — No CI/CD or containerization makes reliable production deployment impossible.

---

## CROSS-CUTTING DUPLICATE BUSINESS LOGIC

| Logic | Locations | Risk |
|-------|-----------|------|
| Commission calculation (`gross − commission = net`) | `CommissionCalculator.js`, `CanonicalFinancialService.js`, `VehicleHireWorkflowService.computeMoney()` | Inconsistent rates if one updated without others |
| Vehicle/driver availability check | `ResourceAvailabilityService.js`, `VehicleHireWorkflowService.checkVehicleUsable()`, `EnquiryAssignmentService.validateAssignment()` | Conflict rules can diverge |
| Booking number generation | `BookingNumberService.js`, inline in `BookingService.createBooking()` | Non-canonical numbers possible |
| Trip status → delivery status mapping | `BookingStateMachine.toDeliveryStatus()`, `Delivery` model default | Delivery status drift |

---

## SUMMARY: MODULE READINESS SCORES

| Module | Score | Blocking Issues |
|--------|-------|-----------------|
| Auth & Authorization | 45/100 | No MFA, no token revocation, CSRF missing |
| Enquiry→Quote→Booking | 75/100 | Race conditions, email fire-and-forget |
| Vehicle Hire & Assignment | 80/100 | DB constraint gaps, document date parsing |
| Trip Lifecycle | 70/100 | No POD enforcement, no geofencing |
| Financials | 60/100 | No double-entry, no DB constraints |
| Partner/Owner Mgmt | 70/100 | No GST validation, no doc expiry |
| Driver Mgmt | 65/100 | No license verification, no OTP |
| Customer Tracking | 75/100 | No rate limiting, data exposure pre-acceptance |
| Integrations (WhatsApp/Email/Maps) | 35/100 | Stubbed WhatsApp, no email queue |
| Global Search | 60/100 | No rate limiting, no role scoping |
| Logging/Monitoring | 45/100 | No tracing, no metrics, log rotation |
| Database & Migrations | 55/100 | Schema drift, no migration guard |
| Frontend Architecture | 65/100 | localStorage tokens, no error boundaries |
| Deployment | 30/100 | No Docker, no CI/CD |

**Overall: 58/100 — Not production ready without critical remediation.**