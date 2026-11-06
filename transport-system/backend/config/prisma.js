/**
 * Shared Prisma Client
 *
 * Singleton Prisma instance for the entire backend. Every route, controller
 * and service imports this module so the process keeps one connection pool
 * (connection_limit 20, pool_timeout 10s, idle_timeout 30s — Neon/serverless
 * friendly).
 *
 * Usage:
 *   const { prisma } = require('../config/prisma');
 *   const users = await prisma.user.findMany();
 */

const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

/**
 * Normalize hostname for comparison: lowercase, remove trailing dot.
 * @param {string} hostname
 * @returns {string}
 */
function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

/**
 * Validate that DATABASE_URL matches an explicitly approved hostname.
 * Hostnames must be provided via environment variables — no pattern matching.
 * @throws {Error} If environment/database mismatch detected
 */
function validateDatabaseEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const expectedBranch = process.env.EXPECTED_DB_BRANCH;
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Configure the correct Neon branch for this environment.');
  }

  if (!expectedBranch) {
    throw new Error('EXPECTED_DB_BRANCH is not set. Must be "development" or "production".');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection string.');
  }

  const hostname = normalizeHostname(parsed.hostname);

  // Exact approved hostnames from Neon Console — MUST be set via environment variables
  // Development (direct connection, no pooler)
  const devHostname = process.env.DEV_DB_HOSTNAME
    ? normalizeHostname(process.env.DEV_DB_HOSTNAME)
    : null;

  // Production pooled (application runtime)
  const prodPooledHostname = process.env.PROD_DB_POOLED_HOSTNAME
    ? normalizeHostname(process.env.PROD_DB_POOLED_HOSTNAME)
    : null;

  // Production direct (migrations)
  const prodDirectHostname = process.env.PROD_DB_DIRECT_HOSTNAME
    ? normalizeHostname(process.env.PROD_DB_DIRECT_HOSTNAME)
    : null;

  // Protected snapshot (always blocked)
  const forbiddenHostname = process.env.FORBIDDEN_DB_HOSTNAME
    ? normalizeHostname(process.env.FORBIDDEN_DB_HOSTNAME)
    : null;

  // Validate required hostnames are configured
  if (nodeEnv === 'production' || expectedBranch === 'production') {
    if (!prodPooledHostname) {
      throw new Error('PROD_DB_POOLED_HOSTNAME is not set. Production requires explicit approved pooled hostname.');
    }
    if (!prodDirectHostname) {
      throw new Error('PROD_DB_DIRECT_HOSTNAME is not set. Production requires explicit approved direct hostname.');
    }
  } else {
    if (!devHostname) {
      throw new Error('DEV_DB_HOSTNAME is not set. Development requires explicit approved direct hostname.');
    }
  }

  if (!forbiddenHostname) {
    console.warn('[prisma] WARNING: FORBIDDEN_DB_HOSTNAME not set. Protected snapshot blocking relies on manual configuration.');
  }

  const isPooled = hostname.includes('-pooler.');

  if (nodeEnv === 'production' || expectedBranch === 'production') {
    // Production must use pooled connection
    if (!isPooled) {
      throw new Error(
        `PRODUCTION ENVIRONMENT VIOLATION: DATABASE_URL uses direct connection (${hostname}). ` +
        `Production must use Neon pooled endpoint (-pooler.). ` +
        `Configure PROD_DB_POOLED_HOSTNAME and use pooled DATABASE_URL.`
      );
    }

    // Must match exactly the approved production pooled hostname
    if (hostname !== prodPooledHostname) {
      throw new Error(
        `PRODUCTION ENVIRONMENT VIOLATION: DATABASE_URL hostname "${hostname}" does not match approved production pooled hostname "${prodPooledHostname}". ` +
        `Verify PROD_DB_POOLED_HOSTNAME in environment and DATABASE_URL in Neon Console.`
      );
    }

    // Ensure it's not the forbidden snapshot
    if (forbiddenHostname && hostname === forbiddenHostname) {
      throw new Error(
        `FORBIDDEN: DATABASE_URL points to protected snapshot (${forbiddenHostname}). ` +
        `This branch must never be used for active connections.`
      );
    }
  } else {
    // Development must use direct connection (no pooler)
    if (isPooled) {
      throw new Error(
        `DEVELOPMENT ENVIRONMENT VIOLATION: DATABASE_URL uses pooled connection (${hostname}). ` +
        `Development must use direct connection to Neon development branch. ` +
        `Configure DEV_DB_HOSTNAME and use development DATABASE_URL.`
      );
    }

    // Must match exactly the approved development hostname
    if (hostname !== devHostname) {
      throw new Error(
        `DEVELOPMENT ENVIRONMENT VIOLATION: DATABASE_URL hostname "${hostname}" does not match approved development hostname "${devHostname}". ` +
        `Verify DEV_DB_HOSTNAME in environment and DATABASE_URL in Neon Console.`
      );
    }

    // Ensure it's not the forbidden snapshot
    if (forbiddenHostname && hostname === forbiddenHostname) {
      throw new Error(
        `FORBIDDEN: DATABASE_URL points to protected snapshot (${forbiddenHostname}). ` +
        `This branch must never be used for active connections.`
      );
    }

    // Ensure it's not a production hostname
    if (prodPooledHostname && hostname === prodPooledHostname) {
      throw new Error(
        `DEVELOPMENT ENVIRONMENT VIOLATION: DATABASE_URL matches production pooled hostname. ` +
        `Development must use development branch only.`
      );
    }
    if (prodDirectHostname && hostname === prodDirectHostname) {
      throw new Error(
        `DEVELOPMENT ENVIRONMENT VIOLATION: DATABASE_URL matches production direct hostname. ` +
        `Development must use development branch only.`
      );
    }
  }

  console.log(`[prisma] Environment validation passed: ${nodeEnv} → ${expectedBranch} (${hostname})`);
}

// Run validation at module load time
validateDatabaseEnvironment();

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
        ? (() => {
            try {
              const u = new URL(process.env.DATABASE_URL);
              if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '20');
              if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '10');
              if (!u.searchParams.has('idle_timeout')) u.searchParams.set('idle_timeout', '30');
              return u.toString();
            } catch {
              return process.env.DATABASE_URL;
            }
          })()
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

    // Get PostgreSQL version and the actual database name (never hardcode —
    // the same code runs against local, staging and Neon production).
    const versionResult = await prisma.$queryRaw`SELECT version() AS version, current_database() AS database`;
    const version = versionResult[0]?.version || 'unknown';
    const databaseName = versionResult[0]?.database || 'unknown';

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
        database: databaseName,
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

