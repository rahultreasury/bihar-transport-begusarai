# BIHAR TRANSPORT — SECURITY AUDIT

**Audit Date:** 2026-10-31  
**Auditor:** Application Security Engineer  
**OWASP Top 10 2021 Mapping:** Included for each finding  
**Total Security Findings:** 24 (Critical: 5, High: 9, Medium: 7, Low: 3)  

---

## SECURITY SCORE: 42/100

**Verdict: NOT SECURE FOR PRODUCTION.** Critical gaps in authentication, authorization, transport security, and input validation must be remediated before any production deployment.

---

## SECURITY FINDINGS BY SEVERITY

| ID | Severity | OWASP Category | Title | Affected Files |
|----|----------|----------------|-------|----------------|
| SEC-001 | Critical | A01:2021 Broken Access Control | JWT_SECRET not validated; weak secret enables token forgery | `backend/middleware/auth.js:15`, `backend/server.js:29-37` |
| SEC-002 | Critical | A01:2021 Broken Access Control | No MFA for admin accounts; single-factor only | `backend/middleware/auth.js:19-50` |
| SEC-003 | Critical | A01:2021 Broken Access Control | No token revocation / blocklist; compromised tokens valid for 7 days | `backend/middleware/auth.js:119-123` |
| SEC-004 | Critical | A01:2021 Broken Access Control | No CSRF protection on state-changing endpoints | `backend/server.js`, `backend/package.json:26` (csurf unused) |
| SEC-005 | Critical | A02:2021 Cryptographic Failures | Password hashing with default bcrypt rounds; no strength policy | `backend/services/` (bcryptjs usage), `backend/routes/authRoutes.js` |
| SEC-006 | High | A01:2021 Broken Access Control | Admin `operator` role over-privileged on all admin routes | `backend/middleware/auth.js:108` |
| SEC-007 | High | A01:2021 Broken Access Control | No account lockout after failed login/OTP attempts | `backend/routes/authRoutes.js`, `backend/services/otpService.js` |
| SEC-008 | High | A01:2021 Broken Access Control | JWT stored in localStorage — XSS token theft | `frontend/src/services/api.js:21-24` |
| SEC-009 | High | A01:2021 Broken Access Control | No concurrent session limits per user | `backend/middleware/auth.js` |
| SEC-010 | High | A05:2021 Security Misconfiguration | CORS `*` in development; permissive origin in production fallback | `backend/server.js:120-123` |
| SEC-011 | High | A04:2021 Insecure Design | No rate limiting on public tracking endpoint (reference enumeration) | `backend/routes/bookingRoutes.js` |
| SEC-012 | High | A07:2021 Identification Failures | No session absolute timeout (7-day default) | `backend/middleware/auth.js:120` |
| SEC-013 | Medium | A01:2021 Broken Access Control | Driver phone exposed in tracking pre-acceptance | `backend/services/BookingService.js:1236-1248` |
| SEC-014 | Medium | A02:2021 Cryptographic Failures | No password expiration or history policy | `backend/routes/authRoutes.js` |
| SEC-015 | Medium | A01:2021 Broken Access Control | No role-based scoping on global search results | `backend/routes/adminRoutes.js` |
| SEC-016 | Medium | A01:2021 Broken Access Control | No input validation on `session_key` for guest enquiries | `backend/services/EnquiryService.js:362` |
| SEC-017 | Medium | A05:2021 Security Misconfiguration | No security headers audit (HSTS, Referrer-Policy gaps) | `backend/server.js:98-114` |
| SEC-018 | Medium | A08:2021 Software/Data Failures | File uploads without virus scanning or type validation | `backend/server.js:133` |
| SEC-019 | Medium | A04:2021 Insecure Design | Error handler may leak stack traces if NODE_ENV misconfigured | `backend/middleware/errorHandler.js:44` |
| SEC-020 | Medium | A07:2021 Identification Failures | OTP verification has max 3 attempts but no escalating delay | `backend/services/otpService.js`, `prisma/schema.prisma:54-62` |
| SEC-021 | Low | A01:2021 Broken Access Control | No audit logging for security-sensitive operations (password change, role change) | `backend/repositories/AuditLogRepository.js` |
| SEC-022 | Low | A09:2021 Logging Failures | Log rotation not configured; 1.4GB backend.log | `backend/backend.log`, `backend/utils/logger.js` |
| SEC-023 | Low | A05:2021 Security Misconfiguration | Environment variables not strictly validated in production | `backend/server.js:29-37` (`ENV_STRICT` lenient) |
| SEC-024 | Low | A06:2021 Vulnerable Components | Dependency versions not pinned; no `npm audit` in CI | `backend/package.json`, `frontend/package.json` |

