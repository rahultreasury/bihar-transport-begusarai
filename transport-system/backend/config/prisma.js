/**
 * Shared Prisma Client
 *
 * Provides a singleton Prisma instance for the entire backend.
 * This is Phase 4.1 — Prisma is configured and verified but NOT yet
 * used in production routes/controllers/services. SQLite remains active.
 *
 * Usage:
 *   const prisma = require('../config/prisma');
 *   const users = await prisma.user.findMany();
 */

const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

// Prevent multiple instances during hot-reload in development
const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
  // Connection pool configuration:
  // - connection_limit: up to 20 concurrent connections
  // - pool_timeout: wait up to 10s for a connection from the pool
  // - idle_timeout: close idle connections after 30s (neon/serverless-friendly)
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}connection_limit=20&pool_timeout=10&idle_timeout=30`
        : undefined,
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Handle Prisma connection errors gracefully
prisma.$on('error', (e) => {
  console.error('[prisma] Client error:', e.message);
});

/**
 * Test PostgreSQL connectivity via Prisma.
 * @returns {Promise<{success: boolean, message: string, data?: object}>}
 */
async function testPrismaConnection() {
  try {
    // Execute a simple query to verify connection
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    const connected = result[0]?.connected === 1 || result[0]?.connected === '1' || result[0]?.connected === true;

    // Get PostgreSQL version
    const versionResult = await prisma.$queryRaw`SELECT version()`;
    const version = versionResult[0]?.version || 'unknown';

    // Get table counts (batch in single query to avoid pool exhaustion)
    let counts = {};
    try {
      const tableCounts = await prisma.$queryRawUnsafe(`
        SELECT tablename as table_name, 
               (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public') as total_tables
        FROM pg_catalog.pg_tables 
        WHERE schemaname='public'
        ORDER BY tablename
      `);
      counts = { totalTables: tableCounts.length };
    } catch {
      counts = { totalTables: 'unknown' };
    }

    return {
      success: true,
      message: '✅ Prisma client connected to PostgreSQL successfully',
      data: {
        database: 'bihar_transport_begusarai',
        version,
        tables: counts,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ Prisma client connection failed: ${error.message}`,
      data: null,
    };
  }
}

module.exports = {
  prisma,
  testPrismaConnection,
};

