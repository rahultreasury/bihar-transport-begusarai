/**
 * tests/adminVehiclesEnquiriesSchema.test.js
 * ============================================================================
 * REGRESSION COVERAGE for the production 500 that broke
 *   GET /api/admin/vehicles   -> "Unable to load vehicles" (HTTP 500)
 *   GET /api/admin/enquiries  -> "Internal server error"      (HTTP 500)
 *
 * WHY A NORMAL DATABASE TEST IS NOT ENOUGH
 *   The developer database has migrations applied that production does not, so
 *   querying it proves nothing. These tests assert the thing that actually
 *   broke: **schema.prisma must not declare a column that production has
 *   never received.** They open no database connection and cannot be fooled by
 *   local database state.
 *
 * A column counts as SAFE when production is known to have it — either a
 * committed migration creates it, or the last known-good deployed schema
 * already declared it (several pre-existing tables were created outside the
 * migration history). It is AT RISK only when neither is true, which is
 * exactly the defect that took both admin screens down.
 *
 * They also assert the positive half: Loading -> Dispatch columns are still
 * declared AND still backed, so this guard can never be "fixed" by deleting
 * something Loading -> Dispatch needs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  committedMigrationSql,
  modelBlock,
  scalarColumns,
  atRiskColumns,
  AFFECTED_MODELS,
  LOADING_DISPATCH_COLUMNS,
  LAST_KNOWN_GOOD,
  readSchema,
} = require('./helpers/schemaDeploymentGuard');

const schema = readSchema();
const { sql: migrationSql, count: migrationCount } = committedMigrationSql();
const isBackedByMigration = (c) => new RegExp(`"${c}"`).test(migrationSql);

/* ========================================================================== */
test(`the committed migration set is what production runs (${migrationCount} migrations)`, () => {
  assert.ok(migrationCount >= 29, `expected the tracked migrations, found ${migrationCount}`);
  assert.match(migrationSql, /TO_LOADING_POINT/, 'phase 4 TripStatus migration must be committed');
  assert.match(migrationSql, /trip_documents/, 'phase 4 trip_documents migration must be committed');
  assert.match(migrationSql, /trip_dispatches/, 'phase 9 dispatch migration must be committed');
});

/* ========================================================================== */
test(`ADMIN VEHICLES — no declared column is missing from production (baseline ${LAST_KNOWN_GOOD})`, () => {
  const columns = scalarColumns(schema, 'TransportVehicle');
  assert.ok(columns, 'model TransportVehicle must exist');

  assert.deepEqual(
    atRiskColumns('TransportVehicle'),
    [],
    'TransportVehicle declares columns production has never received; every ' +
    'prisma.transportVehicle query (GET /api/admin/vehicles) fails with P2022'
  );

  // The exact regression: these six came from an un-deployed Vehicle Hire
  // migration and took /admin/vehicles down.
  for (const gone of [
    'tax_number', 'tax_expiry',
    'fitness_number', 'fitness_expiry',
    'national_permit_number', 'national_permit_expiry',
  ]) {
    assert.ok(
      !columns.includes(gone),
      `${gone} is created only by the un-deployed Vehicle Hire migration and must not be declared`
    );
  }
});

/* ========================================================================== */
test('ADMIN VEHICLES — the relations and columns the vehicle query reads are intact', () => {
  const columns = scalarColumns(schema, 'TransportVehicle');
  const block = modelBlock(schema, 'TransportVehicle');

  // adminRoutes.js includes these relations; they must survive any schema edit.
  for (const relation of ['owner', 'driver', 'sourcePartner']) {
    assert.match(
      block,
      new RegExp(`\\n\\s{2}${relation}\\s`),
      `TransportVehicle.${relation} is included by GET /api/admin/vehicles and must remain declared`
    );
  }
  // The handler filters and sorts on these.
  for (const column of ['current_status', 'is_available', 'created_at', 'vehicle_number']) {
    assert.ok(columns.includes(column), `TransportVehicle.${column} is required by the vehicle query`);
  }
});

/* ========================================================================== */
test(`ADMIN ENQUIRIES — no declared column is missing from production (baseline ${LAST_KNOWN_GOOD})`, () => {
  const columns = scalarColumns(schema, 'Enquiry');
  assert.ok(columns, 'model Enquiry must exist');

  assert.deepEqual(
    atRiskColumns('Enquiry'),
    [],
    'Enquiry declares columns production has never received; every prisma.enquiry ' +
    'query (GET /api/admin/enquiries) fails with P2022'
  );

  // The exact regression: this came from the un-deployed Quotation migration.
  assert.ok(
    !columns.includes('quotation_id'),
    'quotation_id is created only by the un-deployed phase_b quotation migration and must not be declared'
  );
});

/* ========================================================================== */
test('ADMIN ENQUIRIES — the enquiry list relations are intact', () => {
  const block = modelBlock(schema, 'Enquiry');
  assert.ok(block, 'model Enquiry must exist');
  for (const relation of ['customer', 'events', 'booking', 'assignedOwner', 'assignedVehicle', 'assignedDriver', 'assignedPartner']) {
    assert.match(
      block,
      new RegExp(`\\n\\s{2}${relation}\\s`),
      `Enquiry.${relation} is required by GET /api/admin/enquiries and must remain declared`
    );
  }
  // EnquiryEvent must still point back at Enquiry.
  const eventBlock = modelBlock(schema, 'EnquiryEvent');
  assert.match(eventBlock, /enquiry_id/, 'EnquiryEvent.enquiry_id must remain declared');
  assert.match(eventBlock, /enquiry\s+Enquiry\s+@relation/, 'EnquiryEvent.enquiry relation must remain declared');
});

/* ========================================================================== */
test('every model these two screens read is free of at-risk columns', () => {
  const problems = [];
  for (const model of AFFECTED_MODELS) {
    if (!modelBlock(schema, model)) { problems.push(`${model}: model missing`); continue; }
    const risk = atRiskColumns(model);
    if (risk.length) problems.push(`${model}: ${risk.join(', ')}`);
  }
  assert.deepEqual(problems, [], `models declaring columns production does not have -> ${problems.join(' | ')}`);
});

/* ========================================================================== */
test('LOADING -> DISPATCH is unchanged: its columns are declared and backed', () => {
  const trip = scalarColumns(schema, 'Trip');
  assert.ok(trip, 'model Trip must exist');

  const missing = LOADING_DISPATCH_COLUMNS.filter((c) => !trip.includes(c));
  assert.deepEqual(missing, [], `Loading/Dispatch columns must remain declared; missing: ${missing.join(', ')}`);

  const unbacked = LOADING_DISPATCH_COLUMNS.filter((c) => !isBackedByMigration(c));
  assert.deepEqual(
    unbacked,
    [],
    `Loading/Dispatch columns must be created by a committed migration; unbacked: ${unbacked.join(', ')}`
  );

  assert.deepEqual(
    atRiskColumns('Trip'),
    [],
    'Trip must declare no column production has never received'
  );
});

/* ========================================================================== */
test('LOADING -> DISPATCH state machine values are still declared', () => {
  for (const status of ['TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED']) {
    assert.match(schema, new RegExp(status), `TripStatus.${status} must remain declared`);
  }
});