---

## DETAILED FINDINGS

---

### SEC-001: JWT_SECRET Not Validated for Entropy (Critical)

**OWASP:** A02:2021 Cryptographic Failures  
**Location:** `transport-system/backend/middleware/auth.js:15`, `transport-system/backend/server.js:29-37`  
**Evidence:**
```javascript
// auth.js:15
const decoded = jwt.verify(token, process.env.JWT_SECRET);

// server.js:29-37
try {
  validateEnv();
} catch (e) {
  const strict = String(process.env.ENV_STRICT || 'true') === 'true';
  console.error('[env] Validation failed:', e.message);
  if (strict) process.exit(1);
}
```
`validateEnv()` is lenient in development. No minimum length or entropy check on `JWT_SECRET`. A weak or predictable secret allows JWT forgery.

**Impact:** Attacker can forge admin/user JWT tokens, gain full access to all endpoints including financial operations, vehicle assignments, and settlement modifications.

**Remediation:** Enforce `JWT_SECRET` minimum 32 characters, high entropy (crypto.randomBytes), secret rotation strategy. Fail startup if invalid regardless of environment.

**Tests:** Unit test on `validateEnv` rejecting short/weak secrets (< 32 chars, low entropy).

---

### SEC-002: No MFA for Admin Accounts (Critical)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/middleware/auth.js:19-50`  
**Evidence:** Admin login resolves through `prisma.admin.findUnique` and issues JWT with `expiresIn: 7d`. No TOTP, no SMS-based MFA, no backup codes.

**Impact:** Stolen admin credentials = full system compromise. Admin can modify bookings, settlements, delete data, assign drivers.

**Remediation:** Add TOTP/MFA for admin login (speakeasy/qrcode), backup codes, MFA enforcement for super_admin and financial operations.

**Tests:** Integration test verifying MFA required for admin login; MFA bypass blocked.

**Dependencies:** speakeasy, qrcode, Redis (for MFA state).

---

### SEC-003: No Token Revocation / Blocklist (Critical)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/middleware/auth.js:119-123`  
**Evidence:**
```javascript
const generateToken = (id, type = 'user') => {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};
```
No token blocklist, no Redis-backed session store. JWT valid until expiry (7 days default). No way to revoke a compromised token.

**Impact:** Compromised token remains valid for full 7 days. Logout does not invalidate token. Password change does not invalidate existing tokens.

**Remediation:** Short-lived access tokens (15 min) + refresh tokens. Redis-backed token blocklist. Blocklist on logout, password change, role change.

**Tests:** Integration test verifying token blocked after logout/password change.

**Dependencies:** Redis.

---

### SEC-004: No CSRF Protection on State-Changing Endpoints (Critical)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/server.js`, `transport-system/backend/package.json:26`  
**Evidence:** `csurf` is installed as a dependency but not applied to any route. Helmet is configured but CSRF middleware is absent.

**Impact:** Attacker can trick authenticated admin into performing state-changing actions (delete bookings, change settlements, assign drivers) via malicious website.

**Remediation:** Apply CSRF protection to all POST/PUT/DELETE endpoints, or use SameSite=Strict cookies + double-submit token pattern.

**Tests:** Security test verifying CSRF token required on state-changing endpoints.

**Dependencies:** csurf middleware or custom CSRF implementation.

---

### SEC-005: Password Hashing with Default Rounds / No Strength Policy (Critical)

**OWASP:** A02:2021 Cryptographic Failures  
**Location:** `backend/services/` (bcryptjs usage), `backend/routes/authRoutes.js`  
**Evidence:** `bcryptjs` used with default salt rounds (10). No configurable work factor. No password complexity requirements (min length, mixed case, numbers, symbols). No password history. No expiration.

**Impact:** Weak passwords vulnerable to brute force. Rainbow table attacks if rounds too low. Credential stuffing attacks.

**Remediation:** Configurable `BCRYPT_SALT_ROUNDS` (minimum 12). Password strength policy (min 12 chars, mixed case, numbers, symbols). Password history (last 5). Expiration (90 days).

**Tests:** Unit test verifying password strength validation; bcrypt rounds >= 12.

---

### SEC-006: Admin `operator` Role Over-Privileged (High)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/middleware/auth.js:108`  
**Evidence:**
```javascript
const adminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'operator')) {
    next();
  }
```
`operator` role has access to all admin routes including financial settlements, user deletion, and partner management.

