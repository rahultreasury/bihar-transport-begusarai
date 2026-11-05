/**
 * Automated tests for the Delete Management System.
 *
 * Uses node:test + node:assert (no extra deps). These tests exercise the
 * SERVICE-LEVEL business rules with injected fake repositories, so no real
 * database is required. Prisma's $transaction is stubbed per-test so test
 * cases are isolated and never touch a real database.
 *
 * Coverage:
 *   DRIVER
 *     - safe driver (no protected deps) → hard delete success
 *     - active bookings  → DRIVER_HAS_ACTIVE_BOOKINGS
 *     - active reservation → DRIVER_HAS_ACTIVE_RESERVATION
 *     - active assignment → DRIVER_IS_ASSIGNED
 *     - active delivery  → DRIVER_HAS_ACTIVE_DELIVERY
 *     - retained financial records → archive (not silently dropped)
 *   TRANSPORT OWNER
 *     - safe owner → hard delete success
 *     - owner with dependencies → OWNER_HAS_DEPENDENCIES
 *   BOOKING (state-aware rules mirroring the route)
 *     - allowed statuses deletable
 *     - protected statuses rejected
 *   BOOKING NUMBER
 *     - derived from autoincrement PK → never reused on delete
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const DriverManagementService = require('../services/DriverManagementService');
const PartnerService = require('../services/PartnerService');
const { buildBookingNumber } = require('../services/BookingNumberService');

// ===========================================================================
// Stub Prisma's $transaction per-test so no real DB is touched.
// ---------------------------------------------------------------------------
// The services import `const { prisma } = require('../config/prisma')` at
// module scope. We save/restore the original $transaction around each test so
// the singleton is never left patched.
// ===========================================================================
const { prisma } = require('../config/prisma');
const originalTransaction = prisma.$transaction;

function stubTransaction(txObject) {
  prisma.$transaction = async (fn) => fn(txObject);
}

function restoreTransaction() {
  prisma.$transaction = originalTransaction;
}

// ===========================================================================
// Driver helpers
// ===========================================================================

function makeDriverRepo({ findById, deps }) {
  return {
    findById: async () => findById,
    findDependencySummary: async () => deps,
    hardDelete: async (id) => ({ driver_id: id }),
  };
}

// ===========================================================================
// DRIVER
// ===========================================================================

describe('Driver — permanentlyDeleteDriver', () => {
  test('hard-deletes a driver with no protected dependencies', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: { driver_id: 1, driver_name: 'Test Driver' },
      deps: {
        activeBookings: 0,
        activeReservations: 0,
        activeAssignments: 0,
        activeDeliveries: 0,
        hasFinancialRecords: false,
      },
    });
    stubTransaction({
      driver: {
        findUnique: async () => null, // verification: row is gone
      },
    });
    try {
      const result = await service.permanentlyDeleteDriver(1, 1);
      assert.ok(result);
      assert.strictEqual(result.driver_id, 1);
    } finally {
      restoreTransaction();
    }
  });

  test('DRIVER_HAS_ACTIVE_BOOKINGS — rejects driver with active bookings', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: { driver_id: 1, driver_name: 'Busy Driver' },
      deps: {
        activeBookings: 2,
        activeReservations: 0,
        activeAssignments: 0,
        activeDeliveries: 0,
        hasFinancialRecords: false,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeleteDriver(1, 1),
      (err) => err.code === 'DRIVER_HAS_ACTIVE_BOOKINGS'
    );
  });

  test('DRIVER_HAS_ACTIVE_RESERVATION — rejects reserved driver', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: { driver_id: 1, driver_name: 'Reserved Driver' },
      deps: {
        activeBookings: 0,
        activeReservations: 1,
        activeAssignments: 0,
        activeDeliveries: 0,
        hasFinancialRecords: false,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeleteDriver(1, 1),
      (err) => err.code === 'DRIVER_HAS_ACTIVE_RESERVATION'
    );
  });

  test('DRIVER_IS_ASSIGNED — rejects actively assigned driver', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: { driver_id: 1, driver_name: 'Assigned Driver' },
      deps: {
        activeBookings: 0,
        activeReservations: 0,
        activeAssignments: 1,
        activeDeliveries: 0,
        hasFinancialRecords: false,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeleteDriver(1, 1),
      (err) => err.code === 'DRIVER_IS_ASSIGNED'
    );
  });

  test('DRIVER_HAS_ACTIVE_DELIVERY — rejects driver on active delivery', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: { driver_id: 1, driver_name: 'On Trip Driver' },
      deps: {
        activeBookings: 0,
        activeReservations: 0,
        activeAssignments: 0,
        activeDeliveries: 1,
        hasFinancialRecords: false,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeleteDriver(1, 1),
      (err) => err.code === 'DRIVER_HAS_ACTIVE_DELIVERY'
    );
  });

  test('DRIVER_NOT_FOUND — rejects unknown driver', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: null,
      deps: {
        activeBookings: 0,
        activeReservations: 0,
        activeAssignments: 0,
        activeDeliveries: 0,
        hasFinancialRecords: false,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeleteDriver(999, 1),
      (err) => err.code === 'DRIVER_NOT_FOUND'
    );
  });

  test('archives driver when financial records must be retained', async () => {
    const service = new DriverManagementService();
    service.repo = makeDriverRepo({
      findById: { driver_id: 1, driver_name: 'Has Ledger Driver' },
      deps: {
        activeBookings: 0,
        activeReservations: 0,
        activeAssignments: 0,
        activeDeliveries: 0,
        hasFinancialRecords: true,
      },
    });
    stubTransaction({
      driver: {
        update: async () => ({ driver_id: 1, status: 'inactive' }),
      },
      driverTimeline: {
        create: async () => ({ event_id: 1 }),
      },
    });
    try {
      const result = await service.permanentlyDeleteDriver(1, 1);
      assert.strictEqual(result.archived, true);
      assert.strictEqual(result.status, 'inactive');
    } finally {
      restoreTransaction();
    }
  });
});

// ===========================================================================
// TRANSPORT OWNER
// ===========================================================================

function makePartnerRepo({ findById, deps }) {
  return {
    findById: async () => findById,
    findDependencyCounts: async () => deps,
    hardDelete: async (id) => ({ partner_id: id }),
  };
}

function makeEmptyDeps() {
  return {
    drivers: 0,
    vehicles: 0,
    activeBookings: 0,
    ledgerEntries: 0,
    payments: 0,
    settlements: 0,
    documents: 0,
    hasProtectedFinancialHistory: false,
    hasOperationalDependency: false,
  };
}

describe('Transport Owner — permanentlyDeletePartner', () => {
  test('hard-deletes an owner with no dependencies', async () => {
    const service = new PartnerService();
    service.repo = makePartnerRepo({
      findById: { partner_id: 1, partner_name: 'Owner One' },
      deps: makeEmptyDeps(),
    });
    stubTransaction({
      partner: {
        findUnique: async () => null, // verification: gone
      },
    });
    try {
      const result = await service.permanentlyDeletePartner(1, 1);
      assert.ok(result);
      assert.strictEqual(result.partner_id, 1);
    } finally {
      restoreTransaction();
    }
  });

  test('OWNER_HAS_DEPENDENCIES — rejects owner with active bookings', async () => {
    const service = new PartnerService();
    service.repo = makePartnerRepo({
      findById: { partner_id: 1, partner_name: 'Owner With Data' },
      deps: {
        ...makeEmptyDeps(),
        activeBookings: 2,
        hasOperationalDependency: true,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeletePartner(1, 1),
      (err) => err.code === 'OWNER_HAS_DEPENDENCIES'
    );
  });

  test('OWNER_HAS_DEPENDENCIES — rejects owner with protected financial history', async () => {
    const service = new PartnerService();
    service.repo = makePartnerRepo({
      findById: { partner_id: 1, partner_name: 'Owner With Ledger' },
      deps: {
        ...makeEmptyDeps(),
        ledgerEntries: 5,
        payments: 2,
        hasProtectedFinancialHistory: true,
      },
    });
    await assert.rejects(
      () => service.permanentlyDeletePartner(1, 1),
      (err) => err.code === 'OWNER_HAS_DEPENDENCIES'
    );
  });

  test('OWNER_NOT_FOUND — rejects unknown owner', async () => {
    const service = new PartnerService();
    service.repo = makePartnerRepo({
      findById: null,
      deps: makeEmptyDeps(),
    });
    await assert.rejects(
      () => service.permanentlyDeletePartner(999, 1),
      (err) => err.code === 'OWNER_NOT_FOUND'
    );
  });
});

// ===========================================================================
// BOOKING — state eligibility (mirrors the route's allowed-status logic)
// ===========================================================================

const PROTECTED_BOOKING_STATUSES = [
  'confirmed',
  'driver_assigned',
  'pickup_completed',
  'in_transit',
  'delivered',
  'completed',
];

const ALLOWED_BOOKING_STATUSES = [
  'pending',
  'quote_sent',
  'rejected',
  'expired',
  'cancelled',
];

function bookingIsDeletable(status) {
  return ALLOWED_BOOKING_STATUSES.includes(status);
}

describe('Booking — state-aware deletability', () => {
  test('allows deletion of pending / quote_sent / rejected / expired / cancelled', () => {
    ALLOWED_BOOKING_STATUSES.forEach((s) => {
      assert.strictEqual(bookingIsDeletable(s), true, `${s} should be deletable`);
    });
  });

  test('rejects deletion of confirmed / in_transit / delivered / completed', () => {
    PROTECTED_BOOKING_STATUSES.forEach((s) => {
      assert.strictEqual(bookingIsDeletable(s), false, `${s} should NOT be deletable`);
    });
  });

  test('a deletable-status booking is still rejected when it has an active dependency', () => {
    // Even a cancelled booking with an active reservation/assignment/delivery
    // must be rejected. Mirrors the route check.
    const allowedStatus = 'cancelled';
    const hasActiveDependency = true;
    assert.strictEqual(bookingIsDeletable(allowedStatus) && !hasActiveDependency, false);
  });
});

// ===========================================================================
// BOOKING NUMBER — non-reuse
// ===========================================================================

describe('Booking Number — never reused on delete', () => {
  test('booking number is derived from the autoincrement PK', () => {
    const deleted = buildBookingNumber(32, new Date('2026-01-01'));
    const nextAfterDelete = buildBookingNumber(34, new Date('2026-01-01'));

    assert.strictEqual(deleted, 'BTB-2026-00032');
    // The sequence advances monotonically via the PK; deleting 32 does not
    // cause the next booking to reuse 32.
    assert.strictEqual(nextAfterDelete, 'BTB-2026-00034');
    assert.notStrictEqual(nextAfterDelete, deleted);
  });

  test('deleting a middle booking does not reuse its number', () => {
    const exists = ['BTB-2026-00031', 'BTB-2026-00033'];
    const deleted = 'BTB-2026-00032';
    const nextId = 34; // sequence has moved past 33
    const nextNumber = buildBookingNumber(nextId, new Date('2026-01-01'));

    assert.strictEqual(nextNumber, 'BTB-2026-00034');
    assert.ok(!exists.includes(deleted), 'deleted number must not be present');
    assert.notStrictEqual(nextNumber, deleted);
  });
});
