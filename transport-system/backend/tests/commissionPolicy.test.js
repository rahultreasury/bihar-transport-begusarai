/**
 * Focused tests for the FIXED 5% commission policy (Phase 1B).
 *
 * What this proves:
 *   1. ₹5,000   -> 5% -> ₹250
 *   2. ₹10,000  -> 5% -> ₹500
 *   3. ₹100,000 -> 5% -> ₹5,000
 *   4. A caller cannot get 10% through normal business flow (applyCommission
 *      coerces any non-5 caller rate to 5 and records the override).
 *   5. Owner share formula: freight - commission = owner_share
 *   6. Historical commission rows are NOT recomputed by policy changes
 *      (TripFinancialService.calculateTripFinancial preserves the booking
 *      snapshot when one exists).
 *
 * Conventions:
 *   - node:test + node:assert (matches the rest of the project's tests).
 *   - No external deps.
 *   - Services are exercised via real require()s. Repositories are replaced
 *     by direct assignment on the service instance after construction.
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert');

const commissionPolicy = require('../config/commissionPolicy');
const { computeCommission } = require('../services/CommissionCalculator');

const prismaModule = require('../config/prisma');
// CommissionService / TripFinancialService did `const { prisma } = require(...)`
// at module-load time, so we MUST mutate the same PrismaClient instance, not
// the exports.
const realPrismaBooking = prismaModule.prisma.booking;

const CommissionService = require('../services/CommissionService');
const TripFinancialService = require('../services/TripFinancialService');

describe('commissionPolicy — fixed 5% business rule', () => {
  test('policy constant is exactly 5', () => {
    assert.strictEqual(commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE, 5);
    assert.strictEqual(commissionPolicy.DEFAULT_COMMISSION_TYPE, 'percentage');
  });

  test('CASE 1: freight ₹5,000   -> commission ₹250', () => {
    const commission = computeCommission({
      base: 5000,
      rate: commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE,
      type: commissionPolicy.DEFAULT_COMMISSION_TYPE,
    });
    assert.strictEqual(commission, 250);
  });

  test('CASE 2: freight ₹10,000  -> commission ₹500', () => {
    const commission = computeCommission({
      base: 10000,
      rate: commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE,
      type: commissionPolicy.DEFAULT_COMMISSION_TYPE,
    });
    assert.strictEqual(commission, 500);
  });

  test('CASE 3: freight ₹100,000 -> commission ₹5,000', () => {
    const commission = computeCommission({
      base: 100000,
      rate: commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE,
      type: commissionPolicy.DEFAULT_COMMISSION_TYPE,
    });
    assert.strictEqual(commission, 5000);
  });

  test('CASE 5: owner share = freight - commission (₹5,000 - ₹250 = ₹4,750)', () => {
    const freight = 5000;
    const commission = computeCommission({
      base: freight,
      rate: commissionPolicy.DEFAULT_COMMISSION_PERCENTAGE,
      type: commissionPolicy.DEFAULT_COMMISSION_TYPE,
    });
    const ownerShare = freight - commission;
    assert.strictEqual(commission, 250);
    assert.strictEqual(ownerShare, 4750);
  });

  test('computeWithPolicy convenience wrapper matches manual composition', () => {
    const a = commissionPolicy.computeWithPolicy({ base: 5000 });
    const b = computeCommission({ base: 5000, rate: 5, type: 'percentage' });
    assert.strictEqual(a, b);
    assert.strictEqual(a, 250);
  });

  test('computeWithPolicy accepts caller override (still pure math)', () => {
    // Even with an override, the calculator stays pure. The business
    // layer (CommissionService.applyCommission) is responsible for
    // forcing the policy value, NOT this wrapper.
    const a = commissionPolicy.computeWithPolicy({ base: 1000, rate: 10 });
    assert.strictEqual(a, 100);
  });
});

/**
 * Build a fresh CommissionService instance with all repositories stubbed,
 * and return both the service and the call-recording bag.
 */
