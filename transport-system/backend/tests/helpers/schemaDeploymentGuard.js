/**
 * tests/helpers/schemaDeploymentGuard.js
 * ============================================================================
 * REGRESSION GUARD — the production 500 that broke /admin/vehicles and
 * /admin/enquiries on 2026-10-04.
 *
 * WHAT WENT WRONG
 *   schema.prisma declared columns that only two UNDEPLOYED migrations create:
 *     • Enquiry.quotation_id            -> phase_b_quotation_module
 *     • TransportVehicle.tax_number …   -> vehicle_hire_rate_basis_and_documents
 *   Render runs `prisma migrate deploy`, which only applies COMMITTED
 *   migrations, so production never got those columns while the generated
 *   Prisma Client still SELECTed them. Every prisma.transportVehicle /
 *   prisma.enquiry query then failed with Prisma P2022 -> HTTP 500.
 *
 * WHY A LOCAL DATABASE TEST WOULD HAVE MISSED IT
 *   The developer database already had those migrations applied. This guard
 *   therefore opens NO database connection: it compares schema.prisma against
 *   the migration SQL that is actually COMMITTED to git, which is precisely
 *   what production will run.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(BACKEND, '..', '..');
const SCHEMA_PATH = path.join(BACKEND, 'prisma', 'schema.prisma');

/** The migrations Render can actually apply = the ones committed to git. */
let _committed = null;
function committedMigrationSql() {
  if (_committed) return _committed; // memoised: it shells out to git per migration

  const listing = execSync(
    `git -C ${REPO} ls-tree --name-only HEAD transport-system/backend/prisma/migrations/`,
    { maxBuffer: 1e8 }
  ).toString().trim().split('\n')
    .map((d) => d.split('/').pop())
    .filter((d) => d !== 'migration_lock.toml');

  let sql = '';
  for (const d of listing) {
    try {
      sql += execSync(
        `git -C ${REPO} show HEAD:transport-system/backend/prisma/migrations/${d}/migration.sql`,
        { maxBuffer: 1e8 }
      ).toString() + '\n';
    } catch (e) { /* a directory with no migration.sql */ }
  }
  _committed = { sql, count: listing.length };
  return _committed;
}

/** Extract a model's full block from the schema text. */
function modelBlock(schema, name) {
  const re = new RegExp(`^model ${name} \\{`, 'm');
  const m = schema.match(re);
  if (!m) return null;
  const start = schema.indexOf(m[0]);
  let depth = 0;
  for (let i = start; i < schema.length; i++) {
    if (schema[i] === '{') depth++;
    else if (schema[i] === '}') { depth--; if (depth === 0) return schema.slice(start, i + 1); }
  }
  return null;
}

/** Scalar column names declared on a model (relations and attributes skipped). */
function scalarColumns(schema, name) {
  const block = modelBlock(schema, name);
  if (!block) return null;
  const out = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+(Int|String|Boolean|Float|DateTime|Json|Decimal|BigInt|Bytes)/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The models the two broken admin screens read. */
const AFFECTED_MODELS = [
  'Enquiry', 'EnquiryEvent', 'TransportVehicle', 'VehicleOwner',
  'Driver', 'Booking', 'Invoice', 'Client', 'Partner', 'Admin', 'User', 'Trip',
];

/** Columns Loading -> Dispatch requires (Phase 4 migrations + phase 9 dispatch). */
const LOADING_DISPATCH_COLUMNS = [
  'sent_to_loading_at', 'arrived_at_loading_at', 'loading_started_at', 'loading_completed_at',
  'loading_remarks', 'loaded_by', 'dispatched_at', 'actual_quantity', 'actual_quantity_unit',
  'actual_weight_kg', 'documents_required', 'pod_required', 'insurance_required', 'value_of_goods',
];

/**
 * The last commit that production ran WITHOUT the 500. Anything its schema
 * already declared is, by definition, a column production has and serves
 * today — even when no committed migration mentions it, because several
 * pre-existing tables were created outside the migration history.
 *
 * This is what stops the guard from crying wolf about `vehicle_code`,
 * `trip_number`, `owner_code` and friends.
 */
const LAST_KNOWN_GOOD = '8937f99';

/** Columns declared by the last known-good deployed schema. */
function lastKnownGoodColumns(model) {
  try {
    const src = execSync(
      `git -C ${REPO} show ${LAST_KNOWN_GOOD}:transport-system/backend/prisma/schema.prisma`,
      { maxBuffer: 1e8 }
    ).toString();
    return scalarColumns(src, model);
  } catch (e) {
    return null;
  }
}

const readSchema = () => fs.readFileSync(SCHEMA_PATH, 'utf8');

/**
 * A declared column is SAFE when production is known to have it:
 *   - a committed migration creates it, OR
 *   - the last known-good deployed schema already declared it.
 * It is AT RISK only when neither is true — that is precisely the defect that
 * took /admin/vehicles and /admin/enquiries down.
 */
function atRiskColumns(model) {
  const declared = scalarColumns(readSchema(), model);
  if (!declared) return null;
  const knownGood = lastKnownGoodColumns(model) || [];
  const sql = committedMigrationSql().sql;
  return declared.filter((c) => !new RegExp(`"${c}"`).test(sql) && !knownGood.includes(c));
}

module.exports = {
  committedMigrationSql,
  modelBlock,
  scalarColumns,
  lastKnownGoodColumns,
  atRiskColumns,
  AFFECTED_MODELS,
  LOADING_DISPATCH_COLUMNS,
  LAST_KNOWN_GOOD,
  SCHEMA_PATH,
  readSchema: () => fs.readFileSync(SCHEMA_PATH, 'utf8'),
};