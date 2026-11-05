/**
 * scripts/verify-dispatch-routes.js
 * ---------------------------------------------------------------------------
 * Probes a RUNNING backend for every route the Dispatch and Transit workspaces
 * call, using a real admin JWT.
 *
 * WHY THIS EXISTS
 *   A backend started with `node server.js` (rather than `nodemon`) keeps
 *   whatever route table it had when it booted. Adding a router file then has
 *   NO effect until the process is restarted, and the only symptom an operator
 *   sees is a red "Route not found" panel on one page — which looks like a
 *   wiring bug in the code that was just written, when the code is fine and the
 *   process is simply old.
 *
 *   This script answers that question in one second, against the process that is
 *   actually serving traffic.
 *
 * Usage:
 *   node scripts/verify-dispatch-routes.js [baseUrl]      # default localhost:3000
 *
 * Exit code 0 = every route is registered. 1 = at least one is missing.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Every path the Dispatch / Transit workspaces call. `expect` is the status a
 * HEALTHY backend returns for an authenticated admin: 200, or 400/404 with a
 * business message (never the bare "Route not found" the 404 handler emits).
 */
const ROUTES = [
  ['GET', '/api/trips/1094/dispatch', [200]],
  ['GET', '/api/trips/1094/dispatch/readiness', [200]],
  ['GET', '/api/trips/1094/dispatch/lr-gr', [200]],
  ['GET', '/api/trips/1094/dispatch/eway-bill', [200]],
  ['GET', '/api/trips/1094/dispatch/insurance', [200]],
  ['GET', '/api/trips/1094/transit', [200]],
  ['GET', '/api/trips/1094/incidents', [200]],
  ['GET', '/api/trips/1094/vehicle-changes', [200]],
  ['GET', '/api/trips/1094/invoice', [200]],
  ['GET', '/api/trips/1094/documents', [200]],
  ['GET', '/api/trips/1094/workflow', [200]],
  ['POST', '/api/trips/1094/dispatch', [400, 200]], // 400 = correctly refused
];

(async () => {
  let token = null;
  try {
    const admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
    if (!admin) {
      console.error('✕ No admin account exists, so no JWT can be minted.');
      process.exit(1);
    }
    token = jwt.sign({ id: admin.admin_id, type: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  } catch (err) {
    console.error('✕ Could not reach the database to mint a token:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nProbing ${base}\n${'─'.repeat(72)}`);

  let missing = 0;
  for (const [method, path, expect] of ROUTES) {
    let status = 0;
    let detail = '';
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      status = res.status;
      const text = await res.text();
      detail = text.slice(0, 90);
    } catch (err) {
      detail = err.message;
    }

    // "Route not found" with a 404 is the server's terminal handler, i.e. no
    // router matched. That is the failure this script exists to catch, so it is
    // checked by MESSAGE as well as by status.
    const isUnmatched = status === 404 && /route not found/i.test(detail);
    const ok = expect.includes(status) && !isUnmatched;

    if (!ok) missing += 1;
    const mark = ok ? '✓' : '✕';
    console.log(`${mark} ${method.padEnd(4)} ${path.padEnd(42)} HTTP ${status}`);
    if (!ok) console.log(`    ${detail}`);
  }

  console.log(`${'─'.repeat(72)}`);
  if (missing > 0) {
    console.error(
      `\n✕ ${missing} route(s) are NOT registered on the process serving ${base}.\n`
      + '  The backend is running older code than the frontend expects.\n'
      + '  Restart it:  cd transport-system/backend && npm run dev\n',
    );
    process.exit(1);
  }

  console.log(`\n✓ All ${ROUTES.length} dispatch/transit routes are registered and responding.\n`);
  process.exit(0);
})();
