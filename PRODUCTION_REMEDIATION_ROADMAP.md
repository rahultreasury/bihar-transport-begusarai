# BIHAR TRANSPORT — PRODUCTION REMEDIATION ROADMAP

**Audit Date:** 2026-10-31  
**Overall Production Readiness Score:** 42/100  
**Verdict: NOT SAFE FOR PRODUCTION** — Critical P0 findings must be remediated before any production deployment.

---

## REMEDIATION MODEL

Each fix is implemented independently: implement → test → review → release independently. Approval required before any implementation begins. No production migrations without approval.

---

## PHASE 0 — WEEK 1: CRITICAL BLOCKERS (P0)

### Day 1-2: Security Foundation

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| SEC-001 | JWT in localStorage, no MFA | P0 | Move JWT to HttpOnly Secure SameSite=Strict cookies; add MFA for admin | None | Backend | 3 days |
| SEC-004 | CSRF middleware installed but unused | P0 | Enable CSRF protection on all state-changing endpoints | JWT cookie migration | Backend | 2 days |
| SEC-007 | No rate limiting on tracking endpoints | P0 | Add rate limiting to `/track/:tripNumber`, `/api/enquiries` | None | Backend | 2 days |
| SEC-009 | No token revocation/blocklist | P0 | Implement Redis-backed token blocklist on logout/password change | Redis setup | Backend | 3 days |
| SEC-013 | PII in server logs (backend.log 1.47GB) | P0 | Mask PII in logs; implement log rotation | None | Backend | 3 days |

**Week 1 Deliverable:** JWT in secure cookies, CSRF enabled, rate limiting on key endpoints, token blocklist, PII masking + log rotation.

---

### Day 3-4: Data Integrity (P0 Database)

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| DB-001 | Schema drift — reconciliation migrations | P0 | Clean migration history; make schema.prisma single source of truth; `prisma migrate status` clean | None | Backend | 2 days |
| DB-002 | No CI migration guard | P0 | Add `prisma migrate status` check to CI pipeline | CI setup | DevOps | 2 days |
| DB-003 | No double-entry constraint on financial transactions | P0 | Add PostgreSQL CHECK constraint/trigger enforcing debit=credit | Prisma migration | Backend | 3 days |
| DB-004 | Settlement arithmetic not enforced | P0 | Add CHECK constraint on Settlement model | Prisma migration | Backend | 2 days |
| DB-010 | No UNIQUE on trips.booking_id | P0 | Add `@unique` constraint on Trip.booking_id | Prisma migration | Backend | 1 day |

**Week 1 Deliverable:** Clean migrations, CI migration guard, double-entry constraint, settlement arithmetic CHECK, unique trip-per-booking.

---

### Day 5-7: Critical Bugs & State Machines (P0)

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| BUG-001 | Double-booking race condition | P0 | Centralize advisory lock acquisition with consistent namespace ordering | None | Backend | 3 days |
| BUG-002 | Invalid document dates pass hire gate | P0 | Migrate document expiry columns to DATE type; strict validation | Prisma migration | Backend | 3 days |
| BUG-003 | Missing UNIQUE on trips.booking_id | P0 | Same as DB-010 | DB-010 | Backend | 1 day |
| BUG-004 | Settlement arithmetic drift | P0 | Same as DB-004 | DB-004 | Backend | 2 days |
| BUG-005 | No double-entry constraint | P0 | Same as DB-003 | DB-003 | Backend | 3 days |

**Week 1 Deliverable:** Race condition fixed, document dates as DATE, unique trip constraint, settlement arithmetic, double-entry constraint.

---

## PHASE 1 — WEEK 2: SECURITY HARDENING (P0/P1)

### Security

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| SEC-002 | No password complexity policy | P1 | Implement password complexity + entropy validation | None | Backend | 2 days |
| SEC-003 | No account lockout after failed logins | P1 | Add account lockout (5 attempts → 15 min lockout) | None | Backend | 2 days |
| SEC-005 | No session timeout | P1 | Add absolute session timeout (8h) + idle timeout (30m) | JWT cookie migration | Backend | 2 days |
| SEC-006 | Admin endpoints not IP-restricted | P1 | Add IP allowlisting for admin routes | None | Backend | 2 days |
| SEC-008 | No input validation on query parameters | P1 | Add Zod/Joi validation on all query params | None | Backend | 3 days |
| SEC-010 | Error messages leak stack traces | P1 | Sanitize error responses in production | None | Backend | 2 days |
| SEC-011 | No security headers (CSP, HSTS, X-Frame-Options) | P1 | Configure helmet with CSP, HSTS, X-Frame-Options | None | Frontend/Backend | 2 days |
| SEC-012 | WhatsApp stubbed — no delivery verification | P1 | Implement WhatsApp delivery status verification or remove feature | External API | Backend | 3 days |
| SEC-014 | No secret scanning | P1 | Add secret scanning to pre-commit hooks | None | DevOps | 1 day |
| SEC-015 | No dependency vulnerability scanning | P1 | Add `npm audit` to CI; fix high/critical vulnerabilities | None | DevOps | 2 days |

