/**
 * scripts/e2e-audit-prepare.js
 * ---------------------------------------------------------------------------
 * Prepare the ISOLATED audit database for scripts/e2e-audit-test.js.
 *
 *   1. create the throwaway database `bihar_transport_audit_test` (if absent)
 *   2. `prisma db push` the schema onto it (a THROWAWAY database — the dev
 *      database `bihar_transport_begusarai` is never touched by this script)
 *   3. seed exactly what the audit script needs, copying real masters from
 *      the local dev database (READ ONLY there — nothing is written to it):
 *        · admin   #1  — the login row for admin@bihartransport.com
 *                        (password hash copied, never printed)
 *        · vendor  #1  — vehicle owner 1 with its vehicle 1 and driver 1
 *
 * Rows are copied by PRIMARY KEY = 1 so the script's hardcoded
 * VENDOR_ID / DRIVER_ID / VEHICLE_ID = 1 constants resolve to real rows with
 * real document snapshots (an audit run must see the documents an operator
 * would see, including expiry state). Nothing is deleted; the script is
 * idempotent — existing ids are skipped.
 */


// SAFETY GUARD: Refuse to run against production or non-local databases.
const _dbUrl = process.env.DATABASE_URL || '';
const _host = (() => { try { return new URL(_dbUrl).hostname; } catch { return ''; } })();
const _allowOverride = process.argv.includes('--allow-production');
if (_host && !_host.includes('localhost') && !_host.includes('127.0.0.1') && !_host.includes('::1')) {
  if (!_allowOverride || !_host.includes('neon.tech')) {
    console.error('SAFETY: This script must not run against a non-local database.');
    console.error('Host detected:', _host);
    console.error('Use a local throwaway database, or pass --allow-production for an explicitly allow-listed throwaway DB.');
    process.exit(1);
  }
  if (_host.includes('neon.tech')) {
    console.error('SAFETY: Refusing to run against Neon (production).');
    console.error('This script drops and recreates tables. It must never run against production.');
    process.exit(1);
  }
}


const { execSync } = require('child_process');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const BACKEND_ROOT = path.resolve(__dirname, '..');


const AUDIT_DB = 'bihar_transport_audit_test';
const AUDIT_URL = process.env.AUDIT_URL || `postgresql://rahulraj@localhost:5432/${AUDIT_DB}`;
const DEV_URL = process.env.DEV_URL || 'postgresql://rahulraj@localhost:5432/bihar_transport_begusarai';

function print(label, value) {
  console.log(`[prepare] ${label}: ${value}`);
}