**Impact:** Over-privileged operators can modify sensitive financial data, delete users, and alter settlements.

**Remediation:** Granular RBAC. Define role-based route permissions. Operator should not access financial/user deletion routes.

**Tests:** Unit test verifying operator denied on financial routes.

---

### SEC-007: No Account Lockout After Failed Attempts (High)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/routes/authRoutes.js`, `transport-system/backend/services/otpService.js`  
**Evidence:** OTP has `max_attempts: 3` but no account lockout after repeated failed OTP or password attempts. No escalating delay between attempts.

**Impact:** Brute force attacks on OTP and passwords. Automated tools can attempt unlimited combinations.

**Remediation:** Account lockout after 5 failed attempts (30 min). Escalating delay (1s, 2s, 4s, 8s) between OTP attempts. CAPTCHA after 3 failures.

**Tests:** Integration test verifying account lockout after 5 failed attempts.

---

### SEC-008: JWT Stored in localStorage (High)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/frontend/src/services/api.js:21-24`  
**Evidence:**
```javascript
const token = localStorage.getItem('token');
if (token) {
  config.headers.Authorization = `Bearer ${token}`;
}
```
Token accessible to any JavaScript running on the page. No httpOnly flag.

**Impact:** XSS attack steals session token. Full account takeover. Token persists until manually cleared or expired.

**Remediation:** httpOnly cookies with Secure and SameSite=Strict flags. Short access token expiry (15 min). Refresh token rotation.

**Tests:** Security test verifying token not accessible via JavaScript in XSS scenario.

---

### SEC-009: No Concurrent Session Limits (High)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/middleware/auth.js`  
**Evidence:** No tracking of active sessions per user. Multiple simultaneous logins allowed with no limit.

**Impact:** Shared credentials undetected. Token theft via concurrent sessions not detectable. No notification on new login from different location.

**Remediation:** Track active sessions in Redis. Limit concurrent sessions per user (e.g., 3). Notify user on new login. Invalidate old sessions on new login (optional).

**Tests:** Integration test verifying session limit enforced.

**Dependencies:** Redis.

---

### SEC-010: CORS `*` in Development / Permissive Production Fallback (High)

**OWASP:** A05:2021 Security Misconfiguration  
**Location:** `transport-system/backend/server.js:120-123`  
**Evidence:**
```javascript
const isDev = process.env.NODE_ENV !== 'production';
app.use(cors({
  origin: isDev ? '*' : (process.env.FRONTEND_URL || '*'),
  credentials: true,
}));
```
In development, all origins allowed. In production, falls back to `*` if `FRONTEND_URL` not set. `credentials: true` with wildcard origin is a misconfiguration.

**Impact:** Cross-origin request leakage. Malicious sites can make authenticated requests if user visits them while logged in.

**Remediation:** Restrict origins to specific domains even in development. Require `FRONTEND_URL` in production. Never use `*` with `credentials: true`.

**Tests:** Integration test verifying CORS rejects unauthorized origins.

---

### SEC-011: No Rate Limiting on Public Tracking Endpoint (High)

**OWASP:** A04:2021 Insecure Design  
**Location:** `transport-system/backend/routes/bookingRoutes.js` (tracking endpoint)  
**Evidence:** `GET /api/bookings/track/:reference` shares global limiter (2000/15min) but no specific tracker. Reference enumeration possible.

**Impact:** Attacker can enumerate booking references (BTB-YYYY-NNNNN pattern is predictable) and expose customer details, driver info, vehicle numbers, delivery locations.

**Remediation:** Dedicated rate limiter on tracking endpoint (30/15min per IP). CAPTCHA after 10 failed lookups.

**Tests:** Security test verifying rate limit on tracking endpoint.

---

### SEC-012: No Session Absolute Timeout (High)

**OWASP:** A07:2021 Identification and Authentication Failures  
**Location:** `transport-system/backend/middleware/auth.js:120`  
**Evidence:** `expiresIn: process.env.JWT_EXPIRE || '7d'` — 7-day default with no absolute maximum.

**Impact:** Long-lived sessions increase token theft window. Stolen tokens usable for up to 7 days.

**Remediation:** Absolute timeout (24 hours max). Forced re-authentication for sensitive operations (financial, user management).

**Tests:** Integration test verifying token expiration at 24 hours.

---

### SEC-013: Driver Phone Exposed in Tracking Pre-Acceptance (Medium)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/services/BookingService.js:1236-1248`  
**Evidence:** `getBookingForTracking` returns driver phone in some code paths before quote acceptance. `mobile_snapshot` and `truck_number_snapshot` exposed.