**Week 2 Deliverable:** Password policy, lockout, session timeouts, IP restrictions, input validation, sanitized errors, security headers, WhatsApp verification, secret scanning, dependency scanning.

---

## PHASE 2 — WEEK 3: DATABASE INTEGRITY & PERFORMANCE (P1)

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| DB-005 | No connection pooling config | P1 | Configure `connection_limit` in Prisma datasource; add PgBouncer | None | Backend | 2 days |
| DB-006 | No soft delete on core tables | P1 | Add `deleted_at` to Booking, Trip, Enquiry, PartnerLedger, FinancialTransaction | Prisma migration | Backend | 3 days |
| DB-007 | Advisory lock deadlock risk | P1 | Centralize lock acquisition utility with documented ordering | None | Backend | 2 days |
| DB-008 | Document dates as TEXT | P1 | Migrate to DATE type (same as BUG-002) | BUG-002 | Backend | 3 days |
| DB-009 | No read replicas / failover | P1 | Configure read replica connection string; read/write splitting | Neon/PostgreSQL | DevOps | 3 days |
| DB-011 | Missing composite indexes | P2 | Add composite indexes on high-volume query patterns | None | Backend | 2 days |
| DB-012 | JSON fields without GIN indexes | P2 | Add GIN indexes on frequently-queried JSON fields | None | Backend | 2 days |
| DB-014 | PartnerLedger running_balance consistency | P2 | Add reconciliation job verifying running balance | None | Backend | 3 days |

**Week 2 Deliverable:** Connection pooling, soft deletes, centralized advisory locks, DATE types, read replica, composite indexes, GIN indexes, balance reconciliation.

---

## PHASE 3 — WEEK 4: TEST COVERAGE (P0/P1)

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| TEST-001 | No state machine unit tests | P0 | Add EnquiryStateMachine, BookingStateMachine, TripStateMachine unit tests | None | QA | 3 days |
| TEST-002 | No financial calculation unit tests | P0 | Add CommissionCalculator, CanonicalFinancialService, TripFinancialCalculationService tests | None | QA | 3 days |
| TEST-003 | No security tests | P0 | Add CSRF, JWT, authz, rate limit tests | SEC-001/004/007 | QA | 5 days |
| TEST-004 | No contract tests | P1 | Add BookingAPI, EnquiryAPI, TripAPI contract tests | API spec | QA | 4 days |
| TEST-005 | No performance/load tests | P1 | Add load tests (1000 concurrent users, 500 bookings/hour) | None | QA | 5 days |
| TEST-006 | No chaos engineering tests | P2 | Add DB failover, external service degradation tests | Read replica | QA | 5 days |
| TEST-007 | No backup/restore tests | P1 | Add pg_dump verification, restore drill tests | Backup setup | QA | 3 days |
| TEST-008 | No frontend component tests | P1 | Add Vitest + React Testing Library for Admin components | None | Frontend QA | 5 days |
| TEST-009 | No E2E tests | P1 | Add Playwright E2E for booking, quote, payment flows | Test DB | QA | 5 days |
| TEST-010 | No test isolation | P2 | Add transaction rollback between tests; parallel execution | Test fixtures | QA | 3 days |

**Week 4 Deliverable:** State machine unit tests, financial calculation tests, security tests, contract tests, load tests, chaos tests, backup tests, frontend component tests, E2E tests, test isolation.

---

## PHASE 5 — WEEK 5-6: INFRASTRUCTURE & DEPLOYMENT (P1/P2)

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| DEP-001 | No CI/CD pipeline | P1 | Set up GitHub Actions: test, build, security scan, deploy | None | DevOps | 5 days |
| DEP-002 | No Docker containerization | P1 | Create Dockerfile, docker-compose, multi-stage builds | None | DevOps | 4 days |
| DEP-003 | No environment validation | P1 | Add startup validation for required env vars | None | Backend | 2 days |
| DEP-004 | No health check endpoints | P1 | Add `/health`, `/health/ready`, `/health/live` endpoints | None | Backend | 2 days |
| DEP-005 | No blue-green deployment | P2 | Implement blue-green or canary deployment | CI/CD | DevOps | 5 days |
| DEP-006 | No rollback procedure documented | P2 | Document and test rollback procedure | CI/CD | DevOps | 2 days |
| DEP-007 | No monitoring/alerting | P1 | Set up uptime monitoring, error alerting (Sentry/PagerDuty) | None | DevOps | 3 days |
| DEP-008 | No log aggregation | P1 | Centralize logs (ELK/Datadog); structured logging already via Pino | None | DevOps | 3 days |