function buildCommissionServiceStubs(bookingRow) {
  const calls = {
    commissionRepo_create: [],
    financialTx_create: [],
    booking_update: [],
    audit_create: [],
    tripFinancial_calculateTripFinancial: 0,
  };

  const tripFinancialRepo = {
    findByBookingId: async () => ({
      trip_financial_id: 1,
      commission_rate: null,
      commission_amount: null,
      status: 'DRAFT',
    }),
    update: async () => ({}),
    calculateTripFinancial: async () => {
      calls.tripFinancial_calculateTripFinancial += 1;
      return null;
    },
  };

  const commissionRepo = {
    create: async (data) => {
      calls.commissionRepo_create.push(data);
      return { commission_id: calls.commissionRepo_create.length, ...data };
    },
  };

  const financialTxRepo = {
    create: async (data) => {
      calls.financialTx_create.push(data);
      return { id: calls.financialTx_create.length, ...data };
    },
  };

  const auditRepo = {
    create: async (data) => {
      calls.audit_create.push(data);
      return { id: calls.audit_create.length, ...data };
    },
  };

  // Mutate the singleton Prisma instance directly so the destructured
  // reference held inside CommissionService resolves to our stub.
  prismaModule.prisma.booking = {
    findUnique: async () => bookingRow,
    update: async (args) => {
      calls.booking_update.push(args.data);
      return args.data;
    },
  };

  const svc = new CommissionService();
  svc.tripFinancialRepo = tripFinancialRepo;
  svc.commissionRepo = commissionRepo;
  svc.financialTxRepo = financialTxRepo;
  svc.auditRepo = auditRepo;

  return { svc, calls };
}

describe('commissionPolicy — write paths must yield 5%, never 10%', () => {
  after(() => {
    prismaModule.prisma.booking = realPrismaBooking;
  });

  test('CommissionService.applyCommission forces 5% even if caller sends 10', async () => {
    const { svc, calls } = buildCommissionServiceStubs({
      final_price: 5000,
      commission_percentage: null,
      commission_amount: null,
      commission_type: 'percentage',
      partner_id: null,
    });

    const result = await svc.applyCommission(
      42,
      { commission_rate: 10, commission_type: 'percentage' },
      { user_id: 1, role: 'admin' }
    );

    assert.strictEqual(result.commission_rate, 5, 'rate must be coerced to 5');
    assert.strictEqual(result.commission_amount, 250, 'amount must be ₹250');
    assert.strictEqual(result.commission_base, 5000);

    assert.strictEqual(calls.booking_update.length, 1);
    assert.strictEqual(calls.booking_update[0].commission_percentage, 5);
    assert.strictEqual(calls.booking_update[0].commission_amount, 250);

    assert.strictEqual(calls.audit_create.length, 1);
    const auditPayload = JSON.parse(calls.audit_create[0].new_value);
    assert.strictEqual(auditPayload.policy_rate, 5);
    assert.strictEqual(auditPayload.caller_supplied_rate, 10);
    assert.strictEqual(auditPayload.policy_override, true);
  });

  test('CommissionService.applyCommission: caller sending 5 yields exactly 5% (no override)', async () => {
    const { svc, calls } = buildCommissionServiceStubs({
      final_price: 10000,
      commission_percentage: null,
      commission_amount: null,
      commission_type: 'percentage',
      partner_id: null,
    });

    await svc.applyCommission(
      99,
      { commission_rate: 5, commission_type: 'percentage' },
      { user_id: 1, role: 'admin' }
    );

    assert.strictEqual(calls.booking_update[0].commission_percentage, 5);
    assert.strictEqual(calls.booking_update[0].commission_amount, 500);
    const auditPayload = JSON.parse(calls.audit_create[0].new_value);
    assert.strictEqual(auditPayload.policy_override, false);
  });

  test('CommissionService.applyCommission: caller omitting rate also yields 5%', async () => {
    const { svc, calls } = buildCommissionServiceStubs({
      final_price: 100000,
      commission_percentage: null,
      commission_amount: null,
      commission_type: 'percentage',
      partner_id: null,
    });

    await svc.applyCommission(
      7,
      { /* no rate supplied */ },
      { user_id: 1, role: 'admin' }
    );

    assert.strictEqual(calls.booking_update[0].commission_percentage, 5);
    assert.strictEqual(calls.booking_update[0].commission_amount, 5000);
  });
});

