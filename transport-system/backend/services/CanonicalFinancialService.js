/**
 * CanonicalFinancialService
 * Single source of truth for ALL financial calculations in the system.
 *
 * This service consolidates duplicate calculation logic from:
 * - TripFinancialCalculationService
 * - TripFinancialService
 * - TripTransactionService
 *
 * All financial values are derived from FinancialTransaction records.
 * No other source of truth is used.
 *
 * BUSINESS RULES:
 * - Customer/Client payments are CREDIT (money in to BT)
 * - Owner/Driver advances are DEBIT (money out from BT)
 * - Owner/Driver settlements are DEBIT (money out from BT)
 * - Customer Due = Freight - Total Customer/Client Payments
 * - Owner Due = Owner Share - Owner Advances - Owner Settlements
 * - Driver Due = Driver Agreed Pay - Driver Advances - Driver Settlements
 * - Expenses are EXCLUDED from trip financial calculations
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const CommissionCalculator = require('./CommissionCalculator');
const { ValidationError, NotFoundError } = require('../utils/AppError');

class CanonicalFinancialService {
  constructor(options = {}) {
    this.prisma = options.prisma || defaultPrisma;
  }

  // ============================================================
  // TRANSACTION AGGREGATION (single source of truth)
  // ============================================================

  /**
   * Does this row represent money that actually stayed in the books?
   *
   * PHASE 7 — WHY ONLY TWO STATUSES ARE EXCLUDED
   *   `PaymentStatus` is PENDING | PARTIAL | PAID | CANCELLED | REFUNDED, and
   *   the aggregation used to ignore the column entirely, so a payment the
   *   user had cancelled or refunded still counted as cash collected.
   *
   *   Only CANCELLED and REFUNDED are excluded. They are the two states that
   *   unambiguously mean the money did not stay. PENDING and PARTIAL are
   *   deliberately still counted, because the client has NOT defined their
   *   treatment and silently re-classifying them would move balances that
   *   exist today — including a real OWNER_SETTLEMENT row on the live
   *   database. Excluding them would quietly re-open the vendor side, which
   *   this phase must never do.
   *
   * @param {Object} tx
   * @returns {boolean}
   */
  _isLiveMoney(tx) {
    return tx.status !== 'CANCELLED' && tx.status !== 'REFUNDED';
  }

  /**
   * Parse the JSON payload stored in FinancialTransaction.metadata.
   *
   * `metadata` is a TEXT column holding a JSON string. A row written by an
   * older path (or hand-edited) may not be valid JSON, and a single bad row
   * must never throw inside a balance calculation.
   *
   * @param {string|null|undefined} raw
   * @returns {Object|null}
   */
  _parseMetadata(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Aggregate financial values from FinancialTransaction records.
   * This is the ONLY place where transaction aggregation happens.
   *
   * @param {Array} transactions - FinancialTransaction records
   * @returns {Object} Aggregated values
   */
  _aggregateTransactions(transactions) {
    const result = {
      totalDriverAdvances: 0,
      totalFuelAdvances: 0,
      totalOwnerAdvances: 0,
      totalCustomerPayments: 0,
      totalClientPayments: 0,
      totalOwnerSettlements: 0,
      totalDriverSettlements: 0,
      totalExpenses: 0,
      totalCommission: 0,
    };

    // PHASE 7 — reversals. The repository ALREADY writes a REVERSAL row with
    // the opposite direction (TripTransactionService.createReversal), but the
    // switch below had no REVERSAL case, so a reversed customer payment kept
    // counting as collected forever. That is a direct contradiction: the
    // persisted ledger said "money given back" while the balance said
    // "money received".
    //
    // A REVERSAL row does not repeat the original's type, so it is resolved
    // against the original it points at — by `original_transaction_id` first,
    // then by `reference_number`, which is the same reconciliation key the
    // idempotency index uses. Anything we cannot resolve is left alone rather
    // than guessed at, and the result is floored at zero so a reversal can
    // never manufacture a negative receivable.
    const byId = new Map();
    for (const tx of transactions) {
      if (tx && tx.transaction_id != null) byId.set(Number(tx.transaction_id), tx);
    }

    const reversalsByReference = new Map();
    for (const tx of transactions) {
      if (!tx || tx.transaction_type !== 'REVERSAL') continue;
      const meta = this._parseMetadata(tx.metadata);
      const originalId = Number(meta?.original_transaction_id);
      let original = Number.isFinite(originalId) ? byId.get(originalId) : null;
      if (!original && tx.reference_number) {
        const bucket = reversalsByReference.get(tx.reference_number) || [];
        bucket.push(tx);
        reversalsByReference.set(tx.reference_number, bucket);
        continue;
      }
      if (original) this._applyReversal(result, original, tx);
    }

    // Second pass: reversals that could not be resolved by id are matched to
    // a customer payment carrying the same reference.
    for (const [reference, pending] of reversalsByReference.entries()) {
      for (const reversal of pending) {
        const original = transactions.find(
          (t) =>
            t &&
            t.transaction_type !== 'REVERSAL' &&
            t.reference_number === reference &&
            (t.transaction_type === 'CUSTOMER_PAYMENT' || t.transaction_type === 'CLIENT_PAYMENT')
        );
        if (original) this._applyReversal(result, original, reversal);
      }
    }

    for (const tx of transactions) {
      if (!tx) continue;
      if (tx.transaction_type === 'REVERSAL') continue; // already applied above
      if (!this._isLiveMoney(tx)) continue;

      const amount = tx.amount || 0;

      switch (tx.transaction_type) {
        case 'DRIVER_ADVANCE':
          result.totalDriverAdvances += amount;
          break;
        case 'FUEL_ADVANCE':
          result.totalFuelAdvances += amount;
          break;
        case 'OWNER_ADVANCE':
          result.totalOwnerAdvances += amount;
          break;
        case 'CUSTOMER_PAYMENT':
          if (tx.direction === 'CREDIT') {
            result.totalCustomerPayments += amount;
          }
          break;
        case 'CLIENT_PAYMENT':
          if (tx.direction === 'CREDIT') {
            result.totalClientPayments += amount;
          }
          break;
        case 'OWNER_SETTLEMENT':
          result.totalOwnerSettlements += amount;
          break;
        case 'DRIVER_SETTLEMENT':
          result.totalDriverSettlements += amount;
          break;
        case 'TRIP_EXPENSE':
          result.totalExpenses += amount;
          break;
        case 'COMMISSION':
          result.totalCommission += amount;
          break;
      }
    }

    // Floor every bucket at zero: a reversal can only ever give money back,
    // never create a receivable that the ledger does not support.
    for (const key of Object.keys(result)) {
      if (result[key] < 0) result[key] = 0;
    }

    return result;
  }

  /**
   * Subtract a reversed transaction from the matching aggregate bucket.
   * @private
   */
  _applyReversal(result, original, reversal) {
    if (!this._isLiveMoney(reversal)) return;
    const amount = reversal.amount || original.amount || 0;
    switch (original.transaction_type) {
      case 'CUSTOMER_PAYMENT':
        result.totalCustomerPayments -= amount;
        break;
      case 'CLIENT_PAYMENT':
        result.totalClientPayments -= amount;
        break;
      case 'DRIVER_ADVANCE':
        result.totalDriverAdvances -= amount;
        break;
      case 'FUEL_ADVANCE':
        result.totalFuelAdvances -= amount;
        break;
      case 'OWNER_ADVANCE':
        result.totalOwnerAdvances -= amount;
        break;
      case 'OWNER_SETTLEMENT':
        result.totalOwnerSettlements -= amount;
        break;
      case 'DRIVER_SETTLEMENT':
        result.totalDriverSettlements -= amount;
        break;
      case 'TRIP_EXPENSE':
        result.totalExpenses -= amount;
        break;
      case 'COMMISSION':
        result.totalCommission -= amount;
        break;
      default:
        break;
    }
  }

  // ============================================================
  // TRIP FINANCIAL CALCULATION
  // ============================================================

  /**
   * Calculate complete financial summary for a trip.
   * All values derived from FinancialTransaction records.
   *
   * @param {number} tripId - Trip ID
   * @returns {Promise<Object>} Complete financial summary
   */
  async calculateTripFinancials(tripId) {
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: {
        financialTransactions: true,
        payments: true,
        client: { select: { client_id: true, company_name: true } },
        driver: { select: { driver_id: true, driver_name: true } },
        transportOwner: { select: { owner_id: true, owner_name: true } },
      },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    return this._computeTripFinancials(trip);
  }

  /**
   * Compute trip financials from a trip object with transactions.
   * @param {Object} trip - Prisma trip row with financialTransactions
   * @returns {Object} Financial summary
   */
  _computeTripFinancials(trip) {
    const freightAmount = Number(trip.freight_amount) || 0;
    const driverAgreedPay = Number(trip.driver_payment) || 0;

    // Commission (authoritative policy, never hardcoded)
    const derived = CommissionCalculator.deriveCommission({ trip });
    const btCommission = derived.commissionAmount;
    const ownerShare = derived.ownerShare;

    // Aggregate from FinancialTransaction records (canonical ledger)
    const transactions = trip.financialTransactions || [];
    const txCalc = this._aggregateTransactions(transactions);

    // TripPayment rows are a LEGACY fallback only, for payments recorded before
    // the FinancialTransaction ledger was populated.
    //
    // PHASE 7 — WHY THIS IS NOW AN `if`, NOT A `Math.max`
    //   It used to be `Math.max(ledger, tripPayments)`. That silently undid a
    //   reversal: once a payment has been written to BOTH tables (which
    //   TripService.addPayment does), reversing the ledger row leaves the
    //   TripPayment row untouched, and the max() brought the reversed amount
    //   straight back — so a refunded payment still read as collected.
    //
    //   The fallback now applies ONLY when the canonical ledger holds no
    //   customer payment row for this trip at all, which is exactly the case
    //   it was written for. Whenever the ledger has spoken, the ledger is the
    //   answer, and there is exactly one authoritative number.
    let tripPaymentFallback = 0;
    let ledgerHasCustomerPayments = false;
    for (const tx of transactions) {
      if (
        tx &&
        (tx.transaction_type === 'CUSTOMER_PAYMENT' || tx.transaction_type === 'CLIENT_PAYMENT')
      ) {
        ledgerHasCustomerPayments = true;
        break;
      }
    }
    if (!ledgerHasCustomerPayments && trip.payments && trip.payments.length > 0) {
      for (const p of trip.payments) {
        const cat = (p.payment_category || '').toUpperCase();
        if (cat === 'CLIENT_PAYMENT' || cat === 'CUSTOMER_PAYMENT' || cat === 'CUSTOMER') {
          tripPaymentFallback += Number(p.amount) || 0;
        }
      }
    }

    // Customer/Client payments: the canonical ledger is authoritative.
    const customerCollected = ledgerHasCustomerPayments
      ? txCalc.totalCustomerPayments + txCalc.totalClientPayments
      : tripPaymentFallback;
    const customerDue = Math.max(0, freightAmount - customerCollected);

    // Owner payable
    const ownerPaid = txCalc.totalOwnerSettlements + txCalc.totalOwnerAdvances;
    const ownerDue = Math.max(0, ownerShare - ownerPaid);

    // Driver payable
    const driverPaid = txCalc.totalDriverSettlements + txCalc.totalDriverAdvances + txCalc.totalFuelAdvances;
    const driverDue = Math.max(0, driverAgreedPay - driverPaid);

    // Payment status
    const customerPaymentStatus = this._paymentStatus(freightAmount, customerCollected);
    const ownerPaymentStatus = this._paymentStatus(ownerShare, ownerPaid);
    const driverPaymentStatus = this._paymentStatus(driverAgreedPay, driverPaid);

    return {
      tripId: trip.trip_id,
      tripNumber: trip.trip_number,
      status: trip.status,
      sourceType: trip.source_type,
      clientId: trip.client_id,
      clientName: trip.client?.company_name || null,
      driverId: trip.driver_id,
      driverName: trip.driver?.driver_name || null,
      ownerId: trip.transport_owner_id,
      ownerName: trip.transportOwner?.owner_name || null,

      // 1. Freight / GMV
      freight: freightAmount,
      // 2. BT Commission
      btCommission,
      commissionRate: derived.commissionRate,
      commissionType: derived.commissionType,
      // 3. Owner Share
      ownerShare,
      // 4. Customer Amount Collected
      customerCollected,
      // 5. Customer Amount Due
      customerDue,
      customerPaymentStatus,
      // 6. Owner Amount Paid
      ownerPaid,
      // 7. Owner Amount Due
      ownerDue,
      ownerPaymentStatus,
      // 8. Driver Agreed Pay
      driverAgreedPay,
      // 9. Driver Amount Paid
      driverPaid,
      // 10. Driver Amount Due
      driverDue,
      driverPaymentStatus,

      // Transaction counts
      transactionCount: transactions.length,
      advanceCount: transactions.filter(t =>
        t.transaction_type === 'DRIVER_ADVANCE' ||
        t.transaction_type === 'FUEL_ADVANCE' ||
        t.transaction_type === 'OWNER_ADVANCE'
      ).length,
      settlementCount: transactions.filter(t =>
        t.transaction_type === 'DRIVER_SETTLEMENT' ||
        t.transaction_type === 'OWNER_SETTLEMENT'
      ).length,
    };
  }

  // ============================================================
  // CLIENT FINANCIAL CALCULATION
  // ============================================================

  /**
   * Calculate financial summary for a client.
   * All values derived from FinancialTransaction records.
   *
   * @param {number} clientId - Client ID
   * @returns {Promise<Object>} Client financial summary
   */
  async calculateClientFinancials(clientId) {
    const client = await this.prisma.client.findUnique({
      where: { client_id: clientId },
      include: {
        trips: {
          include: {
            financialTransactions: true,
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const trips = client.trips || [];
    let totalFreight = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;
    let totalTrips = trips.length;
    let activeTrips = 0;

    const tripSummaries = [];

    for (const trip of trips) {
      const tripFinancials = this._computeTripFinancials(trip);
      totalFreight += tripFinancials.freight;
      totalPaid += tripFinancials.customerCollected;
      totalOutstanding += tripFinancials.customerDue;

      // Count active trips (not completed, cancelled, or delivered)
      const activeStatuses = ['ASSIGNED', 'IN_TRANSIT', 'PENDING', 'LOADING', 'UNLOADING'];
      if (activeStatuses.includes(trip.status)) {
        activeTrips++;
      }

      tripSummaries.push({
        tripId: trip.trip_id,
        tripNumber: trip.trip_number,
        status: trip.status,
        freight: tripFinancials.freight,
        paid: tripFinancials.customerCollected,
        due: tripFinancials.customerDue,
        paymentStatus: tripFinancials.customerPaymentStatus,
      });
    }

    return {
      clientId: client.client_id,
      companyName: client.company_name,
      contactPerson: client.contact_person,
      phone: client.phone,
      email: client.email,
      status: client.status,
      totalTrips,
      activeTrips,
      totalFreight,
      totalPaid,
      totalOutstanding,
      paymentStatus: this._paymentStatus(totalFreight, totalPaid),
      trips: tripSummaries,
    };
  }

  // ============================================================
  // GLOBAL FINANCIAL SUMMARY
  // ============================================================

  /**
   * Calculate global financial summary across all trips.
   *
   * @returns {Promise<Object>} Global financial summary
   */
  async calculateGlobalFinancials() {
    const trips = await this.prisma.trip.findMany({
      include: {
        financialTransactions: true,
      },
    });

    let totalFreight = 0;
    let totalCustomerCollected = 0;
    let totalCustomerDue = 0;
    let totalOwnerShare = 0;
    let totalOwnerPaid = 0;
    let totalOwnerDue = 0;
    let totalDriverAgreedPay = 0;
    let totalDriverPaid = 0;
    let totalDriverDue = 0;
    let totalBtCommission = 0;
    let totalAdvances = 0;
    let totalSettlements = 0;

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);
      totalFreight += f.freight;
      totalCustomerCollected += f.customerCollected;
      totalCustomerDue += f.customerDue;
      totalOwnerShare += f.ownerShare;
      totalOwnerPaid += f.ownerPaid;
      totalOwnerDue += f.ownerDue;
      totalDriverAgreedPay += f.driverAgreedPay;
      totalDriverPaid += f.driverPaid;
      totalDriverDue += f.driverDue;
      totalBtCommission += f.btCommission;
      totalAdvances += f.advanceCount;
      totalSettlements += f.settlementCount;
    }

    return {
      totalTrips: trips.length,
      totalFreight,
      totalBtCommission,
      totalOwnerShare,
      // Receivables (what customers/clients owe BT)
      totalReceivable: totalCustomerDue,
      totalReceived: totalCustomerCollected,
      // Payables (what BT owes owners/drivers)
      totalOwnerPayable: totalOwnerDue,
      totalOwnerPaid,
      totalDriverPayable: totalDriverDue,
      totalDriverPaid,
      totalPayable: totalOwnerDue + totalDriverDue,
      totalPaid: totalOwnerPaid + totalDriverPaid,
      // Advances
      totalAdvances,
      totalSettlements,
      // Net position
      netPosition: totalCustomerDue - (totalOwnerDue + totalDriverDue),
    };
  }

  // ============================================================
  // RECEIVABLES (who owes BT)
  // ============================================================

  /**
   * Get receivables grouped by client.
   *
   * STATUS FILTER (§2) — "who still owes us money"
   *   ALL             every active client, including a clean balance
   *   DUE             outstanding > 0 — the "Client Due" view
   *   UNPAID          nothing collected at all
   *   PARTIALLY_PAID  something collected, balance remains
   *   OVERDUE         balance remains AND the trip is older than 30 days
   *   DUE_SOON        balance remains AND the trip is inside the next 7 days
   *
   * SORT (§15)
   *   OUTSTANDING_DESC / OUTSTANDING_ASC / OLDEST_DUE / NEWEST
   *
   * Every filter is applied AFTER the per-client balance is computed from the
   * same `_computeTripFinancials` the summary uses, so the total of whatever is
   * returned still reconciles with the dashboard.
   *
   * @param {object} [filters]
   * @returns {Promise<Array>} Receivables by client
   */
  async getReceivablesByClient(filters = {}) {
    // RECONCILIATION FIX #2 — an INACTIVE client is still a DEBTOR.
    //
    // This read used to carry `where: { is_active: true }`, so the moment an
    // operator deactivated a customer, whatever they owed vanished from the
    // receivables screen while the dashboard kept counting it. On the live
    // database that was ₹45,000 owed by a deactivated client — real money the
    // business is still chasing, made invisible by a status flag.
    //
    // `is_active` now travels with the row instead of filtering it, so the UI
    // can mark the party without the balance ever disappearing.
    const clients = await this.prisma.client.findMany({
      include: {
        trips: {
          include: {
            financialTransactions: true,
          },
        },
      },
    });

    const receivables = [];
    const term = String(filters.search || '').trim().toLowerCase();

    for (const client of clients) {
      const clientFinancials = this.calculateClientFinancials(client.client_id);
      const summary = await clientFinancials;

      if (summary.totalOutstanding > 0) {
        receivables.push({
          clientId: client.client_id,
          companyName: client.company_name,
          contactPerson: client.contact_person,
          phone: client.phone,
          totalTrips: summary.totalTrips,
          totalFreight: summary.totalFreight,
          totalPaid: summary.totalPaid,
          outstanding: summary.totalOutstanding,
          paymentStatus: summary.paymentStatus,
          // Travels with the row rather than filtering it — see the note on the
          // client read above.
          is_active: client.is_active,
          // The most recent trip date is what "Overdue" and "Due Soon" are
          // measured against, so it travels with the row rather than being
          // recomputed by the browser.
          lastTripDate: (() => {
            const dates = client.trips
              .map((t) => t.trip_date)
              .filter((d) => d && !Number.isNaN(new Date(d).getTime()))
              .map((d) => new Date(d).getTime());
            return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
          })(),
        });
      }
    }

    // ── THE PARTIES WITH NO `Client` RECORD ───────────────────────────────
    // RECONCILIATION FIX — why this block exists.
    //
    // `calculateGlobalFinancials()` sums `customerDue` across EVERY trip, but
    // this method used to walk only `Client` rows. A trip placed by an enquiry,
    // a guest, or any source that does not carry a `client_id` therefore owed
    // money that no receivables row could ever show. On the live database that
    // was ₹5,28,000 of an ₹8,88,000 receivable — the dashboard said one thing
    // and the only screen meant to justify it could not add up to it.
    //
    // A receivables screen whose job is "who do I collect from" must never drop
    // a party because their master record is missing. Those trips are grouped by
    // the customer identity the trip actually carries (`user_id`), or by the
    // order when there is not even that, and reported honestly as un-attributed
    // rather than quietly omitted.
    const unattributed = await this.prisma.trip.findMany({
      where: { client_id: null },
      include: { financialTransactions: true, user: true, booking: true },
    });

    if (unattributed.length) {
      const byParty = new Map();
      for (const trip of unattributed) {
        const f = this._computeTripFinancials(trip);
        const key = trip.user_id ? `user:${trip.user_id}` : `order:${trip.booking_id || trip.trip_id}`;
        if (!byParty.has(key)) {
          const u = trip.user;
          const who = u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : null;
          byParty.set(key, {
            partyKey: key,
            clientId: null,
            userId: trip.user_id || null,
            companyName: who || `Order ${trip.booking?.booking_number || trip.trip_number}`,
            clientCode: trip.booking?.booking_number || trip.trip_number,
            contactPerson: who,
            phone: u ? u.phone : null,
            unlinked: true,
            totalTrips: 0,
            totalFreight: 0,
            totalPaid: 0,
            outstanding: 0,
            paymentStatus: null,
            lastTripDate: null,
          });
        }
        const entry = byParty.get(key);
        entry.totalTrips += 1;
        entry.totalFreight += f.freight;
        entry.totalPaid += f.customerCollected;
        entry.outstanding += f.customerDue;
        entry.paymentStatus = this._paymentStatus(entry.totalFreight, entry.totalPaid);
        const t = trip.trip_date ? new Date(trip.trip_date).getTime() : null;
        if (Number.isFinite(t)) {
          entry.lastTripDate = entry.lastTripDate
            ? new Date(Math.max(new Date(entry.lastTripDate).getTime(), t)).toISOString()
            : new Date(t).toISOString();
        }
      }
      receivables.push(...byParty.values());
    }

    // ── SEARCH ────────────────────────────────────────────────────────────
    const searched = term
      ? receivables.filter((r) => [r.companyName, r.clientCode, r.contactPerson, r.phone]
        .some((v) => String(v || '').toLowerCase().includes(term)))
      : receivables;

    // ── STATUS FILTER (§2) ─────────────────────────────────────────────────
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const status = String(filters.status || 'ALL').toUpperCase();

    const filtered = searched.filter((r) => {
      if (status === 'ALL') return true;
      const outstanding = Number(r.outstanding) || 0;
      if (status === 'DUE') return outstanding > 0;
      if (status === 'UNPAID') return outstanding > 0 && (Number(r.totalPaid) || 0) === 0;
      if (status === 'PARTIALLY_PAID') {
        return outstanding > 0 && (Number(r.totalPaid) || 0) > 0 && (Number(r.totalFreight) || 0) > 0;
      }
      // The age buckets need a date. A client with a balance but no dated trip
      // is reported as DUE rather than dropped — dropping money silently is
      // the one thing a receivables screen must never do.
      const ref = r.lastTripDate ? new Date(r.lastTripDate).getTime() : null;
      if (!Number.isFinite(ref)) return outstanding > 0;
      const days = (now - ref) / DAY;
      if (status === 'OVERDUE') return outstanding > 0 && days > 30;
      if (status === 'DUE_SOON') {
        const daysUntil = (ref - now) / DAY;
        return outstanding > 0 && daysUntil >= 0 && daysUntil <= 7;
      }
      return true;
    });

    // ── SORT (§15) ─────────────────────────────────────────────────────────
    const sort = String(filters.sort || 'OUTSTANDING_DESC').toUpperCase();
    const ageOf = (r) => (r.lastTripDate ? new Date(r.lastTripDate).getTime() : Number.MAX_SAFE_INTEGER);
    const sorted = [...filtered];
    if (sort === 'OUTSTANDING_ASC') sorted.sort((a, b) => a.outstanding - b.outstanding);
    else if (sort === 'OLDEST_DUE') sorted.sort((a, b) => ageOf(a) - ageOf(b));
    else if (sort === 'NEWEST') sorted.sort((a, b) => ageOf(b) - ageOf(a));
    else sorted.sort((a, b) => b.outstanding - a.outstanding);

    return sorted;
  }

  // ============================================================
  // PAYABLES (whom BT owes)
  // ============================================================

  /**
   * Get payables grouped by owner and driver.
   *
   * @returns {Promise<Object>} Payables by owner and driver
   */
  async getPayables() {
    const trips = await this.prisma.trip.findMany({
      include: {
        financialTransactions: true,
        driver: { select: { driver_id: true, driver_name: true } },
        transportOwner: { select: { owner_id: true, owner_name: true } },
      },
    });

    const ownerPayables = new Map();
    const driverPayables = new Map();

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);

      // Owner payables
      if (f.ownerDue > 0) {
        const key = f.ownerId;
        if (!ownerPayables.has(key)) {
          ownerPayables.set(key, {
            ownerId: f.ownerId,
            ownerName: f.ownerName,
            totalShare: 0,
            totalPaid: 0,
            totalDue: 0,
            tripCount: 0,
          });
        }
        const entry = ownerPayables.get(key);
        entry.totalShare += f.ownerShare;
        entry.totalPaid += f.ownerPaid;
        entry.totalDue += f.ownerDue;
        entry.tripCount += 1;
      }

      // Driver payables
      if (f.driverDue > 0) {
        const key = f.driverId;
        if (!driverPayables.has(key)) {
          driverPayables.set(key, {
            driverId: f.driverId,
            driverName: f.driverName,
            totalAgreedPay: 0,
            totalPaid: 0,
            totalDue: 0,
            tripCount: 0,
          });
        }
        const entry = driverPayables.get(key);
        entry.totalAgreedPay += f.driverAgreedPay;
        entry.totalPaid += f.driverPaid;
        entry.totalDue += f.driverDue;
        entry.tripCount += 1;
      }
    }

    return {
      owners: Array.from(ownerPayables.values()).sort((a, b) => b.totalDue - a.totalDue),
      drivers: Array.from(driverPayables.values()).sort((a, b) => b.totalDue - a.totalDue),
    };
  }

  // ============================================================
  // TRANSACTIONS
  // ============================================================

  /**
   * Get all financial transactions with optional filters.
   *
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Transactions
   */
  async getTransactions(filters = {}) {
    const where = {};

    if (filters.trip_id) where.trip_id = parseInt(filters.trip_id);
    if (filters.client_id) where.client_id = parseInt(filters.client_id);
    if (filters.transaction_type) where.transaction_type = filters.transaction_type;
    if (filters.from_party) where.from_party = filters.from_party;
    if (filters.to_party) where.to_party = filters.to_party;
    if (filters.driver_id) where.driver_id = parseInt(filters.driver_id);
    if (filters.transport_owner_id) where.transport_owner_id = parseInt(filters.transport_owner_id);
    if (filters.payment_status) where.status = filters.payment_status;
    if (filters.payment_method) where.payment_method = filters.payment_method;

    if (filters.date_from || filters.date_to) {
      where.transaction_date = {};
      if (filters.date_from) where.transaction_date.gte = new Date(filters.date_from);
      if (filters.date_to) where.transaction_date.lte = new Date(filters.date_to);
    }

    // SEARCH — one box across party, reference and trip, which is what an
    // operator actually has to hand when somebody rings with a receipt number.
    const term = String(filters.search || '').trim();
    if (term) {
      where.OR = [
        { reference_number: { contains: term, mode: 'insensitive' } },
        { from_party: { contains: term, mode: 'insensitive' } },
        { to_party: { contains: term, mode: 'insensitive' } },
        { transaction_type: { contains: term, mode: 'insensitive' } },
        { remarks: { contains: term, mode: 'insensitive' } },
        { trip: { trip_number: { contains: term, mode: 'insensitive' } } },
        { booking: { booking_number: { contains: term, mode: 'insensitive' } } },
      ];
    }

    // ORDER BY — only whitelisted columns reach the query builder, so a
    // query-string value can never become an arbitrary sort expression.
    const SORTABLE = {
      transaction_date: 'transaction_date',
      amount: 'amount',
      reference: 'reference_number',
      type: 'transaction_type',
    };
    const sortColumn = SORTABLE[String(filters.orderBy || '').toLowerCase()];
    const direction = String(filters.orderDirection || '').toLowerCase() === 'asc' ? 'asc' : 'desc';

    // PAGINATION. Totals are counted by the DATABASE, not by slicing rows in
    // JavaScript — a ledger can be far larger than what a browser should ever
    // be asked to hold (requirement: never load every transaction to total it).
    const hasPage = filters.page !== undefined && filters.page !== null && filters.page !== '';
    const limit = hasPage
      ? Math.min(Math.max(parseInt(filters.limit, 10) || 25, 1), 200)
      : undefined;
    const page = hasPage ? Math.max(parseInt(filters.page, 10) || 1, 1) : undefined;
    const skip = hasPage ? (page - 1) * limit : undefined;

    const orderBy = sortColumn ? { [sortColumn]: direction } : { transaction_date: direction };

    const [rows, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        orderBy,
        ...(hasPage ? { skip, take: limit } : {}),
        include: {
          trip: { select: { trip_id: true, trip_number: true, status: true } },
          booking: { select: { booking_id: true, booking_number: true } },
        },
      }),
      hasPage ? this.prisma.financialTransaction.count({ where }) : Promise.resolve(null),
    ]);

    // Backwards compatible: with no `page`, this returns exactly the array it
    // always did. With a page, it returns the envelope the drill-downs consume.
    if (!hasPage) return rows;

    return {
      rows,
      pagination: {
        page,
        limit,
        total: total ?? rows.length,
        totalPages: limit ? Math.max(Math.ceil((total ?? rows.length) / limit), 1) : 1,
      },
    };
  }

  // ============================================================
  // LEDGERS — a party's own running balance
  // ============================================================

  /**
   * THE RECURRING RULE BEHIND BOTH LEDGERS
   *
   *   opening balance
   *   + everything this party's current trips owe / are owed
   *   − everything actually paid
   *   = closing balance
   *
   * The three are NEVER collapsed. Requirement: "trip calculation", "previous
   * ledger balance" and "actual payment" are three different facts, and an
   * operator reconciling money needs to see all three on one screen. So each
   * ledger row states which of the three it is.
   */

  /** Money IN to BT from a client. Positive balance = the client owes us. */
  static CLIENT_DEBIT = 'DEBIT';
  /** Money OUT of BT to a provider. Positive balance = we owe them. */
  static PROVIDER_CREDIT = 'CREDIT';

  /**
   * The client-side ledger for ONE customer.
   *
   * Runs off the SAME `_computeTripFinancials` the dashboard totals use, so the
   * ledger's closing balance always equals that customer's row in the
   * receivables list — reconciliation by construction, not by coincidence.
   *
   * @param {number} clientId
   * @param {object} [filters]
   * @returns {Promise<object>}
   */
  async getClientLedger(clientId, filters = {}) {
    const id = parseInt(clientId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError({ message: 'A valid clientId is required' });
    }

    const client = await this.prisma.client.findUnique({
      where: { client_id: id },
      select: {
        client_id: true,
        company_name: true,
        contact_person: true,
        contact_phone: true,
        contact_email: true,
        billing_address: true,
        city: true,
        state: true,
        gst_number: true,
      },
    });
    if (!client) throw new NotFoundError({ message: 'Client not found' });

    const trips = await this.prisma.trip.findMany({
      where: { client_id: id },
      include: { financialTransactions: true, vehicle: true, driver: true },
      orderBy: { trip_date: 'asc' },
    });

    let billed = 0;
    let received = 0;
    const rows = [];

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);
      billed += f.freight;
      received += f.customerCollected;
      rows.push({
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        trip_date: trip.trip_date,
        trip_status: trip.status,
        vehicle_number: trip.vehicle?.vehicle_number || null,
        driver_name: trip.driver?.driver_name || null,
        billed: f.freight,
        received: f.customerCollected,
        // NOT PAID until the balance reaches zero — a part payment leaves a
        // real remaining amount, which is the whole point of the column.
        due: f.customerDue,
        status: this._paymentStatus(f.freight, f.customerCollected),
      });
    }

    const outstanding = billed - received;

    // Running balance, oldest → newest, so the ledger reads like a statement.
    let running = 0;
    const ledger = rows.map((r) => {
      running += r.due;
      return {
        date: r.trip_date,
        particulars: `Transport · ${r.trip_number}`,
        trip_id: r.trip_id,
        trip_number: r.trip_number,
        billed: r.billed,
        received: r.received,
        balance: running,
      };
    });

    const payments = await this.getTransactions({
      client_id: id,
      transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
      orderBy: 'transaction_date',
      orderDirection: 'asc',
    });

    return {
      party: {
        party_type: 'CLIENT',
        client_id: client.client_id,
        name: client.company_name,
        contact_person: client.contact_person,
        mobile: client.contact_phone,
        email: client.contact_email,
        address: [client.billing_address, client.city, client.state].filter(Boolean).join(', ') || null,
        gst_number: client.gst_number,
      },
      totals: {
        // billed = every trip's freight, EVER — not just this month's.
        previousBalance: billed - received,
        currentReceivable: outstanding,
        billed,
        received,
        tripCount: rows.length,
        paymentCount: payments.length,
      },
      trips: rows,
      // Payments are a separate list so "how much has this customer actually
      // paid" is answerable without reading the trips.
      payments,
      ledger,
    };
  }

  /**
   * The provider-side ledger for ONE vehicle owner.
   *
   * Signs follow the ledger convention: for a VENDOR, a credit INCREASES what
   * we owe them (a hire we engaged) and a debit REDUCES it (a payment we made).
   * The closing balance is therefore "we owe them ₹X", which is what the
   * payables list shows — so the two always agree.
   *
   * @param {number} ownerId
   * @param {object} [filters]
   * @returns {Promise<object>}
   */
  async getVendorLedger(ownerId, filters = {}) {
    const id = parseInt(ownerId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError({ message: 'A valid ownerId is required' });
    }

    const owner = await this.prisma.vehicleOwner.findUnique({
      where: { owner_id: id },
      select: { owner_id: true, owner_name: true, company_name: true, owner_type: true, mobile: true, city: true },
    });
    if (!owner) throw new NotFoundError({ message: 'Vehicle owner not found' });

    const trips = await this.prisma.trip.findMany({
      where: { transport_owner_id: id },
      include: {
        financialTransactions: true,
        vehicle: true,
        vehicleHire: true,
        tripSettlements: true,
        tripAdvances: true,
      },
      orderBy: { trip_date: 'asc' },
    });

    let gross = 0;
    let commission = 0;
    let net = 0;
    let paid = 0;
    const rows = [];

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);
      gross += f.ownerShare;
      commission += f.btCommission;
      net += f.ownerDue;
      paid += f.ownerPaid;
      rows.push({
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        trip_date: trip.trip_date,
        trip_status: trip.status,
        vehicle_number: trip.vehicle?.vehicle_number || null,
        vehicle_name: trip.vehicle?.vehicle_name || null,
        // Gross, commission and net are stored and reported as THREE figures.
        // `net = gross − commission` is an identity the backend never overwrites.
        gross_hire: f.ownerShare,
        commission: f.btCommission,
        net_payable: f.ownerShare - f.btCommission,
        paid: f.ownerPaid,
        balance: f.ownerDue,
        status: this._paymentStatus(f.ownerShare - f.btCommission, f.ownerPaid),
      });
    }

    const payments = await this.getTransactions({
      transport_owner_id: id,
      orderBy: 'transaction_date',
      orderDirection: 'asc',
    });

    // Running balance: each hire increases what we owe, each payment reduces it.
    let running = 0;
    const ledger = [];
    for (const r of rows) {
      running += r.net_payable;
      ledger.push({
        date: r.trip_date,
        particulars: `Vehicle hire · ${r.trip_number}`,
        trip_id: r.trip_id,
        trip_number: r.trip_number,
        debit: null,
        credit: r.net_payable,
        balance: running,
      });
    }
    for (const p of payments) {
      // Only money that actually left the business reduces what we owe.
      const isOutgoing = p.transaction_type === 'OWNER_PAYMENT'
        || p.transaction_type === 'OWNER_ADVANCE'
        || p.transaction_type === 'OWNER_SETTLEMENT'
        || String(p.from_party || '').toUpperCase().includes('BHAR');
      const amount = Number(p.amount) || 0;
      if (!isOutgoing) continue;
      running -= amount;
      ledger.push({
        date: p.transaction_date,
        particulars: `${p.transaction_type.replace(/_/g, ' ')} · ${p.reference_number || '—'}`,
        trip_id: p.trip_id,
        trip_number: p.trip?.trip_number || null,
        debit: amount,
        credit: null,
        balance: running,
      });
    }
    ledger.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    return {
      party: {
        party_type: 'VEHICLE_OWNER',
        owner_id: owner.owner_id,
        name: owner.company_name || owner.owner_name,
        owner_type: owner.owner_type,
        mobile: owner.mobile,
        city: owner.city,
      },
      totals: {
        gross_hire: gross,
        commission,
        // The identity the spec pins down, asserted rather than assumed.
        net_vendor_payable: gross - commission,
        paid,
        outstanding: net,
        tripCount: rows.length,
      },
      trips: rows,
      payments,
      ledger,
    };
  }

  /**
   * COMMISSION EARNED, per trip.
   *
   * §9 requires gross hire, commission and net vendor payable to be preserved
   * as three separate values, with `net = gross − commission`. They are read
   * from the same `_computeTripFinancials` the payables list uses, so a
   * commission drill-down can never disagree with the provider payable shown
   * next to it.
   *
   * @param {object} [filters]
   */
  async getCommissionEarned(filters = {}) {
    const trips = await this.prisma.trip.findMany({
      include: { financialTransactions: true, vehicle: true, transportOwner: true },
      orderBy: { trip_date: 'desc' },
    });

    const rows = [];
    let totalGross = 0;
    let totalCommission = 0;

    for (const trip of trips) {
      const f = this._computeTripFinancials(trip);
      const gross = f.ownerShare;
      const commission = f.btCommission;
      totalGross += gross;
      totalCommission += commission;
      rows.push({
        trip_id: trip.trip_id,
        trip_number: trip.trip_number,
        trip_date: trip.trip_date,
        vehicle_number: trip.vehicle?.vehicle_number || null,
        vehicle_name: trip.vehicle?.vehicle_name || null,
        vendor_name: trip.transportOwner?.company_name || trip.transportOwner?.owner_name || null,
        gross_vehicle_hire: gross,
        commission,
        // `gross − commission`, computed here for display only; it is never
        // written back over the gross.
        net_vendor_payable: gross - commission,
        commission_rate: gross > 0 ? Math.round((commission / gross) * 10000) / 100 : null,
        status: commission > 0 ? 'EARNED' : 'NO_COMMISSION',
      });
    }

    const term = String(filters.search || '').trim().toLowerCase();
    const searched = term
      ? rows.filter((r) => [r.trip_number, r.vehicle_number, r.vendor_name]
        .some((v) => String(v || '').toLowerCase().includes(term)))
      : rows;

    return {
      totals: {
        gross_vehicle_hire: totalGross,
        total_commission: totalCommission,
        trip_count: rows.length,
      },
      commission: searched,
    };
  }

  // ============================================================
  // CLIENT STATEMENT
  // ============================================================

  /**
   * Get client statement (chronological financial events).
   *
   * @param {number} clientId - Client ID
   * @returns {Promise<Object>} Client statement
   */
  async getClientStatement(clientId) {
    const client = await this.prisma.client.findUnique({
      where: { client_id: clientId },
    });

    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const transactions = await this.prisma.financialTransaction.findMany({
      where: { client_id: clientId },
      orderBy: { transaction_date: 'asc' },
      include: {
        trip: { select: { trip_id: true, trip_number: true } },
        booking: { select: { booking_id: true, booking_number: true } },
      },
    });

    const statement = [];
    let runningBalance = 0;

    for (const tx of transactions) {
      const amount = tx.amount || 0;
      const isDebit = tx.direction === 'DEBIT';
      const isCredit = tx.direction === 'CREDIT';

      // For client statement:
      // DEBIT = money BT is owed (increases client balance)
      // CREDIT = money client paid (decreases client balance)
      if (isDebit) {
        runningBalance += amount;
      } else if (isCredit) {
        runningBalance -= amount;
      }

      statement.push({
        date: tx.transaction_date || tx.created_at,
        transactionId: tx.transaction_id,
        type: tx.transaction_type,
        tripNumber: tx.trip?.trip_number || null,
        description: tx.purpose,
        debit: isDebit ? amount : 0,
        credit: isCredit ? amount : 0,
        balance: runningBalance,
        paymentMethod: tx.payment_method,
        reference: tx.reference_number,
      });
    }

    return {
      clientId: client.client_id,
      companyName: client.company_name,
      currentBalance: runningBalance,
      transactionCount: transactions.length,
      statement,
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Record a client/customer payment for a trip.
   * Creates a FinancialTransaction (CREDIT, CLIENT_PAYMENT or CUSTOMER_PAYMENT).
   * This is the ONLY way to record client payments - ensures single source of truth.
   *
   * PHASE 7 — IDEMPOTENCY
   *   `reference_number` is the payment's own transaction reference, and it is
   *   the idempotency key: a double click, a browser retry, a network retry or
   *   a duplicate gateway callback all carry the SAME reference, so the second
   *   and later attempts resolve to the payment that already exists instead of
   *   moving money twice. The database enforces the same rule via
   *   financial_tx_customer_payment_reference_key.
   *
   *   A payment with NO reference is still accepted — offline cash collection
   *   legitimately has none — it simply carries no key, so it cannot be
   *   de-duplicated and the caller must not retry it blindly.
   *
   * PHASE 7 — WHY EVERYTHING HAPPENS INSIDE ONE TRANSACTION
   *   The outstanding check, the TripFinancial lookup and the insert now all
   *   run on the SAME `tx`. They previously read through `this.prisma` from
   *   inside a `$transaction` callback, so the "is there enough due?" decision
   *   and the write were never actually atomic: two concurrent requests could
   *   both pass the check and both write, over-collecting the trip. The trip's
   *   own ledger row is taken with a row lock so the second request waits and
   *   then sees the first one's money.
   *
   * @param {number} tripId
   * @param {Object} paymentData
   * @returns {Promise<Object>}
   */
  async recordClientPayment(tripId, paymentData, user = null) {
    const { amount, payment_method, reference_number, notes, transaction_date, client_id, source_type } = paymentData;

    if (!amount || amount <= 0) {
      throw new ValidationError('Valid payment amount is required');
    }

    // Validate trip exists
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: tripId },
      select: { trip_id: true, trip_number: true, freight_amount: true, source_type: true, client_id: true, booking_id: true },
    });

    if (!trip) {
      throw new NotFoundError('Trip not found');
    }

    // Determine source type
    const effectiveSourceType = source_type || trip.source_type;
    const effectiveClientId = client_id || trip.client_id;

    // Validate: if OFFLINE_CLIENT, client_id must be present
    if (effectiveSourceType === 'OFFLINE_CLIENT' && !effectiveClientId) {
      throw new ValidationError('Client ID is required for offline client payment');
    }

    // Determine transaction type and parties
    const isClientPayment = effectiveSourceType === 'OFFLINE_CLIENT' && effectiveClientId;
    const transactionType = isClientPayment ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT';
    const fromParty = isClientPayment ? 'CLIENT' : 'CUSTOMER';

    const paymentAmount = parseFloat(amount);
    const reference = reference_number ? String(reference_number).trim() || null : null;

    return this.prisma.$transaction(async (tx) => {
      // ── Idempotency: a repeated request with the same reference is the
      //    SAME payment, so return the original rather than moving money again.
      if (reference) {
        const existing = await tx.financialTransaction.findFirst({
          where: {
            trip_id: tripId,
            reference_number: reference,
            transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
            status: { not: 'CANCELLED' },
          },
        });
        if (existing) return { ...existing, idempotentReplay: true };
      }

      // ── Find or create the trip's ledger row, taking a row lock so a
      //    concurrent payment for the same trip serialises behind this one.
      //
      // PHASE 7 — WHY THE LOOKUP IS BY TRIP *OR* BOOKING
      //   A TripFinancial is the ledger for a movement, and it can be created
      //   either from the Trip or from the Booking (`booking_id` is @unique,
      //   `trip_id` is not). `BookingService.confirmBooking()` creates it
      //   booking-first, so a booking-linked trip already has a row keyed by
      //   booking with `trip_id` still NULL. Looking up by `trip_id` alone
      //   missed that row and tried to insert a second one for the same
      //   booking — which the unique constraint rejected, so a real customer
      //   payment against any booking-linked trip returned 500.
      //
      //   The Trip wins when both resolve (a Trip may exist with no Booking);
      //   otherwise the Booking's own ledger row is used. This is the same
      //   "trip wins, else booking" rule TripAdvanceService._resolveTarget
      //   already applies.
      let tripFinancial = await tx.tripFinancial.findFirst({
        where: { trip_id: tripId },
        select: { trip_financial_id: true },
      });
      let resolvedBy = 'trip';

      if (!tripFinancial && trip.booking_id) {
        tripFinancial = await tx.tripFinancial.findFirst({
          where: { booking_id: trip.booking_id },
          select: { trip_financial_id: true },
        });
        resolvedBy = 'booking';
      }

      if (!tripFinancial) {
        tripFinancial = await tx.tripFinancial.create({
          data: {
            booking_id: trip.booking_id || null,
            trip_id: tripId,
            status: 'CALCULATED',
            customer_fare: trip.freight_amount || 0,
            calculated_at: new Date(),
          },
          select: { trip_financial_id: true },
        });
      } else {
        // Row lock. Plain SELECT does not block a concurrent writer, which is
        // exactly the race that let two requests both pass the due check.
        await tx.$queryRaw`SELECT trip_financial_id FROM trip_financials WHERE trip_financial_id = ${tripFinancial.trip_financial_id} FOR UPDATE`;
      }
      void resolvedBy;

      // ── Re-derive the outstanding INSIDE the transaction, from the canonical
      //    ledger, so the limit and the write are decided against one snapshot.
      const existingTx = await tx.financialTransaction.findMany({
        where: { trip_id: tripId },
        select: {
          transaction_id: true,
          transaction_type: true,
          amount: true,
          direction: true,
          status: true,
          metadata: true,
          reference_number: true,
        },
      });

      const tripPayments = await tx.tripPayment.findMany({
        where: { trip_id: tripId },
        select: { amount: true, payment_category: true },
      });

      const ledger = this._aggregateTransactions(existingTx);
      const ledgerHasCustomerPayments = existingTx.some(
        (t) => t.transaction_type === 'CUSTOMER_PAYMENT' || t.transaction_type === 'CLIENT_PAYMENT'
      );

      let legacyCollected = 0;
      if (!ledgerHasCustomerPayments) {
        for (const p of tripPayments) {
          const cat = (p.payment_category || '').toUpperCase();
          if (cat === 'CLIENT_PAYMENT' || cat === 'CUSTOMER_PAYMENT' || cat === 'CUSTOMER') {
            legacyCollected += Number(p.amount) || 0;
          }
        }
      }

      const collected = ledgerHasCustomerPayments
        ? ledger.totalCustomerPayments + ledger.totalClientPayments
        : legacyCollected;
      const outstanding = Math.max(0, (Number(trip.freight_amount) || 0) - collected);

      if (paymentAmount > outstanding) {
        throw new ValidationError(
          `Payment amount (₹${paymentAmount}) exceeds outstanding customer due (₹${outstanding})`
        );
      }

      // ── The single authoritative money row.
      return tx.financialTransaction.create({
        data: {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip.booking_id || null,
          trip_id: tripId,
          transaction_type: transactionType,
          amount: paymentAmount,
          direction: 'CREDIT',
          from_party: fromParty,
          to_party: 'BIHAR_TRANSPORT',
          purpose: 'Freight Payment',
          payment_method: payment_method || 'cash',
          reference_number: reference,
          transaction_date: transaction_date ? new Date(transaction_date) : new Date(),
          status: 'PAID',
          client_id: effectiveClientId || null,
          notes: notes || null,
          created_by: user?.user_id || null,
          metadata: JSON.stringify({
            source_type: effectiveSourceType,
            client_id: effectiveClientId || null,
          }),
        },
      });
    });
  }

  /**
   * Determine payment status from amount vs collected.
   */
  _paymentStatus(totalAmount, collected) {
    if (collected >= totalAmount && totalAmount > 0) return 'PAID';
    if (collected > 0) return 'PARTIAL';
    return 'PENDING';
  }

  /**
   * Format currency for display.
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }
}

module.exports = CanonicalFinancialService;
