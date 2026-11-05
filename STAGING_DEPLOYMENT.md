# Staging Deployment Configuration
**Release Candidate:** `release-candidate/20261029-batch2b`
**Target Environment:** Staging (separate from production)

---

## 1. Infrastructure Overview

### Database
- **Staging Database:** `bihar_transport_staging` (PostgreSQL)
- **Production Database:** `bihar_transport_begusarai` (PostgreSQL) — **MUST NOT TOUCH**
- **Connection:** Separate DATABASE_URL for staging
- **Migrations:** 48 migrations including 2 Batch 2B migrations

### Backend Hosting
- **Platform:** Render / Railway / Fly.io / Self-hosted (Express + Socket.IO)
- **Port:** 3000 (configurable via PORT env var)
- **Health Check:** GET `/api/health` or root `/`
- **Process:** `npm start` → `node server.js`

### Frontend Hosting
- **Platform:** Netlify (configured via `netlify.toml`)
- **Build Command:** `npm run build` (outputs to `dist/`)
- **Base Directory:** `transport-system/frontend`
- **SPA Redirect:** `/*` → `/index.html` (status 200)

---

## 2. Environment Variables

### Backend (`.env.staging` — NOT COMMITTED)
```bash
# Server
NODE_ENV=staging
PORT=3000
ENV_STRICT=true

# JWT (MUST BE DIFFERENT FROM PRODUCTION)
JWT_SECRET=staging-jwt-secret-change-me
JWT_EXPIRE=7d

# Database (STAGING DATABASE ONLY)
DATABASE_URL=postgresql://user:pass@host:5432/bihar_transport_staging

# CORS
FRONTEND_URL=https://staging.bihartransport.example

# Google Maps (OPTIONAL - for vehicle RC lookup)
GOOGLE_MAPS_API_KEY=staging-maps-key

# Email (Brevo SMTP - TEST MODE)
EMAIL_MODE=development
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=staging-user
BREVO_SMTP_PASSWORD=staging-password
FROM_EMAIL=noreply@staging.bihartransport.example
OWNER_EMAIL=admin@staging.bihartransport.example
ADMIN_URL=https://staging.bihartransport.example/admin

# Customer Care
CUSTOMER_CARE_NAME=Bihar Transport Staging
CUSTOMER_CARE_PHONE=8210931799
CUSTOMER_CARE_EMAIL=support@staging.bihartransport.example
BRAND_NAME=Bihar Transport Staging

# WhatsApp (OPTIONAL - can be disabled)
# WHATSAPP_ACCESS_TOKEN=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_BUSINESS_NUMBER=

# Parse API (OPTIONAL - vehicle RC lookup)
# PARSE_API_KEY=

# Rate Limiting
# RATE_LIMIT_WINDOW_MS=900000
# RATE_LIMIT_MAX=100
```

### Frontend (`.env.staging` — NOT COMMITTED)
```bash
# Backend API URL
VITE_API_URL=https://staging-api.bihartransport.example/api

# Google Maps
VITE_GOOGLE_MAPS_API_KEY=staging-maps-key
```

---

## 3. Pre-Deployment Checklist

### Database Verification (CRITICAL)
- [ ] Confirm staging database is `bihar_transport_staging` (NOT production)
- [ ] Run `psql $STAGING_DATABASE_URL -c "SELECT current_database();"` → should return `bihar_transport_staging`
- [ ] Verify no production data in staging DB

### Backend Deployment
- [ ] Push `release-candidate/20261029-batch2b` branch to remote
- [ ] Set all staging environment variables in hosting platform
- [ ] Deploy backend service
- [ ] Run migrations: `npx prisma migrate deploy` (against staging DB only)
- [ ] Verify migration success: `npx prisma migrate status`
- [ ] Start backend: `npm start`
- [ ] Health check: `curl https://staging-api.bihartransport.example/api/health`

### Frontend Deployment
- [ ] Set frontend staging environment variables
- [ ] Build: `cd transport-system/frontend && npm run build`
- [ ] Deploy `dist/` to Netlify (or configured platform)
- [ ] Verify: `curl https://staging.bihartransport.example`

---

## 4. Migration Execution (Staging)

```bash
# 1. Set staging DATABASE_URL
export DATABASE_URL="postgresql://user:pass@host:5432/bihar_transport_staging"

# 2. Verify target database
psql "$DATABASE_URL" -c "SELECT current_database();"
# MUST output: bihar_transport_staging

# 3. Run migrations (all 48 including Batch 2B)
cd transport-system/backend
npx prisma migrate deploy

# 4. Verify schema matches
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma
# MUST output: "No difference detected."

# 5. Verify InvoiceStatus enum
psql "$DATABASE_URL" -c "SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'InvoiceStatus');"
# MUST include: PARTIALLY_PAID
```

---

## 5. Rollback Procedure

