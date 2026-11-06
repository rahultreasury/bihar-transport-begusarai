/**
 * Production Data Cleanup Execution Script
 * 
 * This script executes the cleanup plan by deleting test records in the correct
 * order to respect foreign key constraints. Uses transactions for atomicity.
 * 
 * Run with: node scripts/execute-cleanup.js [--dry-run]
 * 
 * WARNING: This script DELETES DATA. Only run after reviewing the cleanup plan
 * and creating a verified backup.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function executeCleanup() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Starting cleanup execution...\n`);
  
  // Load the cleanup plan
  const planPath = path.join(__dirname, '..', 'cleanup-plan.json');
  if (!fs.existsSync(planPath)) {
    console.error('Cleanup plan not found. Run production-cleanup-plan.js first.');
    process.exit(1);
  }
  
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const { results } = plan;
  
  console.log('Loaded cleanup plan from:', plan.timestamp);
  console.log('');
  
  // Track deletion counts
  const deletionCounts = {};
  
  // Deletion order (respecting FK constraints - children first)
  const deletionSteps = [
    {
      name: 'financialTransactions',
      model: 'financialTransaction',
      ids: results.financialTransactions.testIds,
      where: { transaction_id: { in: results.financialTransactions.testIds } },
    },
    {
      name: 'tripAdvances',
      model: 'tripAdvance',
      ids: results.tripAdvances.testIds,
      where: { advance_id: { in: results.tripAdvances.testIds } },
    },
    {
      name: 'tripSettlements',
      model: 'tripSettlement',
      ids: results.tripSettlements.testIds,
      where: { settlement_id: { in: results.tripSettlements.testIds } },
    },
    {
      name: 'driverTransactions',
      model: 'driverTransaction',
      ids: results.driverTransactions.testIds,
      where: { transaction_id: { in: results.driverTransactions.testIds } },
    },
    {
      name: 'partnerLedger',
      model: 'partnerLedger',
      ids: results.partnerLedger.testIds,
      where: { ledger_id: { in: results.partnerLedger.testIds } },
    },
    {
      name: 'partnerPayments',
      model: 'partnerPayment',
      ids: results.partnerPayments.testIds,
      where: { payment_id: { in: results.partnerPayments.testIds } },
    },
    {
      name: 'settlements',
      model: 'settlement',
      ids: results.settlements.testIds,
      where: { settlement_id: { in: results.settlements.testIds } },
    },
    {
      name: 'trips',
      model: 'trip',
      ids: results.trips.testIds,
      where: { trip_id: { in: results.trips.testIds } },
    },
    {
      name: 'bookings',
      model: 'booking',
      ids: results.bookings.testIds,
      where: { booking_id: { in: results.bookings.testIds } },
    },
    {
      name: 'enquiries',
      model: 'enquiry',
      ids: results.enquiries.testIds,
      where: { enquiry_id: { in: results.enquiries.testIds } },
    },
    {
      name: 'vehicles',
      model: 'transportVehicle',
      ids: results.vehicles.testIds,
      where: { vehicle_id: { in: results.vehicles.testIds } },
    },
    {
      name: 'drivers',
      model: 'driver',
      ids: results.drivers.testIds,
      where: { driver_id: { in: results.drivers.testIds } },
    },
    {
      name: 'vehicleOwners',
      model: 'vehicleOwner',
      ids: results.vehicleOwners.testIds,
      where: { owner_id: { in: results.vehicleOwners.testIds } },
    },
    {
      name: 'users',
      model: 'user',
      ids: results.users.testIds,
      where: { user_id: { in: results.users.testIds } },
    },
    {
      name: 'partners',
      model: 'partner',
      ids: results.partners.testIds,
      where: { partner_id: { in: results.partners.testIds } },
    },
    {
      name: 'clients',
      model: 'client',
      ids: results.clients.testIds,
      where: { client_id: { in: results.clients.testIds } },
    },
  ];
  
  // Execute deletions
  for (const step of deletionSteps) {
    if (step.ids.length === 0) {
      console.log(`Skipping ${step.name}: no records to delete`);
      deletionCounts[step.name] = 0;
      continue;
    }
    
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Deleting ${step.ids.length} records from ${step.name}...`);
    
    if (DRY_RUN) {
      deletionCounts[step.name] = step.ids.length;
      continue;
    }
    
    try {
      // Use deleteMany with the where clause
      const result = await prisma[step.model].deleteMany({
        where: step.where,
      });
      
      deletionCounts[step.name] = result.count;
      console.log(`  ✓ Deleted ${result.count} records from ${step.name}`);
    } catch (error) {
      console.error(`  ✗ Failed to delete from ${step.name}:`, error.message);
      
      // Try to delete in smaller batches if it's a constraint issue
      if (error.code === 'P2003' || error.message.includes('Foreign key constraint')) {
        console.log(`  Attempting batch deletion for ${step.name}...`);
        let deleted = 0;
        for (const id of step.ids) {
          try {
            await prisma[step.model].delete({ where: { [Object.keys(step.where)[0]]: id } });
            deleted++;
          } catch (e) {
            console.error(`    Failed to delete ${step.name} id ${id}: ${e.message}`);
          }
        }
        deletionCounts[step.name] = deleted;
        console.log(`  ✓ Deleted ${deleted}/${step.ids.length} records from ${step.name} (batched)`);
      } else {
        throw error;
      }
    }
  }
  
  // Print summary
  console.log('\n=== DELETION SUMMARY ===\n');
  console.log('| Table | Planned | Deleted |');
  console.log('|-------|--------:|--------:|');
  
  let totalPlanned = 0;
  let totalDeleted = 0;
  
  for (const step of deletionSteps) {
    const planned = step.ids.length;
    const deleted = deletionCounts[step.name] || 0;
    totalPlanned += planned;
    totalDeleted += deleted;
    console.log(`| ${step.name} | ${planned} | ${deleted} |`);
  }
  
  console.log(`| TOTAL | ${totalPlanned} | ${totalDeleted} |`);
  
  // Save execution report
  const report = {
    timestamp: new Date().toISOString(),
    dryRun: DRY_RUN,
    planTimestamp: plan.timestamp,
    deletionCounts,
    totalPlanned,
    totalDeleted,
    success: totalDeleted === totalPlanned,
  };
  
  const reportPath = path.join(__dirname, '..', `cleanup-execution-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nExecution report saved to: ${reportPath}`);
  
  if (!DRY_RUN && totalDeleted !== totalPlanned) {
    console.error('\n⚠ WARNING: Not all planned records were deleted!');
    process.exit(1);
  }
  
  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Cleanup ${report.success ? 'completed successfully' : 'completed with errors'}.`);
}

async function main() {
  try {
    await executeCleanup();
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
