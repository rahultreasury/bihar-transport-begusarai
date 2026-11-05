#!/usr/bin/env node
/**
 * ============================================================================
 * Neon Migration State Diagnostic — Read-Only
 * ============================================================================
 * Run this ONCE against Neon to gather all precheck information needed for
 * the production migration recovery.
 *
 * Connection handling:
 *   1. Uses DATABASE_URL from the environment if already set.
 *   2. If not set, securely prompts for the Neon connection string (hidden input).
 *   3. Does NOT silently fall back to localhost.
 *   4. Confirms the connection targets Neon before running diagnostics.
 *   5. Never prints credentials.
 *
 * Prerequisites:
 *   Run: npm run diagnose:production
 *   Or:  node scripts/diagnose-neon-migration-state.js
 *
 * This script does NOT modify any data. It only performs read-only queries.
 * It does NOT print DATABASE_URL or any credentials.
 * ============================================================================

const path = require('path');
let prisma = null;


/**
 * Securely prompt for a connection string without echoing input.
 */
function promptHidden(promptText) {
  return new Promise((resolve) => {
    process.stdout.write(promptText);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    function handler(char) {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdout.write('\n');
        process.exit(0);
      } else if (char === '\u007f') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          // Erase the last character visually
          process.stdout.write('\b \b');
        }
      } else if (char >= ' ' && char <= '~') {
        input += char;
        process.stdout.write('*');
      }
    }
    stdin.on('data', handler);
  });
}

/**
 * Validate that the connection string is a PostgreSQL connection to Neon.
 * Returns an object with { valid: boolean, reason: string, host: string }.
 */
