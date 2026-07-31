#!/usr/bin/env node
/**
 * ============================================================
 * Bihar Transport Begusarai — SQLite → PostgreSQL Migration
 * Phase 3 — One-time data copy script
 * ============================================================
 *
 * This script reads all data from the existing SQLite database
 * and inserts it into the PostgreSQL database via Prisma.
 *
 * - Preserves all primary keys, foreign keys, and relationships
 * - Uses transactions with rollback on failure
 * - Skips duplicate rows if rerun (idempotent via ON CONFLICT)
 * - Does NOT modify any application code
 * - SQLite remains the production database
 *
 * Usage: node scripts/migrate-sqlite-to-postgres.js
 * ============================================================
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const pg = require('pg');

// ============================================================
// Configuration
// ============================================================
const SQLITE_DB_PATH = path.join(__dirname, '../../database/transport.db');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://rahulraj@localhost:5432/bihar_transport_begusarai';
const MIGRATION_ORDER = [
  'users',
  'admins',
  'drivers',
  'transport_vehicles',
  'bookings',
  'deliveries',
  'booking_events',
  'booking_assignments',
];

// ============================================================
// Counters
// ============================================================
const stats = {
  sqlite: {},
  postgres: {},
  migrated: {},
  skipped: {},
};

// ============================================================
// Helper: Convert SQLite value to PostgreSQL-compatible value
// ============================================================

/**
 * Converts a value from SQLite to a format suitable for PostgreSQL.
 * SQLite booleans are integers (0/1).
 * SQLite dates are strings.
 */
function convertValue(val, pgType) {
  if (val === null || val === undefined) return null;

  switch (pgType) {
    case 'bool':
    case 'boolean':
      return val === 1 || val === true ? true : false;
    case 'int2':
    case 'int4':
    case 'integer':
      return Number(val);
    case 'float4':
    case 'float8':
      return Number(val);
    default:
      return val;
  }
}

// ============================================================
// Database Connections
// ============================================================

function openSQLite() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(SQLITE_DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('❌ Failed to open SQLite database:', err.message);
        reject(err);
      } else {
        console.log('✅ Connected to SQLite:', SQLITE_DB_PATH);
        resolve(db);
      }
    });
  });
}

function queryAll(db, table) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM "${table}"`, (err, rows) => {
      if (err) {
        console.error(`❌ Error querying ${table}:`, err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

function countSQLite(db, table) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as cnt FROM "${table}"`, (err, row) => {
      if (err) reject(err);
      else resolve(row.cnt);
    });
  });
}

// ============================================================
// PostgreSQL direct connection (bypass Prisma for inserts)
// We use pg.Client directly to have full control over type casting.
// ============================================================

function getPgPool() {
  return new pg.Pool({
    connectionString: DATABASE_URL,
  });
}

/**
 * Get column type info from PostgreSQL.
 */
async function getColumnTypes(pool) {
  const result = await pool.query(`
    SELECT 
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name::text as udt_name,
      c.is_nullable
    FROM information_schema.columns c
    JOIN pg_type t ON t.typname = c.udt_name::name
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position
  `);

  const columnMap = {};
  for (const row of result.rows) {
    if (!columnMap[row.table_name]) {
      columnMap[row.table_name] = [];
    }
    columnMap[row.table_name].push(row);
  }
  return columnMap;
}

/**
 * Get primary key column name for a table.
 */
async function getPrimaryKey(pool, table) {
  const result = await pool.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
  `, [table]);
  return result.rows[0]?.column_name || Object.keys(COLUMN_TYPES[table])[0];
}

/**
 * Build a parameterized INSERT query using PostgreSQL native types.
 * Columns with enum types need CAST.
 * 
 * IMPORTANT: For NULL values, we use literal 'NULL::type' in the SQL string
 * and do NOT include them as parameters. This avoids PG's "could not determine
 * data type of parameter" error when a param is null and PG tries to infer the type.
 */
function buildInsertQuery(table, row, colInfos, pkCol) {
  const cols = [];
  const placeholders = [];
  const params = [];

  for (const colInfo of colInfos) {
    const val = row[colInfo.column_name];
    const udtName = colInfo.udt_name;

    cols.push(`"${colInfo.column_name}"`);

    if (val === null || val === undefined) {
      // Use literal NULL with type cast - no parameter needed
      const pgType = colInfo.data_type === 'USER-DEFINED' ? `"${udtName}"` : colInfo.data_type;
      placeholders.push(`NULL::${pgType}`);
      // No param added
    } else {
      const paramRef = `$${params.length + 1}`;

      // Check if this is an enum type
      if (colInfo.data_type === 'USER-DEFINED') {
        placeholders.push(`CAST(${paramRef} AS "${udtName}")`);
        params.push(String(val));
      }
      // For timestamp types, cast from text
      else if (colInfo.data_type === 'timestamp without time zone' || colInfo.data_type === 'timestamp') {
        placeholders.push(`CAST(${paramRef} AS timestamp)`);
        params.push(String(val));
      }
      // For date types
      else if (colInfo.data_type === 'date') {
        placeholders.push(`CAST(${paramRef} AS date)`);
        params.push(String(val));
      }
      // For booleans
      else if (colInfo.data_type === 'boolean') {
        placeholders.push(paramRef);
        params.push(val === 1 || val === true ? true : false);
      }
      // For integers
      else if (colInfo.data_type === 'integer' || udtName === 'int4' || udtName === 'int2') {
        placeholders.push(paramRef);
        params.push(Number(val));
      }
      // For floats / numeric
      else if (colInfo.data_type === 'numeric' || colInfo.data_type === 'real' || colInfo.data_type === 'double precision' || colInfo.data_type === 'real') {
        placeholders.push(paramRef);
        params.push(Number(val));
      }
      // Default: text
      else {
        placeholders.push(paramRef);
        params.push(String(val));
      }
    }
  }

  const colList = cols.join(', ');
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders.join(', ')}) ON CONFLICT ("${pkCol}") DO NOTHING`;

  return { sql, params };
}

