const required = [
  'JWT_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_NUMBER',
];


// Treat these as optional in dev; booking/maps can still work with fallback.
const optional = [
  'GOOGLE_MAPS_API_KEY',
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


