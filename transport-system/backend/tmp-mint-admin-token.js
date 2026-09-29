/**
 * TEMP — mint a real admin JWT (same helper the login route uses) so we can
 * exercise GET /api/admin/booking-drivers over real HTTP.
 */
require('dotenv').config();
const { prisma } = require('./config/prisma');
const { generateToken } = require('./middleware/auth');

(async () => {
  const admins = await prisma.admin.findMany({
    select: { admin_id: true, email: true, role: true, full_name: true },
    take: 5,
  });
  console.log('admins:', admins);
  const a = admins.find((x) => x.role === 'admin' || x.role === 'super_admin') || admins[0];
  if (!a) {
    console.log('NO ADMIN FOUND');
    process.exit(1);
  }
  const token = generateToken(a.admin_id, 'admin');
  require('fs').writeFileSync('/tmp/btb-admin-token.txt', token);
  console.log('TOKEN_SAVED for admin_id', a.admin_id, 'role', a.role);
  await prisma.$disconnect();
})();