**Impact:** Customer can contact driver directly before accepting quote, bypassing platform. Privacy violation for driver.

**Remediation:** Mask driver phone until quote accepted. Return only driver name and vehicle number pre-acceptance.

**Tests:** Unit test verifying phone null before quote accepted.

---

### SEC-014: No Password Expiration or History Policy (Medium)

**OWASP:** A02:2021 Cryptographic Failures  
**Location:** `transport-system/backend/routes/authRoutes.js`  
**Evidence:** No password expiration, no password history, no forced rotation.

**Impact:** Compromised passwords remain valid indefinitely. Password reuse across breaches.

**Remediation:** Password expiration (90 days). Password history (last 5 passwords prevented from reuse).

**Tests:** Unit test verifying password expiration and history.

---

### SEC-015: No Role-Based Scoping on Global Search (Medium)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/routes/adminRoutes.js`  
**Evidence:** Global search endpoint returns results without role-based filtering.

**Impact:** Operator may see financial records, partner details, or settlement data they shouldn't access.

**Remediation:** Role-scoped search filters based on `req.user.role`. Exclude sensitive fields for non-super-admin roles.

**Tests:** Integration test verifying role-scoped search results.

---

### SEC-016: No Input Validation on `session_key` for Guest Enquiries (Medium)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/services/EnquiryService.js:362`  
**Evidence:** `session_key: clean(ctx.sessionKey, 120)` — only cleaned for length, no format validation or uniqueness check.

**Impact:** Session hijacking or collision. Attacker could guess session keys and access other users' enquiries.

**Remediation:** UUID format validation for session_key. Uniqueness check at creation.

**Tests:** Unit test verifying session_key format validation.

---

### SEC-017: No Security Headers Audit / HSTS Missing (Medium)

**OWASP:** A05:2021 Security Misconfiguration  
**Location:** `transport-system/backend/server.js:98-114`  
**Evidence:** Helmet configured with CSP but no `hsts` (HTTP Strict Transport Security), no `referrerPolicy` beyond `no-referrer`, no `expectCt`.

**Impact:** Man-in-the-middle attacks on HTTP connections. Referrer leakage. No enforcement of HTTPS.

**Remediation:** Add HSTS with `includeSubDomains` and `preload`. Add `expectCt`. Ensure all production traffic via HTTPS.

**Tests:** Security test verifying HSTS header present in production.

---

### SEC-018: File Uploads Without Virus Scanning (Medium)

**OWASP:** A08:2021 Software and Data Integrity Failures  
**Location:** `transport-system/backend/server.js:133`  
**Evidence:** Base64 file uploads up to 12MB for `/api/trips` with no virus scanning, no file type validation, no per-type size limits.

**Impact:** Malware upload to server. XSS via malicious SVG/HTML. Storage exhaustion via large files.

**Remediation:** Virus scan (ClamAV). File type whitelist (PDF, JPG, PNG only). Per-type size limits (5MB max). Filename sanitization.

**Tests:** Security test verifying malicious file rejected.

**Dependencies:** ClamAV or similar.

---

### SEC-019: Error Handler May Leak Stack Traces (Medium)

**OWASP:** A04:2021 Insecure Design  
**Location:** `transport-system/backend/middleware/errorHandler.js:44`  
**Evidence:**
```javascript
const devMessage = process.env.NODE_ENV === 'development' ? (err && err.message ? err.message : message) : message;
```
Stack traces logged but not returned in production. However, if `NODE_ENV` is misconfigured as `development` in production, stack traces leak.

**Impact:** Internal system details exposed to attackers (file paths, library versions, logic flow).

**Remediation:** Always hide stack traces from client responses regardless of NODE_ENV. Log stack traces server-side only.

**Tests:** Unit test verifying no stack trace in production response.

---

### SEC-020: OTP Verification — No Escalating Delay (Medium)

**OWASP:** A07:2021 Identification and Authentication Failures  
**Location:** `transport-system/backend/services/otpService.js`, `prisma/schema.prisma:54-62`  
**Evidence:** OTP model has `max_attempts: 3` and `attempts` counter but no escalating delay between attempts.

**Impact:** Automated OTP brute force attacks possible within the 3-attempt limit if no rate limiting.

**Remediation:** Escalating delay between OTP attempts. Rate limit OTP requests per phone number.

**Tests:** Integration test verifying escalating delay.

---

### SEC-021: No Audit Logging for Security-Sensitive Operations (Low)

**OWASP:** A01:2021 Broken Access Control  
**Location:** `transport-system/backend/repositories/AuditLogRepository.js`  
**Evidence:** `audit_logs` table captures entity mutations but no dedicated logging for password changes, role changes, MFA events, or failed login attempts.

