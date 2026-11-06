/**
 * Production Data Cleanup Plan Generator
 * 
 * This script analyzes the database to identify test records and generates
 * a comprehensive cleanup plan with before/after counts.
 * 
 * Run with: node scripts/production-cleanup-plan.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Test data patterns to identify dummy records
const TEST_PATTERNS = {
  // Driver patterns
  driverNamePatterns: [
    /^P\d\s+Driver\s+\d+/,
    /^B2B\s+Driver\s+/,
    /^HA\s+Driver\s+/,
    /^Reservation\s+Test\s+/,
    /^Test\s+No\s+License$/,
  ],
  driverMobilePatterns: [
    /^7[567]\d{8}$/,  // 7569003109, 7669003108, 7710108-68
    /^8[48]\d{7}$/,   // 84588944, 8810108-68
    /^8[26]3\d{7}$/,  // 8636256202, 8234550732
    /^7[74]INV\d+/,
    /^7[74]AUT\d+/,
    /^9[7]INV\d+/,
    /^6[32]3\d{7}$/,
    /^2\d{9}$/,
  ],
  
  // Vehicle Owner patterns
  ownerNamePatterns: [
    /^P\d\s+\d+/,
    /^P\d\s+Owner\s+/,
    /^B2B\s+Owner\s+/,
    /^B2B\s+Owner\s+AUT/,
  ],
  ownerMobilePatterns: [
    /^9[77]69\d{6}$/,
    /^999\d{6}$/,
    /^999INV\d+/,
    /^999AUT\d+/,
    /^7[67]60\d{5}$/,
  ],
  
  // Vehicle patterns
  vehicleNumberPatterns: [
    /^P\d{1,2}\d{1,2}-\d{5}-\d{2}-mw\w+/,
    /^P[23]\d{1,2}-\d{5}-\d{2}-mw\w+/,
    /^P2B[IA]I(NV|AUT)\d+mw\w+/,
    /^P[34]\d{1,2}-\d{5}-\d{2}-mw\w+/,
    /^T-RES-V-/,
  ],
  
  // User patterns
  userEmailPatterns: [
    /@example\.test$/,
    /@example\.invalid$/,
    /@btb\.local$/,
    /^guest_/,
    /^res\.test\./,
    /^p[34]\.driver\./,
    /^b2b\.(driver|customer)\./,
  ],
  userNamePatterns: [
    /^Reservation\s+Test\s+/,
    /^P[34]\s+Driver$/,
    /^B2B\s+(Driver|Customer)$/,
  ],
  
  // Enquiry patterns
  enquiryNumberPatterns: [
    /^TB-QT-\d+-\d+$/,
    /^T-RES-E-\d+$/,
    /^BTB-\d{8}-\d+$/,
  ],
  enquiryCustomerNamePatterns: [
    /^Phase B Test Party$/,
    /^Aasan OPD$/,
    /^Reservation Test Customer\s+\d+$/,
    /^Staging Test$/,
  ],
  
  // Booking patterns
  bookingNumberPatterns: [
    /^BTBT-AUTO-AUTO/,
    /^T-RES-B-\d+$/,
    /^PH7-mw/,
    /^HA-BK-/,
    /^P9B-/,
  ],
  
  // Trip patterns
  tripNumberPatterns: [
    /^BTBT-P[34]-\d+/,
    /^BTBT-B2B-/,
    /^BTBT-AUT-/,
  ],
};

async function identifyTestRecords() {
  console.log('=== Identifying Test Records ===\n');
  
  const results = {};
  
  // 1. Drivers
  const allDrivers = await prisma.driver.findMany({
    select: { driver_id: true, driver_name: true, mobile: true, driver_code: true, user_id: true, created_at: true }
  });
  
  const testDrivers = allDrivers.filter(d => 
    TEST_PATTERNS.driverNamePatterns.some(p => p.test(d.driver_name)) ||
    TEST_PATTERNS.driverMobilePatterns.some(p => p.test(d.mobile))
  );
  
  results.drivers = {
    total: allDrivers.length,
    test: testDrivers.length,
    preserve: allDrivers.length - testDrivers.length,
    testIds: testDrivers.map(d => d.driver_id),
  };
  
  // 2. Vehicle Owners
  const allOwners = await prisma.vehicleOwner.findMany({
    select: { owner_id: true, owner_name: true, company_name: true, mobile: true, owner_code: true, created_at: true }
  });
  
  const testOwners = allOwners.filter(o => 
    TEST_PATTERNS.ownerNamePatterns.some(p => p.test(o.owner_name)) ||
    TEST_PATTERNS.ownerMobilePatterns.some(p => p.test(o.mobile))
  );
  
  results.vehicleOwners = {
    total: allOwners.length,
    test: testOwners.length,
    preserve: allOwners.length - testOwners.length,
    testIds: testOwners.map(o => o.owner_id),
  };
  
  // 3. Vehicles
  const allVehicles = await prisma.transportVehicle.findMany({
    select: { vehicle_id: true, vehicle_number: true, vehicle_name: true, vehicle_type: true, owner_id: true, driver_id: true, created_at: true }
  });
  
  const testVehicles = allVehicles.filter(v => 
    TEST_PATTERNS.vehicleNumberPatterns.some(p => p.test(v.vehicle_number)) ||
    (v.owner_id && results.vehicleOwners.testIds.includes(v.owner_id)) ||
    (v.driver_id && results.drivers.testIds.includes(v.driver_id))
  );
  
  results.vehicles = {
    total: allVehicles.length,
    test: testVehicles.length,
    preserve: allVehicles.length - testVehicles.length,
    testIds: testVehicles.map(v => v.vehicle_id),
  };
  
  // 4. Users
  const allUsers = await prisma.user.findMany({
    select: { user_id: true, first_name: true, last_name: true, email: true, phone: true, role: true, created_at: true }
  });
  
  const testUsers = allUsers.filter(u => 
    TEST_PATTERNS.userEmailPatterns.some(p => p.test(u.email)) ||
    TEST_PATTERNS.userNamePatterns.some(p => p.test(`${u.first_name} ${u.last_name}`)) ||
    (u.role === 'driver' && TEST_PATTERNS.driverMobilePatterns.some(p => p.test(u.phone)))
  );
  
  // Always preserve admin users and specific real users
  const preserveUserIds = new Set([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25]);
  const actualTestUsers = testUsers.filter(u => !preserveUserIds.has(u.user_id));
  
  results.users = {
    total: allUsers.length,
    test: actualTestUsers.length,
    preserve: allUsers.length - actualTestUsers.length,
    testIds: actualTestUsers.map(u => u.user_id),
  };
  
  // 5. Enquiries
  const allEnquiries = await prisma.enquiry.findMany({
    select: { enquiry_id: true, enquiry_number: true, customer_name: true, customer_mobile: true, status: true, created_at: true }
  });
  
  const testEnquiries = allEnquiries.filter(e => 
    TEST_PATTERNS.enquiryNumberPatterns.some(p => p.test(e.enquiry_number)) ||
    TEST_PATTERNS.enquiryCustomerNamePatterns.some(p => p.test(e.customer_name))
  );
  
  results.enquiries = {
    total: allEnquiries.length,
    test: testEnquiries.length,
    preserve: allEnquiries.length - testEnquiries.length,
    testIds: testEnquiries.map(e => e.enquiry_id),
  };
  
  // 6. Bookings
  const allBookings = await prisma.booking.findMany({
    select: { booking_id: true, booking_number: true, booking_reference: true, status: true, created_at: true }
  });
  
  const testBookings = allBookings.filter(b => 
    TEST_PATTERNS.bookingNumberPatterns.some(p => p.test(b.booking_number))
  );
  
  results.bookings = {
    total: allBookings.length,
    test: testBookings.length,
    preserve: allBookings.length - testBookings.length,
    testIds: testBookings.map(b => b.booking_id),
  };
  
  // 7. Trips
  const allTrips = await prisma.trip.findMany({
    select: { trip_id: true, trip_number: true, status: true, booking_id: true, driver_id: true, vehicle_id: true, transport_owner_id: true, created_at: true }
  });
  
  const testTrips = allTrips.filter(t => 
    TEST_PATTERNS.tripNumberPatterns.some(p => p.test(t.trip_number)) ||
    (t.booking_id && results.bookings.testIds.includes(t.booking_id)) ||
    (t.driver_id && results.drivers.testIds.includes(t.driver_id)) ||
    (t.vehicle_id && results.vehicles.testIds.includes(t.vehicle_id)) ||
    (t.transport_owner_id && results.vehicleOwners.testIds.includes(t.transport_owner_id))
  );
  
  results.trips = {
    total: allTrips.length,
    test: testTrips.length,
    preserve: allTrips.length - testTrips.length,
    testIds: testTrips.map(t => t.trip_id),
  };
  
  // 8. Financial Transactions
  const allFts = await prisma.financialTransaction.findMany({
    select: { transaction_id: true, trip_id: true, booking_id: true, created_at: true }
  });
  
  const testFts = allFts.filter(ft => 
    (ft.trip_id && results.trips.testIds.includes(ft.trip_id)) ||
    (ft.booking_id && results.bookings.testIds.includes(ft.booking_id))
  );
  
  results.financialTransactions = {
    total: allFts.length,
    test: testFts.length,
    preserve: allFts.length - testFts.length,
    testIds: testFts.map(ft => ft.transaction_id),
  };
  
  // 9. Trip Advances
  const allAdvances = await prisma.tripAdvance.findMany({
    select: { advance_id: true, trip_id: true, booking_id: true, created_at: true }
  });
  
  const testAdvances = allAdvances.filter(a => 
    (a.trip_id && results.trips.testIds.includes(a.trip_id)) ||
    (a.booking_id && results.bookings.testIds.includes(a.booking_id))
  );
  
  results.tripAdvances = {
    total: allAdvances.length,
    test: testAdvances.length,
    preserve: allAdvances.length - testAdvances.length,
    testIds: testAdvances.map(a => a.advance_id),
  };
  
  // 10. Trip Settlements
  const allSettlements = await prisma.tripSettlement.findMany({
    select: { settlement_id: true, trip_id: true, booking_id: true, created_at: true }
  });
  
  const testSettlements = allSettlements.filter(s => 
    (s.trip_id && results.trips.testIds.includes(s.trip_id)) ||
    (s.booking_id && results.bookings.testIds.includes(s.booking_id))
  );
  
  results.tripSettlements = {
    total: allSettlements.length,
    test: testSettlements.length,
    preserve: allSettlements.length - testSettlements.length,
    testIds: testSettlements.map(s => s.settlement_id),
  };
  
  // 11. Driver Transactions
  const allDriverTx = await prisma.driverTransaction.findMany({
    select: { transaction_id: true, driver_id: true, created_at: true }
  });
  
  const testDriverTx = allDriverTx.filter(dt => 
    dt.driver_id && results.drivers.testIds.includes(dt.driver_id)
  );
  
  results.driverTransactions = {
    total: allDriverTx.length,
    test: testDriverTx.length,
    preserve: allDriverTx.length - testDriverTx.length,
    testIds: testDriverTx.map(dt => dt.transaction_id),
  };
  
  // 12. Partners (check for test partners)
  const allPartners = await prisma.partner.findMany({
    select: { partner_id: true, partner_name: true, mobile: true, created_at: true }
  });
  
  const testPartners = allPartners.filter(p => 
    /Test|Phase B|Staging/i.test(p.partner_name) ||
    /^9[77]69\d{6}$/.test(p.mobile)
  );
  
  results.partners = {
    total: allPartners.length,
    test: testPartners.length,
    preserve: allPartners.length - testPartners.length,
    testIds: testPartners.map(p => p.partner_id),
  };
  
  // 13. Clients
  const allClients = await prisma.client.findMany({
    select: { client_id: true, company_name: true, contact_person: true, phone: true, created_at: true }
  });
  
  const testClients = allClients.filter(c => 
    /Test|Phase B|Staging/i.test(c.company_name) ||
    /Test|Phase B|Staging/i.test(c.contact_person || '')
  );
  
  results.clients = {
    total: allClients.length,
    test: testClients.length,
    preserve: allClients.length - testClients.length,
    testIds: testClients.map(c => c.client_id),
  };
  
  // 14. Partner Ledger
  const allPartnerLedger = await prisma.partnerLedger.findMany({
    select: { ledger_id: true, partner_id: true, booking_id: true }
  });
  
  const testPartnerLedger = allPartnerLedger.filter(pl => 
    (pl.partner_id && results.partners.testIds.includes(pl.partner_id)) ||
    (pl.booking_id && results.bookings.testIds.includes(pl.booking_id))
  );
  
  results.partnerLedger = {
    total: allPartnerLedger.length,
    test: testPartnerLedger.length,
    preserve: allPartnerLedger.length - testPartnerLedger.length,
    testIds: testPartnerLedger.map(pl => pl.ledger_id),
  };
  
  // 15. Partner Payments
  const allPartnerPayments = await prisma.partnerPayment.findMany({
    select: { payment_id: true, partner_id: true, settlement_id: true }
  });
  
  const testPartnerPayments = allPartnerPayments.filter(pp => 
    (pp.partner_id && results.partners.testIds.includes(pp.partner_id)) ||
    (pp.settlement_id && results.settlements.testIds.includes(pp.settlement_id))
  );
  
  results.partnerPayments = {
    total: allPartnerPayments.length,
    test: testPartnerPayments.length,
    preserve: allPartnerPayments.length - testPartnerPayments.length,
    testIds: testPartnerPayments.map(pp => pp.payment_id),
  };
  
  // 16. Settlements
  const allSettlements2 = await prisma.settlement.findMany({
    select: { settlement_id: true, partner_id: true }
  });
  
  const testSettlements2 = allSettlements2.filter(s => 
    s.partner_id && results.partners.testIds.includes(s.partner_id)
  );
  
  results.settlements = {
    total: allSettlements2.length,
    test: testSettlements2.length,
    preserve: allSettlements2.length - testSettlements2.length,
    testIds: testSettlements2.map(s => s.settlement_id),
  };
  
  // 17. Admin (should always preserve)
  const allAdmins = await prisma.admin.findMany({
    select: { admin_id: true, username: true, email: true }
  });
  
  results.admins = {
    total: allAdmins.length,
    test: 0,
    preserve: allAdmins.length,
    testIds: [],
  };
  
  // Print summary table
  console.log('\n=== CLEANUP PLAN SUMMARY ===\n');
  console.log('| Table | Records Found | Records to Delete | Records to Preserve |');
  console.log('|-------|--------------:|------------------:|--------------------:|');
  
  for (const [table, data] of Object.entries(results)) {
    console.log(`| ${table} | ${data.total} | ${data.test} | ${data.preserve} |`);
  }
  
  // Save detailed plan
  const plan = {
    timestamp: new Date().toISOString(),
    results,
    deletionOrder: [
      'financialTransactions',
      'tripAdvances',
      'tripSettlements',
      'driverTransactions',
      'partnerLedger',
      'partnerPayments',
      'settlements',
      'trips',
      'bookings',
      'enquiries',
      'vehicles',
      'drivers',
      'vehicleOwners',
      'users',
      'partners',
      'clients',
    ],
    preserveRules: {
      admins: 'All admin records preserved',
      users: 'User IDs 1,3-25 preserved (real business users)',
      drivers: 'Non-test pattern drivers preserved',
      vehicleOwners: 'Non-test pattern owners preserved',
      vehicles: 'Non-test pattern vehicles preserved',
    }
  };
  
  const outputPath = path.join(__dirname, '..', 'cleanup-plan.json');
  fs.writeFileSync(outputPath, JSON.stringify(plan, null, 2));
  console.log(`\nDetailed plan saved to: ${outputPath}`);
  
  return plan;
}

async function main() {
  try {
    await identifyTestRecords();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
