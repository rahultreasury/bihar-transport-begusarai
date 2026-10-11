/**
 * VendorLedgerService
 * ---------------------------------------------------------------------------
 * The VENDOR ledger for Phase 3 — read-only, and built ENTIRELY on records the
 * repository already owns. No new table, no second accounting system.
 *
 * WHAT A VENDOR IS HERE
 *   In Phase 2 a Trip's vendor is `Trip.transport_owner_id → VehicleOwner`.
 *   That is a DIFFERENT entity from `Partner`, and `PartnerLedger` /
 *   `PartnerPayment` / `Settlement` are all keyed on `partner_id`. So those
 *   tables are NOT the vendor ledger for the hire chain and are not reused for
 *   it — reusing them would silently mis-key a VehicleOwner as a Partner.
 *
 *   The canonical money rows for a vendor already exist and are already
 *   written by `TripTransactionService`: `FinancialTransaction`, filtered on
 *   `transport_owner_id` (Phase 3 now also stamps that column on every vendor
 *   advance / settlement, see `TripTransactionService.createTransaction`).
 *   This service is the READ side of that ledger and nothing more.
 *
 * THE OBLIGATION COMES FROM PHASE 2, NEVER FROM A PAYLOAD
 *      Gross Hire  −  Commission  =  Net Vendor Payable
 *   is computed by `VehicleHireService.computeCommissionAmount()` — the single
 *   Phase 2 calculator — so this file never re-implements the arithmetic and
 *   never reads `net_vendor_payable` / `owner_payable` / `vendor_payable` from
 *   a browser.
 *
 * THE IDENTITY IT PROVES
 *      Net Vendor Payable  −  Advances  −  Payments  =  Outstanding
 *   and, rolled up per vendor:
 *      Opening Balance  +  New Obligations  −  Advances/Payments
 *                         = Closing Balance
 *
 * HOW A TRANSACTION TYPE IS CLASSIFIED
 *   Uses the canonical `FinancialTransactionType` / `TransactionDirection`
 *   enums that already exist. Classification is a whitelist, so a future or
 *   unrelated transaction type is reported but never quietly counted as money
 *   out to the vendor.
 *
 *   ADVANCE  : OWNER_ADVANCE   — BT → TRANSPORT_OWNER (money already paid out)
 *   PAYMENT  : OWNER_SETTLEMENT — BT → TRANSPORT_OWNER (final/partial payment)
 *   REVERSAL : a reversal of either of the above, signed back
 *   FUEL (AdvanceType FUEL_ADVANCE / TripExpenseType DIESEL) is deliberately
 *   NOT vendor money: a fuel advance is paid to the DRIVER for diesel, and a
 *   recorded diesel spend is a `TripExpense`. Neither reduces the vendor's
 *   payable and neither appears here (STEP 13).
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const VehicleHireService = require('./VehicleHireService');
const { NotFoundError } = require('../utils/AppError');
const { roundMoney } = VehicleHireService;

/**
 * Canonical money movements that reduce a vendor's outstanding balance.
 * Keyed by the existing Prisma `FinancialTransactionType` enum.
 */
const VENDOR_MONEY_TYPES = Object.freeze({
  OWNER_ADVANCE: 'ADVANCE',
  OWNER_SETTLEMENT: 'PAYMENT',
  REVERSAL: 'REVERSAL',
});