// ============================================================
// Main Migration
// ============================================================

async function migrate() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Bihar Transport — SQLite → PostgreSQL Migration ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // 1. Open SQLite
  const sqlite = await openSQLite();
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    // Get PostgreSQL column metadata
    const columnMap = await getColumnTypes(pool);

    // ============================================================
    // Phase A: Count SQLite rows
    // ============================================================
    console.log('📊 Counting SQLite rows...');
    for (const table of MIGRATION_ORDER) {
      const cnt = await countSQLite(sqlite, table);
      stats.sqlite[table] = cnt;
      if (columnMap[table]) {
        console.log(`   ${table}: ${cnt} rows  (${columnMap[table].length} columns)`);
      } else {
        console.log(`   ${table}: ${cnt} rows  (⚠️  no PostgreSQL table found)`);
      }
    }
    console.log('');

    // ============================================================
    // Phase B: Count existing PostgreSQL rows (before migration)
    // ============================================================
    console.log('📊 Checking PostgreSQL current state...');
    for (const table of MIGRATION_ORDER) {
      if (columnMap[table]) {
        const result = await client.query(`SELECT COUNT(*)::int as cnt FROM "${table}"`);
        const cnt = result.rows[0].cnt;
        stats.postgres[table] = cnt;
        console.log(`   ${table}: ${cnt} rows`);
      } else {
        console.log(`   ${table}: table not found in PostgreSQL`);
      }
    }
    console.log('');

    // ============================================================
    // Phase C: Read all data from SQLite
    // ============================================================
    console.log('📖 Reading all data from SQLite...');
    const allData = {};
    for (const table of MIGRATION_ORDER) {
      const rows = await queryAll(sqlite, table);
      allData[table] = rows;
      console.log(`   ${table}: ${rows.length} rows read`);
    }

    // Close SQLite
    sqlite.close();
    console.log('✅ SQLite connection closed');
    console.log('');

    // ============================================================
    // Phase D: Migrate to PostgreSQL in dependency order
    // ============================================================
    console.log('🔄 Starting migration in dependency order...');
    console.log('');

    let totalMigrated = 0;
    let totalSkipped = 0;

    await client.query('BEGIN');

    try {
      for (const table of MIGRATION_ORDER) {
        console.log(`--- ${table} ---`);
        const rows = allData[table];
        const colInfos = columnMap[table];

        if (!colInfos) {
          console.log(`   ⚠️  Skipping: table not found in PostgreSQL`);
          continue;
        }

        if (rows.length === 0) {
          console.log('   (empty)');
          continue;
        }

        const pkCol = await getPrimaryKey(pool, table);

        for (const row of rows) {
          try {
            const { sql, params } = buildInsertQuery(table, row, colInfos, pkCol);
            await client.query(sql, params);
            stats.migrated[table] = (stats.migrated[table] || 0) + 1;
            totalMigrated++;
          } catch (e) {
            // Check for duplicate key violation
            if (e.code === '23505') {
              stats.skipped[table] = (stats.skipped[table] || 0) + 1;
              totalSkipped++;
            } else {
              console.error(`\n❌ Error inserting into ${table}:`);
              console.error(`   Error: ${e.message}`);
              console.error(`   Row: ${JSON.stringify(row)}`);
              throw e;
            }
          }
        }
        console.log(`   Migrated: ${stats.migrated[table] || 0}, Skipped: ${stats.skipped[table] || 0}`);
      }

      await client.query('COMMIT');
      console.log('');
      console.log('✅ Transaction committed successfully');
      console.log(`📊 Total: ${totalMigrated} inserted, ${totalSkipped} skipped`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('');
      console.error('❌ Migration failed. Transaction rolled back.');
      throw err;
    }

    console.log('');

    // ============================================================
    // Phase E: Verification
    // ============================================================
    console.log('🔍 Verifying migration...');
    console.log('');

    let allMatch = true;
    const verificationRows = [];

    for (const table of MIGRATION_ORDER) {
      const sqliteCount = stats.sqlite[table];
      const result = await client.query(`SELECT COUNT(*)::int as cnt FROM "${table}"`);
      const pgCount = result.rows[0].cnt;
      const match = pgCount === sqliteCount;
      if (!match) allMatch = false;

      verificationRows.push({
        table,
        sqlite: sqliteCount,
        postgres: pgCount,
        match: match ? '✅' : '❌',
      });
    }

    // Print verification table
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       Migration Verification Report         ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');
    console.log('  Table                  │ SQLite │ PgSQL  │ Status');
    console.log(' ────────────────────────┼────────┼────────┼────────');
    for (const row of verificationRows) {
      const table = row.table.padEnd(23);
      const sqlite = String(row.sqlite).padStart(6);
      const pg = String(row.postgres).padStart(6);
      console.log(`  ${table} │ ${sqlite} │ ${pg} │  ${row.match}`);
    }
    console.log(' ────────────────────────┴────────┴────────┴────────');
    console.log('');

    if (allMatch) {
      console.log('✅ ALL TABLES MATCH — Migration verified successfully!');
    } else {
      console.log('❌ Some tables have mismatched counts. Review above.');
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Migration Complete                             ║');
    console.log('║  SQLite remains the production database         ║');
    console.log('╚══════════════════════════════════════════════════╝');

  } catch (err) {
    console.error('');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

