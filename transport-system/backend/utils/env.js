const required = [
  'JWT_SECRET',
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
];

function validateEnv() {
  const strict = String(process.env.ENV_STRICT || 'true') === 'true';
  if (!strict) return;

  const missing = [];
  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  // In strict mode, still validate that GOOGLE_MAPS_API_KEY exists ONLY if the app is likely to call maps.
  if (process.env.NODE_ENV === 'production' && !process.env.GOOGLE_MAPS_API_KEY) {
    missing.push('GOOGLE_MAPS_API_KEY');
  }

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

module.exports = { validateEnv, required, optional };