### Database Rollback
```bash
# If migration fails or issues detected:
# 1. Restore from pre-deployment backup (see BIHAR_TRANSPORT_BACKUP_RESTORE_RUNBOOK.md)
# 2. Or rollback last migration:
npx prisma migrate resolve --rolled-back 20261028150000_reconcile_schema_equivalence
npx prisma migrate resolve --rolled-back 20261028140000_add_partially_paid_invoice_status
```

### Application Rollback
- Revert to previous backend deployment (blue/green or container tag)
- Revert frontend to previous Netlify deploy

---

## 6. UAT Test Plan (Staging)

### Prerequisites
- Staging backend + frontend deployed and healthy
- Staging database seeded with test masters (vendor, vehicle, driver, admin)
- Admin credentials: `admin@bihartransport.com` / `admin123` (or staging equivalent)

### Test Scenarios

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Customer creates enquiry → receives enquiry number | Enquiry created, status `ENQUIRY_SUBMITTED` |
| 2 | Admin creates quotation (₹50,000) → sends to customer | Quotation created, enquiry status `AWAITING_CUSTOMER_ACCEPTANCE`, 1 `QUOTE_SENT` event |
| 3 | Admin confirms order (customer acceptance) | Exactly 1 booking created, `quote_status=ACCEPTED`, `status=confirmed` |
| 4 | System provisions trip for booking | Exactly 1 trip created, linked to booking |
| 5 | Assign vehicle (ID=1) + driver (ID=1) + vendor (ID=1) | Trip updated with assignments |
| 6 | Hire vehicle (CONSIGNOR, CONTRACT, FIXED, ₹42,000, commission ₹2,000) | VehicleHire created: gross ₹42k, commission ₹2k, net ₹40k; trip status `ASSIGNED` |
| 7 | Customer invoice via API (`POST /trips/:id/invoice`) | Returns booking's auto-invoice (₹50k), `created=false` |
| 8 | Customer payments: ₹20k + ₹15k | Invoice `PARTIALLY_PAID` on both columns, outstanding ₹15k |
| 9 | Vendor payments: ₹10k + ₹15k + ₹5k | Vendor outstanding ₹10k; over-payment ₹40,001 refused |
| 10 | POD upload (verified) → Complete trip | Trip `COMPLETED`; customer outstanding STILL ₹15k; vendor outstanding STILL ₹10k |
| 11 | Duplicate invoice request | Returns same invoice (`created=false`) |
| 12 | Duplicate payment (same reference) | Idempotent — no double charge |
| 13 | Invalid status transition (e.g., `FLYING`) | Rejected (400), no timeline event |
| 14 | Unauthorized access (no token) | 401 on financial/operational endpoints |
| 15 | Customer cannot access other customer's trips | 403/404 |

### Financial Invariants to Verify
```
Customer Invoice:     ₹50,000
Customer Receipts:    ₹35,000
Customer Outstanding: ₹15,000

Gross Vehicle Hire:   ₹42,000
Commission:           ₹2,000
Net Vendor Payable:   ₹40,000
Vendor Payments:      ₹30,000
Vendor Outstanding:   ₹10,000

Post-Completion:      Neither outstanding changes
```

---

## 7. Deployment Commands Summary

### Backend (Run on Staging Server)
```bash
# Clone and checkout release candidate
git clone <repo-url>
cd bihar-transport-begusarai-main
git checkout release-candidate/20261029-batch2b

# Install deps
cd transport-system/backend
npm ci

# Set staging env vars (see .env.staging template)
# Export DATABASE_URL for staging DB

# Run migrations
npx prisma migrate deploy

# Start
npm start
```

### Frontend (Run Locally, Deploy to Netlify)
```bash
cd transport-system/frontend
npm ci
npm run build
# Deploy dist/ to Netlify with:
# Base directory: transport-system/frontend
# Build command: npm run build
# Publish directory: dist
# Environment variables: VITE_API_URL, VITE_GOOGLE_MAPS_API_KEY
```

---

## 8. Security Notes

- ✅ No secrets in repository (`.env` gitignored)
- ✅ JWT_SECRET must be unique per environment
- ✅ `EMAIL_MODE=development` prevents real emails in staging
- ✅ `ENV_STRICT=true` enforces required vars
- ✅ `trust proxy: 1` configured for reverse proxy IP detection
- ✅ Helmet, CORS, rate limiting enabled
- ⚠️ Verify staging uses different JWT_SECRET than production
- ⚠️ Verify staging database is isolated from production

---

## 9. Go/No-Go Criteria for Production Review

| Criterion | Status |
|-----------|--------|
| All 137 E2E assertions pass on staging | ☐ Pending |
| All 17 Batch 2B DB tests pass on staging | ☐ Pending |
| Migrations apply cleanly on staging DB | ☐ Pending |
| Schema matches Prisma after migration | ☐ Pending |
| Frontend builds without errors | ✅ Verified locally |
| Financial invariants hold on staging | ☐ Pending |
| No production data in staging | ☐ Pending |
| Rollback tested and documented | ✅ Documented |

**Production Deployment:** ONLY after all ☐ items verified and human approval.
