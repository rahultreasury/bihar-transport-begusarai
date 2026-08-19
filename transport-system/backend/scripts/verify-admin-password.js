/**
 * Verify the admin password change (backend-only, no secrets logged).
 *
 * This replicates the EXACT server-side logic used by the Admin Login page
 * (POST /api/auth/admin-login in routes/authRoutes.js):
 *   - prisma.admin.findUnique({ where: { email }, select: {...password_hash} })
 *   - bcrypt.compare(password, admin.password_hash)
 *
 * It also confirms the admin JWT/session still works by generating and
 * verifying a token the same way the login route and `protect` middleware do.
 *
 * The new password is supplied ONLY via NEW_ADMIN_PASSWORD (env). It is never
 * logged or printed. The password hash is never logged or printed.
 *
 * USAGE
 * -----
 *   NEW_ADMIN_PASSWORD='<new-password>' node scripts/verify-admin-password.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateToken } = require('../middleware/auth');

const ADMIN_EMAIL = 'admin@bihartransport.com';
// Documented seed default. Used only to prove the previous/default password
// no longer authenticates after the change.
const OLD_DEFAULT_PASSWORD = 'admin123';

async function main() {
  const newPassword = process.env.NEW_ADMIN_PASSWORD;

  if (!newPassword) {
    console.error('ERROR: NEW_ADMIN_PASSWORD must be set to verify the change.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // Same lookup shape as /api/auth/admin-login
    const admin = await prisma.admin.findUnique({
      where: { email: ADMIN_EMAIL },
      select: {
        admin_id: true,
        full_name: true,
        email: true,
        role: true,
        is_active: true,
        password_hash: true,
      },
    });

    if (!admin) {
      console.error(`ERROR: No admin found with email ${ADMIN_EMAIL}.`);
      process.exit(1);
    }

    // 1) New password authenticates through the same logic as the login page.
    const newAccepted = await bcrypt.compare(newPassword, admin.password_hash);

    // 2) Old/default password is rejected.
    const oldRejected = !(await bcrypt.compare(OLD_DEFAULT_PASSWORD, admin.password_hash));

    // 3) Admin JWT/session still works. The `protect` middleware only checks
    //    token validity + that the admin record still exists (not the password),
    //    so a valid token must continue to verify after a password change.
    const token = generateToken(admin.admin_id, 'admin');
    let jwtValid = false;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      jwtValid = !!(decoded && decoded.type === 'admin' && decoded.id === admin.admin_id);
    } catch (e) {
      jwtValid = false;
    }

    console.log(
      `VERIFY: new-password-accepted=${newAccepted}, ` +
        `old-default-rejected=${oldRejected}, ` +
        `admin-active=${admin.is_active}, ` +
        `jwt-session-valid=${jwtValid}, ` +
        `role=${admin.role}`
    );

    if (newAccepted && oldRejected && jwtValid) {
      console.log('RESULT: PASS — admin logs in with the new password; old password rejected; JWT session works.');
      process.exit(0);
    } else {
      console.error('RESULT: FAIL — see flags above.');
      process.exit(1);
    }
  } catch (err) {
    console.error('ERROR during verification:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
