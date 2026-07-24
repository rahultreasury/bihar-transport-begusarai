#!/usr/bin/env node
/**
 * ============================================================
 * Bihar Transport Begusarai — Local PostgreSQL → Neon PostgreSQL
 * One-time Data Migration Script
 * ============================================================
 *
 * This script copies all data from a local PostgreSQL database
 * to a Neon PostgreSQL database (configured in DATABASE_URL).
 *
 * - Reuses the existing DATABASE_URL env var for destination (Neon)
 * - Requires SOURCE_DATABASE_URL constant set below for source (local)
 * - Uses Prisma Client only
 * - Preserves all primary keys, foreign keys, timestamps, and IDs
 * - Prints progress for every table
 * - Wraps each table in try/catch — continues if one fails
 * - Auto-resets PostgreSQL sequences after migration
 * - Verifies row counts after each table
 *
 * Usage: node scripts/migrate-local-postgres-to-neon.js
 * ============================================================
 */

const { PrismaClient } = require('@prisma/client');

// ============================================================
// CONFIGURATION — Paste your local PostgreSQL connection string below
// ============================================================
const SOURCE_DATABASE_URL =postgresql:"neondb_owner:npg_M5Gq0AumvfTo@ep-red-butterfly-azmswhcg-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
  'postgresql://rahulraj@localhost:5432/bihar_transport_begusarai'";

// Destination is read from existing .env's DATABASE_URL
const DEST_DATABASE_URL = process.env.DATABASE_URL;

// ============================================================
// Migration order (dependency order — parents before children)
// ============================================================
const TABLE_CONFIG = [
  { name: 'admins', modelName: 'admin' },
  { name: 'users', modelName: 'user' },
  { name: 'drivers', modelName: 'driver' },
  { name: 'transport_vehicles', modelName: 'transportVehicle' },
  { name: 'bookings', modelName: 'booking' },
  { name: 'deliveries', modelName: 'delivery' },
  { name: 'booking_events', modelName: 'bookingEvent' },
  { name: 'booking_assignments', modelName: 'bookingAssignment' },
];

// Tables that use createMany (simple tables without complex relations)
const CREATE_MANY_TABLES = new Set([
  'admins',
  'users',
  'drivers',
  'transport_vehicles',
  'booking_events',
  'booking_assignments',
]);

// Tables that need row-by-row insert (complex tables with foreign key cascades)
const ROW_BY_ROW_TABLES = new Set(['bookings', 'deliveries']);

// ============================================================
// Track stats
// ============================================================
const stats = {
  source: {},
  dest: {},
  migrated: { created: 0, skipped: 0 },
  errors: [],
};

// ============================================================
// Prisma Client factory
// ============================================================
function createPrismaClient(databaseUrl) {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: ['warn', 'error'],
  });
}

// ============================================================
// Helper: Get sequence name for a table
// ============================================================
function getSequenceName(tableName) {
  const sequenceMap = {
    admins: 'admins_admin_id_seq',
    users: 'users_user_id_seq',
    drivers: 'drivers_driver_id_seq',
    transport_vehicles: 'transport_vehicles_vehicle_id_seq',
    bookings: 'bookings_booking_id_seq',
    deliveries: 'deliveries_delivery_id_seq',
    booking_events: 'booking_events_booking_event_id_seq',
    booking_assignments: 'booking_assignments_booking_assignment_id_seq',
  };
  return sequenceMap[tableName];
}

// ============================================================
// Progress logger
// ============================================================
function printTableResult(table, sourceCount, destCount) {
  const match = sourceCount === destCount;
  const icon = match ? '✓' : '⚠️';
  console.log(`\n  ${icon} ${table}`);
  console.log(`  Source: ${sourceCount}`);
  console.log(`  Destination: ${destCount}`);
  if (!match) {
    console.log(`  ⚠️  WARNING: Row count mismatch! Source: ${sourceCount}, Dest: ${destCount}`);
  }
}

// ============================================================
// Count rows in a table
// ============================================================
async function countRows(prisma, prismaModel) {
  try {
    return await prismaModel.count();
  } catch {
    return -1;
  }
}

// ============================================================
// Reset sequence for a table
// ============================================================
async function resetSequence(destPrisma, tableName) {
  const sequenceName = getSequenceName(tableName);
  if (!sequenceName) return;

  try {
    await destPrisma.$executeRawUnsafe(
      `SELECT setval('${sequenceName}', COALESCE((SELECT MAX(${getPkColumn(tableName)}) FROM "${tableName}"), 0))`
    );
    console.log(`   ↻ Sequence reset: ${sequenceName}`);
  } catch (err) {
    console.warn(`   ⚠️  Could not reset sequence ${sequenceName}: ${err.message}`);
  }
}

function getPkColumn(tableName) {
  const pkMap = {
    admins: 'admin_id',
    users: 'user_id',
    drivers: 'driver_id',
    transport_vehicles: 'vehicle_id',
    bookings: 'booking_id',
    deliveries: 'delivery_id',
    booking_events: 'booking_event_id',
    booking_assignments: 'booking_assignment_id',
  };
  return pkMap[tableName] || 'id';
}