function validateConnectionUrl(url) {
  if (!url || url.trim() === '') {
    return { valid: false, reason: 'Connection string is empty.', host: null };
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { valid: false, reason: 'Invalid URL format.', host: null };
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    return { valid: false, reason: `Invalid protocol: ${parsed.protocol} (expected postgresql:)`, host: parsed.hostname };
  }

  if (!parsed.hostname) {
    return { valid: false, reason: 'No hostname in connection string.', host: null };
  }

  // Check for localhost — reject to prevent silent fallback
  const localhostHosts = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
  if (localhostHosts.includes(parsed.hostname.toLowerCase())) {
    return { valid: false, reason: `Connection targets localhost (${parsed.hostname}). This is not Neon. Set DATABASE_URL to your Neon production connection string.`, host: parsed.hostname };
  }

  // Check for Neon host
  const isNeon = parsed.hostname.includes('neon.tech') || parsed.hostname.includes('neon.');
  if (!isNeon) {
    return { valid: false, reason: `Hostname "${parsed.hostname}" does not appear to be a Neon host. Verify this is your intended production database.`, host: parsed.hostname };
  }

  return { valid: true, reason: 'OK', host: parsed.hostname };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  NEON MIGRATION STATE DIAGNOSTIC — READ-ONLY                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Step 1: Resolve DATABASE_URL ──
  let databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl || databaseUrl.trim() === '') {
    // Check if stdin is a TTY (interactive terminal)
    if (!process.stdin.isTTY) {
      console.error('ERROR: DATABASE_URL is not set and stdin is not an interactive terminal.');
      console.error('');
      console.error('To run this diagnostic securely:');
      console.error('  1. Set DATABASE_URL in your environment:');
      console.error('     export DATABASE_URL="your-neon-connection-string"');
      console.error('  2. Run: npm run diagnose:production');
      console.error('');
      console.error('Or run interactively in a terminal (not piped):');
      console.error('  node scripts/diagnose-neon-migration-state.js');
      console.error('');
      console.error('The script will securely prompt for the connection string.');
      console.error('It will NOT echo the input or print credentials.');
      process.exit(1);
    }

    console.log('DATABASE_URL is not set in the environment.');
    console.log('Please enter your Neon production connection string securely.');
    console.log('(Input will be hidden. Press Enter when done.)');
    console.log('');
    databaseUrl = await promptHidden('Neon connection string: ');
    console.log('');

    if (!databaseUrl || databaseUrl.trim() === '') {
      console.error('ERROR: No connection string provided.');
      console.error('Set DATABASE_URL in your environment or enter it when prompted.');
      process.exit(1);
    }

    // Validate the URL
    const validation = validateConnectionUrl(databaseUrl);
    if (!validation.valid) {
      console.error('ERROR: ' + validation.reason);
      console.error('This diagnostic will not run against localhost or non-Neon hosts.');
      process.exit(1);
    }

    console.log(`Connection target: ${validation.host}`);
    console.log('Connection string accepted (not displayed).');
    console.log('');
  } else {
    // DATABASE_URL is set — validate it
    const validation = validateConnectionUrl(databaseUrl);
    if (!validation.valid) {
      console.error('ERROR: ' + validation.reason);
      console.error('This diagnostic will not run against localhost or non-Neon hosts.');
      console.error('Set DATABASE_URL to your Neon production connection string.');
      process.exit(1);
    }
    console.log(`Connection target: ${validation.host}`);
    console.log('Connection string accepted from environment (not displayed).');
    console.log('');
  }

  // Set the environment variable for Prisma
  process.env.DATABASE_URL = databaseUrl.trim();

  // ── Step 2: Connect and verify ──
  console.log('── Connection Verification ──');
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient({ log: ['error'] });

  try {
    const connInfo = await prisma.$queryRawUnsafe(`
      SELECT 
        inet_server_addr() AS server_addr,
        inet_server_port() AS server_port,
        current_database() AS database_name,
        current_user AS current_user,
        version() AS server_version
    `);
    const ci = connInfo[0];
    console.log(`  Server address: ${ci.server_addr}`);
    console.log(`  Server port: ${ci.server_port}`);
    console.log(`  Database: ${ci.database_name}`);
    console.log(`  User: ${ci.current_user}`);
    console.log(`  PostgreSQL version: ${ci.server_version.split(',')[0]}`);
    console.log('');

    // Verify the connection is to the intended Neon database.
    // NOTE: inet_server_addr() may return 127.0.0.1 when connecting through
    // Neon's connection pooler/proxy. This is informational, not proof of localhost.
    // The primary verification is the connection URL hostname (validated above)
    // and the database name/user matching Neon conventions.
    console.log(`  NOTE: Server address ${ci.server_addr} (may be 127.0.0.1 via Neon proxy — this is normal for pooled connections).`);

    // Verify database name is not a local default
    const localDbNames = ['postgres', 'template0', 'template1', 'bihar_transport_begusarai'];
    if (localDbNames.includes(ci.database_name)) {
      console.error('ERROR: Connected to a local/default database name: ' + ci.database_name);
      console.error('This diagnostic expects a Neon production database.');
      console.error('Verify your DATABASE_URL points to the correct Neon database.');
      try { await prisma.$disconnect(); } catch (_) {}
      process.exit(1);
    }

    // Verify user is not a local default
    const localUsers = ['postgres', 'rahulraj'];
    if (localUsers.includes(ci.current_user)) {
      console.error('ERROR: Connected as a local user: ' + ci.current_user);
      console.error('This diagnostic expects a Neon production user.');
      console.error('Verify your DATABASE_URL points to the correct Neon database.');
      try { await prisma.$disconnect(); } catch (_) {}
      process.exit(1);
    }

    console.log('  Connection confirmed to Neon production database.');
    console.log('  (Hostname validated from connection URL; server_addr may show 127.0.0.1 via Neon proxy.)');
    console.log('');
  } catch (e) {
    console.error('ERROR: Cannot connect to database:', e.message);
    console.error('Verify your Neon connection string and network access.');
    try { await prisma.$disconnect(); } catch (_) {}
    process.exit(1);
  }

  const results = {};

  // ── A.1 Migration history ──
  console.log('\n── A.1 Migration History ──');
  try {
    const migrations = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
      WHERE migration_name IN (
        '20260815000000_create_vehicle_owners',
        '20260818000000_add_transport_owner_to_driver',
        '20260820000000_create_missing_tables',
        '20261018120000_add_assignment_released_event',
        '20261028140000_add_partially_paid_invoice_status',
        '20261028150000_reconcile_schema_equivalence'
      )
      ORDER BY migration_name;
    `);
    results.migrations = migrations;
    console.table(migrations);
  } catch (e) {
    console.error('ERROR reading migration history:', e.message);
  }

  // ── A.2 vehicle_owners columns ──
  console.log('\n── A.2 vehicle_owners Columns ──');
  try {
    const columns = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vehicle_owners'
      ORDER BY ordinal_position;
    `);
    results.vehicleOwnerColumns = columns;
    console.table(columns);
    console.log(`Column count: ${columns.length}`);
  } catch (e) {
    console.error('ERROR reading vehicle_owners columns:', e.message);
  }

  // ── A.3 vehicle_owners indexes and constraints ──
  console.log('\n── A.3 vehicle_owners Indexes ──');
  try {
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'vehicle_owners'
      ORDER BY indexname;
    `);
    results.vehicleOwnerIndexes = indexes;
    console.table(indexes);
  } catch (e) {
    console.error('ERROR reading vehicle_owners indexes:', e.message);
  }

  console.log('\n── A.3 vehicle_owners Constraints ──');
  try {
    const constraints = await prisma.$queryRawUnsafe(`
      SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
             ccu.table_name AS referenced_table, ccu.column_name AS referenced_column,
             rc.delete_rule, rc.update_rule
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name = 'vehicle_owners';
    `);
    results.vehicleOwnerConstraints = constraints;
    console.table(constraints);
  } catch (e) {
    console.error('ERROR reading vehicle_owners constraints:', e.message);
  }

  // ── A.4 drivers — transport_owner_id ──
  console.log('\n── A.4 drivers.transport_owner_id Column ──');
  try {
    const col = await prisma.$queryRawUnsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'drivers' AND column_name = 'transport_owner_id';
    `);
    results.driverTransportOwnerColumn = col;
    console.table(col);
  } catch (e) {
    console.error('ERROR reading drivers.transport_owner_id:', e.message);
  }

  console.log('\n── A.4 drivers.transport_owner_id Index ──');
  try {
    const idx = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'drivers' AND indexname = 'idx_drivers_transport_owner';
    `);
    results.driverTransportOwnerIndex = idx;
    console.table(idx);
  } catch (e) {
    console.error('ERROR reading drivers.transport_owner_id index:', e.message);
  }

  console.log('\n── A.4 drivers.transport_owner_id FK ──');
  try {
    const fk = await prisma.$queryRawUnsafe(`
      SELECT tc.constraint_name, rc.delete_rule, rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_schema = 'public' AND tc.table_name = 'drivers'
        AND tc.constraint_name = 'drivers_transport_owner_id_fkey';
    `);
    results.driverTransportOwnerFK = fk;
    console.table(fk);
  } catch (e) {
    console.error('ERROR reading drivers FK:', e.message);
  }

  // ── A.5 Enum types and values ──
  console.log('\n── A.5 Enum Types ──');
  try {
    const enums = await prisma.$queryRawUnsafe(`
      SELECT typname
      FROM pg_type
      WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY typname;
    `);
    results.enumTypes = enums;
    console.table(enums);
    console.log(`Total enum types: ${enums.length}`);
  } catch (e) {
    console.error('ERROR reading enum types:', e.message);
  }

  console.log('\n── A.5 Enum Values (10 types from create_missing_tables + disputed) ──');
  try {
    const enumValues = await prisma.$queryRawUnsafe(`
      SELECT t.typname, e.enumlabel, e.enumsortorder
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND t.typname IN (
          'TripStatus', 'TripPaymentType', 'TripPaymentCategory', 'TripFinancialStatus',
          'AdvanceType', 'TransactionDirection', 'PaymentStatus',
          'trip_expense_type', 'expense_paid_by', 'FinancialTransactionType', 'TransactionParty',
          'EnquiryEventType', 'InvoiceStatus', 'LedgerTransactionType', 'UserRole'
        )
      ORDER BY t.typname, e.enumsortorder;
    `);
    results.enumValues = enumValues;
    console.table(enumValues);
  } catch (e) {
    console.error('ERROR reading enum values:', e.message);
  }

  // ── A.6 Tables from create_missing_tables ──
  console.log('\n── A.6 Tables from create_missing_tables ──');
  try {
    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'trips', 'trip_payments', 'trip_financials', 'trip_settlements',
          'trip_advances', 'commission_records', 'financial_transactions',
          'audit_logs', 'trip_expenses', 'vehicle_assignments', 'partner_applications'
        )
      ORDER BY table_name;
    `);
    results.createMissingTables = tables;
    console.table(tables);
    console.log(`Table count: ${tables.length}`);
  } catch (e) {
    console.error('ERROR reading tables:', e.message);
  }

  // ── A.7 Complete schema for all 11 tables from create_missing_tables ──
  const elevenTables = [
    'trips', 'trip_payments', 'trip_financials', 'trip_settlements',
    'trip_advances', 'commission_records', 'financial_transactions',
    'audit_logs', 'trip_expenses', 'vehicle_assignments', 'partner_applications'
  ];

  for (const tbl of elevenTables) {
    console.log(`\n── A.7 ${tbl}: Columns ──`);
    try {
      const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, tbl);
      results[`${tbl}_columns`] = cols;
      console.table(cols);
    } catch (e) {
      console.error(`ERROR reading ${tbl} columns:`, e.message);
    }

    console.log(`\n── A.7 ${tbl}: Indexes ──`);
    try {
      const idxs = await prisma.$queryRawUnsafe(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname;
      `, tbl);
      results[`${tbl}_indexes`] = idxs;
      console.table(idxs);
    } catch (e) {
      console.error(`ERROR reading ${tbl} indexes:`, e.message);
    }

    console.log(`\n── A.7 ${tbl}: Constraints ──`);
    try {
      const cons = await prisma.$queryRawUnsafe(`
        SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
               ccu.table_name AS referenced_table, ccu.column_name AS referenced_column,
               rc.delete_rule, rc.update_rule
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_schema = 'public' AND tc.table_name = $1;
      `, tbl);
      results[`${tbl}_constraints`] = cons;
      console.table(cons);
    } catch (e) {
      console.error(`ERROR reading ${tbl} constraints:`, e.message);
    }
  }

  // ── A.8 vehicle_owners sequence ownership ──
  console.log('\n── A.8 vehicle_owners Sequence ──');
  try {
    const seq = await prisma.$queryRawUnsafe(`
      SELECT pg_get_serial_sequence('vehicle_owners', 'owner_id') AS sequence_name;
    `);
    results.vo_sequence = seq;
    console.table(seq);
    if (seq[0]?.sequence_name) {
      const seqOwner = await prisma.$queryRawUnsafe(`
        SELECT s.relname AS sequence_name, t.relname AS owned_table, a.attname AS owned_column
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relname = $1 AND s.relkind = 'S';
      `, seq[0].sequence_name.split('.').pop());
      results.vo_seq_owner = seqOwner;
      console.table(seqOwner);
    }
  } catch (e) {
    console.error('ERROR reading vehicle_owners sequence:', e.message);
  }

  // ── A.9 drivers columns that reconcile migration drops ──
  console.log('\n── A.9 drivers.vehicle_number / vehicle_type Data Check ──');
  try {
    // First check which columns exist
    const colCheck = await prisma.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'drivers'
        AND column_name IN ('vehicle_number', 'vehicle_type');
    `);
    const existingCols = colCheck.map(r => r.column_name);
    console.log(`  Existing legacy columns: ${existingCols.length > 0 ? existingCols.join(', ') : 'NONE'}`);

    // Build query dynamically based on existing columns
    let selectParts = ['COUNT(*) AS total_rows'];
    if (existingCols.includes('vehicle_number')) {
      selectParts.push('COUNT(vehicle_number) AS rows_with_vehicle_number');
    } else {
      selectParts.push('0 AS rows_with_vehicle_number');
      console.log('  vehicle_number: ABSENT (already dropped)');
    }
    if (existingCols.includes('vehicle_type')) {
      selectParts.push('COUNT(vehicle_type) AS rows_with_vehicle_type');
    } else {
      selectParts.push('0 AS rows_with_vehicle_type');
      console.log('  vehicle_type: ABSENT (already dropped)');
    }

    const drvData = await prisma.$queryRawUnsafe(`
      SELECT ${selectParts.join(', ')} FROM drivers;
    `);
    results.drivers_legacy_data = drvData;
    console.table(drvData);
  } catch (e) {
    console.error('ERROR reading drivers legacy data:', e.message);
  }

  // ── A.10a Enum type used by trip_expenses columns ──
  console.log('\n── A.10a trip_expenses Column Enum Types ──');
  try {
    const colEnums = await prisma.$queryRawUnsafe(`
      SELECT c.column_name, c.data_type, c.udt_name,
             t.typname AS enum_type_name
      FROM information_schema.columns c
      LEFT JOIN pg_type t ON t.typname = c.udt_name
      WHERE c.table_schema = 'public' AND c.table_name = 'trip_expenses'
        AND c.column_name IN ('expense_type', 'paid_by');
    `);
    results.trip_expenses_col_enums = colEnums;
    console.table(colEnums);
    console.log('  NOTE: udt_name shows the actual PostgreSQL type. For enums, this is the enum type name.');
  } catch (e) {
    console.error('ERROR reading trip_expenses column enums:', e.message);
  }

  // ── A.10 trips.source_type distinct values ──
  console.log('\n── A.10 trips.source_type Distinct Values ──');
  try {
    const srcTypes = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT source_type, COUNT(*) AS row_count
      FROM trips
      GROUP BY source_type
      ORDER BY source_type;
    `);
    results.trips_source_types = srcTypes;
    console.table(srcTypes);
  } catch (e) {
    console.error('ERROR reading trips source_type values:', e.message);
  }

  // ── A.11 Enum values (complete) ──
  console.log('\n── A.11 Complete Enum Definitions ──');
  try {
    const allEnumValues = await prisma.$queryRawUnsafe(`
      SELECT t.typname, e.enumlabel, e.enumsortorder
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY t.typname, e.enumsortorder;
    `);
    results.allEnumValues = allEnumValues;
    console.table(allEnumValues);
  } catch (e) {
    console.error('ERROR reading all enum values:', e.message);
  }

  // ── A.12 Complete migration history ──
  console.log('\n── A.12 Complete Migration History ──');
  try {
    const allMigrations = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, checksum
      FROM "_prisma_migrations"
      ORDER BY migration_name;
    `);
    results.allMigrations = allMigrations;
    console.table(allMigrations);
  } catch (e) {
    console.error('ERROR reading full migration history:', e.message);
  }


  // ── A.13 Local migration directories vs Neon history ──
  console.log('\n── A.13 Local Migration Directories ──');
  try {
    const fs = require('fs');
    const pathMod = require('path');
    const migrationsDir = pathMod.join(__dirname, '..', 'prisma', 'migrations');
    const localDirs = fs.readdirSync(migrationsDir)
      .filter(d => {
        try { return fs.statSync(pathMod.join(migrationsDir, d)).isDirectory(); } catch { return false; }
      })
      .sort();
    results.localMigrationDirs = localDirs;
    console.log(`  Local migration directories: ${localDirs.length}`);
    
    // Compare with Neon history
    const neonNames = (results.allMigrations || []).map(m => m.migration_name);
    const localOnly = localDirs.filter(d => !neonNames.includes(d));
    const neonOnly = neonNames.filter(n => !localDirs.includes(n));
    const inBoth = localDirs.filter(d => neonNames.includes(d));
    
    console.log(`  In both local and Neon: ${inBoth.length}`);
    console.log(`  Local only (not in Neon): ${localOnly.length}`);
    localOnly.forEach(d => console.log(`    - ${d}`));
    console.log(`  Neon only (not local): ${neonOnly.length}`);
    neonOnly.forEach(n => console.log(`    - ${n}`));
  } catch (e) {
    console.error('ERROR reading local migration directories:', e.message);
  }

  // ── A.14 Enum type used by each relevant column ──
  console.log('\n── A.14 Column-to-Enum Mapping ──');
  try {
    const colEnumMap = await prisma.$queryRawUnsafe(`
      SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
             t.typname AS resolved_enum_type
      FROM information_schema.columns c
      LEFT JOIN pg_type t ON t.typname = c.udt_name AND t.typtype = 'e'
      WHERE c.table_schema = 'public'
        AND c.table_name IN ('trip_expenses', 'trips', 'financial_transactions', 'trip_financials')
        AND c.data_type = 'USER-DEFINED'
      ORDER BY c.table_name, c.ordinal_position;
    `);
    results.colEnumMap = colEnumMap;
    console.table(colEnumMap);
  } catch (e) {
    console.error('ERROR reading column-enum mapping:', e.message);
  }


  // ── Migration status classification (inlined to avoid scope issues) ──
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

  // ── Summary ──
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY                                                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  // ── Migration status classification ──
  // A migration may have multiple history records (failed, rolled-back, successful).
  // Classify based on ALL records, not just the first one returned by .find().
  function classifyMigrationWrapped(name) {
    const records = (results.migrations || []).filter(m => m.migration_name === name);
    return { status: classifyMigration(records), records };
  }

  const vCOwnersClass = classifyMigrationWrapped('20260815000000_create_vehicle_owners');
  const vDriverFKClass = classifyMigrationWrapped('20260818000000_add_transport_owner_to_driver');
  const createMissingClass = classifyMigrationWrapped('20260820000000_create_missing_tables');
  const assignReleasedClass = classifyMigrationWrapped('20261018120000_add_assignment_released_event');
  const partiallyPaidClass = classifyMigrationWrapped('20261028140000_add_partially_paid_invoice_status');
  const reconcileClass = classifyMigrationWrapped('20261028150000_reconcile_schema_equivalence');

  // Pending = migrations with NO successful record
  const allMigrationNames = [
    '20260815000000_create_vehicle_owners',
    '20260818000000_add_transport_owner_to_driver',
    '20260820000000_create_missing_tables',
    '20261018120000_add_assignment_released_event',
    '20261028140000_add_partially_paid_invoice_status',
    '20261028150000_reconcile_schema_equivalence'
  ];
  const pending = getPendingMigrations(allMigrationNames, results.migrations || []);

  console.log(`\n20260815000000_create_vehicle_owners:`);
  console.log(`  Records: ${vCOwnersClass.records.length}`);
  vCOwnersClass.records.forEach(r => console.log(`    finished_at=${r.finished_at}, rolled_back_at=${r.rolled_back_at}, steps=${r.applied_steps_count}`));
  console.log(`  Status: ${vCOwnersClass.status}${vCOwnersClass.status === 'FAILED' ? ' (needs resolve after verification)' : ''}`);

  console.log(`\n20260818000000_add_transport_owner_to_driver:`);
  console.log(`  Records: ${vDriverFKClass.records.length}`);
  vDriverFKClass.records.forEach(r => console.log(`    finished_at=${r.finished_at}, rolled_back_at=${r.rolled_back_at}, steps=${r.applied_steps_count}`));
  console.log(`  Status: ${vDriverFKClass.status}${vDriverFKClass.status === 'APPLIED' ? ' (preserve — do NOT resolve again)' : ''}`);

  console.log(`\n20260820000000_create_missing_tables: ${createMissingClass.status}`);
  console.log(`20261018120000_add_assignment_released_event: ${assignReleasedClass.status}`);
  console.log(`20261028140000_add_partially_paid_invoice_status: ${partiallyPaidClass.status}`);
  console.log(`20261028150000_reconcile_schema_equivalence: ${reconcileClass.status}`);

  console.log(`\nPending migrations (no successful record): ${pending.length}`);
  pending.forEach(name => console.log(`  - ${name} (${classifyMigrationWrapped(name).status})`));

  const fkRule = results.driverTransportOwnerFK?.[0];
  if (fkRule) {
    console.log(`\ndrivers_transport_owner_id_fkey delete_rule: ${fkRule.delete_rule}`);
    console.log(`  Expected: RESTRICT (matches Prisma schema)`);
    console.log(`  Match: ${fkRule.delete_rule === 'RESTRICT' ? 'YES' : 'NO — MISMATCH'}`);
  }

  const assignmentReleased = results.enumValues?.filter(e => e.typname === 'EnquiryEventType' && e.enumlabel === 'ASSIGNMENT_RELEASED');
  const partiallyPaid = results.enumValues?.filter(e => e.typname === 'InvoiceStatus' && e.enumlabel === 'PARTIALLY_PAID');
  console.log(`\nASSIGNMENT_RELEASED in EnquiryEventType: ${assignmentReleased?.length ? 'EXISTS (migration will fail)' : 'NOT FOUND (migration needed)'}`);
  console.log(`PARTIALLY_PAID in InvoiceStatus: ${partiallyPaid?.length ? 'EXISTS (migration will fail)' : 'NOT FOUND (migration needed)'}`);

  console.log(`\nTables from create_missing_tables: ${results.createMissingTables?.length ?? 0} of 11`);
  console.log(`vehicle_owners columns: ${results.vehicleOwnerColumns?.length ?? 0}`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('Diagnostic complete. Share this output to proceed with recovery.');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main()
  .catch(async (e) => {
    console.error('FATAL:', e.message);
    if (prisma) {
      try { await prisma.$disconnect(); } catch (_) {}
    }
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      try { await prisma.$disconnect(); } catch (_) {}
    }
  });