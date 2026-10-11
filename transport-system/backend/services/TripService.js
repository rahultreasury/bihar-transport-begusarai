/**
 * TripService
 * Business logic for trip management.
 *
 * This is the single source of truth for all trip operations.
 * All trip CRUD, expense, payment, and financial calculations flow through this service.
 */

const { prisma } = require('../config/prisma');
const { AppError, ValidationError, NotFoundError, ConflictError } = require('../utils/AppError');
const TripRepository = require('../repositories/TripRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const TripTimelineService = require('./TripTimelineService');
const TripFinancialCalculationService = require('./TripFinancialCalculationService');
const CanonicalFinancialService = require('./CanonicalFinancialService');
const VehicleHireService = require('./VehicleHireService');
const tripStateMachine = require('../utils/TripStateMachine');
const ResourceAvailabilityService = require('./ResourceAvailabilityService');

/**
 * Keys a browser might try to post that must NEVER reach the database.
 *
 * These are all DERIVED values. The gross hire is `freight_amount`, which IS
 * accepted (an admin has to be able to state the agreed hire). Everything
 * downstream of it is computed by VehicleHireService from the persisted gross
 * and the stored commission terms, so accepting a posted figure would let a
 * client overwrite a rupee amount it has no authority over — and, in the case
 * of a net figure, would risk the gross being clobbered by a net.
 */
const CLIENT_SUPPLIED_DERIVED_FIELDS = Object.freeze([
  'commission_amount',
  'net_vendor_payable',
  'gross_hire',
  'grossHire',
  'commissionAmount',
  'netVendorPayable',
  'owner_share',
  'ownerShare',
  'bt_margin',
  'btMargin',
  'vehicleHire',
  'vehicle_hire',
]);

class TripService {
  constructor() {
    this.tripRepo = new TripRepository();
    this.auditRepo = new AuditLogRepository();
    // The same repository TripTimelineService writes through, held directly so
    // a timeline event can be written inside a transaction with the change it
    // describes.
    this.timelineRepo = new TripTimelineRepository();
    this.timelineService = new TripTimelineService();
    this.financialService = new TripFinancialCalculationService();
    this.canonicalFinancialService = new CanonicalFinancialService();
    this.vehicleHireService = new VehicleHireService({ prisma });
    this.resourceAvailability = new ResourceAvailabilityService();
  }

  /**
   * Get all trips with pagination, filters, and search.
   */
  async getAllTrips(filters = {}, user = null) {
    const trips = await this.tripRepo.findAll(filters);

    // Calculate financial data for each trip using the authoritative financial service
    // This ensures consistency with the trip detail financial API
    const tripsWithFinancials = await Promise.all(
      trips.trips.map(async (trip) => {
        const financials = await this.financialService.calculateTripFinancials(trip.trip_id);

        return {
          ...trip,
          // Legacy fields for backward compatibility
          totalExpenses: 0, // Expenses removed from trip financial workflow
          totalPayments: financials.customerCollected,
          profit: financials.btNetProfit,
          outstanding: financials.customerDue,
          // New consistent financial fields
          financials: {
            client: {
              freight: financials.freight,
              paid: financials.customerCollected,
              due: financials.customerDue,
            },
            provider: {
              agreedAmount: financials.ownerPayable,
              paid: financials.ownerPaid,
              due: financials.ownerPayableRemaining,
            },
            commission: {
              amount: financials.btCommission,
              rate: financials.commissionRate,
            },
          },
        };
      })
    );

    return {
      ...trips,
      trips: tripsWithFinancials,
    };
  }

  /**
   * Get trip by ID.
   */
  async getTripById(id, user = null) {
    const trip = await this.tripRepo.findById(id);

    // Calculate financial data
    const [totalExpenses, totalPayments, expenses, payments] = await Promise.all([
      prisma.tripExpense.aggregate({
        where: { trip_id: trip.trip_id },
        _sum: { amount: true },
      }),
      prisma.tripPayment.aggregate({
        where: { trip_id: trip.trip_id },
        _sum: { amount: true },
      }),
      prisma.tripExpense.findMany({
        where: { trip_id: trip.trip_id },
        orderBy: { expense_date: 'desc' },
      }),
      prisma.tripPayment.findMany({
        where: { trip_id: trip.trip_id },
        orderBy: { payment_date: 'desc' },
      }),
    ]);

    const totalExpensesAmount = totalExpenses._sum.amount || 0;
    const totalPaymentsAmount = totalPayments._sum.amount || 0;
    const profit = trip.freight_amount - totalExpensesAmount;
    const outstanding = trip.freight_amount - totalPaymentsAmount;

    // The canonical vehicle hire for this trip: gross → commission → net,
    // computed server-side from the persisted row. Read-only, so it is always
    // in step with the stored freight and commission terms.
    const vehicleHire = this.vehicleHireService.buildVehicleHire(trip, {
      payments: {
        total: totalPaymentsAmount,
        outstanding,
        // A hire is NOT a payment. This only reports what the existing
        // ledger already contains; nothing here creates one.
        settled: totalPaymentsAmount >= trip.freight_amount && trip.freight_amount > 0,
      },
    });

    return {
      ...trip,
      totalExpenses: totalExpensesAmount,
      totalPayments: totalPaymentsAmount,
      profit,
      outstanding,
      expenses,
      payments,
      // ── Vehicle hire (Phase 2) ──────────────────────────────────────
      vehicleHire,
      // Flat aliases for the money the existing admin trip screens already
      // render. They carry the SAME server-computed figures as
      // `vehicleHire` — a second name for one value, never a second
      // calculation. `freight_amount` (the gross) is left untouched above.
      commission_amount: vehicleHire.commissionAmount,
      owner_settlement_amount: vehicleHire.netVendorPayable,
      bt_margin: vehicleHire.commissionAmount,
    };
  }

  /**
   * Create a new trip.
   */
  async createTrip(data, user = null) {
    const sourceType = data.source_type || 'ONLINE_BOOKING';

    // Validate required fields
    const requiredFields = [
      'transport_owner_id',
      'vehicle_id',
      'driver_id',
      'pickup_location',
      'pickup_city',
      'drop_location',
      'drop_city',
      'freight_amount',
    ];

    for (const field of requiredFields) {
      if (!data[field]) {
        throw new ValidationError(`${field} is required`);
      }
    }

    // Validate source-specific fields
    if (sourceType === 'ONLINE_BOOKING') {
      if (!data.user_id) {
        throw new ValidationError('user_id is required for ONLINE_BOOKING trips');
      }
      const userExists = await prisma.user.findUnique({
        where: { user_id: data.user_id },
      });
      if (!userExists) {
        throw new ValidationError('Client not found');
      }
    } else if (sourceType === 'OFFLINE_CLIENT') {
      if (!data.client_id) {
        throw new ValidationError('client_id is required for OFFLINE_CLIENT trips');
      }
      const clientExists = await prisma.client.findUnique({
        where: { client_id: data.client_id, deleted_at: null },
      });
      if (!clientExists) {
        throw new ValidationError('Offline client not found');
      }
    } else if (sourceType === 'DIRECT') {
      // DIRECT trips don't require user_id or client_id
    } else {
      throw new ValidationError(`Invalid source_type: ${sourceType}`);
    }

    // Validate that transport owner exists
    const ownerExists = await prisma.vehicleOwner.findUnique({
      where: { owner_id: data.transport_owner_id },
    });
    if (!ownerExists) {
      throw new ValidationError('Transport owner not found');
    }

    // Validate that vehicle exists and belongs to the selected owner
    const vehicleExists = await prisma.transportVehicle.findUnique({
      where: { vehicle_id: data.vehicle_id },
    });
    if (!vehicleExists) {
      throw new ValidationError('Vehicle not found');
    }
    if (vehicleExists.owner_id !== data.transport_owner_id) {
      throw new ValidationError(`Vehicle ${vehicleExists.vehicle_number} does not belong to the selected transport owner`);
    }

    // Validate that driver exists
    const driverExists = await prisma.driver.findUnique({
      where: { driver_id: data.driver_id },
    });
    if (!driverExists) {
      throw new ValidationError('Driver not found');
    }

    // Validate driver-owner consistency:
    // - For TRANSPORT_COMPANY/INDIVIDUAL_OWNER: driver must belong to the selected owner
    // - For DRIVER_OWNER: driver can be the owner themselves or belong to the owner
    if (ownerExists.owner_type === 'DRIVER_OWNER') {
      // Driver-owner: driver can be the owner themselves (if driver has same person)
      // or belong to the owner. We allow it as long as the driver exists.
      // Additional check: if driver has transport_owner_id, it should match
      if (driverExists.transport_owner_id && driverExists.transport_owner_id !== data.transport_owner_id) {
        throw new ValidationError(`Driver ${driverExists.driver_name} is assigned to a different transport owner`);
      }
    } else {
      // For company/individual owners, driver must belong to the selected owner
      if (driverExists.transport_owner_id !== data.transport_owner_id) {
        throw new ValidationError(`Driver ${driverExists.driver_name} does not belong to the selected transport owner`);
      }
    }

    // ── PHASE 1: ORDER → TRIP INTEGRITY (server-authoritative) ─────────────
    // The operational Trip is the child of a CONFIRMED ORDER. Two rules make
    // that true on the server, not in the browser:
    //
    //   1. NO TRIP BEFORE CUSTOMER ACCEPTANCE.
    //      `Booking.quote_status` is the single source of truth for "the price
    //      was agreed" (the quote → confirmation invariant). An order whose
    //      quote is still PENDING/SENT/REJECTED can therefore never spawn an
    //      operational trip, which is what stops a truck being dispatched
    //      against a price nobody agreed to.
    //
    //   2. EXACTLY ONE TRIP PER ORDER.
    //      Enquiry → Booking → Trip is a 1:1:1 chain (Enquiry.booking_id is
    //      UNIQUE, Trip.booking_id points at the order). A second trip for the
    //      same booking would split one load's expenses, payments and
    //      commission across two records, so the existing trip is returned
    //      instead — a double-clicked "Create trip" button is a harmless no-op,
    //      not a 500 and not a duplicate row.
    //
    // These checks deliberately apply ONLY to the booking-linked path. A
    // standalone trip (OFFLINE_CLIENT / DIRECT, no booking_id) is created by an
    // authenticated admin through the same endpoint and is unaffected.
    if (data.booking_id) {
      const bookingId = Number(data.booking_id);
      const bookingExists = await prisma.booking.findUnique({
        where: { booking_id: bookingId },
      });
      if (!bookingExists) {
        throw new ValidationError('Booking not found');
      }

      const quoteStatus = String(bookingExists.quote_status || '').toUpperCase();
      if (quoteStatus !== 'ACCEPTED') {
        throw new ValidationError(
          'The customer must accept the quote before a trip can be created'
        );
      }

      const existingTrip = await prisma.trip.findFirst({
        where: { booking_id: bookingId },
        orderBy: { trip_id: 'asc' },
      });
      if (existingTrip) {
        return { ...existingTrip, alreadyExisted: true };
      }
    }

    // Generate trip number
    const tripNumber = await this.tripRepo.generateTripNumber();

    // Create trip (exclude partner_id - not a Trip model field, used for validation only)
    const { partner_id: _partnerId, ...tripData } = data;

    // ── Phase 2: vehicle-hire commercial terms ───────────────────────
    // Validated server-side against the canonical vocabularies. A bad
    // billing_to / business_model / rate_basis / commission term is rejected
    // here rather than written and discovered at reporting time. Derived money
    // fields are stripped so a client can never author them.
    const hireTerms = this.vehicleHireService.validateHireTerms(data);
    for (const key of CLIENT_SUPPLIED_DERIVED_FIELDS) delete tripData[key];

    const trip = await this.tripRepo.create({
      ...tripData,
      ...hireTerms,
      trip_number: tripNumber,
      status: data.status || 'PENDING',
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_created',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        new_value: JSON.stringify(trip),
      });
    }

    return trip;
  }

  /**
   * Update a trip.
   */
  async updateTrip(id, data, user = null) {
    // Validate trip exists
    const existingTrip = await this.tripRepo.findById(id);

    // Validate booking if provided
    if (data.booking_id) {
      const bookingExists = await prisma.booking.findUnique({
        where: { booking_id: data.booking_id },
      });
      if (!bookingExists) {
        throw new ValidationError('Booking not found');
      }
    }

    // ── Phase 2: vehicle-hire terms are validated, derived money is not
    // accepted. The hire stays a CALCULATION of the stored gross, so an
    // update can change the rate but can never post a net figure.
    const hireTerms = this.vehicleHireService.validateHireTerms(data, {
      commission_type: existingTrip.commission_type,
    });
    const updateData = { ...data };
    for (const key of CLIENT_SUPPLIED_DERIVED_FIELDS) delete updateData[key];

    const trip = await this.tripRepo.update(id, { ...updateData, ...hireTerms });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_updated',
        entity_type: 'Trip',
        entity_id: trip.trip_id,
        previous_value: JSON.stringify(existingTrip),
        new_value: JSON.stringify(trip),
      });
    }

    return trip;
  }

  /**
   * Delete a trip.
   */
  async deleteTrip(id, user = null) {
    const existingTrip = await this.tripRepo.findById(id);

    // Check for financial records that would block deletion
    const [expenseCount, paymentCount, advanceCount, financialCount, transactionCount, timelineCount] =
      await Promise.all([
        prisma.tripExpense.count({ where: { trip_id: id } }),
        prisma.tripPayment.count({ where: { trip_id: id } }),
        prisma.tripAdvance.count({ where: { trip_id: id } }),
        prisma.tripFinancial.count({ where: { trip_id: id } }),
        prisma.financialTransaction.count({ where: { trip_id: id } }),
        prisma.tripTimeline.count({ where: { trip_id: id } }),
      ]);

    const totalRecords = expenseCount + paymentCount + advanceCount + financialCount + transactionCount + timelineCount;

    if (totalRecords > 0) {
      const parts = [];
      if (expenseCount > 0) parts.push(`${expenseCount} expense(s)`);
      if (paymentCount > 0) parts.push(`${paymentCount} payment(s)`);
      if (advanceCount > 0) parts.push(`${advanceCount} advance(s)`);
      if (financialCount > 0) parts.push(`${financialCount} financial record(s)`);
      if (transactionCount > 0) parts.push(`${transactionCount} transaction(s)`);
      if (timelineCount > 0) parts.push(`${timelineCount} timeline event(s)`);

      throw new ConflictError({
        message: `Cannot delete trip with existing financial records: ${parts.join(', ')}. ` +
                 'Please settle all financial activity before deleting this trip.',
      });
    }

    const trip = await this.tripRepo.delete(id);

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_deleted',
        entity_type: 'Trip',
        entity_id: id,
        previous_value: JSON.stringify(existingTrip),
      });
    }

    return trip;
  }

  /**
   * Update trip status.
   *
   * PHASE 4: this is now VALIDATED rather than merely checked for membership.
   * Before Phase 4 the only test was `validStatuses.includes(status)`, which
   * meant any trip could jump to any status — including backwards. The server
   * now loads the trip and asks utils/TripStateMachine whether that specific
   * move is legal, so "arbitrary frontend status injection" is no longer
   * possible.
   *
   * COMPATIBILITY: the shipped admin UI has always been able to press "Mark In
   * Transit" straight from PENDING/ASSIGNED, and three live trips are already
   * IN_TRANSIT having arrived there that way. That ability is PRESERVED as an
   * explicit, audited edge in the state machine rather than removed, because
   * Phase 4 must not redesign a working UI. It is never available on the
   * operational loading/dispatch path (TripOperationalService), where the full
   * chain is mandatory.
   *
   * The status change, its timeline event and its audit entry are written in
   * ONE transaction, so a movement can never be recorded without its history
   * or vice versa.
   */
  async updateTripStatus(id, status, user = null) {
    const target = String(status || '').toUpperCase();

    if (!tripStateMachine.TRIP_STATUSES.includes(target)) {
      throw new ValidationError(
        `Invalid status: ${status}. Valid statuses: ${tripStateMachine.TRIP_STATUSES.join(', ')}`
      );
    }

    const existingTrip = await this.tripRepo.findById(id);

    // Validate THIS move, from the status the database actually holds.
    tripStateMachine.validateTransition(existingTrip.status, target);

    // COMPLETION RULE: A trip MUST NOT be marked COMPLETED while Customer Due > 0
    if (target === 'COMPLETED') {
      const financials = await this.canonicalFinancialService.calculateTripFinancials(id);
      const customerDue = financials.customerDue || 0;
      if (customerDue > 0) {
        throw new ValidationError(`Cannot complete trip. Customer payment pending: ₹${customerDue.toLocaleString('en-IN')}`);
      }
    }

    const legacySkip = tripStateMachine.isLegacySkip(existingTrip.status, target);

    const updateData = { status: target };

    // Set timestamps based on status
    if (target === 'COMPLETED') {
      updateData.completed_at = new Date();
    } else if (target === 'CANCELLED') {
      updateData.cancelled_at = new Date();
    } else if (target === 'IN_TRANSIT' && !existingTrip.dispatched_at) {
      // Reaching IN_TRANSIT without a recorded dispatch means the operational
      // chain was bypassed. Record when it happened rather than leaving the
      // fact undocumented.
      updateData.dispatched_at = new Date();
    }

    const trip = await prisma.$transaction(async (tx) => {
      const updated = await tx.trip.update({
        where: { trip_id: id },
        data: updateData,
        // Same relation shape TripRepository.update() has always returned, so
        // the existing UI response contract is unchanged.
        include: {
          user: { select: { user_id: true, first_name: true, last_name: true, email: true, phone: true } },
          client: { select: { client_id: true, client_code: true, company_name: true, contact_person: true, phone: true, email: true } },
          transportOwner: { select: { owner_id: true, owner_code: true, owner_name: true, company_name: true, mobile: true } },
          vehicle: { select: { vehicle_id: true, vehicle_code: true, vehicle_number: true, vehicle_name: true, vehicle_type: true } },
          driver: { select: { driver_id: true, driver_code: true, driver_name: true, mobile: true, license_number: true } },
          booking: { select: { booking_id: true, booking_number: true, booking_reference: true, status: true } },
          expenses: true,
          payments: true,
        },
      });

      // RELEASE THE RESOURCES on completion.
      //
      // `completeTrip` (TripDeliveryService) is the authoritative completion
      // operation and already releases. This generic status path can also move
      // a trip to COMPLETED (PATCH /api/trips/:id/status and the driver-facing
      // status endpoint), so it releases here too — a trip must never be
      // COMPLETED while its vehicle and driver stay locked. The release runs
      // inside the same transaction as the status change.
      let release = { driverReleased: false, vehicleReleased: false };
      if (target === 'COMPLETED') {
        release = await this.resourceAvailability.releaseResourcesIfNoActiveTrip(
          updated.driver_id,
          updated.vehicle_id,
          id,
          tx,
        );
      }

      await this.timelineRepo.create({
        trip_id: id,
        event_type: 'status_changed',
        description: `Status changed from ${existingTrip.status} to ${target}`,
        reference_type: 'trip',
        reference_id: id,
        metadata: {
          // Both vocabularies are written: `previousStatus`/`newStatus` is the
          // shape TripTimelineService.createStatusChangeEvent has always
          // produced (and any existing consumer of it keeps working), while
          // `from`/`to`/`operation` is the shape the Phase 4 operational path
          // writes. One timeline, one reader per key, no migration needed.
          previousStatus: existingTrip.status,
          newStatus: target,
          from: existingTrip.status,
          to: target,
          operation: 'STATUS_SET',
          ...(legacySkip ? { legacy_skip: true } : {}),
          ...(target === 'COMPLETED'
            ? { driver_released: release.driverReleased, vehicle_released: release.vehicleReleased }
            : {}),
        },
        created_by: user?.user_id || user?.admin_id || null,
      }, tx);

      // An explicit release event so the movement history records the resource
      // hand-back as its own fact whenever a completion freed a resource.
      if (target === 'COMPLETED' && (release.driverReleased || release.vehicleReleased)) {
        await this.timelineRepo.create({
          trip_id: id,
          event_type: 'resources_released',
          description: [
            release.driverReleased ? 'Driver released' : null,
            release.vehicleReleased ? 'Vehicle released' : null,
          ].filter(Boolean).join(' and '),
          reference_type: 'trip',
          reference_id: id,
          metadata: {
            operation: 'RELEASE_RESOURCES',
            driver_released: release.driverReleased,
            vehicle_released: release.vehicleReleased,
            driver_id: updated.driver_id,
            vehicle_id: updated.vehicle_id,
          },
          created_by: user?.user_id || user?.admin_id || null,
        }, tx);
      }

      await this.auditRepo.create({
        user_id: user?.user_id || user?.admin_id || null,
        user_role: user?.role || 'admin',
        action: 'trip_status_changed',
        entity_type: 'Trip',
        entity_id: id,
        previous_value: JSON.stringify({ status: existingTrip.status }),
        new_value: JSON.stringify({
          status: target,
          ...(legacySkip ? { legacy_skip: true, note: 'loading/dispatch chain bypassed by admin' } : {}),
          ...(target === 'COMPLETED'
            ? { driver_released: release.driverReleased, vehicle_released: release.vehicleReleased }
            : {}),
        }),
      }, tx);

      return updated;
    });

    return trip;
  }

  /**
   * Add expense to a trip.
   */
  async addExpense(tripId, data, user = null) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    // Validate expense type
    const validTypes = ['DRIVER', 'DIESEL', 'TOLL', 'LOADING', 'UNLOADING', 'OWNER', 'MAINTENANCE', 'OTHER'];
    if (!validTypes.includes(data.expense_type)) {
      throw new ValidationError(`Invalid expense type: ${data.expense_type}`);
    }

    const expense = await prisma.tripExpense.create({
      data: {
        trip_id: tripId,
        expense_type: data.expense_type,
        amount: parseFloat(data.amount),
        expense_date: data.expense_date ? new Date(data.expense_date) : new Date(),
        description: data.description || null,
      },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_expense_added',
        entity_type: 'TripExpense',
        entity_id: expense.expense_id,
        new_value: JSON.stringify(expense),
      });
    }

    return expense;
  }

  /**
   * Update trip expense.
   */
  async updateExpense(tripId, expenseId, data, user = null) {
    // Validate expense exists and belongs to trip
    const existingExpense = await prisma.tripExpense.findFirst({
      where: { expense_id: expenseId, trip_id: tripId },
    });

    if (!existingExpense) {
      throw new NotFoundError('Expense not found');
    }

    const expense = await prisma.tripExpense.update({
      where: { expense_id: expenseId },
      data: {
        expense_type: data.expense_type || existingExpense.expense_type,
        amount: data.amount ? parseFloat(data.amount) : existingExpense.amount,
        expense_date: data.expense_date ? new Date(data.expense_date) : existingExpense.expense_date,
        description: data.description !== undefined ? data.description : existingExpense.description,
      },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_expense_updated',
        entity_type: 'TripExpense',
        entity_id: expense.expense_id,
        previous_value: JSON.stringify(existingExpense),
        new_value: JSON.stringify(expense),
      });
    }

    return expense;
  }

  /**
   * Delete trip expense.
   */
  async deleteExpense(tripId, expenseId, user = null) {
    // Validate expense exists and belongs to trip
    const existingExpense = await prisma.tripExpense.findFirst({
      where: { expense_id: expenseId, trip_id: tripId },
    });

    if (!existingExpense) {
      throw new NotFoundError('Expense not found');
    }

    const expense = await prisma.tripExpense.delete({
      where: { expense_id: expenseId },
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_expense_deleted',
        entity_type: 'TripExpense',
        entity_id: expenseId,
        previous_value: JSON.stringify(existingExpense),
      });
    }

    return expense;
  }

  /**
   * Add payment to a trip.
   *
   * PHASE 7 — IDEMPOTENCY
   *   `data.reference` is the payment's own transaction reference and is the
   *   idempotency key. A double click, a browser retry, a network retry or a
   *   duplicate gateway callback all carry the SAME reference, so a repeated
   *   request returns the payment that already exists instead of writing a
   *   second TripPayment AND a second FinancialTransaction. The database
   *   enforces the same rule via
   *   financial_tx_customer_payment_reference_key.
   *
   *   The idempotency check runs INSIDE the transaction, before either row is
   *   written, so a replay can never leave a half-written payment behind.
   */
  async addPayment(tripId, data, user = null) {
    // Validate trip exists
    const trip = await this.tripRepo.findById(tripId);

    // Validate payment type
    const validTypes = ['ADVANCE', 'PARTIAL', 'FULL', 'SETTLEMENT', 'OTHER'];
    if (!validTypes.includes(data.payment_type)) {
      throw new ValidationError(`Invalid payment type: ${data.payment_type}`);
    }

    const amount = parseFloat(data.amount);
    if (!amount || amount <= 0) {
      throw new ValidationError('Valid payment amount is required');
    }

    const reference = data.reference ? String(data.reference).trim() || null : null;

    // Fast pre-check outside the transaction, so an obviously oversized payment
    // is rejected with the same message without opening one. It is NOT the
    // authoritative guard: the binding check re-derives the due from the
    // canonical ledger INSIDE the transaction below, because this read can be
    // stale by the time the write lands.
    const tripFinancials = await this.canonicalFinancialService.calculateTripFinancials(tripId);
    const customerDue = tripFinancials.customerDue || 0;
    if (amount > customerDue) {
      throw new ValidationError(
        `Payment cannot exceed the remaining customer due of ₹${customerDue.toLocaleString('en-IN')}`
      );
    }

    // Determine transaction type based on trip source
    const isClientTrip = trip.source_type === 'OFFLINE_CLIENT' && trip.client_id;
    const transactionType = isClientTrip ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT';
    const fromParty = isClientTrip ? 'CLIENT' : 'CUSTOMER';

    // Use a transaction so TripPayment + FinancialTransaction are atomic, so
    // the idempotency check and the due check are decided against one
    // snapshot, and so the two rows can never disagree with each other.
    const result = await prisma.$transaction(async (tx) => {
      // ── Idempotency: a replay carries the reference the original used.
      if (reference) {
        const replay = await tx.financialTransaction.findFirst({
          where: {
            trip_id: tripId,
            reference_number: reference,
            transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
            status: { not: 'CANCELLED' },
          },
        });
        if (replay) {
          const existingPayment = await tx.tripPayment.findFirst({
            where: { trip_id: tripId, reference },
          });
          return existingPayment || replay;
        }
      }

      // Find or create the trip's ledger row, taking a row lock so a
      // concurrent payment for the same trip serialises behind this one.
      //
      // PHASE 7 — the lookup is by Trip OR Booking, for the same reason as in
      // CanonicalFinancialService.recordClientPayment: `BookingService
      // .confirmBooking()` creates the TripFinancial booking-first with
      // `trip_id` still NULL, so a `trip_id`-only lookup missed it and the
      // insert collided with the unique `booking_id`. A Trip wins when both
      // resolve; otherwise the Booking's own ledger row is used.
      let tripFinancial = await tx.tripFinancial.findFirst({
        where: { trip_id: tripId },
        select: { trip_financial_id: true },
      });
      if (!tripFinancial && trip.booking_id) {
        tripFinancial = await tx.tripFinancial.findFirst({
          where: { booking_id: trip.booking_id },
          select: { trip_financial_id: true },
        });
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
        await tx.$queryRaw`SELECT trip_financial_id FROM trip_financials WHERE trip_financial_id = ${tripFinancial.trip_financial_id} FOR UPDATE`;
      }

      // Reject payment that exceeds outstanding customer due, re-derived from
      // the canonical ledger inside the transaction.
      const ledgerRows = await tx.financialTransaction.findMany({
        where: { trip_id: tripId },
        select: {
          transaction_id: true, transaction_type: true, amount: true,
          direction: true, status: true, metadata: true, reference_number: true,
        },
      });
      const tripPayments = await tx.tripPayment.findMany({
        where: { trip_id: tripId },
        select: { amount: true, payment_category: true },
      });
      const ledger = this.canonicalFinancialService._aggregateTransactions(ledgerRows);
      const ledgerHasCustomerPayments = ledgerRows.some(
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
      const dueNow = Math.max(0, (Number(trip.freight_amount) || 0) - collected);
      if (amount > dueNow) {
        throw new ValidationError(
          `Payment cannot exceed the remaining customer due of ₹${dueNow.toLocaleString('en-IN')}`
        );
      }

      // Create TripPayment record
      const payment = await tx.tripPayment.create({
        data: {
          trip_id: tripId,
          amount: amount,
          payment_type: data.payment_type,
          payment_category: 'CLIENT_PAYMENT',
          payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
          payment_method: data.payment_method || null,
          reference: reference,
          notes: data.notes || null,
        },
      });

      // Create FinancialTransaction for canonical financial system
      // Use tripFinancial relation connect (required by Prisma schema)
      await tx.financialTransaction.create({
        data: {
          tripFinancial: { connect: { trip_financial_id: tripFinancial.trip_financial_id } },
          trip: { connect: { trip_id: tripId } },
          booking: trip.booking_id ? { connect: { booking_id: trip.booking_id } } : undefined,
          client_id: trip.client_id || null,
          transaction_type: transactionType,
          amount: amount,
          direction: 'CREDIT',
          from_party: fromParty,
          to_party: 'BIHAR_TRANSPORT',
          purpose: 'Freight Payment',
          payment_method: data.payment_method || null,
          reference_number: reference,
          transaction_date: data.payment_date ? new Date(data.payment_date) : new Date(),
          status: 'PAID',
          notes: data.notes || null,
          created_by: user?.user_id || null,
          metadata: JSON.stringify({
            source_type: trip.source_type,
            client_id: trip.client_id || null,
            payment_id: payment.payment_id,
          }),
        },
      });

      return payment;
    });

    // Create audit log
    if (user) {
      await this.auditRepo.create({
        user_id: user.user_id || user.admin_id,
        user_role: user.role || 'admin',
        action: 'trip_payment_added',
        entity_type: 'TripPayment',
        entity_id: result.payment_id,
        new_value: JSON.stringify(result),
      });
    }

    return result;
  }

  /**
   * Get trip expenses.
   */
  async getTripExpenses(tripId) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    return prisma.tripExpense.findMany({
      where: { trip_id: tripId },
      orderBy: { expense_date: 'desc' },
    });
  }

  /**
   * Get trip payments.
   */
  async getTripPayments(tripId) {
    // Validate trip exists
    await this.tripRepo.findById(tripId);

    return prisma.tripPayment.findMany({
      where: { trip_id: tripId },
      orderBy: { payment_date: 'desc' },
    });
  }

  /**
   * Get trip summary statistics.
   */
  async getTripSummary() {
    return this.tripRepo.getSummary();
  }

  /**
   * Get top clients.
   */
  async getTopClients(limit = 5) {
    return this.tripRepo.getTopClients(limit);
  }

  /**
   * Get trips by client ID.
   */
  async getTripsByClientId(clientId, filters = {}) {
    return this.tripRepo.findByClientId(clientId, filters);
  }

  /**
   * Get trips by driver ID.
   */
  async getTripsByDriverId(driverId, filters = {}) {
    return this.tripRepo.findByDriverId(driverId, filters);
  }

  /**
   * Get trips by vehicle ID.
   */
  async getTripsByVehicleId(vehicleId, filters = {}) {
    return this.tripRepo.findByVehicleId(vehicleId, filters);
  }

  /**
   * Get trips by transport owner ID.
   */
  async getTripsByOwnerId(ownerId, filters = {}) {
    return this.tripRepo.findByOwnerId(ownerId, filters);
  }

  /**
   * Get available clients for dropdown.
   */
  async getAvailableClients(search = '') {
    return this.tripRepo.getAvailableClients(search);
  }

  /**
   * Get available drivers for dropdown.
   */
  async getAvailableDrivers(search = '') {
    return this.tripRepo.getAvailableDrivers(search);
  }

  /**
   * Get available vehicles for dropdown.
   */
  async getAvailableVehicles(search = '') {
    return this.tripRepo.getAvailableVehicles(search);
  }

  /**
   * Get available transport owners for dropdown.
   */
  async getAvailableOwners(search = '') {
    return this.tripRepo.getAvailableOwners(search);
  }

  /**
   * Get offline clients (business accounts) for trip creation lookup.
   * Includes trip count and outstanding stats.
   * @param {string} search - Optional search term
   * @returns {Promise<Array>}
   */
  async getOfflineClients(search = '') {
    const clients = await this.tripRepo.getOfflineClients(search);

    // Enrich with financial stats using the canonical service
    const enriched = await Promise.all(
      clients.map(async (client) => {
        try {
          const financials = await this.canonicalFinancialService.calculateClientFinancials(client.client_id);
          return {
            ...client,
            totalTrips: financials.totalTrips,
            totalFreight: financials.totalFreight,
            totalPaid: financials.totalPaid,
            outstanding: financials.totalOutstanding,
            paymentStatus: financials.paymentStatus,
          };
        } catch {
          return {
            ...client,
            totalTrips: client._count?.trips || 0,
            totalFreight: 0,
            totalPaid: 0,
            outstanding: 0,
            paymentStatus: 'PENDING',
          };
        }
      })
    );

    return enriched;
  }

  /**
   * Get clients with stats (outstanding amount, trip count).
   * Used for trip creation wizard.
   */
  async getClientsWithStats() {
    const clients = await prisma.user.findMany({
      where: {
        role: 'customer',
      },
      select: {
        user_id: true,
        first_name: true,
        last_name: true,
        phone: true,
        email: true,
        trips: {
          select: {
            trip_id: true,
            freight_amount: true,
            client_received: true,
            status: true,
          },
        },
      },
      orderBy: {
        first_name: 'asc',
      },
    });

    // Calculate stats for each client
    return clients.map(client => {
      const totalTrips = client.trips.length;
      const totalFreight = client.trips.reduce((sum, t) => sum + (t.freight_amount || 0), 0);
      const totalReceived = client.trips.reduce((sum, t) => sum + (t.client_received || 0), 0);
      const outstanding = totalFreight - totalReceived;

      return {
        user_id: client.user_id,
        first_name: client.first_name,
        last_name: client.last_name,
        phone: client.phone,
        email: client.email,
        totalTrips,
        totalFreight,
        totalReceived,
        outstanding,
      };
    });
  }

  /**
   * Get vehicles belonging to a specific transport owner.
   * Used for trip creation wizard.
   */
  async getVehiclesByOwner(ownerId) {
    return prisma.transportVehicle.findMany({
      where: {
        owner_id: ownerId,
      },
      select: {
        vehicle_id: true,
        vehicle_number: true,
        vehicle_name: true,
        vehicle_type: true,
        owner_id: true,
      },
      orderBy: {
        vehicle_number: 'asc',
      },
    });
  }

  /**
   * Get drivers belonging to a specific transport owner.
   * Used for trip creation wizard — ensures owner-vehicle-driver consistency.
   */
  async getDriversByOwner(ownerId, search = '') {
    return this.tripRepo.getDriversByOwner(ownerId, search);
  }

  /**
   * Resolve the VehicleOwner linked to a Partner.
   * A Partner links to exactly one VehicleOwner via VehicleOwner.partner_link.
   * @param {number} partnerId
   * @returns {Promise<Object|null>}
   */
  async getOwnerByPartnerId(partnerId) {
    return this.tripRepo.getOwnerByPartnerId(partnerId);
  }

  /**
   * Get trips belonging to a Partner's linked VehicleOwner.
   *
   * Scoping: Trip.transport_owner_id → VehicleOwner.partner_link →
   * Partner.partner_id. This guarantees a Partner can ONLY see trips whose
   * transport owner is linked to their own partner account — never trips
   * belonging to another partner.
   *
   * @param {number} partnerId
   * @param {Object} filters - { page, limit, status, search, date_from, date_to, sort_by, sort_order }
   * @returns {Promise<{ trips: Array, pagination: Object }>}
   */
  async getTripsByPartner(partnerId, filters = {}) {
    return this.tripRepo.getTripsByPartner(partnerId, filters);
  }
}

module.exports = TripService;