**Week 5-6 Deliverable:** CI/CD pipeline, Docker, environment validation, health checks, monitoring, alerting, log aggregation, rollback procedure.

---

## PHASE 6 — WEEK 7-8: OPERATIONS & COMPLIANCE (P2/P3)

| ID | Finding | Severity | Action | Dependency | Owner | Est. |
|----|---------|----------|--------|------------|-------|------|
| OPS-001 | No automated backup | P1 | Automated daily pg_dump to encrypted S3 | None | DevOps | 3 days |
| OPS-002 | No restore drills | P1 | Quarterly restore drills; document RTO < 4h, RPO < 1h | Backup setup | DevOps | 3 days |
| OPS-003 | No partitioning on large tables | P2 | Time-based partitioning on AuditLog, FinancialTransaction | None | Backend | 5 days |
| OPS-004 | No data retention policy | P2 | Define and implement retention for logs, audit trails | None | Backend | 3 days |
| OPS-005 | No disaster recovery plan | P2 | Document DR plan with RTO/RPO; test annually | Backup setup | DevOps | 5 days |
| OPS-006 | No API versioning strategy | P3 | Add API versioning (URL or header-based) | None | Backend | 3 days |
| OPS-007 | No feature flags | P3 | Implement feature flag system for gradual rollouts | None | Backend | 4 days |
| OPS-008 | No documentation for runbooks | P3 | Write operational runbooks for common incidents | None | DevOps | 3 days |

**Week 7-8 Deliverable:** Automated backups, restore drills, partitioning, retention policy, DR plan, API versioning, feature flags, runbooks.

---

## DEPENDENCY GRAPH

```
Phase 0 (Week 1)
├── JWT cookies (SEC-001) ──► CSRF (SEC-004) ──► Session timeout (SEC-005)
├── Schema cleanup (DB-001) ──► CI migration guard (DB-002)
├── Advisory locks (BUG-001) ──► Double-entry (DB-003) ──► Settlement CHECK (DB-004)
└── UNIQUE trips.booking_id (DB-010/Day 5)

Phase 1 (Week 2)
├── JWT cookies (SEC-001) ──► Password policy (SEC-002)
├── JWT cookies (SEC-001) ──► Account lockout (SEC-003)
└── None blocking for security headers, input validation, error sanitization

Phase 2 (Week 3)
├── Soft deletes (DB-006) ──► Depends on DB-001 schema cleanup
├── Connection pooling (DB-005) ──► Read replica (DB-009)
└── Advisory locks (DB-007) ──► Depends on BUG-001

Phase 3 (Week 4)
├── State machine tests (TEST-001) ──► Depends on state machine code (stable)
├── Financial tests (TEST-002) ──► Depends on double-entry (DB-003)
├── Security tests (TEST-003) ──► Depends on SEC-001/004/007
└── E2E tests (TEST-009) ──► Depends on test DB setup

Phase 5 (Week 5-6)
├── CI/CD (DEP-001) ──► Docker (DEP-002) ──► Blue-green (DEP-005)
├── CI/CD (DEP-001) ──► Monitoring (DEP-007)
└── Health checks (DEP-004) ──► CI/CD (DEP-001)

Phase 6 (Week 7-8)
├── Automated backup (OPS-001) ──► Restore drills (OPS-002)
├── Backup (OPS-001) ──► DR plan (OPS-005)
└── Partitioning (OPS-003) ──► Depends on DB-001 cleanup
```

---

## CRITICAL PATH (Minimum Time to Production-Ready)

1. **Week 1:** JWT cookies → CSRF → rate limiting → token blocklist → PII masking → log rotation → schema cleanup → CI migration guard → double-entry constraint → settlement CHECK → unique trip → advisory locks → document dates as DATE
2. **Week 2:** Password policy → lockout → session timeout → IP restrictions → input validation → error sanitization → security headers → WhatsApp verification → secret scanning → dependency scanning → connection pooling → soft deletes → centralized locks → DATE migration → read replica → indexes → GIN indexes → balance reconciliation
3. **Week 3-4:** State machine tests → financial tests → security tests → contract tests → load tests → chaos tests → backup tests → frontend component tests → E2E tests → test isolation
4. **Week 5-6:** CI/CD → Docker → env validation → health checks → blue-green → rollback → monitoring → log aggregation
5. **Week 7-8:** Automated backup → restore drills → partitioning → retention → DR plan → API versioning → feature flags → runbooks