class VendorLedgerService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.vehicleHireService = new VehicleHireService(deps);
  }

  // =========================================================================
  // CLASSIFICATION
  // =========================================================================

  /**
   * Classify a canonical transaction as vendor money or not.
   *
   * A reversal restores whatever its original reversed, so it is signed from
   * the direction of the row it points at rather than guessed.
   *
   * @param {Object} tx - a FinancialTransaction row
   * @returns {{counts:boolean, impact:string, sign:number}} sign is −1 when
   *          the transaction INCREASES what the vendor is owed.
   */
  classifyTransaction(tx) {
    const type = tx.transaction_type;

    if (type === 'REVERSAL') {
      let originalType = null;
      try {
        const meta = tx.metadata ? JSON.parse(tx.metadata) : {};
        originalType = meta.original_type || null;
      } catch {
        originalType = null;
      }
      if (!VENDOR_MONEY_TYPES[originalType]) {
        return { counts: false, impact: 'REVERSAL', sign: 0 };
      }
      // A reversal points the other way from the row it undoes.
      const forwards = VENDOR_MONEY_TYPES[originalType];
      return {
        counts: true,
        impact: forwards === 'ADVANCE' ? 'ADVANCE_REVERSED' : 'PAYMENT_REVERSED',
        sign: 1,
      };
    }

    const impact = VENDOR_MONEY_TYPES[type];
    if (!impact) return { counts: false, impact: 'OTHER', sign: 0 };

    // An OWNER_ADVANCE / OWNER_SETTLEMENT is only vendor money when it really
    // left Bihar Transport for the vendor. Anything else is ignored.
    const outToVendor =
      tx.direction === 'DEBIT' &&
      tx.to_party === 'TRANSPORT_OWNER';

    if (!outToVendor) return { counts: false, impact, sign: 0 };

    return { counts: true, impact, sign: -1 };
  }

  // =========================================================================
  // PER-TRIP POSITION (STEP 3 / 4 / 5 / 6)
  // =========================================================================

  /**
   * The authoritative money position of ONE trip, for its vendor.
   *
   * Everything here is server-derived. `payload` is accepted only so a caller
   * can prove that a browser-supplied payable is ignored — it is never read.
   *
   * @param {number} tripId
   * @param {Object} [payload] - ignored on purpose (documented, testable)
   * @returns {Promise<Object>}
   */
  async getOwnerPosition(tripId, payload = null) { // eslint-disable-line no-unused-vars
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: Number(tripId) },
      select: {
        trip_id: true,
        trip_number: true,
        booking_id: true,
        trip_date: true,
        status: true,
        freight_amount: true,
        commission_type: true,
        commission_percentage: true,
        transport_owner_id: true,
        vehicle_id: true,
        driver_id: true,
        transportOwner: {
          select: { owner_id: true, owner_name: true, owner_type: true, mobile: true },
        },
      },
    });

    if (!trip) throw new NotFoundError('Trip not found');

    // ── The Phase 2 identity, from the one existing calculator ─────────────
    const hire = this.vehicleHireService.buildVehicleHire(trip);

    // ── Money actually moved, from the canonical ledger ────────────────────
    const transactions = await this.prisma.financialTransaction.findMany({
      where: { trip_id: trip.trip_id },
      orderBy: [{ transaction_date: 'asc' }, { transaction_id: 'asc' }],
    });

    let advancePaid = 0;
    let paymentPaid = 0;
    let reversed = 0;

    for (const tx of transactions) {
      const { counts, impact, sign } = this.classifyTransaction(tx);
      if (!counts) continue;
      const amount = Number(tx.amount) || 0;
      if (sign === 1) { reversed += amount; continue; }
      if (impact === 'ADVANCE') advancePaid += amount;
      if (impact === 'PAYMENT') paymentPaid += amount;
    }

    const paidTotal = roundMoney(advancePaid + paymentPaid - reversed);
    const netVendorPayable = hire.netVendorPayable;
    const outstanding = roundMoney(Math.max(0, netVendorPayable - paidTotal));

    return {
      trip_id: trip.trip_id,
      trip_number: trip.trip_number,
      status: trip.status,

      vendor: hire.vendor,
      owner_id: trip.transport_owner_id,

      // ── The hire, unchanged by any money movement ───────────────────────
      grossHire: hire.grossHire,
      commissionAmount: hire.commissionAmount,
      netVendorPayable,

      // ── The money, kept strictly apart from the hire ────────────────────
      advancePaid: roundMoney(advancePaid),
      paymentPaid: roundMoney(paymentPaid),
      reversedAmount: roundMoney(reversed),
      paidTotal,
      outstanding,
      settled: outstanding === 0,

      paymentStatus: this._paymentStatus(netVendorPayable, paidTotal),

      transactionCount: transactions.length,
    };
  }

  // =========================================================================
  // PER-VENDOR LEDGER (STEP 9)
  // =========================================================================

  /**
   * Chronological accounting for ONE vendor across ALL their trips.
   *
   * Every line carries, in the repository's existing schema terminology:
   * date · Trip · transaction type · debit/credit direction · amount ·
   * reference · running balance.
   *
   * @param {number} ownerId - VehicleOwner.owner_id
   * @param {{from?:string,to?:string,tripId?:number}} [filters]
   * @returns {Promise<Object>}
   */
  async getOwnerLedger(ownerId, filters = {}) {
    const id = Number(ownerId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new NotFoundError('Vehicle owner not found');
    }

    const owner = await this.prisma.vehicleOwner.findUnique({
      where: { owner_id: id },
      select: { owner_id: true, owner_name: true, owner_type: true, mobile: true, partner_link: true },
    });
    if (!owner) throw new NotFoundError('Vehicle owner not found');

    const tripWhere = { transport_owner_id: id };
    if (filters.tripId) tripWhere.trip_id = Number(filters.tripId);

    const trips = await this.prisma.trip.findMany({
      where: tripWhere,
      select: {
        trip_id: true,
        trip_number: true,
        trip_date: true,
        created_at: true,
        status: true,
        freight_amount: true,
        commission_type: true,
        commission_percentage: true,
        transport_owner_id: true,
      },
      orderBy: [{ trip_date: 'asc' }, { trip_id: 'asc' }],
    });

    // ── One merged, date-ordered event stream ──────────────────────────────
    const events = [];

    for (const trip of trips) {
      const hire = this.vehicleHireService.buildVehicleHire(trip);
      events.push({
        sortKey: new Date(trip.trip_date || trip.created_at || 0).getTime(),
        order: 0,
        kind: 'OBLIGATION',
        date: trip.trip_date || trip.created_at,
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        transaction_type: 'VEHICLE_HIRE_OBLIGATION',
        direction: 'CREDIT', // increases what the vendor is owed
        amount: hire.netVendorPayable,
        reference: hire.grossHire !== hire.netVendorPayable
          ? `gross ${hire.grossHire} − commission ${hire.commissionAmount}`
          : 'gross hire (no commission)',
        balance: null,
        payment_method: null,
        created_by: null,
        notes: 'Net vendor payable raised by the vehicle hire (gross − commission)',
      });
    }

    if (trips.length > 0) {
      const tripIds = trips.map((t) => t.trip_id);
      const txWhere = { trip_id: { in: tripIds } };
      if (filters.from || filters.to) {
        txWhere.transaction_date = {};
        if (filters.from) txWhere.transaction_date.gte = new Date(filters.from);
        if (filters.to) txWhere.transaction_date.lte = new Date(filters.to);
      }

      const transactions = await this.prisma.financialTransaction.findMany({
        where: txWhere,
        orderBy: [{ transaction_date: 'asc' }, { transaction_id: 'asc' }],
        select: {
          transaction_id: true,
          trip_id: true,
          transaction_type: true,
          amount: true,
          direction: true,
          // classifyTransaction() decides whether a row is vendor money by
          // reading the parties, so they must be selected — omitting them would
          // silently drop every advance and payment from the statement.
          from_party: true,
          to_party: true,
          transaction_date: true,
          reference_number: true,
          payment_method: true,
          created_by: true,
          notes: true,
          purpose: true,
          metadata: true,
        },
      });

      const tripById = new Map(trips.map((t) => [t.trip_id, t]));

      for (const tx of transactions) {
        const { counts, impact, sign } = this.classifyTransaction(tx);
        if (!counts) continue;

        events.push({
          sortKey: new Date(tx.transaction_date || 0).getTime(),
          order: 1,
          kind: 'MONEY',
          date: tx.transaction_date,
          trip_id: tx.trip_id,
          trip_number: tripById.get(tx.trip_id)?.trip_number || null,
          transaction_id: tx.transaction_id,
          transaction_type: tx.transaction_type,
          direction: tx.direction,
          impact,
          amount: roundMoney((Number(tx.amount) || 0) * sign),
          reference: tx.reference_number,
          balance: null,
          payment_method: tx.payment_method,
          created_by: tx.created_by,
          notes: tx.notes || tx.purpose,
        });
      }
    }

    // ── Running balance ───────────────────────────────────────────────────
    events.sort((a, b) => a.sortKey - b.sortKey || a.order - b.order
      || (a.trip_id || 0) - (b.trip_id || 0));

    let balance = 0;
    let totalObligations = 0;
    let totalAdvances = 0;
    let totalPayments = 0;

    for (const e of events) {
      balance = roundMoney(balance + e.amount);
      e.balance = balance;

      if (e.kind === 'OBLIGATION') totalObligations = roundMoney(totalObligations + e.amount);
      else if (e.impact === 'ADVANCE') totalAdvances = roundMoney(totalAdvances + Math.abs(e.amount));
      else if (e.impact === 'PAYMENT') totalPayments = roundMoney(totalPayments + Math.abs(e.amount));
    }

    return {
      owner: {
        owner_id: owner.owner_id,
        owner_name: owner.owner_name,
        owner_type: owner.owner_type,
        mobile: owner.mobile,
        partner_link: owner.partner_link ?? null,
      },
      // Opening balance  +  obligations  −  advances/payments  =  closing
      openingBalance: 0,
      totalObligations,
      totalAdvances,
      totalPayments,
      closingBalance: balance,
      outstanding: roundMoney(Math.max(0, balance)),
      settled: balance === 0,
      tripCount: trips.length,
      entryCount: events.length,
      entries: events,
    };
  }

  /**
   * Per-trip position for every trip of one vendor — the "which trip still owes
   * what" view. Uses the same canonical reads as `getOwnerLedger`.
   *
   * @param {number} ownerId
   * @returns {Promise<Array>}
   */
  async getOwnerTripPositions(ownerId) {
    const id = Number(ownerId);
    const trips = await this.prisma.trip.findMany({
      where: { transport_owner_id: id },
      select: { trip_id: true },
      orderBy: { trip_id: 'asc' },
    });

    const positions = [];
    for (const t of trips) {
      positions.push(await this.getOwnerPosition(t.trip_id));
    }
    return positions;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  /**
   * Payment status for a vendor balance. Mirrors the PENDING / PARTIAL / PAID
   * convention the repository already uses on `PaymentStatus`, so no new
   * vocabulary is introduced.
   *
   * @param {number} payable
   * @param {number} paid
   * @returns {'PENDING'|'PARTIAL'|'PAID'}
   */
  _paymentStatus(payable, paid) {
    if (payable > 0 && paid >= payable) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return 'PENDING';
  }
}

module.exports = VendorLedgerService;
module.exports.VendorLedgerService = VendorLedgerService;
module.exports.VENDOR_MONEY_TYPES = VENDOR_MONEY_TYPES;
