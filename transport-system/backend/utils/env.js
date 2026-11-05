const crypto = require('crypto');

const required = [
  'JWT_SECRET',
];

const requiredInProduction = [
  'DATABASE_URL',
];

// Treat these as optional; booking/maps/email/SMS/RC-lookup can still work with
// fallback. PARSE_API_KEY is deliberately OPTIONAL: without it the vehicle RC
// lookup endpoint returns 503 and the registration form simply falls back to
// manual entry. It must never be required at boot.
const optional = [
  'GOOGLE_MAPS_API_KEY',
  'PARSE_API_KEY',
  'PARSE_CARINFO_TIMEOUT_MS',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_NUMBER',
  'SMS_PROVIDER',
  'SMS_API_KEY',
  'SMS_SENDER_ID',
  'SMS_TEMPLATE_ID',
  'SMS_TEMPLATE_NAME',
  'BREVO_SMTP_HOST',
  'BREVO_SMTP_PORT',
  'BREVO_SMTP_USER',
  'BREVO_SMTP_PASSWORD',
  'FROM_EMAIL',
  'OWNER_EMAIL',
  'GEMINI_API_KEY',
  'FRONTEND_URL',
];

const WEAK_JWT_SECRETS = [
  'btb_secret_key_2024_change_in_production',
  'secret',
  'jwt_secret',
  'change_me',
  'your_jwt_secret',
  'default',
  '123456',
  'password',
];

function isWeakSecret(secret) {
  if (!secret) return true;
  if (typeof secret !== 'string') return true;
  if (secret.length < 32) return true;
  if (WEAK_JWT_SECRETS.includes(secret)) return true;
  
  // Check for common weak patterns
  if (/^[a-z]+$/.test(secret) || /^[0-9]+$/.test(secret)) return true;
  // Only flag all-lowercase as weak if it's not a hex string and all letters
  if (secret === secret.toLowerCase() && secret.length < 40 && !/^[0-9a-f]+$/i.test(secret) && /^[a-z]+$/.test(secret)) return true;
  
  return false;
}

function validateEnv() {
  const isProduction = process.env.NODE_ENV === 'production';
  const strict = String(process.env.ENV_STRICT || 'true') === 'true';
  
  if (!strict && !isProduction) {
    // In non-strict dev mode, just warn
    if (!process.env.JWT_SECRET) {
      console.warn('[env] WARNING: JWT_SECRET not set - using insecure defaults in development only');
    } else if (isWeakSecret(process.env.JWT_SECRET)) {
      console.warn('[env] WARNING: JWT_SECRET is weak - please use a strong random secret');
    }
    return;
  }

  const missing = [];
  const errors = [];

  // Always required
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Production required
  if (isProduction) {
    for (const key of requiredInProduction) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  }

  if (missing.length) {
    const error = new Error(`Missing required env vars: ${missing.join(', ')}`);
    error.code = 'MISSING_ENV_VARS';
    throw error;
  }

  // JWT_SECRET strength validation
  const jwtSecret = process.env.JWT_SECRET;
  if (isWeakSecret(jwtSecret)) {
    if (isProduction) {
      const error = new Error('JWT_SECRET is weak or missing. Must be at least 32 characters with sufficient entropy.');
      error.code = 'WEAK_JWT_SECRET';
      throw error;
    } else {
      console.warn('[env] WARNING: JWT_SECRET is weak or uses default value. Generate a strong secret for production.');
    }
  }

  // In production, still validate that GOOGLE_MAPS_API_KEY exists if the app is likely to call maps.
  if (isProduction && !process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('[env] WARNING: GOOGLE_MAPS_API_KEY not set in production - maps functionality may be limited');
  }

  if (errors.length) {
    throw errors[0];
  }
}

function generateSecureSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = { validateEnv, required, optional, isWeakSecret, generateSecureSecret };
