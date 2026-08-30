const { prisma } = require('./config/prisma');

async function check() {
  try {
    const result = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE '%trip%' 
      ORDER BY table_name;
    `;
    console.log('Trip-related tables:', result);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
