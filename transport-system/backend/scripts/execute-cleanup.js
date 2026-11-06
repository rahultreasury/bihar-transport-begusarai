'use strict';

/**
 * Production test-data cleanup executor.
 *
 * Safety properties:
 *   - read-only unless both --execute and CLEANUP_CONFIRM are supplied;
 *   - refuses non-Neon / pooled / wrong-branch connections;
 *   - verifies the plan hash, plan freshness and backup SHA-256;
 *   - re-classifies inside the same transaction that performs the deletes;
 *   - re-runs the preserved-row foreign-key guard;
 *   - deletes child-first, verifies every planned row is gone, and verifies
 *     every preserved table count is unchanged before COMMIT.
 *
 * Usage:
 *   PROD_DATABASE_URL=... EXPECTED_NEON_BRANCH_ID=... \
 *     node scripts/execute-cleanup.js --plan /secure/path/cleanup-plan.json
 *
 *   CLEANUP_CONFIRM=DELETE_VERIFIED_TEST_DATA \
 *   PROD_DATABASE_URL=... EXPECTED_NEON_BRANCH_ID=... \
 *     node scripts/execute-cleanup.js --plan /secure/path/cleanup-plan.json --execute
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
  classify,
  guardCheck,
  summarize,
  idsObject,
  diffTestIds,
  sortedIds,
} = require('./cleanup-classifier');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIRMATION = 'DELETE_VERIFIED_TEST_DATA';
const DEFAULT_ARTIFACT_DIR = path.join(os.tmpdir(), 'bihar-transport-cleanup');
const CHUNK_SIZE = 500;

function parseArgs(argv) {
  const args = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--plan') args.plan = argv[++i];
    else if (arg === '--backup') args.backup = argv[++i];
    else if (arg === '--execute') args.execute = true;
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

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function verifyPlanIntegrity(plan) {
  if (plan.schemaVersion !== 1) throw new Error(`Unsupported plan schema: ${plan.schemaVersion}`);
  if (plan.rulesVersion !== RULES_VERSION) {
    throw new Error(`Plan rules version ${plan.rulesVersion} does not match ${RULES_VERSION}`);
  }

  const { planHash, ...withoutHash } = plan;
  const computed = crypto.createHash('sha256').update(stableStringify(withoutHash)).digest('hex');
  if (!planHash || computed !== planHash) {
    throw new Error('Plan hash verification failed; the plan was modified after generation');
  }

  for (const table of Object.keys(TABLES)) {
    if (!Array.isArray(plan.testIds[table])) {
      throw new Error(`Plan is missing testIds for table ${table}`);
    }
    const ids = plan.testIds[table];
    if (ids.some((id) => !Number.isInteger(id))) {
      throw new Error(`Plan contains non-integer IDs for table ${table}`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Plan contains duplicate IDs for table ${table}`);
    }
    const expected = plan.totals.tables[table];
    if (!expected || expected.test !== ids.length) {
      throw new Error(`Plan count mismatch for table ${table}`);
    }
  }

  const expectedOrder = DELETION_ORDER
    .filter((table) => plan.testIds[table].length > 0)
    .map((table) => ({
      table,
      model: TABLES[table].model,
      id_field: TABLES[table].id,
      count: plan.testIds[table].length,
    }));
  if (stableStringify(expectedOrder) !== stableStringify(plan.deletionOrder)) {
    throw new Error('Plan deletion order does not match the reviewed child-first order');
  }
}

function verifyBackup(plan, overridePath) {
  const planPath = path.resolve(plan.backup.path);
  if (overridePath && path.resolve(overridePath) !== planPath) {
    throw new Error('--backup must match the backup path recorded in the plan');
  }
  const resolved = assertOutsideRepo(planPath, 'Backup');
  if (!fs.existsSync(resolved)) throw new Error(`Backup not found: ${resolved}`);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size === 0) throw new Error('Backup is empty or not a file');
  if (stat.size !== plan.backup.sizeBytes) {
    throw new Error(`Backup size changed: expected ${plan.backup.sizeBytes}, found ${stat.size}`);
  }
  const hash = sha256File(resolved);
  if (hash !== plan.backup.sha256) {
    throw new Error(`Backup SHA-256 mismatch: expected ${plan.backup.sha256}, found ${hash}`);
  }
  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  const listOutput = execFileSync(pgRestore, ['--list', resolved], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = listOutput.split(/\r?\n/);
  const tableDataEntries = lines.filter((line) => line.includes(' TABLE DATA ')).length;
  const tableEntries = lines.filter((line) => line.includes(' TABLE ') && !line.includes(' TABLE DATA ')).length;
  if (tableDataEntries !== plan.backup.tableDataEntries || tableEntries !== plan.backup.tableEntries) {
    throw new Error('pg_restore --list entry counts do not match the plan');
  }
  return { path: resolved, sizeBytes: stat.size, sha256: hash, tableDataEntries, tableEntries };
}

async function getIdentity(db) {
  const rows = await db.$queryRawUnsafe(`
    SELECT
      current_database() AS database,
      current_user AS db_user,
      current_setting('neon.branch_id', true) AS branch_id,
      current_setting('neon.project_id', true) AS project_id,
      version() AS server_version
  `);
  return rows[0];
}

function assertPlanMatchesLive(plan, liveTest, liveSummary) {
  const liveIds = idsObject(liveTest);
  const diffs = diffTestIds(plan.testIds, liveIds);
  if (diffs.length > 0) {
    const details = diffs.map((diff) => (
      `${diff.table}: planned=${diff.planned_count} live=${diff.live_count}` +
      (diff.new_in_live.length ? ` new=${diff.new_in_live.join(',')}` : '') +
      (diff.missing_from_live.length ? ` missing=${diff.missing_from_live.join(',')}` : '')
    )).join('; ');
    throw new Error(`Plan is stale; live data changed since plan generation. ${details}`);
  }
  if (plan.expectedTotalRows != null && liveSummary.testRows !== plan.expectedTotalRows) {
    throw new Error(
      `Live test row count ${liveSummary.testRows} does not match expected ${plan.expectedTotalRows}`
    );
  }
}

async function executeCleanup(prisma, plan, live) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(2147483001)::text AS lock');

    const identity = await getIdentity(tx);
    if (identity.branch_id !== plan.database.branch_id) {
      throw new Error(
        `Branch changed inside transaction: ${identity.branch_id} !== ${plan.database.branch_id}`
      );
    }
    if (identity.database !== plan.database.database) {
      throw new Error(`Database changed inside transaction: ${identity.database}`);
    }

    const liveCheck = await classify(tx);
    const liveSummary = summarize(liveCheck.test, liveCheck.totals);
    assertPlanMatchesLive(plan, liveCheck.test, liveSummary);

    const guard = await guardCheck(tx, liveCheck.test);
    if (guard.blockers.length > 0) {
      throw new Error(
        `Foreign-key guard blocked execution: ${guard.blockers.length} preserved row(s) reference test parents`
      );
    }

    // Break self-references in financial transactions before deleting them.
    const financialTransactionIds = sortedIds(liveCheck.test.financial_transactions);
    if (financialTransactionIds.length > 0) {
      await tx.financialTransaction.updateMany({
        where: { transaction_id: { in: financialTransactionIds } },
        data: { reversal_of_transaction_id: null },
      });
    }

    const deleted = {};
    for (const table of DELETION_ORDER) {
      const ids = sortedIds(liveCheck.test[table] || new Set());
      if (ids.length === 0) continue;
      const meta = TABLES[table];
      let count = 0;
      for (const chunk of chunks(ids, CHUNK_SIZE)) {
        const result = await tx[meta.model].deleteMany({
          where: { [meta.id]: { in: chunk } },
        });
        count += result.count;
      }
      if (count !== ids.length) {
        throw new Error(`Deleted ${count}/${ids.length} rows from ${table}`);
      }
      deleted[table] = count;
    }

    for (const table of DELETION_ORDER) {
      const ids = sortedIds(liveCheck.test[table] || new Set());
      if (ids.length === 0) continue;
      const meta = TABLES[table];
      for (const chunk of chunks(ids, CHUNK_SIZE)) {
        const remaining = await tx[meta.model].findMany({
          where: { [meta.id]: { in: chunk } },
          select: { [meta.id]: true },
        });
        if (remaining.length > 0) {
          throw new Error(`${remaining.length} test row(s) remain in ${table}`);
        }
      }
    }

    const afterCounts = {};
    for (const table of Object.keys(TABLES)) {
      const actual = await tx[TABLES[table].model].count();
      const expected = liveSummary.tables[table].preserve;
      if (actual !== expected) {
        throw new Error(
          `Preserved row count mismatch for ${table}: expected ${expected}, found ${actual}`
        );
      }
      afterCounts[table] = actual;
    }

    return {
      deleted,
      before: liveSummary,
      after: afterCounts,
      guard,
      identity,
    };
  }, { timeout: 180000, maxWait: 15000 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.plan) throw new Error('--plan <path> is required');
  const planPath = assertOutsideRepo(args.plan, 'Plan');
  if (!fs.existsSync(planPath)) throw new Error(`Plan not found: ${planPath}`);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  verifyPlanIntegrity(plan);

  const expectedBranchId = process.env.EXPECTED_NEON_BRANCH_ID;
  if (!expectedBranchId) {
    throw new Error('EXPECTED_NEON_BRANCH_ID is required (production branch guard)');
  }
  if (plan.database.branch_id !== expectedBranchId) {
    throw new Error(
      `Plan branch ${plan.database.branch_id} does not match expected ${expectedBranchId}`
    );
  }

  if (args.execute && process.env.CLEANUP_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Refusing to delete: set CLEANUP_CONFIRM=${CONFIRMATION} to execute`
    );
  }

  const url = validateProductionUrl(process.env.PROD_DATABASE_URL);
  const backup = verifyBackup(plan, args.backup);
  console.log('Plan verified:', { path: planPath, planHash: plan.planHash, rulesVersion: plan.rulesVersion });
  console.log('Backup verified:', backup);

  const prisma = new PrismaClient({ datasourceUrl: process.env.PROD_DATABASE_URL, log: ['error'] });
  try {
    const identity = await getIdentity(prisma);
    if (identity.branch_id !== plan.database.branch_id) {
      throw new Error(
        `Neon branch mismatch: connected to ${identity.branch_id}, plan expects ${plan.database.branch_id}`
      );
    }
    if (identity.database !== plan.database.database || identity.db_user !== plan.database.db_user) {
      throw new Error('Connected database/user does not match the plan');
    }

    const live = await classify(prisma);
    const liveSummary = summarize(live.test, live.totals);
    assertPlanMatchesLive(plan, live.test, liveSummary);
    const guard = await guardCheck(prisma, live.test);
    if (guard.blockers.length > 0) {
      throw new Error(`Foreign-key guard blocked execution: ${guard.blockers.length} blocker(s)`);
    }

    console.log('Live classification matches plan:', {
      testRows: liveSummary.testRows,
      preservedRows: liveSummary.preservedRows,
      tablesWithDeletions: plan.deletionOrder.length,
    });
    console.log('Deletion order:', plan.deletionOrder.map((step) => `${step.table}(${step.count})`).join(' -> '));

    if (!args.execute) {
      console.log('\nDRY RUN: no data was modified. Re-run with --execute and CLEANUP_CONFIRM to delete.');
      return;
    }

    const result = await executeCleanup(prisma, plan, live);
    const report = {
      executedAt: new Date().toISOString(),
      mode: 'EXECUTE',
      planPath,
      planHash: plan.planHash,
      rulesVersion: plan.rulesVersion,
      backup: {
        path: backup.path,
        sizeBytes: backup.sizeBytes,
        sha256: backup.sha256,
        tableDataEntries: backup.tableDataEntries,
      },
      database: {
        host: url.hostname,
        database: result.identity.database,
        branch_id: result.identity.branch_id,
        project_id: result.identity.project_id,
      },
      guard: {
        foreignKeysChecked: result.guard.foreignKeysChecked,
        blockers: result.guard.blockers.length,
      },
      before: result.before.tables,
      after: result.after,
      deleted: result.deleted,
      totalDeleted: Object.values(result.deleted).reduce((sum, count) => sum + count, 0),
      success: true,
    };
    fs.mkdirSync(DEFAULT_ARTIFACT_DIR, { recursive: true });
    const reportPath = path.join(
      DEFAULT_ARTIFACT_DIR,
      `cleanup-execution-${Date.now()}.json`
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

    console.log('\nCleanup committed successfully.');
    console.log('Deleted rows:', report.totalDeleted);
    for (const step of plan.deletionOrder) {
      console.log(`  ${step.table.padEnd(34)} ${result.deleted[step.table]}`);
    }
    console.log('Execution report:', reportPath);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Cleanup failed:', error.message);
  process.exit(1);
});