// ============================================================
// Main Migration
// ============================================================
async function migrate() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Bihar Transport — Local PostgreSQL → Neon PostgreSQL   ║');
  console('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Validate destination URL
  if (!DEST_DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL environment variable is not set.');
    console.error('   This should point to your Neon PostgreSQL instance.');
    console.error('   It is already configured in backend/.env');
    process.exit(1);
  }

  // Create Prisma clients
  console.log('🔌 Connecting to databases...');
  const sourcePrisma = createPrismaClient(SOURCE_DATABASE_URL);
  const destPrisma = createPrismaClient(DEST_DATABASE_URL);

  try {
    // Test connections
    await sourcePrisma.$connect();
    console.log('✅ Connected to SOURCE (local PostgreSQL)');

    await destPrisma.$connect();
    console.log('✅ Connected to DESTINATION (Neon PostgreSQL)');
    console.log('');

    // ================================================================
    // PHASE 1: Count source rows and migrate each table
    // ================================================================
    console.log('📊 Counting source rows and starting migration...');
    console.log('');

    for (const config of TABLE_CONFIG) {
      const { name, modelName } = config;
      const prismaModel = sourcePrisma[modelName];

      if (!prismaModel) {
        console.error(`   ❌ Prisma model "${modelName}" not found. Skipping.`);
        stats.errors.push(`Model ${modelName} not found`);
        continue;
      }

      console.log(`--- ${name} ---`);

      try {
        // Count source rows
        const sourceCount = await countRows(sourcePrisma, prismaModel);
        stats.source[name] = sourceCount;
        console.log(`   Source rows: ${sourceCount}`);

        if (sourceCount === 0) {
          console.log('   (empty — skipping)');
          const destCount = await countRows(destPrisma, destPrisma[modelName]);
          stats.dest[name] = destCount;
          printTableResult(name, sourceCount, destCount);
          continue;
        }

        // Read all data from source
        const rows = await prismaModel.findMany();
        console.log(`   Read ${rows.length} rows from source`);

        // Determine insertion strategy
        if (CREATE_MANY_TABLES.has(name)) {
          // Use createMany with skipDuplicates
          const result = await destPrisma[modelName].createMany({
            data: rows,
            skipDuplicates: true,
          });
          stats.migrated.created += result.count;
          console.log(`   createMany: ${result.count} rows inserted`);

          // Verify
          const destCount = await countRows(destPrisma, destPrisma[modelName]);
          stats.dest[name] = destCount;
          printTableResult(name, sourceCount, destCount);

          // Reset sequence
          await resetSequence(destPrisma, name);
        } else if (ROW_BY_ROW_TABLES.has(name)) {
          // Insert one by one inside a transaction
          let inserted = 0;
          let skipped = 0;

          await destPrisma.$transaction(async (tx) => {
            for (const row of rows) {
              try {
                await tx[modelName].create({ data: row });
                inserted++;
              } catch (err) {
                // Check for duplicate key violation
                if (err.code === 'P2002') {
                  skipped++;
                } else {
                  throw err;
                }
              }
            }
          });

          stats.migrated.created += inserted;
          stats.migrated.skipped += skipped;
          console.log(`   Row-by-row: ${inserted} inserted, ${skipped} skipped`);

          // Verify
          const destCount = await countRows(destPrisma, destPrisma[modelName]);
          stats.dest[name] = destCount;
          printTableResult(name, sourceCount, destCount);

          // Reset sequence
          await resetSequence(destPrisma, name);
        }
      } catch (err) {
        console.error(`   ❌ Failed to migrate "${name}": ${err.message}`);
        stats.errors.push(`Table ${name}: ${err.message}`);

        // Still try to count destination for verification
        try {
          const destCount = await countRows(destPrisma, destPrisma[modelName]);
          stats.dest[name] = destCount;
        } catch {
          stats.dest[name] = -1;
        }
      }

      console.log(''); // blank line between tables
    }

    // ================================================================
    // PHASE 2: Final verification
    // ================================================================
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                 Migration Summary                      ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    let allMatch = true;

    console.log('  Table                  │ Source  │ Dest    │ Status');
    console.log(' ────────────────────────┼─────────┼─────────┼──────────');

    for (const config of TABLE_CONFIG) {
      const { name } = config;
      const src = stats.source[name] ?? 'N/A';
      const dst = stats.dest[name] ?? 'N/A';
      const match = src === dst;
      if (!match && src !== 'N/A' && dst !== 'N/A') allMatch = false;

      const tableLabel = name.padEnd(23);
      const srcStr = String(src).padStart(7);
      const dstStr = String(dst).padStart(7);
      const status = match ? '✓ MATCH' : '⚠️  MISMATCH';
      console.log(`  ${tableLabel} │ ${srcStr} │ ${dstStr} │ ${status}`);
    }

    console.log(' ────────────────────────┴─────────┴─────────┴──────────');
    console.log('');

    if (allMatch) {
      console.log('✅ ALL TABLES MATCH — Migration verified successfully!');
    } else {
      console.log('❌ Some tables have mismatched counts. Review above.');
    }

    if (stats.errors.length > 0) {
      console.log('');
      console.log('⚠️  Errors encountered during migration:');
      for (const err of stats.errors) {
        console.log(`   • ${err}`);
      }
    }

    console.log('');
    console.log('📊 Migration stats:');
    console.log(`   Total rows inserted: ${stats.migrated.created}`);
    console.log(`   Total rows skipped:  ${stats.migrated.skipped}`);
    console.log(`   Errors:              ${stats.errors.length}`);
    console.log('');

    // ================================================================
    // PHASE 3: Final sequence resets (safety net for all tables)
    // ================================================================
    console.log('🔄 Resetting all PostgreSQL sequences...');
    for (const config of TABLE_CONFIG) {
      await resetSequence(destPrisma, config.name);
    }
    console.log('✅ All sequences reset');
    console.log('');

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  Migration Complete!                                   ║');
    console.log('║  Local PostgreSQL data has been copied to Neon.        ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
  } catch (err) {
    console.error('');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    // Always disconnect both clients
    await sourcePrisma.$disconnect();
    await destPrisma.$disconnect();
    console.log('🔌 Database connections closed');
  }
}

migrate();

