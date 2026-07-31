/**
 * Diagnostic script to test the Prisma connection and try a partner creation
 * Run: node diag-test.js
 */
const { prisma, testPrismaConnection } = require('./config/prisma');
const PartnerService = require('./services/PartnerService');

async function main() {
  console.log('=== DIAGNOSTIC TEST ===');
  console.log('');

  // Step 1: Test Prisma connection
  console.log('[TEST] Testing Prisma connection...');
  try {
    const connResult = await testPrismaConnection();
    console.log('[TEST] Connection result:', JSON.stringify(connResult, null, 2));
  } catch (err) {
    console.error('[TEST] Connection test threw:', err.message);
  }

  console.log('');

  // Step 2: Try a simple query
  console.log('[TEST] Running partner count query...');
  try {
    const count = await prisma.partner.count();
    console.log('[TEST] Partner count:', count);
  } catch (err) {
    console.error('[TEST] Partner count query failed:', err.message, 'code:', err.code);
  }

  console.log('');

  // Step 3: Try creating a partner
  console.log('[TEST] Attempting to register a test partner...');
  const service = new PartnerService();
  try {
    const result = await service.registerPartner({
      owner_name: 'Test Diagnostic Owner',
      mobile: '9999999999',
      city: 'Patna',
      commission_percentage: 10,
    });
    console.log('[TEST] Partner created successfully:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('[TEST] Partner creation failed:', err.message, 'code:', err.code);
  }

  console.log('');
  console.log('=== DIAGNOSTIC COMPLETE ===');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[TEST] Fatal error:', err);
  prisma.$disconnect().catch(() => {});
});
