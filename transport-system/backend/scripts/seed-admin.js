/**
 * ============================================================
 * Bihar Transport Begusarai — Development Admin Seed / Reset
 * ============================================================
 *
 * Creates or resets the development admin account:
 *   Email:    admin@bihartransport.com
 *   Password: supplied via ADMIN_PASSWORD environment variable
 *
 * SECURITY PROPERTIES
 * -------------------
 * - Password is supplied ONLY via the ADMIN_PASSWORD environment variable.
 *   It is never written to disk, never logged, and never printed.
 * - Uses the project's existing hashing library (bcryptjs) and cost
 *   factor (10), identical to authRoutes.js and the seed scripts.
 * - If the admin already exists, ONLY the password_hash and updated_at
 *   fields are modified. All other fields (username, full_name, role,
 *   is_active, etc.) are preserved.
 * - If the admin does not exist, it is created with sensible defaults.
 * - Performs an internal self-check (bcrypt.compare) to confirm the new
 *   password authenticates correctly.
 *
 * USAGE
 * -----
 *   ADMIN_PASSWORD='<dev-password>' node scripts/seed-admin.js
 *
 * EXAMPLES
 * --------
 *   # Create/reset with a strong password
 *   ADMIN_PASSWORD='DevPass123!@#' node scripts/seed-admin.js
 *
 *   # Use the documented default for local development
 *   ADMIN_PASSWORD='admin123' node scripts/seed-admin.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = 'admin@bihartransport.com';
const BCRYPT_ROUNDS = 10; // matches project convention (authRoutes.js, change-admin-password.js)
const MIN_PASSWORD_LENGTH = 6;

async function main() {
  const password = process.env.ADMIN_PASSWORD;

  if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `ERROR: ADMIN_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters. Aborting.`
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.admin.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { admin_id: true, email: true, password_hash: true },
    });

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    if (existing) {
      // Update ONLY the password_hash and updated_at. Preserve all other fields.
      await prisma.admin.update({
        where: { email: ADMIN_EMAIL },
        data: { password_hash, updated_at: new Date() },
      });

      // Self-check: confirm the new password authenticates.
      const updated = await prisma.admin.findUnique({
        where: { email: ADMIN_EMAIL },
        select: { password_hash: true },
      });

      const newPasswordMatches = await bcrypt.compare(password, updated.password_hash);

      if (!newPasswordMatches) {
        console.error('ERROR: Post-update self-check failed. Password may not have been set correctly.');
        process.exit(1);
      }

      console.log(
        `SUCCESS: Password reset for existing admin (admin_id=${existing.admin_id}, email=${ADMIN_EMAIL}). ` +
          `Self-check: new-password-accepted=${newPasswordMatches}. No other fields were modified.`
      );
    } else {
      // Create the admin with defaults.
      await prisma.admin.create({
        data: {
          username: 'admin',
          email: ADMIN_EMAIL,
          password_hash,
          full_name: 'System Administrator',
          phone: '9876543210',
          role: 'super_admin',
          is_active: true,
        },
      });

      // Self-check: confirm the new password authenticates.
      const created = await prisma.admin.findUnique({
        where: { email: ADMIN_EMAIL },
        select: { password_hash: true },
      });

      const newPasswordMatches = await bcrypt.compare(password, created.password_hash);

      if (!newPasswordMatches) {
        console.error('ERROR: Post-create self-check failed. Password may not have been set correctly.');
        process.exit(1);
      }

      console.log(
        `SUCCESS: Admin created (email=${ADMIN_EMAIL}). ` +
          `Self-check: new-password-accepted=${newPasswordMatches}.`
      );
    }
  } catch (err) {
    console.error('ERROR: Failed to seed/reset admin:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
