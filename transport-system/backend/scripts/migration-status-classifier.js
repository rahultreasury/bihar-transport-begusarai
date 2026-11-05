/**
 * Migration status classification for Prisma migration history.
 *
 * A migration may have multiple history records (failed, rolled-back, successful).
 * Classification is based on ALL records, not just the first one.
 */

function classifyMigration(records) {
  if (!records || records.length === 0) return 'ABSENT';
  const hasSuccess = records.some(r => r.finished_at !== null && r.rolled_back_at === null);
  const hasFailed = records.some(r => r.finished_at === null && r.rolled_back_at === null);
  const hasRolledBack = records.some(r => r.rolled_back_at !== null);
  if (hasSuccess) return 'APPLIED';
  if (hasFailed) return 'FAILED';
  if (hasRolledBack) return 'ROLLED_BACK';
  return 'UNKNOWN';
}

function getPendingMigrations(allMigrationNames, migrationRecords) {
  return allMigrationNames.filter(name => {
    const records = (migrationRecords || []).filter(m => m.migration_name === name);
    return classifyMigration(records) !== 'APPLIED';
  });
}

module.exports = { classifyMigration, getPendingMigrations };
