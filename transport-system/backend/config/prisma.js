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
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

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

    // Get table counts
    const tables = ['users', 'admins', 'drivers', 'transport_vehicles', 'bookings', 'deliveries', 'booking_events', 'booking_assignments'];
    const counts = {};
    for (const table of tables) {
      const cnt = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as cnt FROM "${table}"`);
      counts[table] = cnt[0].cnt;
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

