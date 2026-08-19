/**
 * Secure backend-only admin password change.
 *
 * WHY THIS EXISTS
 * ---------------
 * The project had no safe password-change mechanism. This script provides a
 * backend-only way to rotate the admin password without ever placing a
 * plaintext password or hash in frontend code, logs, API responses, console
 * output, or version control.
 *
 * SECURITY PROPERTIES
 * -------------------
 * - Reuses the project's existing hashing library (bcryptjs) and cost factor
 *   (10), identical to authRoutes.js and the seed scripts.
 * - The new password is supplied ONLY via the NEW_ADMIN_PASSWORD environment
 *   variable. It is never written to disk, never logged, and never printed.
 * - Updates EXACTLY ONE row: the admin whose email is ADMIN_EMAIL.
 * - Never creates or recreates an account; aborts if the admin is missing.
 * - Performs an internal self-check (bcrypt.compare) to confirm the new
 *   password authenticates and that the previous hash was replaced.
 *
 * USAGE
 * -----
 *   NEW_ADMIN_PASSWORD='<new-password>' node scripts/change-admin-password.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const ADMIN_EMAIL = 'admin@bihartransport.com';
const BCRYPT_ROUNDS = 10; // matches project convention (authRoutes.js, seed scripts)
const MIN_PASSWORD_LENGTH = 8;

async function main() {
  const newPassword = process.env.NEW_ADMIN_PASSWORD;

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `ERROR: NEW_ADMIN_PASSWORD must be set and at least ${MIN_PASSWORD_LENGTH} characters. Aborting.`
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // Locate the existing admin. Do NOT create/recreate the account.
    const existing = await prisma.admin.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { admin_id: true, email: true, password_hash: true },
    });

    if (!existing) {
      console.error(
        `ERROR: No admin found with email ${ADMIN_EMAIL}. Aborting (accounts are never created by this script).`
      );
      process.exit(1);
    }

    const previousHash = existing.password_hash;

    // Hash with the project's existing library + cost factor.
    const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Update ONLY this admin's password_hash (and updated_at).
    await prisma.admin.update({
      where: { email: ADMIN_EMAIL },
      data: { password_hash, updated_at: new Date() },
    });

    // Internal self-check: confirm the new password authenticates and the
    // previous hash was actually replaced. No secrets are logged.
    const updated = await prisma.admin.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { password_hash: true },
    });

    const newPasswordMatches = await bcrypt.compare(newPassword, updated.password_hash);
    const hashChanged = updated.password_hash !== previousHash;
    const oldDefaultRejected = !(await bcrypt.compare('admin123', updated.password_hash));

    if (!newPasswordMatches || !hashChanged) {
      console.error('ERROR: Post-update self-check failed. Password may not have been changed correctly.');
      process.exit(1);
    }

    console.log(
      `SUCCESS: Password updated for admin (admin_id=${existing.admin_id}, email=${ADMIN_EMAIL}). ` +
        `Self-check: new-password-accepted=${newPasswordMatches}, hash-changed=${hashChanged}, ` +
        `old-default-rejected=${oldDefaultRejected}. No other accounts were modified.`
    );
  } catch (err) {
    console.error('ERROR: Failed to update admin password:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
