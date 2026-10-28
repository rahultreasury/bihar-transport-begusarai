#!/usr/bin/env node
/**
 * Post-Deployment Smoke Test Script
 * 
 * Verifies that a deployed Bihar Transport instance is healthy and functional.
 * 
 * Usage:
 *   BASE_URL=https://staging.bihartransport.in node scripts/smoke-test.js
 *   BASE_URL=http://localhost:3000 node scripts/smoke-test.js
 * 
 * Environment Variables:
 *   BASE_URL (required) - Base URL of the deployed API (e.g., https://api.example.com)
 *   TIMEOUT (optional) - Request timeout in ms (default: 10000)
 *   ADMIN_TOKEN (optional) - Pre-signed admin JWT for authenticated checks
 * 
 * Exit Codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 *   2 - Invalid configuration (missing BASE_URL)
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL;
const TIMEOUT = parseInt(process.env.TIMEOUT || '10000', 10);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!BASE_URL) {
  console.error('ERROR: BASE_URL environment variable is required');
  console.error('Usage: BASE_URL=https://api.example.com node scripts/smoke-test.js');
  process.exit(2);
}

function parseUrl(url) {
  const parsed = new URL(url);
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + parsed.search,
  };
}

function makeRequest(method, path, token = null, body = null) {
  const url = parseUrl(BASE_URL);
  const fullPath = url.path.replace(/\/$/, '') + path;
  
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: fullPath,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'BiharTransport-SmokeTest/1.0',
    },
    timeout: TIMEOUT,
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) {
    const bodyStr = JSON.stringify(body);
    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }

  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : {}; } catch { /* not JSON */ }
        resolve({ statusCode: res.statusCode, body: json, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runSmokeTests() {
  console.log('=== Bihar Transport Post-Deployment Smoke Test ===');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Timeout: ${TIMEOUT}ms`);
  console.log('');

  let passed = 0;
  let failed = 0;
  const results = [];

  async function check(name, fn) {
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      console.log(`✓ ${name} (${duration}ms)`);
      passed++;
      results.push({ name, status: 'PASS', duration });
    } catch (e) {
      const duration = Date.now() - start;
      console.log(`✗ ${name} (${duration}ms): ${e.message}`);
      failed++;
      results.push({ name, status: 'FAIL', duration, error: e.message });
    }
  }

  // 1. Liveness check
  await check('GET /api/health (liveness)', async () => {
    const res = await makeRequest('GET', '/api/health');
    if (res.statusCode !== 200) throw new Error(`Expected 200, got ${res.statusCode}`);
    if (!res.body?.success) throw new Error('Health check returned success: false');
    if (res.body.status !== 'ok') throw new Error(`Unexpected status: ${res.body.status}`);
  });

  // 2. Readiness check
  await check('GET /api/ready (readiness)', async () => {
    const res = await makeRequest('GET', '/api/ready');
    if (res.statusCode !== 200 && res.statusCode !== 503) {
      throw new Error(`Expected 200 or 503, got ${res.statusCode}`);
    }
    if (res.statusCode === 200) {
      if (!res.body?.success) throw new Error('Readiness check returned success: false');
      if (res.body.status !== 'ready') throw new Error(`Not ready: ${res.body.status}`);
    }
  });

  // 3. Database health check
  await check('GET /api/health/db (database)', async () => {
    const res = await makeRequest('GET', '/api/health/db');
    if (res.statusCode !== 200 && res.statusCode !== 503) {
      throw new Error(`Expected 200 or 503, got ${res.statusCode}`);
    }
  });

  // 4. Auth endpoint accessibility (no auth required)
  await check('POST /api/auth/login (accessible)', async () => {
    const res = await makeRequest('POST', '/api/auth/login', null, { phone: 'test', password: 'test' });
    // Should not be 401/403/500 for missing credentials - should be 400 validation error
    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 500) {
      throw new Error(`Auth endpoint returned ${res.statusCode} (should be accessible without auth)`);
    }
  });

  // 5. Protected endpoint requires auth
  await check('GET /api/trips (requires auth)', async () => {
    const res = await makeRequest('GET', '/api/trips');
    if (res.statusCode !== 401) {
      throw new Error(`Expected 401 for unauthenticated request, got ${res.statusCode}`);
    }
  });

  // 6. Invalid token rejected
  await check('GET /api/trips (invalid token rejected)', async () => {
    const res = await makeRequest('GET', '/api/trips', 'invalid.token.here');
    if (res.statusCode !== 401) {
      throw new Error(`Expected 401 for invalid token, got ${res.statusCode}`);
    }
  });

  // 7. Admin-only endpoint protection (if admin token provided)
  if (ADMIN_TOKEN) {
    await check('GET /api/admin/bookings (admin only)', async () => {
      const res = await makeRequest('GET', '/api/admin/bookings', ADMIN_TOKEN);
      if (res.statusCode === 401) throw new Error('Admin token rejected (401)');
      if (res.statusCode === 403) throw new Error('Admin token forbidden (403)');
      if (res.statusCode !== 200) throw new Error(`Expected 200 for admin, got ${res.statusCode}`);
    });

    await check('GET /api/financials/summary (admin only)', async () => {
      const res = await makeRequest('GET', '/api/financials/summary', ADMIN_TOKEN);
      if (res.statusCode === 401) throw new Error('Admin token rejected (401)');
      if (res.statusCode === 403) throw new Error('Admin token forbidden (403)');
      if (res.statusCode !== 200) throw new Error(`Expected 200 for admin, got ${res.statusCode}`);
      if (!res.body?.success) throw new Error('Financial summary returned success: false');
    });

    await check('GET /api/trips/:id/dispatch/readiness (admin only)', async () => {
      // First get a valid trip ID
      const tripsRes = await makeRequest('GET', '/api/trips?limit=1', ADMIN_TOKEN);
      if (tripsRes.statusCode === 200 && tripsRes.body?.data?.length > 0) {
        const tripId = tripsRes.body.data[0].trip_id;
        const res = await makeRequest('GET', `/api/trips/${tripId}/dispatch/readiness`, ADMIN_TOKEN);
        if (res.statusCode === 401) throw new Error('Admin token rejected (401)');
        if (res.statusCode === 403) throw new Error('Admin token forbidden (403)');
        if (res.statusCode !== 200) throw new Error(`Expected 200 for admin, got ${res.statusCode}`);
      } else {
        console.log('⊘ No trips available for dispatch readiness check');
      }
    });

    await check('GET /api/trips/:id/documents (admin only)', async () => {
      const tripsRes = await makeRequest('GET', '/api/trips?limit=1', ADMIN_TOKEN);
      if (tripsRes.statusCode === 200 && tripsRes.body?.data?.length > 0) {
        const tripId = tripsRes.body.data[0].trip_id;
        const res = await makeRequest('GET', `/api/trips/${tripId}/documents`, ADMIN_TOKEN);
        if (res.statusCode === 401) throw new Error('Admin token rejected (401)');
        if (res.statusCode === 403) throw new Error('Admin token forbidden (403)');
        if (res.statusCode !== 200) throw new Error(`Expected 200 for admin, got ${res.statusCode}`);
      } else {
        console.log('⊘ No trips available for documents check');
      }
    });
  } else {
    console.log('⊘ Admin token checks skipped (ADMIN_TOKEN not provided)');
  }

  // Summary
  console.log('');
  console.log('=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log('');
    console.log('Failed checks:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('');
    console.log('All smoke tests passed! ✓');
    process.exit(0);
  }
}

runSmokeTests().catch(e => {
  console.error('Smoke test runner error:', e);
  process.exit(1);
});