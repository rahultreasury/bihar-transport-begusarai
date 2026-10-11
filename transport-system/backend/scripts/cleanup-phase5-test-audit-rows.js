/**
 * cleanup-phase5-test-audit-rows.js
 * ---------------------------------------------------------------------------
 * ONE-OFF REMEDIATION — run once, then this file is spent.
 *
 * WHAT HAPPENED
 *   `AuditLogRepository` and `TripTimelineRepository` reached for the
 *   module-level `prisma` singleton instead of the client injected into the
 *   service that owns them. `TripTrackingService.recordMovement()` wrote its
 *   audit entry through that path, so running the Phase 5 unit suite with an
 *   injected test double still committed the audit rows to the REAL database.
 *
 *   That put 77 rows in `audit_logs` with `action = 'trip_movement_recorded'`
 *   whose `new_value` carries the unit test's fixture strings.
 *
 * WHY IT IS SAFE TO DELETE
 *   1. `trip_movement_recorded` is a Phase-5-only action. It is not written by
 *      any other code path in the repository.
 *   2. Phase 5 has never been released: `trips` had 0 rows with a position and
 *      0 rows with an ETA, and `trip_timeline` had 0 movement events. So no
 *      genuine movement has ever been recorded, and therefore no genuine
 *      movement audit can exist.
 *   3. The delete is restricted to an EXACT allow-list of the fixture note
 *      strings used by tests/phase5TransitTracking.test.js. Anything else is
 *      left alone.
 *
 * A full backup of the affected rows is written to
 * backups/phase5-test-audit-rows-<timestamp>.json before anything is removed.
 *
 * Usage:  node scripts/cleanup-phase5-test-audit-rows.js [--dry-run]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const ACTION = 'trip_movement_recorded';

/** The exact `notes` values used by the Phase 5 unit test fixtures. */
const TEST_FIXTURE_NOTES = [
  'A',
  'B',
  'Crossing Son Bridge',
  'Near the yard',
  'At the gate',
  'Near Patna',
];

function parseNotes(newValue) {
  try {
    const meta = JSON.parse(newValue);
    return meta && Object.prototype.hasOwnProperty.call(meta, 'notes') ? meta.notes : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const candidates = await prisma.auditLog.findMany({
    where: { action: ACTION },
    orderBy: { audit_id: 'asc' },
  });

  // Only the ones that are unambiguously test artefacts.
  const polluted = candidates.filter((row) => {
    const notes = parseNotes(row.new_value);
    return notes !== undefined && TEST_FIXTURE_NOTES.includes(notes);
  });

  const suspects = candidates.filter((row) => !polluted.includes(row));

  console.log(`rows with action='${ACTION}': ${candidates.length}`);
  console.log(`  identifiable as test artefacts : ${polluted.length}`);
  console.log(`  left untouched (not fixtures)  : ${suspects.length}`);

  if (suspects.length) {
    console.log('\nRows deliberately NOT deleted:');
    for (const row of suspects) {
      console.log(`  audit_id=${row.audit_id} notes=${JSON.stringify(parseNotes(row.new_value))}`);
    }
  }

  if (!polluted.length) {
    console.log('\nNothing to clean.');
    return;
  }

  // ── Backup before deleting ────────────────────────────────────────────────
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `phase5-test-audit-rows-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(polluted, null, 2));
  console.log(`\nBackup written: ${file}`);

  if (dryRun) {
    console.log('DRY RUN — nothing deleted.');
    return;
  }

  const ids = polluted.map((r) => r.audit_id);
  const result = await prisma.auditLog.deleteMany({ where: { audit_id: { in: ids } } });
  console.log(`Deleted ${result.count} test-generated audit rows.`);

  const remaining = await prisma.auditLog.count({ where: { action: ACTION } });
  console.log(`Remaining '${ACTION}' rows: ${remaining}`);

  const total = await prisma.auditLog.count();
  console.log(`Total audit rows now: ${total}`);
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
