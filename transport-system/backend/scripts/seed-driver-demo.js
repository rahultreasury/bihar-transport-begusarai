#!/usr/bin/env node
/**
 * ============================================================
 * Bihar Transport Begusarai — Driver Management Demo Seed
 * ============================================================
 *
 * Creates ONE complete demo driver (Ramesh Kumar) with realistic
 * transport business data to test every feature of the
 * Driver Management module.
 *
 * IMPORTANT: This script does NOT insert records into the
 * public Booking Management table. All data is contained
 * within driver-specific tables (drivers, driver_transactions,
 * driver_timeline, transport_vehicles).
 *
 * Usage: node scripts/seed-driver-demo.js
 * ============================================================
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seed() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Bihar Transport — Driver Demo Seed            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // Check if driver already exists
  const existingDriver = await prisma.driver.findUnique({
    where: { driver_code: 'DRV000001' }
  });

  if (existingDriver) {
    console.log('⚠️  Demo driver DRV000001 already exists. Skipping seed.\n');
    console.log('To re-seed, first delete the driver and run again.\n');
    await prisma.$disconnect();
    return;
  }

  try {
    // ============================================================
    // 1. ADMIN
    // ============================================================
    let admin = await prisma.admin.findUnique({ where: { email: 'admin@bihartransport.com' } });
    if (!admin) {
      const adminHash = await bcrypt.hash('admin123', 10);
      admin = await prisma.admin.create({
        data: {
          username: 'admin',
          email: 'admin@bihartransport.com',
          password_hash: adminHash,
          full_name: 'System Administrator',
          phone: '9876543210',
          role: 'super_admin',
        }
      });
      console.log('✅ Admin created');
    } else {
      console.log('ℹ️  Admin exists');
    }

    // ============================================================
    // 2. USER + DRIVER + VEHICLE (batched)
    // ============================================================
    const userHash = await bcrypt.hash('driver123', 10);
    const { user, driver, vehicle } = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          first_name: 'Ramesh',
          last_name: 'Kumar',
          email: 'ramesh.kumar@driver.bihar-transport.com',
          phone: '9876543210',
          password_hash: userHash,
          address: 'Ward No. 12, Near Bus Stand, Begusarai',
          city: 'Begusarai',
          state: 'Bihar',
          pincode: '851101',
          role: 'driver',
          is_active: true,
        }
      });

      const d = await tx.driver.create({
        data: {
          driver_code: 'DRV000001',
          user_id: u.user_id,
          driver_name: 'Ramesh Kumar',
          mobile: '9876543210',
          alternate_mobile: '9123456789',
          address: 'Ward No. 12, Near Bus Stand, Near Mahavir Mandir',
          city: 'Begusarai',
          state: 'Bihar',
          pincode: '851101',
          license_number: 'BR01-2020-458796',
          license_expiry: '2028-03-15',
          license_class: 'HTV',
          joining_date: '2024-01-12',
          status: 'available',
          is_available: true,
          is_verified: true,
          rating: 4.7,
          total_deliveries: 48,
          total_advance: 15000,
          total_paid: 245000,
          total_expenses: 107000,
          current_balance: 22500,
        }
      });

      const v = await tx.transportVehicle.create({
        data: {
          driver_id: d.driver_id,
          vehicle_number: 'BR09GA4589',
          vehicle_type: 'truck',
          vehicle_name: 'Tata LPT 2518 14 Wheeler',
          capacity_kg: 25000,
          capacity_volume: 65,
          vehicle_make: 'Tata Motors',
          vehicle_model: 'LPT 2518',
          manufacturing_year: 2022,
          registration_date: '2022-06-15',
          insurance_number: 'INS/BR/2022/45896',
          insurance_expiry: '2026-06-14',
          permit_number: 'NPT/BR/2022/78945',
          permit_expiry: '2026-06-14',
          pollution_certificate: 'PUC/BR/2024/12365',
          pollution_expiry: '2025-06-10',
          is_available: true,
          is_verified: true,
          current_status: 'available',
          base_location: 'Begusarai',
          hourly_rate: 600,
          per_km_rate: 28,
        }
      });

      return { user: u, driver: d, vehicle: v };
    });
    console.log(`✅ User: ${user.first_name} ${user.last_name}`);
    console.log(`✅ Driver: ${driver.driver_name} (${driver.driver_code})`);
    console.log(`✅ Vehicle: ${vehicle.vehicle_number}`);

    // ============================================================
    // 3. FINANCIAL LEDGER (37 entries in small batches)
    //    Note: Transactions are stored in driver_transactions table
    //    which is separate from the Booking Management table.
    //    No booking records are created.
    // ============================================================
    let runningBalance = 0;

    const transactions = [
      // Initial advance
      { date: '2024-01-12', type: 'advance', amount: 5000, desc: 'Signing advance - Ramesh Kumar joining', mode: 'cash' },
      // Trip 1 - Begusarai to Patna (Steel)
      { date: '2024-01-15', type: 'fuel_expense', amount: 8500, desc: 'Fuel - Begusarai to Patna trip (Steel transport)', mode: 'cash' },
      { date: '2024-01-15', type: 'toll_expense', amount: 1200, desc: 'Toll charges - Begusarai to Patna', mode: 'cash' },
      { date: '2024-01-16', type: 'trip_payment', amount: 18500, desc: 'Trip settlement - Begusarai to Patna (Steel transport)', mode: 'bank' },
      // Trip 2 - Patna to Muzaffarpur (Cement)
      { date: '2024-01-22', type: 'fuel_expense', amount: 5500, desc: 'Fuel - Patna to Muzaffarpur (Cement)', mode: 'cash' },
      { date: '2024-01-22', type: 'toll_expense', amount: 800, desc: 'Toll charges - Patna-Muzaffarpur', mode: 'cash' },
      { date: '2024-01-23', type: 'trip_payment', amount: 12000, desc: 'Trip settlement - Patna to Muzaffarpur (Cement)', mode: 'bank' },
      // Trip 3 - Muzaffarpur to Darbhanga (Fertilizer)
      { date: '2024-01-28', type: 'fuel_expense', amount: 6000, desc: 'Fuel - Muzaffarpur to Darbhanga (Fertilizer)', mode: 'cash' },
      { date: '2024-01-28', type: 'toll_expense', amount: 750, desc: 'Toll charges - Muzaffarpur-Darbhanga', mode: 'cash' },
      { date: '2024-01-29', type: 'trip_payment', amount: 14000, desc: 'Trip settlement - Muzaffarpur to Darbhanga (Fertilizer)', mode: 'bank' },
      // Advance Feb
      { date: '2024-02-01', type: 'advance', amount: 5000, desc: 'Monthly advance - February 2024', mode: 'cash' },
      // Trip 4 - Darbhanga to Sitamarhi (Rice)
      { date: '2024-02-05', type: 'fuel_expense', amount: 4500, desc: 'Fuel - Darbhanga to Sitamarhi (Rice)', mode: 'cash' },
      { date: '2024-02-06', type: 'trip_payment', amount: 9500, desc: 'Trip settlement - Darbhanga to Sitamarhi (Rice)', mode: 'bank' },
      // Trip 5 - Sitamarhi to Motihari (Wheat)
      { date: '2024-02-12', type: 'fuel_expense', amount: 5000, desc: 'Fuel - Sitamarhi to Motihari (Wheat)', mode: 'cash' },
      { date: '2024-02-12', type: 'toll_expense', amount: 550, desc: 'Toll - Sitamarhi to Motihari', mode: 'cash' },
      { date: '2024-02-13', type: 'trip_payment', amount: 11000, desc: 'Trip settlement - Sitamarhi to Motihari (Wheat)', mode: 'bank' },
      // Trip 6 - Motihari to Gaya (Cement Bricks)
      { date: '2024-02-20', type: 'fuel_expense', amount: 7000, desc: 'Fuel - Motihari to Gaya (Cement Bricks)', mode: 'cash' },
      { date: '2024-02-21', type: 'trip_payment', amount: 22000, desc: 'Trip settlement - Motihari to Gaya (Cement Bricks)', mode: 'bank' },
      // Advance Mar
      { date: '2024-03-01', type: 'advance', amount: 5000, desc: 'Monthly advance - March 2024', mode: 'cash' },
      // Trip 7 - Gaya to Bodh Gaya (Marble Tiles)
      { date: '2024-03-01', type: 'fuel_expense', amount: 3000, desc: 'Fuel - Gaya to Bodh Gaya (Marble Tiles)', mode: 'cash' },
      { date: '2024-03-02', type: 'trip_payment', amount: 5500, desc: 'Trip settlement - Gaya to Bodh Gaya (Marble Tiles)', mode: 'bank' },
      // Trip 8 - Bodh Gaya to Patna (Stone Chips)
      { date: '2024-03-10', type: 'fuel_expense', amount: 6500, desc: 'Fuel - Bodh Gaya to Patna (Stone Chips)', mode: 'cash' },
      { date: '2024-03-10', type: 'toll_expense', amount: 900, desc: 'Toll - Bodh Gaya to Patna', mode: 'cash' },
      { date: '2024-03-11', type: 'trip_payment', amount: 16000, desc: 'Trip settlement - Bodh Gaya to Patna (Stone Chips)', mode: 'bank' },
      // Other expense
      { date: '2024-03-12', type: 'other_expense', amount: 3500, desc: 'Tyre repair & alignment at Patna workshop', mode: 'cash' },
      // Trip 9 - Patna to Begusarai (Iron Rods)
      { date: '2024-03-18', type: 'fuel_expense', amount: 7000, desc: 'Fuel - Patna to Begusarai (Iron Rods)', mode: 'cash' },
      { date: '2024-03-19', type: 'trip_payment', amount: 17500, desc: 'Trip settlement - Patna to Begusarai (Iron Rods)', mode: 'bank' },
      // Recovery
      { date: '2024-03-20', type: 'recovery', amount: 10000, desc: 'Recovery from previous trip balance', mode: 'bank' },
      // Trip 10 - Begusarai to Khagaria (Paddy)
      { date: '2024-03-25', type: 'fuel_expense', amount: 3500, desc: 'Fuel - Begusarai to Khagaria (Paddy)', mode: 'cash' },
      { date: '2024-03-26', type: 'trip_payment', amount: 7000, desc: 'Trip settlement - Begusarai to Khagaria (Paddy)', mode: 'bank' },
      // Trip 11 - Khagaria to Saharsa (Sugar)
      { date: '2024-04-02', type: 'fuel_expense', amount: 4500, desc: 'Fuel - Khagaria to Saharsa (Sugar)', mode: 'cash' },
      { date: '2024-04-03', type: 'trip_payment', amount: 10000, desc: 'Trip settlement - Khagaria to Saharsa (Sugar)', mode: 'bank' },
      // Other expense
      { date: '2024-04-05', type: 'other_expense', amount: 3000, desc: 'Vehicle service - oil change & filter replacement', mode: 'cash' },
      // Advance Apr
      { date: '2024-04-01', type: 'advance', amount: 5000, desc: 'Monthly advance - April 2024', mode: 'cash' },
      // Trip 12 - Saharsa to Purnea (Bamboo Sticks, in progress)
      { date: '2024-04-08', type: 'fuel_expense', amount: 4500, desc: 'Fuel - Saharsa to Purnea (Bamboo Sticks)', mode: 'cash' },
      { date: '2024-04-08', type: 'toll_expense', amount: 700, desc: 'Toll - Saharsa to Purnea', mode: 'cash' },
    ];

    // Process 5 transactions at a time
    for (let i = 0; i < transactions.length; i += 5) {
      const batch = transactions.slice(i, i + 5);
      await prisma.$transaction(async (tx) => {
        for (const txData of batch) {
          const isDebit = ['advance', 'fuel_expense', 'toll_expense', 'other_expense'].includes(txData.type);
          if (isDebit) runningBalance += txData.amount;
          else runningBalance -= txData.amount;

          await tx.driverTransaction.create({
            data: {
              driver_id: driver.driver_id,
              transaction_type: txData.type,
              amount: txData.amount,
              balance_before: runningBalance - (isDebit ? txData.amount : -txData.amount),
              balance_after: runningBalance,
              description: txData.desc,
              payment_mode: txData.mode || 'cash',
              recorded_by: admin.admin_id,
              transaction_date: new Date(txData.date + 'T10:00:00Z'),
            }
          });
        }
      });
    }
    console.log(`✅ ${transactions.length} ledger entries created`);

    // ============================================================
    // 4. TIMELINE EVENTS
    //    Note: Timeline events are stored in driver_timeline table
    //    which is separate from the Booking Management table.
    //    No booking records are created.
    // ============================================================
    const timelineEvents = [
      { date: '2024-01-12T09:00:00Z', type: 'driver_created', desc: 'Driver Ramesh Kumar registered with code DRV000001' },
      { date: '2024-01-12T09:30:00Z', type: 'vehicle_assigned', desc: 'Vehicle BR09GA4589 (Tata LPT 2518) assigned to Ramesh Kumar' },
      { date: '2024-01-15T06:00:00Z', type: 'trip_started', desc: 'Trip started - Begusarai to Patna (Steel transport)' },
      { date: '2024-01-15T18:00:00Z', type: 'trip_completed', desc: 'Trip completed - Begusarai to Patna. Revenue: ₹18,500' },
      { date: '2024-01-16T10:00:00Z', type: 'payment_recorded', desc: 'Trip payment of ₹18,500 recorded for Begusarai-Patna trip' },
      { date: '2024-01-22T06:00:00Z', type: 'trip_started', desc: 'Trip started - Patna to Muzaffarpur (Cement)' },
      { date: '2024-01-22T14:00:00Z', type: 'trip_completed', desc: 'Trip completed - Patna to Muzaffarpur. Revenue: ₹12,000' },
      { date: '2024-01-22T16:00:00Z', type: 'fuel_added', desc: 'Fuel expense of ₹5,500 recorded for Patna-Muzaffarpur trip' },
      { date: '2024-01-28T06:00:00Z', type: 'trip_started', desc: 'Trip started - Muzaffarpur to Darbhanga (Fertilizer)' },
      { date: '2024-01-28T17:00:00Z', type: 'trip_completed', desc: 'Trip completed - Muzaffarpur to Darbhanga. Revenue: ₹14,000' },
      { date: '2024-02-01T10:00:00Z', type: 'advance_given', desc: 'Advance of ₹5,000 given (Monthly advance Feb)' },
      { date: '2024-02-05T06:00:00Z', type: 'trip_started', desc: 'Trip started - Darbhanga to Sitamarhi (Rice)' },
      { date: '2024-02-05T14:00:00Z', type: 'trip_completed', desc: 'Trip completed - Darbhanga to Sitamarhi. Revenue: ₹9,500' },
      { date: '2024-02-12T06:00:00Z', type: 'trip_started', desc: 'Trip started - Sitamarhi to Motihari (Wheat)' },
      { date: '2024-02-12T16:00:00Z', type: 'trip_completed', desc: 'Trip completed - Sitamarhi to Motihari. Revenue: ₹11,000' },
      { date: '2024-02-20T05:00:00Z', type: 'trip_started', desc: 'Trip started - Motihari to Gaya (Cement Bricks)' },
      { date: '2024-02-20T20:00:00Z', type: 'trip_completed', desc: 'Trip completed - Motihari to Gaya. Revenue: ₹22,000' },
      { date: '2024-03-01T09:00:00Z', type: 'advance_given', desc: 'Advance of ₹5,000 given (Monthly advance Mar)' },
      { date: '2024-03-10T06:00:00Z', type: 'trip_started', desc: 'Trip started - Bodh Gaya to Patna (Stone Chips)' },
      { date: '2024-03-10T18:00:00Z', type: 'trip_completed', desc: 'Trip completed - Bodh Gaya to Patna. Revenue: ₹16,000' },
      { date: '2024-03-12T11:00:00Z', type: 'expense_recorded', desc: 'Other expense of ₹3,500 - Tyre repair & alignment' },
      { date: '2024-04-01T09:00:00Z', type: 'advance_given', desc: 'Advance of ₹5,000 given (Monthly advance Apr)' },
      { date: '2024-04-08T06:00:00Z', type: 'trip_started', desc: 'Trip started - Saharsa to Purnea (Bamboo Sticks)' },
    ];

    for (let i = 0; i < timelineEvents.length; i += 5) {
      const batch = timelineEvents.slice(i, i + 5);
      await prisma.$transaction(async (tx) => {
        for (const event of batch) {
          await tx.driverTimeline.create({
            data: {
              driver_id: driver.driver_id,
              event_type: event.type,
              description: event.desc,
              created_at: new Date(event.date),
            }
          });
        }
      });
    }
    console.log(`✅ ${timelineEvents.length} timeline events created`);

    // ============================================================
    // 5. SUMMARY
    // ============================================================
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  Seed Complete!                                ║');
    console.log('╚══════════════════════════════════════════════════╝\n');
    console.log('📋 Driver Summary:');
    console.log('   ─────────────────────────────────────────────');
    console.log(`   Name:        Ramesh Kumar`);
    console.log(`   Driver Code: DRV000001`);
    console.log(`   Mobile:      9876543210`);
    console.log(`   Vehicle:     BR09GA4589 (Tata LPT 2518)`);
    console.log(`   Status:      Available`);
    console.log(`   ─────────────────────────────────────────────`);
    console.log(`   Ledger Entries:     ${transactions.length}`);
    console.log(`   Timeline Events:    ${timelineEvents.length}`);
    console.log(`   ─────────────────────────────────────────────`);
    console.log(`   Booking Table:      Untouched ✅`);
    console.log('\n✅ All driver demo data seeded successfully!\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error.message);
    if (error.meta) console.error('Meta:', JSON.stringify(error.meta));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seed();

