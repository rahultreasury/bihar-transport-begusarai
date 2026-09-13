#!/usr/bin/env node
/**
 * backfill-orphan-drivers.js
 * ------------------------------------------------------------------
 * One-shot script: assign an existing VehicleOwner to every Driver
 * row whose `transport_owner_id` is NULL.
 *
 * Business rule (Phase 2 — Driver <-> Transport Owner required):
 *   Bihar Transport is a transport brokerage. A Driver MUST belong to
 *   exactly one Transport Owner. This script enforces that for legacy
 *   data BEFORE the schema migration that makes the relation NOT NULL.
 *
 * Allocation policy (deterministic, round-robin):
 *   - Only ACTIVE VehicleOwner rows are eligible (status='active',
 *     deleted_at IS NULL).
 *   - If NO active VehicleOwner exists, the script ABORTS (it will
 *     not invent or create new owners). This is a safety rail so the
 *     operator can register at least one owner first.
 *   - Assignment uses a stable round-robin: each orphan driver is
 *     mapped to (owners[hash(driver_id) % owners.length]).owner_id.
 *     This is deterministic — running the script twice is safe and
 *     idempotent (it only touches NULL rows).
 *
 * What it does NOT do:
 *   - Does not modify any non-NULL transport_owner_id rows.
 *   - Does not create new owners or drivers.
 *   - Does not touch trips, bookings, commissions, settlements, ledgers,
 *     or any financial record.
 *
 * Usage:
 *     node scripts/backfill-orphan-drivers.js
 *
 * Exit codes:
 *   0  — success (zero orphans remain, or already zero)
 *   1  — fatal (no active VehicleOwner to backfill from)
 *
 * Safety:
 *   - Idempotent: re-runnable. Rows that already have a transport_owner_id
 *     are left untouched.
 *   - Wrapped in a single transaction so partial failures are rolled back.
 *   - Prints a summary with the EXACT count of orphans backfilled.
 */

'use strict';

const { prisma } = require('../config/prisma');

async function main() {
  console.log('=========================================================');
  console.log(' Backfill orphan drivers -> assign existing VehicleOwner');
  console.log('=========================================================');
  console.log('');

  // 1. Count orphans BEFORE the run.
  const orphanBefore = await prisma.driver.count({
    where: { transport_owner_id: null },
  });
  const totalDrivers = await prisma.driver.count();

  console.log(`Total drivers in DB                : ${totalDrivers}`);
  console.log(`Drivers with transport_owner_id NULL: ${orphanBefore}`);

  if (orphanBefore === 0) {
    console.log('');
    console.log('No orphans found. Nothing to do.');
    return;
  }

  // 2. Load eligible owners (active, not soft-deleted).
  const owners = await prisma.vehicleOwner.findMany({
    where: {
      deleted_at: null,
      OR: [{ status: 'active' }, { is_active: true }],
    },
    select: { owner_id: true, owner_name: true, owner_code: true },
    orderBy: { owner_id: 'asc' },
  });

  if (owners.length === 0) {
    console.error('');
    console.error('FATAL: No active VehicleOwner rows exist in the DB.');
    console.error('       Register at least one Transport Owner before');
    console.error('       running this script. The script will NOT create');
    console.error('       synthetic owners.');
    process.exit(1);
  }

  console.log(`Eligible VehicleOwners              : ${owners.length}`);
  console.log('');
  console.log('Owners available for round-robin:');
  for (const o of owners) {
    console.log(`  - owner_id=${o.owner_id}  ${o.owner_code || ''}  ${o.owner_name}`);
  }
  console.log('');

  // 3. Pull all orphan rows.
  const orphans = await prisma.driver.findMany({
    where: { transport_owner_id: null },
    select: { driver_id: true, driver_code: true, driver_name: true },
    orderBy: { driver_id: 'asc' },
  });

  // 4. Build a deterministic mapping.
  //    Use driver_id mod owners.length as the round-robin key.
  const mapping = orphans.map((d) => {
    const idx = (d.driver_id - 1) % owners.length; // -1 so owner_id=1 starts at index 0
    return {
      driver_id: d.driver_id,
      driver_code: d.driver_code,
      driver_name: d.driver_name,
      owner_id: owners[idx].owner_id,
      owner_code: owners[idx].owner_code,
      owner_name: owners[idx].owner_name,
    };
  });

  console.log(`Will backfill ${mapping.length} driver(s) as follows:`);
  for (const m of mapping) {
    console.log(`  driver ${m.driver_id} (${m.driver_code || '—'}  ${m.driver_name}) -> owner ${m.owner_id} (${m.owner_code || '—'}  ${m.owner_name})`);
  }
  console.log('');

  // 5. Apply in a single transaction.
  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const m of mapping) {
      const result = await tx.driver.updateMany({
        where: { driver_id: m.driver_id, transport_owner_id: null },
        data: { transport_owner_id: m.owner_id },
      });
      updatedCount += result.count;
    }
  });

  // 6. Verify: count orphans AFTER the run.
  const orphanAfter = await prisma.driver.count({
    where: { transport_owner_id: null },
  });

  console.log('=========================================================');
  console.log(' Backfill summary');
  console.log('=========================================================');
  console.log(`Orphans before      : ${orphanBefore}`);
  console.log(`Drivers updated     : ${updatedCount}`);
  console.log(`Orphans after       : ${orphanAfter}`);
  if (orphanAfter === 0) {
    console.log('Status              : SUCCESS — zero orphans remain.');
  } else {
    console.log('Status              : INCOMPLETE — orphans still remain.');
    console.log('                      Re-run after creating more owners or');
    console.log('                      investigate data anomalies.');
    process.exit(2);
  }
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });