/**
 * Temporary read-only database diagnostic script.
 * Uses the existing Prisma client configuration.
 * Does NOT modify any data.
 */

const { prisma } = require('./config/prisma');

async function diagnostic() {
  console.log('=== Database Diagnostic (READ ONLY) ===\n');

  try {
    // 1. Database name, schema, user
    const dbInfo = await prisma.$queryRaw`
      SELECT current_database() AS database,
             current_schema() AS schema,
             current_user AS user
    `;
    console.log('Database info:', JSON.stringify(dbInfo[0], null, 2));

    // 2. PostgreSQL version
    const version = await prisma.$queryRaw`SELECT version() AS version`;
    console.log('PostgreSQL version:', version[0]?.version);

    // 3. Check if archived_at column exists
    const archivedAt = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bookings'
        AND column_name = 'archived_at'
    `;
    console.log('\narchived_at column:', archivedAt.length > 0 ? 'EXISTS' : 'MISSING');
    if (archivedAt.length > 0) {
      console.log('  data_type:', archivedAt[0].data_type);
      console.log('  is_nullable:', archivedAt[0].is_nullable);
    }

    // 4. Check if index exists
    const index = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'bookings'
        AND indexname = 'idx_bookings_archived_at'
    `;
    console.log('\nidx_bookings_archived_at:', index.length > 0 ? 'EXISTS' : 'MISSING');
    if (index.length > 0) {
      console.log('  indexdef:', index[0].indexdef);
    }

    // 5. Check specific migration record
    const migration = await prisma.$queryRaw`
      SELECT migration_name, finished_at, applied_steps_count
      FROM "_prisma_migrations"
      WHERE migration_name = '20260810120000_add_booking_archive'
    `;
    console.log('\nMigration 20260810120000_add_booking_archive:');
    if (migration.length > 0) {
      console.log('  record exists: YES');
      console.log('  finished_at:', migration[0].finished_at);
      console.log('  applied_steps_count:', migration[0].applied_steps_count);
    } else {
      console.log('  record exists: NO');
    }

    // 6. Full migration history
    const allMigrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY finished_at
    `;
    console.log('\nAll migrations:');
    allMigrations.forEach((m) => {
      console.log('  -', m.migration_name, '|', m.finished_at);
    });

    console.log('\n=== Diagnostic Complete ===');
  } catch (error) {
    console.error('Diagnostic failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

diagnostic();