**Total: 8 weeks to production-ready (assuming 1 engineer per workstream, no blockers).**

---

## WEEKLY BREAKDOWN SUMMARY

| Week | Focus | Key Deliverables | Risk Reduction |
|------|-------|-----------------|----------------|
| 1 | Critical blockers | JWT cookies, CSRF, rate limiting, token blocklist, PII masking, clean migrations, double-entry, settlement CHECK, unique trip, advisory locks, DATE types | High — eliminates P0 data loss and security risks |
| 2 | Security hardening | Password policy, lockout, session timeout, IP restrictions, input validation, security headers, WhatsApp verification, connection pooling, soft deletes, read replica | High — eliminates P0/P1 security and availability risks |
| 3-4 | Test coverage | State machine tests, financial tests, security tests, contract tests, load tests, E2E tests, frontend tests | Medium — verifies all fixes work correctly |
| 5-6 | Infrastructure | CI/CD, Docker, health checks, monitoring, alerting, log aggregation | Medium — enables safe deployments and observability |
| 7-8 | Operations | Backups, restore drills, partitioning, retention, DR plan, API versioning, feature flags | Low-Medium — improves operational maturity |

---

## GO/NO-GO CRITERIA FOR PRODUCTION

### Must Pass (No Exceptions)
- [ ] All P0 bugs fixed and tested (12 items)
- [ ] JWT in HttpOnly Secure cookies
- [ ] CSRF enabled on all state-changing endpoints
- [ ] Rate limiting on tracking and auth endpoints
- [ ] Token blocklist implemented
- [ ] PII masked in logs; log rotation configured
- [ ] Migration history clean; `prisma migrate status` clean
- [ ] CI migration guard blocks bad migrations
- [ ] Double-entry constraint on financial transactions
- [ ] Settlement arithmetic CHECK constraint
- [ ] UNIQUE constraint on trips.booking_id
- [ ] Advisory lock deadlock risk resolved
- [ ] Document dates migrated to DATE type
- [ ] State machine unit tests pass
- [ ] Financial calculation unit tests pass
- [ ] Security tests (CSRF, JWT, authz) pass

### Should Pass (Strongly Recommended)
- [ ] Password complexity policy
- [ ] Account lockout
- [ ] Session timeout
- [ ] Input validation on query params
- [ ] Security headers (CSP, HSTS, X-Frame-Options)
- [ ] Connection pooling configured
- [ ] Soft delete on core tables
- [ ] Read replica configured
- [ ] Contract tests for API
- [ ] Load tests pass at target capacity
- [ ] CI/CD pipeline operational
- [ ] Docker containerization
- [ ] Health check endpoints
- [ ] Monitoring and alerting
- [ ] Automated backups to S3
- [ ] Restore drill completed

### Can Defer (Post-Launch)
- [ ] MFA for all users (admin only in Phase 0)
- [ ] Blue-green deployment
- [ ] Chaos engineering tests
- [ ] API versioning
- [ ] Feature flags
- [ ] Partitioning on large tables

---

## ROLLBACK PLAN

For each database migration:
1. Test migration on staging with production-sized data
2. Record migration duration and resource usage
3. Prepare rollback SQL for each migration
4. Execute during low-traffic window
5. Monitor error rates for 30 minutes post-deploy
6. Rollback if error rate > 1% or data inconsistencies detected

---

## SUCCESS METRICS

| Metric | Current | Target |
|--------|---------|--------|
| Production readiness score | 42/100 | ≥ 85/100 |
| P0 findings | 12 | 0 |
| P1 findings | 28 | ≤ 5 |
| Test coverage (unit + integration) | ~45% | ≥ 80% |
| Security score | 42/100 | ≥ 80/100 |
| Database integrity score | 55/100 | ≥ 85/100 |
| CI/CD pipeline | ❌ | ✅ |
| Automated backups | ❌ | ✅ |
| Monitoring/alerting | ❌ | ✅ |
| Mean time to recovery | Unknown | < 4 hours |

---

## APPROVAL REQUIRED

No implementation, migration, or deployment will proceed without explicit approval. Each fix follows: implement → test → review → release independently.

**Each database fix will be implemented, tested, reviewed, and released independently. Approval required before any implementation begins. No production migrations will be executed without approval.**