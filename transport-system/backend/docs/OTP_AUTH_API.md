# OTP Authentication API

## Overview

OTP-based customer authentication has been added to the existing Bihar Transport authentication system. This is an **additional authentication method** — existing password login, admin login, partner login, forgot-password, and JWT authentication remain unchanged.

- **Scope**: Customer authentication only (via phone number)
- **Token**: Uses the same JWT generation logic as existing login (`generateToken` from `middleware/auth.js`)
- **Database**: Uses the existing PostgreSQL/Prisma database — no new database
- **UI**: No web UI changes — mobile app will call these endpoints directly

## Architecture

```
AuthService (authRoutes.js)
    ↓
OtpService (services/otpService.js)
    ↓
OtpRepository (repositories/otpRepository.js)
    ↓
SmsProvider (services/smsProvider.js)
    ↓
DevProvider / MSG91 / 2Factor / TextLocal
```

## Endpoints

### POST /api/auth/send-otp

Send a 6-digit OTP to a customer's phone number.

**Authentication**: None (public)

**Rate Limit**: Covered by `/api/auth` loginLimiter (20 requests / 15 minutes) + per-phone cooldown (60 seconds)

**Request Body**:
```json
{
  "phone": "9709907415"
}
```

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "phone": "9709907415",
    "expiresIn": 300
  },
  "timestamp": "2026-09-22T11:30:00.000Z",
  "requestId": "req-123"
}
```

**Error Responses**:
- `400` — Invalid phone format
- `400` — Resend cooldown active (wait before requesting another OTP)
- `400` — SMS delivery failed (production only)

### POST /api/auth/verify-otp

Verify the OTP and authenticate the customer. Returns the same JWT token format as existing login.

**Authentication**: None (public)

**Rate Limit**: Covered by `/api/auth` loginLimiter (20 requests / 15 minutes) + per-phone attempt limit (3 attempts)

**Request Body**:
```json
{
  "phone": "9709907415",
  "otp": "123456"
}
```

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user_id": 1,
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "9709907415",
    "role": "customer",
    "city": "Begusarai",
    "address": "..."
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "timestamp": "2026-09-22T11:35:00.000Z",
  "requestId": "req-456"
}
```

**Error Responses**:
- `400` — Invalid phone format
- `400` — Invalid OTP format (must be 6 digits)
- `401` — Invalid or expired OTP
- `401` — OTP already used
- `401` — Maximum verification attempts exceeded
- `401` — Account not found for this phone
- `401` — Account deactivated
- `401` — OTP login is only available for customer accounts

## Security Protections

| Protection | Implementation |
|---|---|
| Phone validation | Must be valid 10-digit Indian mobile (starts with 6-9) |
| Phone normalization | Strips +91, 91, spaces, dashes |
| OTP generation | `crypto.randomInt(100000, 1000000)` — cryptographically secure |
| OTP storage | SHA-256 hash only — plaintext never stored |
| Expiration | 5 minutes |
| Max attempts | 3 failed attempts per OTP |
| Resend cooldown | 60 seconds per phone |
| Rate limiting | `/api/auth` loginLimiter (20/15min) + global limiter |
| OTP reuse | Marked as `consumed` after successful verification |
| Generic errors | No phone enumeration on send |
| OTP logging | Never logged in production |
| SMS credentials | Backend-only environment variables |

## Database Model

New table: `otp_verifications`

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL PK | Record ID |
| `user_id` | INTEGER (FK) | Optional link to `users` |
| `phone` | TEXT | Normalized 10-digit phone |
| `otp_hash` | TEXT | SHA-256 hash of OTP |
| `expires_at` | TIMESTAMP | 5-minute expiry |
| `attempts` | INTEGER | Failed verification attempts |
| `max_attempts` | INTEGER | Max allowed (default 3) |
| `verified_at` | TIMESTAMP | When verified (null = unused) |
| `consumed` | BOOLEAN | Prevents reuse |
| `created_at` | TIMESTAMP | Record creation |
| `updated_at` | TIMESTAMP | Last update |

Migration: `prisma/migrations/20260922000000_add_otp_verification/migration.sql`

## SMS Provider Configuration

Environment variables (backend-only):

```
SMS_PROVIDER=dev|msg91|2factor|textlocal
SMS_API_KEY=your-api-key
SMS_SENDER_ID=BTINFO
SMS_TEMPLATE_ID=your-template-id   # MSG91
SMS_TEMPLATE_NAME=OTP              # 2Factor
```

### Development Mode

When `NODE_ENV=development` and no `SMS_PROVIDER` is set, the system defaults to the dev provider. OTPs are logged to the backend console:

```
[DEV OTP]
Phone: 9709907415
OTP: 123456
```

This is **never** exposed in production.

## Mobile App Integration (Expo)

The mobile app should call these endpoints directly:

1. Call `POST /api/auth/send-otp` with `{ "phone": "9709907415" }`
2. User receives OTP via SMS
3. Call `POST /api/auth/verify-otp` with `{ "phone": "9709907415", "otp": "123456" }`
4. Store the returned `token` (same JWT format as web login)
5. Use `Authorization: Bearer <token>` for all protected API calls

The returned token is identical to the one from `POST /api/auth/login` and works with all existing protected routes (`/api/auth/me`, `/api/bookings`, etc.).

## Testing

Run: `npm test -- otpAuth.test.js`

Coverage:
- Valid OTP
- Wrong OTP
- Expired OTP
- OTP reuse prevention
- Max attempts
- Resend cooldown
- Rate limiting
- Unknown phone
- Existing customer
- Existing password login compatibility
- JWT format compatibility
- Unauthorized API access without JWT
- Production OTP non-exposure