/**
 * Build a fresh TripFinancialService instance with all repositories stubbed.
 */
function buildTripFinancialServiceStubs(bookingRow) {
  const calls = {
    tripFinancial_update: [],
    commissionRepo_create: [],
    financialTx_create: [],
  };

  const tripFinancialRepo = {
    findByBookingId: async () => ({
      trip_financial_id: 1,
      status: 'CALCULATED',
    }),
    update: async (id, data) => {
      calls.tripFinancial_update.push(data);
      return { trip_financial_id: id, ...data };
    },
  };

  const tripAdvanceRepo = {
    findByBookingId: async () => [],
  };

  const tripSettlementRepo = {
    findOrCreateByBookingId: async () => ({}),
  };

  let hasHistoricalCommission = false;
  const commissionRepo = {
    findLatestByBookingId: async () => hasHistoricalCommission ? { commission_id: 999 } : null,
    create: async (data) => {
      calls.commissionRepo_create.push(data);
      return { commission_id: calls.commissionRepo_create.length, ...data };
    },
  };

  const financialTxRepo = { create: async (data) => { calls.financialTx_create.push(data); return {}; } };
  const auditRepo = { create: async () => ({}) };

  prismaModule.prisma.booking = {
    findUnique: async () => bookingRow,
  };

  const svc = new TripFinancialService();
  svc.tripFinancialRepo = tripFinancialRepo;
  svc.tripAdvanceRepo = tripAdvanceRepo;
  svc.tripSettlementRepo = tripSettlementRepo;
  svc.commissionRepo = commissionRepo;
  svc.financialTxRepo = financialTxRepo;
  svc.auditRepo = auditRepo;

  // Helper: expose the flag toggle so the historical-preservation test
  // can mark "this booking already has a commission row".
  svc.__setHasHistoricalCommission = (v) => { hasHistoricalCommission = v; };

  return { svc, calls };
}

describe('commissionPolicy — TripFinancialService.calculateTripFinancial', () => {
  after(() => {
    prismaModule.prisma.booking = realPrismaBooking;
  });

  test('when booking has NO commission_percentage snapshot, falls back to 5%', async () => {
    const { svc, calls } = buildTripFinancialServiceStubs({
      final_price: 5000,
      driver_payout: 0,
      owner_settlement_amount: 4750,
      commission_percentage: null,
      commission_amount: null,
      commission_type: 'percentage',
      partner_id: null,
    });

    await svc.calculateTripFinancial(42, {});

    assert.strictEqual(calls.tripFinancial_update.length, 1);
    assert.strictEqual(calls.tripFinancial_update[0].commission_rate, 5);
    assert.strictEqual(calls.tripFinancial_update[0].commission_amount, 250);

    assert.strictEqual(calls.commissionRepo_create.length, 1);
    assert.strictEqual(calls.commissionRepo_create[0].commission_rate, 5);
    assert.strictEqual(calls.commissionRepo_create[0].commission_amount, 250);
  });

  test('CASE 6: when booking HAS a commission_percentage snapshot, it is preserved (no recalc)', async () => {
    const { svc, calls } = buildTripFinancialServiceStubs({
      final_price: 5000,
      driver_payout: 0,
      owner_settlement_amount: 4750,
      commission_percentage: 5,
      commission_amount: 250,
      commission_type: 'percentage',
      partner_id: null,
    });
    svc.__setHasHistoricalCommission(true);

    await svc.calculateTripFinancial(123, {});

    // The rate from the snapshot (5) was used.
    assert.strictEqual(calls.tripFinancial_update[0].commission_rate, 5);
    assert.strictEqual(calls.tripFinancial_update[0].commission_amount, 250);

    // CRITICAL: No new CommissionRecord was created because a historical
    // one already exists. This proves historical data is preserved.
    assert.strictEqual(
      calls.commissionRepo_create.length,
      0,
      'historical CommissionRecord rows must NEVER be recreated'
    );
  });
});