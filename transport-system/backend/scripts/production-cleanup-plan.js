'use strict';

/**
 * Production test-data cleanup plan generator.
 *
 * READ-ONLY. It classifies test records with the conservative shared
 * classifier, verifies that no preserved row references a test parent, checks
 * a fresh custom-format backup, and writes a reviewable plan outside Git.
 *
 * Usage:
 *   PROD_DATABASE_URL=... EXPECTED_NEON_BRANCH_ID=... \
 *     node scripts/production-cleanup-plan.js \
 *     --backup /secure/path/backup.dump \
 *     --out /secure/path/cleanup-plan.json \
 *     --expected-total 1992
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  RULES_VERSION,
  TABLES,
  DELETION_ORDER,
  PRESERVE_ONLY_TABLES,
  classify,
  guardCheck,
  summarize,
  idsObject,
} = require('./cleanup-classifier');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_ARTIFACT_DIR = path.join(os.tmpdir(), 'bihar-transport-cleanup');

function parseArgs(argv) {
  const args = { allowDrift: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--backup') args.backup = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--expected-total') args.expectedTotal = Number(argv[++i]);
    else if (arg === '--allow-drift') args.allowDrift = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function assertOutsideRepo(filePath, label) {
  const resolved = path.resolve(filePath);
  if (resolved === REPO_ROOT || resolved.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`${label} must be outside the Git repository: ${resolved}`);
  }
  return resolved;
}

function validateProductionUrl(raw) {
  if (!raw) throw new Error('PROD_DATABASE_URL is required');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PROD_DATABASE_URL is not a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('PROD_DATABASE_URL must be a PostgreSQL URL');
  }
  if (!url.hostname.endsWith('.neon.tech')) {
    throw new Error(`Refusing non-Neon host: ${url.hostname}`);
  }
  if (url.hostname.includes('-pooler')) {
    throw new Error('Use the direct Neon endpoint (without -pooler) for cleanup');
  }
  return url;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function verifyBackup(backupPath) {
  const resolved = assertOutsideRepo(backupPath, 'Backup');
  if (!fs.existsSync(resolved)) throw new Error(`Backup not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size === 0) throw new Error('Backup is empty or not a file');

  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  const listOutput = execFileSync(pgRestore, ['--list', resolved], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = listOutput.split(/\r?\n/);
  const tableDataEntries = lines.filter((line) => line.includes(' TABLE DATA ')).length;
  const tableEntries = lines.filter((line) => line.includes(' TABLE ') && !line.includes(' TABLE DATA ')).length;
  if (tableDataEntries === 0) {
    throw new Error('pg_restore --list found no TABLE DATA entries in the backup');
  }

  return {
    path: resolved,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: sha256File(resolved),
    pgRestoreListVerified: true,
    tableDataEntries,
    tableEntries,
  };
}

function buildPreservedReview(test, rows, totals) {
  const users = rows.users || [];
  const owners = rows.vehicle_owners || [];
  const enquiries = rows.enquiries || [];
  const driverTransactions = rows.driver_transactions || [];
  const clients = rows.clients || [];

  return {
    ambiguousEnquiries: enquiries
      .filter((row) => !test.enquiries.has(row.enquiry_id) && /^Rahul treasury$/i.test(row.customer_name || ''))
      .map((row) => row.enquiry_id)
      .sort((a, b) => a - b),
    guestUsers: users
      .filter((row) => !test.users.has(row.user_id) && /@btb\.local$/i.test(row.email || ''))
      .map((row) => row.user_id)
      .sort((a, b) => a - b),
    ownersWithTestLikeEmail: owners
      .filter((row) => !test.vehicle_owners.has(row.owner_id) && /@test\.com$/i.test(row.email || ''))
      .map((row) => row.owner_id)
      .sort((a, b) => a - b),
    preservedClients: clients.map((row) => row.client_id).sort((a, b) => a - b),
    preservedAuditLogs: totals.audit_logs || 0,
    preservedDocumentSequences: totals.document_sequences || 0,
    preservedOtpVerifications: totals.otp_verifications || 0,
    preservedDriver2LedgerTransactions: driverTransactions.filter((row) => row.driver_id === 2).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.backup) throw new Error('--backup <path> is required');
  if (!args.out) args.out = path.join(DEFAULT_ARTIFACT_DIR, 'cleanup-plan.json');
  const outPath = assertOutsideRepo(args.out, 'Plan output');

  const expectedBranchId = process.env.EXPECTED_NEON_BRANCH_ID;
  if (!expectedBranchId) {
    throw new Error('EXPECTED_NEON_BRANCH_ID is required (production branch guard)');
  }

  const url = validateProductionUrl(process.env.PROD_DATABASE_URL);
  const prisma = new PrismaClient({ datasourceUrl: process.env.PROD_DATABASE_URL, log: ['error'] });

  try {
    const identityRows = await prisma.$queryRawUnsafe(`
      SELECT
        current_database() AS database,
        current_user AS db_user,
        current_setting('neon.branch_id', true) AS branch_id,
        current_setting('neon.project_id', true) AS project_id,
        version() AS server_version
    `);
    const identity = identityRows[0];
    if (identity.branch_id !== expectedBranchId) {
      throw new Error(
        `Neon branch mismatch: connected to ${identity.branch_id}, expected ${expectedBranchId}`
      );
    }
    if (process.env.EXPECTED_NEON_PROJECT_ID && identity.project_id !== process.env.EXPECTED_NEON_PROJECT_ID) {
      throw new Error(
        `Neon project mismatch: connected to ${identity.project_id}, expected ${process.env.EXPECTED_NEON_PROJECT_ID}`
      );
    }

    console.log('Connected to production database:', {
      host: url.hostname,
      database: identity.database,
      user: identity.db_user,
      branch_id: identity.branch_id,
    });

    const { test, totals, rows } = await classify(prisma);
    const guard = await guardCheck(prisma, test);
    const summary = summarize(test, totals);

    console.log('\nClassification summary:');
    for (const table of Object.keys(TABLES)) {
      const counts = summary.tables[table];
      if (counts.test > 0) {
        console.log(`  ${table.padEnd(34)} total=${String(counts.total).padStart(6)} test=${String(counts.test).padStart(6)} preserve=${String(counts.preserve).padStart(6)}`);
      }
    }
    console.log(`  ${'TOTAL'.padEnd(34)} total=${String(summary.totalRows).padStart(6)} test=${String(summary.testRows).padStart(6)} preserve=${String(summary.preservedRows).padStart(6)}`);

    if (guard.blockers.length > 0) {
      console.error(`\nBLOCKED: ${guard.blockers.length} preserved row(s) reference test parents.`);
      for (const blocker of guard.blockers.slice(0, 100)) {
        console.error('  ', blocker);
      }
      throw new Error('Foreign-key guard blocked the cleanup plan');
    }
    console.log(`\nForeign-key guard: ${guard.foreignKeysChecked} constraints checked, 0 blockers.`);

    if (Number.isFinite(args.expectedTotal) && summary.testRows !== args.expectedTotal && !args.allowDrift) {
      throw new Error(
        `Expected ${args.expectedTotal} test rows but classified ${summary.testRows}. ` +
        'Review the drift or pass --allow-drift.'
      );
    }

    const backup = verifyBackup(args.backup);
    console.log('Backup verified:', {
      path: backup.path,
      sizeBytes: backup.sizeBytes,
      sha256: backup.sha256,
      tableDataEntries: backup.tableDataEntries,
    });

    const testIds = idsObject(test);
    const deletionOrder = DELETION_ORDER
      .filter((table) => test[table] && test[table].size > 0)
      .map((table) => ({
        table,
        model: TABLES[table].model,
        id_field: TABLES[table].id,
        count: test[table].size,
      }));

    const classifiedTables = Object.keys(TABLES);
    const unlistedTestTables = classifiedTables.filter(
      (table) => test[table] && test[table].size > 0 && !DELETION_ORDER.includes(table)
    );
    if (unlistedTestTables.length > 0) {
      throw new Error(`Test rows exist in tables missing from deletion order: ${unlistedTestTables.join(', ')}`);
    }

    const preservedIds = {};
    for (const table of [
      'users', 'drivers', 'vehicle_owners', 'transport_vehicles', 'bookings',
      'enquiries', 'trips', 'trip_financials', 'financial_transactions', 'partners',
    ]) {
      const idField = TABLES[table].id;
      preservedIds[table] = rows[table]
        .map((row) => row[idField])
        .filter((id) => !test[table].has(id))
        .sort((a, b) => a - b);
    }

    const plan = {
      schemaVersion: 1,
      rulesVersion: RULES_VERSION,
      generatedAt: new Date().toISOString(),
      database: {
        host: url.hostname,
        database: identity.database,
        db_user: identity.db_user,
        branch_id: identity.branch_id,
        project_id: identity.project_id,
        server_version: identity.server_version,
      },
      backup,
      expectedTotalRows: Number.isFinite(args.expectedTotal) ? args.expectedTotal : null,
      totals: summary,
      testIds,
      deletionOrder,
      preservedIds,
      preservedReview: buildPreservedReview(test, rows, totals),
      guard: {
        foreignKeysChecked: guard.foreignKeysChecked,
        blockers: guard.blockers,
      },
      preserveOnlyTables: Array.from(PRESERVE_ONLY_TABLES).sort(),
    };
    plan.planHash = crypto.createHash('sha256').update(stableStringify(plan)).digest('hex');

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });

    console.log('\nPlan written:', outPath);
    console.log('Plan hash:', plan.planHash);
    console.log('Deletion order:', deletionOrder.map((step) => `${step.table}(${step.count})`).join(' -> '));
    console.log('\nNo data was modified.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Plan generation failed:', error.message);
  process.exit(1);
});