async function main() {
  const FRESH = process.argv.includes('--fresh');

  // ── 1. the database exists ────────────────────────────────────────────────
  print('database', AUDIT_DB);
  if (FRESH) {
    print('mode', 'fresh (drop + recreate the throwaway database)');
    try {
      // The server may still be attached; terminate its connections first.
      execSync(
        `psql postgresql://rahulraj@localhost:5432/postgres -c`
        + ` "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${AUDIT_DB}' AND pid <> pg_backend_pid()"`,
        { stdio: 'ignore' },
      );
      execSync(`dropdb --if-exists ${AUDIT_DB}`, { stdio: 'ignore' });
      execSync(`createdb ${AUDIT_DB}`);
      print('recreated', AUDIT_DB);
    } catch (error) {
      print('recreate-error', String(error.message).split('\n')[0]);
      process.exit(1);
    }
  } else {
    try {
      const exists = execSync(
        `psql postgresql://rahulraj@localhost:5432/postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${AUDIT_DB}'"`,
      ).toString().trim();
      if (exists !== '1') {
        execSync(`createdb ${AUDIT_DB}`);
        print('created', AUDIT_DB);
      } else {
        print('exists', AUDIT_DB);
      }
    } catch (error) {
      print('create-db-error', String(error.message).split('\n')[0]);
      process.exit(1);
    }
  }

  // ── 2. schema push (throwaway database ONLY) ─────────────────────────────
  print('db push', 'begin');
  try {
    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, DATABASE_URL: AUDIT_URL },
      stdio: 'inherit',
      cwd: BACKEND_ROOT,
    });
  } catch (error) {
    print('db push', 'FAILED — see output above');
    process.exit(1);
  }

  // ── 3. seed ───────────────────────────────────────────────────────────────
  const audit = new PrismaClient({ datasources: { db: { url: AUDIT_URL } } });
  const dev = new PrismaClient({ datasources: { db: { url: DEV_URL } } });

  let copied = 0;
  let skipped = 0;

  try {
    // Admin #1 — by the login email. The password hash is copied so the
    // audit script can log in; it is never logged or exported here.
    const ADMIN_EMAIL = 'admin@bihartransport.com';
    const haveAdmin = await audit.admin.findUnique({ where: { email: ADMIN_EMAIL } });
    if (haveAdmin) {
      skipped += 1;
    } else {
      const src = await dev.admin.findFirst({
        where: { email: ADMIN_EMAIL },
        orderBy: { admin_id: 'asc' },
      });
      if (src) {
        const data = { ...src };
        await audit.admin.create({ data });
        copied += 1;
        print('admin seeded', src.admin_id);
      } else {
        // No such row in dev: synthesize with a hash that matches 'admin123'
        // the way the login path expects (bcrypt through the same helper).
        const bcrypt = require('bcrypt');
        const hash = await bcrypt.hash('admin123', 10);
        await audit.admin.create({
          data: {
            username: 'auditadmin',
            email: ADMIN_EMAIL,
            password_hash: hash,
            full_name: 'Audit Admin',
            role: 'admin',
            is_active: true,
          },
        });
        copied += 1;
        print('admin synthesized', ADMIN_EMAIL);
      }
    }

    // Vendor #1 → vehicle #1 → driver #1, copied with their real ids.
    const haveOwner = await audit.vehicleOwner.findUnique({ where: { owner_id: 1 } });
    if (haveOwner) {
      skipped += 1;
      print('vendor #1', 'already present');
    } else {
      const srcOwner = await dev.vehicleOwner.findUnique({ where: { owner_id: 1 } });
      if (srcOwner) {
        await audit.vehicleOwner.create({ data: srcOwner });
        copied += 1;
        print('vendor #1 copied', 'dev owner_id=1');
      } else {
        await audit.vehicleOwner.create({
          data: {
            owner_id: 1,
            owner_name: 'Audit Transport Vendor',
            owner_type: 'TRANSPORT_COMPANY',
            mobile: '98000000001',
            status: 'active',
            is_active: true,
          },
          // owner_id is not autoincrement-if-provided friendly on every
          // schema: rely on the explicit id column (it is Int @id without
          // autoincrement when copied — if the create rejects the provided
          // id, the error surfaces loudly here).
        }).catch(async () => {
          const ok = await audit.vehicleOwner.findUnique({ where: { owner_id: 1 } });
          if (!ok) throw new Error('could not establish vendor #1');
          return ok;
        });
        copied += 1;
        print('vendor #1 synthesized', 'owner_id=1');
      }
    }

    const haveVehicle = await audit.transportVehicle.findUnique({ where: { vehicle_id: 1 } });
    if (haveVehicle) {
      skipped += 1;
      print('vehicle #1', 'already present');
    } else {
      const srcVehicle = await dev.transportVehicle.findUnique({ where: { vehicle_id: 1 } });
      if (srcVehicle) {
        // Document freshness is the DEV database's artifact, not a fact the
        // audit wants to import: an expired copy would make the hire gate
        // block the run for reasons the scenario does not test. Dates roll
        // forward; identity and document NUMBERS are kept so the audit sees
        // a real vehicle rather than a synthetic one.
        const horizon = new Date(Date.now() + 366 * 24 * 3600 * 1000);
        await audit.transportVehicle.create({
          data: {
            ...srcVehicle,
            tax_expiry: horizon.toISOString().slice(0, 10),
            insurance_expiry: horizon.toISOString().slice(0, 10),
            national_permit_expiry: horizon.toISOString().slice(0, 10),
            permit_expiry: horizon.toISOString().slice(0, 10),
            fitness_expiry: horizon.toISOString().slice(0, 10),
            pollution_expiry: horizon.toISOString().slice(0, 10),
          },
        });
        copied += 1;
        print('vehicle #1 copied', 'dev vehicle_id=1 (documents included)');
      } else {
        await audit.transportVehicle.create({
          data: {
            vehicle_id: 1,
            vehicle_number: 'BTBAUDIT0001',
            vehicle_type: 'TRUCK',
            owner_id: 1,
            is_available: true,
            current_status: 'available',
            tax_number: 'AUDTAX0001',
            tax_expiry: new Date('2027-10-28'),
            insurance_number: 'AUDINS0001',
            insurance_expiry: new Date('2027-10-28'),
            pollution_certificate: 'AUDPOL0001',
            pollution_expiry: new Date('2027-04-28'),
            fitness_number: 'AUDFIT0001',
            fitness_expiry: new Date('2027-10-28'),
            permit_number: 'AUDPER0001',
            permit_expiry: new Date('2027-10-28'),
          },
        });
        copied += 1;
        print('vehicle #1 synthesized', 'fresh future-expiry documents');
      }
    }

    const haveDriver = await audit.driver.findUnique({ where: { driver_id: 1 } });
    if (haveDriver) {
      skipped += 1;
      print('driver #1', 'already present');
    } else {
      const srcDriver = await dev.driver.findUnique({ where: { driver_id: 1 } });
      if (srcDriver) {
        // The driver's backing User comes along when one is required.
        if (srcDriver.user_id) {
          const user = await dev.user.findUnique({ where: { user_id: srcDriver.user_id } });
          const haveUser = user && await audit.user.findUnique({ where: { user_id: user.user_id } });
          if (user && !haveUser) {
            await audit.user.create({ data: user });
            copied += 1;
          }
        }
        await audit.driver.create({ data: srcDriver });
        copied += 1;
        print('driver #1 copied', `dev driver_id=1 (owner ${srcDriver.transport_owner_id})`);
      } else {
        await audit.driver.create({
          data: {
            driver_id: 1,
            driver_name: 'Audit Driver One',
            mobile: '98000000002',
            transport_owner_id: 1,
            is_available: true,
            status: 'available',
            current_vehicle_id: 1,
          },
        });
        copied += 1;
        print('driver #1 synthesized', 'driver_id=1');
      }
    }

    // ── 3b. isolation contract ─────────────────────────────────────────────
    // Masters may arrive with BUSY flags from real work in the dev database,
    // but in the audit database nothing else runs — availability is set, not
    // inherited, or the hire gate refuses the very masters this database
    // exists to exercise.
    await audit.transportVehicle.update({
      where: { vehicle_id: 1 },
      data: { is_available: true, current_status: 'available' },
    }).catch(() => { });
    await audit.driver.update({
      where: { driver_id: 1 },
      data: { is_available: true, status: 'available' },
    }).catch(() => { });
    print('master availability', 'forced available (isolation contract)');

    // ── 4. state summary (ids only, never row contents) ─────────────────────
    // Rows copied with EXPLICIT primary keys do not advance the database's
    // serial sequences — a later `create` would walk its counter straight
    // into a copied id and fail with a unique violation (this is exactly
    // what broke the first audit run when the customer's User row was
    // created). Every copied table gets its sequence pushed past its max.
    await advanceSequence(audit, 'users', 'user_id');
    await advanceSequence(audit, 'admins', 'admin_id');
    await advanceSequence(audit, 'vehicle_owners', 'owner_id');
    await advanceSequence(audit, 'transport_vehicles', 'vehicle_id');
    await advanceSequence(audit, 'drivers', 'driver_id');

    const [owners, vehicles, drivers, admins, trips, invoices] = await Promise.all([
      audit.vehicleOwner.count(),
      audit.transportVehicle.count({ where: { vehicle_id: { gte: 1 } } }),
      audit.driver.count(),
      audit.admin.count(),
      audit.trip.count(),
      audit.invoice.count(),
    ]);
    print('owners', owners);
    print('vehicles', vehicles);
    print('drivers', drivers);
    print('admins', admins);
    print('pre-existing trips', trips);
    print('pre-existing invoices', invoices);
    print('copied/skipped', `${copied}/${skipped}`);
  } finally {
    await Promise.allSettled([audit.$disconnect(), dev.$disconnect()]);
  }
}

main().catch((error) => {
  console.error('[prepare] FATAL:', error.message);
  process.exit(1);
});

/**
 * Push a table's serial sequence past its current max. Tables whose ids are
 * always copied explicitly (never inserted fresh) have no serial — the error
 * is swallowed for them, since nothing then relies on the sequence.
 */
async function advanceSequence(client, table, column) {
  try {
    await client.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', '${column}'),`
      + ` COALESCE((SELECT MAX(${column}) FROM "${table}"), 0) + 1, false)`,
    );
  } catch {
    /* no serial sequence on that column — nothing to advance */
  }
}