**Impact:** Security incidents not traceable. Cannot reconstruct attack timeline.

**Remediation:** Dedicated security audit events: password change, role change, MFA enable/disable, failed login, token revocation.

**Tests:** Unit test verifying security events logged.

---

### SEC-022: Log Rotation Not Configured (Low)

**OWASP:** A09:2021 Logging and Monitoring Failures  
**Location:** `transport-system/backend/backend.log` (1,473,469 bytes), `backend/utils/logger.js`  
**Evidence:** Single growing log file (1.4GB). No rotation. No centralized logging.

**Impact:** Disk exhaustion. Log loss on restart. Cannot search historical logs for security incidents.

**Remediation:** Log rotation (daily, 100MB max, 30-day retention). Centralized logging (ELK/EFK or Loki).

**Tests:** Ops test verifying log rotation.

**Dependencies:** logrotate/Fluentd, ELK stack.

---

### SEC-023: Environment Variables Not Strictly Validated (Low)

**OWASP:** A05:2021 Security Misconfiguration  
**Location:** `transport-system/backend/server.js:29-37`  
**Evidence:** `ENV_STRICT` defaults to `true` but validation failure only logs error and continues in non-strict mode.

**Impact:** Missing config causes runtime failure or insecure defaults.

**Remediation:** Always validate required env vars at startup. Fail fast on missing `JWT_SECRET`, `DATABASE_URL`, `SMTP` credentials.

**Tests:** Unit test verifying startup fails on missing required env vars.

---

### SEC-024: Dependency Versions Not Pinned / No `npm audit` (Low)

**OWASP:** A06:2021 Vulnerable and Outdated Components  
**Location:** `transport-system/backend/package.json`, `transport-system/frontend/package.json`  
**Evidence:** Dependencies use caret ranges (`^`) allowing minor/patch updates. No `npm audit` in CI pipeline.

**Impact:** Vulnerable dependencies introduced via transitive updates. Known CVEs not detected.

**Remediation:** Pin critical dependencies. Add `npm audit` to CI. Regular dependency update schedule.

**Tests:** CI step running `npm audit --production`.

---

## SECURITY CONTROLS ASSESSMENT

| Control | Status | Gap |
|---------|--------|-----|
| Authentication (JWT) | Partial | No MFA, no revocation, weak secret validation |
| Authorization (RBAC) | Partial | Operator over-privileged, no granular permissions |
| Session Management | Weak | localStorage, 7-day expiry, no absolute timeout, no concurrent limits |
| Transport Security | Partial | Helmet CSP present, but no HSTS, CORS permissive |
| Input Validation | Partial | Some validation exists but inconsistent (session_key, GST/PAN) |
| Cryptography | Weak | Default bcrypt rounds, no password policy |
| CSRF Protection | Absent | csurf installed but unused |
| Rate Limiting | Partial | Global limiter only, no per-endpoint limits |
| Audit Logging | Partial | Entity mutations logged, no security events |
| File Upload Security | Absent | No virus scanning, no type validation |
| Dependency Management | Weak | No pinning, no audit in CI |
| Secrets Management | Weak | .env files, no vault, no rotation |

---

## PENETRATION TESTING RECOMMENDATIONS

Before production deployment, conduct:

1. **Authentication testing:** JWT forgery, session fixation, token replay, password reset bypass
2. **Authorization testing:** IDOR on booking/trip/settlement endpoints, privilege escalation (operator → admin), mass assignment
3. **Input validation testing:** SQL injection (Prisma mitigates but verify), XSS in file uploads, command injection
4. **Business logic testing:** Race conditions in booking acceptance, double-spending in payments, quote manipulation
5. **API security testing:** Rate limiting bypass, CORS misconfiguration, excessive data exposure
6. **File upload testing:** Malicious file types, path traversal, file size bombs

---

## REMEDIATION PRIORITY (Security)

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | SEC-001: JWT_SECRET validation | 1 day |
| 2 | SEC-004: CSRF protection | 2 days |
| 3 | SEC-002: Admin MFA | 3 days |
| 4 | SEC-003: Token revocation | 3 days |
| 5 | SEC-008: localStorage → httpOnly cookies | 2 days |
| 6 | SEC-011: Tracking rate limiting | 1 day |
| 7 | SEC-010: CORS restriction | 1 day |
| 8 | SEC-007: Account lockout | 2 days |

**Each security fix will be implemented, tested, reviewed, and released independently. Approval required before any implementation begins.**