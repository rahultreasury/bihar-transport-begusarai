const { classifyMigration, getPendingMigrations } = require('../scripts/migration-status-classifier');

// Test classifyMigration
console.log('Testing classifyMigration...');

// ABSENT: no records
console.assert(classifyMigration([]) === 'ABSENT', 'Empty records should be ABSENT');
console.assert(classifyMigration(null) === 'ABSENT', 'Null records should be ABSENT');
console.assert(classifyMigration(undefined) === 'ABSENT', 'Undefined records should be ABSENT');

// FAILED: failed record only
console.assert(
  classifyMigration([{ finished_at: null, rolled_back_at: null }]) === 'FAILED',
  'Failed-only should be FAILED'
);

// ROLLED_BACK: only rolled-back records
console.assert(
  classifyMigration([{ finished_at: null, rolled_back_at: new Date() }]) === 'ROLLED_BACK',
  'Rolled-back-only should be ROLLED_BACK'
);

// APPLIED: successful record
console.assert(
  classifyMigration([{ finished_at: new Date(), rolled_back_at: null }]) === 'APPLIED',
  'Successful record should be APPLIED'
);

// APPLIED: rolled-back + successful (August 18 scenario)
console.assert(
  classifyMigration([
    { finished_at: null, rolled_back_at: new Date() },
    { finished_at: new Date(), rolled_back_at: null }
  ]) === 'APPLIED',
  'Rolled-back + successful should be APPLIED (not ROLLED_BACK)'
);

// FAILED: failed record, no successful
console.assert(
  classifyMigration([
    { finished_at: null, rolled_back_at: null },
    { finished_at: null, rolled_back_at: new Date() }
  ]) === 'FAILED',
  'Failed + rolled-back (no success) should be FAILED'
);

// Test getPendingMigrations
console.log('Testing getPendingMigrations...');

const allNames = ['mig_a', 'mig_b', 'mig_c'];
const records = [
  { migration_name: 'mig_a', finished_at: new Date(), rolled_back_at: null },
  { migration_name: 'mig_b', finished_at: null, rolled_back_at: null },
];

const pending = getPendingMigrations(allNames, records);
console.assert(pending.length === 2, `Expected 2 pending, got ${pending.length}`);
console.assert(pending.includes('mig_b'), 'mig_b should be pending');
console.assert(pending.includes('mig_c'), 'mig_c (absent) should be pending');
console.assert(!pending.includes('mig_a'), 'mig_a (applied) should not be pending');

console.log('All tests passed!');
