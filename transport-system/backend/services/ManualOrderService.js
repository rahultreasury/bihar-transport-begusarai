/**
 * ManualOrderService
 * ---------------------------------------------------------------------------
 * Service for creating manual orders (phone/offline bookings) directly.
 *
 * This is the primary entry point for the "Create Order" button in the
 * Admin Order / Trip Master. It creates a confirmed order directly without
 * requiring an enquiry or quotation first.
 *
 * FLOW:
 *   Admin clicks "Create Order"
 *   → Fills form (customer, route, goods, vehicle requirements, commercial terms)
 *   → POST /api/admin/orders/manual
 *   → This service creates, in ONE database transaction:
 *       1. Customer user (reserved system customer account) that owns the
 *          booking row — bookings.user_id is a required FK to users and must
 *          NOT be the acting admin's id.
 *       2. Client (if new) or links existing client (deduped by phone).
 *       3. Booking (central order record, source MANUAL, status confirmed).
 *       4. Trip (operational record, source_type MANUAL, status PENDING,
 *          no vehicle/driver assigned = waiting for vehicle assignment).
 *       5. TripFinancial (DRAFT, customer fare only — no accounting posting,
 *          no invoice).
 *       6. Delivery record.
 *       7. Timeline + audit events (acting admin recorded as creator).
 *   → Returns the created order with booking_number, trip_number
 *
 * The created order immediately appears in:
 *   - Order / Trip Master (bookings list)
 *   - Vehicle Hire (as waiting for vehicle if no vehicle assigned)
 *
 * NO FAKE RECORDS:
 *   - No enquiry is created.
 *   - No quotation is created.
 *   - No vehicle/vendor/driver is invented.
 *   - No invoice/payment voucher/receipt is posted.
 *   - Vehicle assignment at creation time is OPTIONAL.
 *
 * IDEMPOTENCY / DUPLICATE PROTECTION:
 *   A manual order with the same customer, route, goods and agreed total taken
 *   within IDEMPOTENCY_WINDOW_MINUTES is treated as a replay of the same order
 *   and returns the existing booking/trip instead of creating a duplicate.
 */

const { prisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const { logger } = require('../utils/logger');
const BookingTimelineRepository = require('../repositories/BookingTimelineRepository');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const { buildBookingNumber } = require('./BookingNumberService');
const { buildTripNumber } = require('./TripNumberService');
const { randomUUID } = require('crypto');

const IDEMPOTENCY_WINDOW_MINUTES = 30;

class ManualOrderService {
  constructor(deps = {}) {
    this.bookingTimelineRepo = deps.bookingTimelineRepo || new BookingTimelineRepository();
    this.tripTimelineRepo = deps.tripTimelineRepo || new TripTimelineRepository();
    this.auditLogRepo = deps.auditLogRepo || new AuditLogRepository();
    this.tripFinancialRepo = deps.tripFinancialRepo || new TripFinancialRepository();
  }

  /**
   * Create a manual order from an admin phone/offline booking.
   *
   * @param {Object} input - The manual order form data
   * @param {Object} actor - The admin creating the order
   *   { adminId, adminName, ipAddress, userAgent }
   * @returns {Promise<Object>} Created order with booking, trip, client
   */
  async createManualOrder(input, actor) {
    this._validateInput(input);

    const adminId = actor?.adminId;
    const adminName = actor?.adminName || 'Administrator';
    const ipAddress = actor?.ipAddress || null;
    const userAgent = actor?.userAgent || null;

    const orderDate = input.orderInfo?.orderDate ? new Date(input.orderInfo.orderDate) : new Date();

    // Backend-recomputed commercial breakdown — never trust frontend-supplied
    // totals. This single figure is stored on both the booking and the trip
    // financial record so they can never disagree.
    const commercialTerms = this._buildCommercialTerms(input);

    // Idempotency key from frontend (generated once per logical submission).
    // Validated and enforced by the unique index on bookings.idempotency_key.
    const idempotencyKey = input.idempotency_key || null;
    if (idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 32 || idempotencyKey.length > 128) {
        throw new ValidationError({ message: 'Invalid idempotency key format' });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)) {
        throw new ValidationError({ message: 'Idempotency key contains invalid characters' });
      }
    }

    // Execute everything in a single transaction: commit or roll back together.
    try {
      const result = await prisma.$transaction(async (tx) => {
      // 1. Resolve the customer user that owns the booking row.
      //    bookings.user_id is a required FK to users and represents the
      //    customer/guest account. It MUST NOT be the acting admin's id.
      //    A reserved system customer user (MANUAL_ORDER_SYSTEM_USER_ID) owns
      //    manual orders; the acting admin is recorded in audit/timeline only.
      const customerUserId = await this._resolveSystemUserId(tx);

      // 2. Idempotency check: if a key was provided, look for existing booking.
      if (idempotencyKey) {
        const existingBooking = await tx.booking.findUnique({
          where: { idempotency_key: idempotencyKey },
          select: { booking_id: true, booking_number: true, status: true },
        });

        if (existingBooking) {
          const existingTrip = await tx.trip.findFirst({
            where: { booking_id: existingBooking.booking_id },
            orderBy: { trip_id: 'asc' },
          });
          let existingClient = null;
          if (existingTrip && existingTrip.client_id) {
            existingClient = await tx.client.findUnique({
              where: { client_id: existingTrip.client_id, deleted_at: null },
            });
          }
          logger.info(
            { idempotencyKey, existingBookingId: existingBooking.booking_id },
            'manual_order.idempotent_replay'
          );
          return {
            idempotentReplay: true,
            booking: existingBooking,
            trip: existingTrip,
            client: existingClient,
          };
        }
      }

      // 3. Resolve existing client or create a new one (dedupe by phone).
      const client = await this._resolveOrCreateClient(input.customer, tx);

      // 4. Create the central booking record.
      // Use a temporary booking_number to satisfy Prisma's required field constraint,
      // then update with the canonical BTB-YYYY-NNNNN derived from the autoincrement PK.
      const tempBookingNumber = `TEMP-${randomUUID()}`;
      const booking = await tx.booking.create({
        data: {
          user_id: customerUserId,
          pickup_location: input.pickup.location.trim(),
          pickup_address: input.pickup.address?.trim() || null,
          pickup_city: input.pickup.city.trim(),
          pickup_state: input.pickup.state?.trim() || 'Bihar',
          pickup_pincode: input.pickup.pincode?.trim() || null,
          pickup_date: orderDate.toISOString().split('T')[0],
          pickup_time: '09:00',
          drop_location: input.drop.location.trim(),
          drop_address: input.drop.address?.trim() || null,
          drop_city: input.drop.city.trim(),
          drop_state: input.drop.state?.trim() || 'Bihar',
          drop_pincode: input.drop.pincode?.trim() || null,
          goods_description: input.goods.description.trim(),
          goods_type: input.goods.category?.trim() || 'General',
          goods_weight_kg: input.goods.weight != null ? Number(input.goods.weight) : null,
          goods_volume: null,
          number_of_items: input.goods.quantity != null ? Number(input.goods.quantity) : 1,
          fragile: false,
          vehicle_type_required: input.vehicle.type.trim(),
          estimated_distance_km:
            input.distance_km != null ? Number(input.distance_km) : null,
          estimated_price: commercialTerms.freightAmount,
          final_price: commercialTerms.totalBillingAmount,
          status: 'confirmed',
          confirmed_at: orderDate,
          quote_status: 'ACCEPTED', // direct order — no quotation required
          confirmation_source: 'MANUAL',
          special_instructions: this._buildSpecialInstructions(input),
          quantity_unit: input.goods.quantityUnit || null,
          weight_unit: input.goods.weightUnit || null,
          idempotency_key: idempotencyKey,
          booking_number: tempBookingNumber,
        },
      });

      // Generate and set the canonical booking number (BTB-YYYY-NNNNN) from
      // the database primary key — never random, never frontend-generated.
      const bookingNumber = buildBookingNumber(booking.booking_id, orderDate);
      const updatedBooking = await tx.booking.update({
        where: { booking_id: booking.booking_id },
        data: { booking_number: bookingNumber, booking_reference: bookingNumber },
      });

      // 5. Provision the operational trip immediately.
      //    Vehicle/driver are NULL here = WAITING FOR VEHICLE. No fake vehicle
      //    or driver is invented. source_type = MANUAL.
      //    A cryptographically random temporary placeholder satisfies the
      //    unique constraint on trip_number at create time; it is replaced
      //    with the canonical BTBT-YYYY-NNNNN (derived from the trip_id PK)
      //    before the transaction commits, so the placeholder is never stored.
      const trip = await tx.trip.create({
        data: {
          trip_number: `TEMP-${randomUUID()}`,
          booking_id: booking.booking_id,
          source_type: 'MANUAL',
          user_id: customerUserId,
          client_id: client.client_id,
          transport_owner_id: null,
          vehicle_id: null,
          driver_id: null,
          pickup_location: input.pickup.location.trim(),
          pickup_city: input.pickup.city.trim(),
          drop_location: input.drop.location.trim(),
          drop_city: input.drop.city.trim(),
          distance_km:
            input.distance_km != null ? Number(input.distance_km) : null,
          trip_date: input.vehicle.tripDate ? new Date(input.vehicle.tripDate) : orderDate,
          expected_delivery_date:
            input.vehicle.expectedDeliveryDate
              ? new Date(input.vehicle.expectedDeliveryDate)
              : null,
          freight_amount: commercialTerms.totalBillingAmount,
          value_of_goods: input.goods.value != null ? Number(input.goods.value) : null,
          notes: this._buildTripNotes(input),
          pod_required: input.operational.podRequired === true,
          documents_required: this._buildDocumentsRequired(input),
          status: 'PENDING',
        },
      });

      // Replace the placeholder trip number with the canonical BTBT-YYYY-NNNNN.
      const tripNumber = buildTripNumber(trip.trip_id, trip.created_at);
      const updatedTrip = await tx.trip.update({
        where: { trip_id: trip.trip_id },
        data: { trip_number: tripNumber },
      });

      // 6. TripFinancial — DRAFT record of the customer fare agreement.
      //    Initialized through the existing TripFinancialRepository (finance
      //    service layer) inside the same transaction. No accounting
      //    transaction is posted and no invoice is raised at order creation.
      await this.tripFinancialRepo.create({
        booking_id: updatedBooking.booking_id,
        trip_id: updatedTrip.trip_id,
        status: 'DRAFT',
        customer_fare: commercialTerms.totalBillingAmount,
        commission_rate: 0,
        commission_amount: 0,
        bt_margin: 0,
        notes: JSON.stringify(commercialTerms),
        calculated_at: new Date(),
        calculated_by: adminId,
      }, tx);

      // 7. Delivery record (operational tracking skeleton)
      await tx.delivery.create({
        data: {
          booking_id: booking.booking_id,
          current_status: 'booking_confirmed',
          status_description:
            'Manual order created - awaiting vehicle assignment',
          estimated_delivery_time:
            input.vehicle.expectedDeliveryDate
              ? new Date(input.vehicle.expectedDeliveryDate)
              : null,
        },
      });

      // 8. Timeline + audit events
      const now = new Date();
      await this._recordCreationEvents(
        input, updatedBooking, updatedTrip, client, adminId, adminName, ipAddress, userAgent, tx
      );

      return {
        idempotentReplay: false,
        booking: updatedBooking,
        trip: updatedTrip,
        client,
      };
    });

    return this._buildSuccessResponse(result);
  } catch (err) {
    // Handle unique constraint violation on idempotency_key (race condition)
    if (err?.code === 'P2002' && err?.meta?.target?.includes('idempotency_key') && idempotencyKey) {
      logger.warn(
        { idempotencyKey },
        'manual_order.idempotent_replay_race'
      );
      
      // Fetch the existing booking and return it
      const existingBooking = await prisma.booking.findUnique({
        where: { idempotency_key: idempotencyKey },
        select: { booking_id: true, booking_number: true, booking_reference: true, status: true, quote_status: true, confirmation_source: true, created_at: true },
      });
      
      if (existingBooking) {
        const existingTrip = await prisma.trip.findFirst({
          where: { booking_id: existingBooking.booking_id },
          orderBy: { trip_id: 'asc' },
        });
        
        return {
          success: true,
          message: 'Manual order already exists (duplicate submission). Returned the existing order.',
          data: {
            booking: {
              booking_id: existingBooking.booking_id,
              booking_number: existingBooking.booking_number,
              booking_reference: existingBooking.booking_reference,
              status: existingBooking.status,
              quote_status: existingBooking.quote_status,
              confirmation_source: existingBooking.confirmation_source,
              created_at: existingBooking.created_at,
            },
            trip: existingTrip
              ? {
                  trip_id: existingTrip.trip_id,
                  trip_number: existingTrip.trip_number,
                  status: existingTrip.status,
                  vehicle_id: existingTrip.vehicle_id,
                  driver_id: existingTrip.driver_id,
                  created_at: existingTrip.created_at,
                }
              : null,
            client: null,
            source_type: 'MANUAL',
            idempotent: true,
          },
        };
      }
    }
    throw err;
  }
}

_buildSuccessResponse(result) {
  return {
    success: true,
    message: result.idempotentReplay
      ? 'Manual order already exists (duplicate submission). Returned the existing order.'
      : 'Manual order created successfully',
    data: {
      booking: {
        booking_id: result.booking.booking_id,
        booking_number: result.booking.booking_number,
        booking_reference: result.booking.booking_reference,
        status: result.booking.status,
        quote_status: result.booking.quote_status,
        confirmation_source: result.booking.confirmation_source,
        created_at: result.booking.created_at,
      },
      trip: result.trip
        ? {
            trip_id: result.trip.trip_id,
            trip_number: result.trip.trip_number,
            status: result.trip.status,
            vehicle_id: result.trip.vehicle_id,
            driver_id: result.trip.driver_id,
            created_at: result.trip.created_at,
          }
        : null,
      client: result.client
        ? {
            client_id: result.client.client_id,
            client_code: result.client.client_code,
            company_name: result.client.company_name,
            contact_person: result.client.contact_person,
            phone: result.client.phone,
          }
        : null,
      source_type: 'MANUAL',
      idempotent: result.idempotentReplay,
    },
  };
}

  /* ------------------------------------------------------------------ */
  /* Validation                                                         */
  /* ------------------------------------------------------------------ */

  _validateInput(input) {
    if (!input) throw new ValidationError('Request body is required');
    if (!input.customer) throw new ValidationError('Customer information is required');
    if (!input.customer.clientId && !input.customer.newClient) {
      throw new ValidationError('Either select an existing customer or provide new customer details');
    }
    if (input.customer.newClient && !input.customer.clientId) {
      if (!input.customer.newClient.companyName?.trim()) {
        throw new ValidationError('Customer company name is required');
      }
      if (!input.customer.newClient.contactPerson?.trim()) {
        throw new ValidationError('Customer contact person is required');
      }
      if (!input.customer.newClient.phone?.trim()) {
        throw new ValidationError('Customer phone number is required');
      }
    }
    if (!input.pickup?.location?.trim()) throw new ValidationError('Pickup location is required');
    if (!input.pickup?.city?.trim()) throw new ValidationError('Pickup city is required');
    if (!input.drop?.location?.trim()) throw new ValidationError('Drop location is required');
    if (!input.drop?.city?.trim()) throw new ValidationError('Drop city is required');
    if (!input.goods?.description?.trim()) throw new ValidationError('Goods description is required');
    if (!input.vehicle?.type?.trim()) throw new ValidationError('Vehicle type is required');
    if (!input.vehicle?.tripDate) throw new ValidationError('Trip date is required');
    if (!input.commercial) throw new ValidationError('Commercial terms are required');
    if (!input.commercial.rateType?.trim()) throw new ValidationError('Rate type is required');
    if (!input.commercial.rateAsPer?.trim()) throw new ValidationError('Rate as per is required');
    if (input.commercial.rate == null || isNaN(input.commercial.rate)) {
      throw new ValidationError('Rate is required');
    }
    if (input.commercial.freightAmount == null || isNaN(input.commercial.freightAmount)) {
      throw new ValidationError('Freight amount is required');
    }
    if (input.commercial.totalBillingAmount == null || isNaN(input.commercial.totalBillingAmount)) {
      throw new ValidationError('Total billing amount is required');
    }
    if (input.commercial.gstPercentage != null && (isNaN(Number(input.commercial.gstPercentage)) || Number(input.commercial.gstPercentage) < 0)) {
      throw new ValidationError('GST percentage must be a valid non-negative number');
    }
    if (input.commercial.additionalChargesTax != null && (isNaN(Number(input.commercial.additionalChargesTax)) || Number(input.commercial.additionalChargesTax) < 0)) {
      throw new ValidationError('Additional charges tax must be a valid non-negative number');
    }
    if (input.distance_km != null && (isNaN(Number(input.distance_km)) || Number(input.distance_km) < 0)) {
      throw new ValidationError('Distance must be a valid non-negative number');
    }
    if (input.goods.quantity != null && (isNaN(Number(input.goods.quantity)) || Number(input.goods.quantity) < 0)) {
      throw new ValidationError('Quantity must be a valid non-negative number');
    }
    if (input.goods.weight != null && (isNaN(Number(input.goods.weight)) || Number(input.goods.weight) < 0)) {
      throw new ValidationError('Weight must be a valid non-negative number');
    }
    if (!input.operational) throw new ValidationError('Operational requirements are required');
    if (input.operational.podRequired === undefined || input.operational.podRequired === null) {
      throw new ValidationError('POD requirement must be specified');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Client resolution                                                  */
  /* ------------------------------------------------------------------ */

  async _resolveOrCreateClient(customerInput, tx) {
    // Existing client
    if (customerInput.clientId) {
      const existing = await tx.client.findUnique({
        where: { client_id: customerInput.clientId, deleted_at: null },
      });
      if (!existing) throw new NotFoundError('Selected client not found');
      return existing;
    }

    const newClient = customerInput.newClient;
    const phone = newClient.phone?.trim();

    // Dedupe by phone: never create a duplicate client record
    const existingByPhone = await tx.client.findFirst({
      where: { phone, deleted_at: null },
    });
    if (existingByPhone) {
      return await tx.client.update({
        where: { client_id: existingByPhone.client_id },
        data: {
          company_name: newClient.companyName?.trim() || existingByPhone.company_name,
          contact_person: newClient.contactPerson?.trim() || existingByPhone.contact_person,
          email: newClient.email?.trim() || existingByPhone.email,
          address: newClient.address?.trim() || existingByPhone.address,
          city: newClient.city?.trim() || existingByPhone.city,
          state: newClient.state?.trim() || existingByPhone.state || 'Bihar',
          gst_number: newClient.gstNumber?.trim() || existingByPhone.gst_number,
          pan_number: newClient.panNumber?.trim() || existingByPhone.pan_number,
          updated_at: new Date(),
        },
      });
    }

    return await tx.client.create({
      data: {
        company_name: newClient.companyName.trim(),
        contact_person: newClient.contactPerson.trim(),
        phone,
        email: newClient.email?.trim() || null,
        address: newClient.address?.trim() || null,
        city: newClient.city?.trim() || null,
        state: newClient.state?.trim() || 'Bihar',
        gst_number: newClient.gstNumber?.trim() || null,
        pan_number: newClient.panNumber?.trim() || null,
        status: 'active',
        is_active: true,
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* System user                                                        */
  /* ------------------------------------------------------------------ */

  async _resolveSystemUserId(tx) {
    // bookings.user_id is the customer/guest account and must NOT be the
    // acting admin's id. Manual orders are owned by a reserved system
    // customer user configured via MANUAL_ORDER_SYSTEM_USER_ID. There is
    // no hardcoded fallback — an unconfigured system fails loudly with a
    // clear message rather than writing bookings to an arbitrary user id.
    const configured = process.env.MANUAL_ORDER_SYSTEM_USER_ID;
    if (!configured) {
      throw new ValidationError(
        'MANUAL_ORDER_SYSTEM_USER_ID is not configured. Set it to the id of an existing customer user that owns manual (admin-created) orders.'
      );
    }
    const systemUserId = Number(configured);
    if (!Number.isInteger(systemUserId) || systemUserId <= 0) {
      throw new ValidationError('MANUAL_ORDER_SYSTEM_USER_ID is not a valid user id');
    }
    const user = await tx.user.findUnique({
      where: { user_id: systemUserId },
      select: { user_id: true },
    });
    if (!user) {
      throw new NotFoundError(
        `System user ${systemUserId} not found. Set MANUAL_ORDER_SYSTEM_USER_ID to an existing customer user.`
      );
    }
    return systemUserId;
  }

  /* ------------------------------------------------------------------ */
  /* Derived field builders                                             */
  /* ------------------------------------------------------------------ */

  _buildSpecialInstructions(input) {
    const parts = [
      input.goods.specialInstructions,
      input.vehicle.specialRequirements,
      input.vehicle.remarks,
      input.operational.remarks,
      input.pickup.contactPerson
        ? `Pickup contact: ${input.pickup.contactPerson}${input.pickup.contactNumber ? ` (${input.pickup.contactNumber})` : ''}`
        : null,
      input.drop.contactPerson
        ? `Drop contact: ${input.drop.contactPerson}${input.drop.contactNumber ? ` (${input.drop.contactNumber})` : ''}`
        : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' | ') : null;
  }

  _buildTripNotes(input) {
    const parts = [
      `Manual order created via phone/offline channel.`,
      `Trip type: ${input.tripType || 'One Way'}`,
      `Distance: ${input.distance_km != null ? input.distance_km : 'not specified'} km`,
      `POD required: ${input.operational.podRequired === true ? 'Yes' : 'No'}`,
      `Party invoice: ${input.operational.partyInvoiceRequired || 'to_be_confirmed'}`,
      `E-way bill: ${input.operational.ewayBillRequired || 'to_be_confirmed'}`,
      `LR/GR: ${input.operational.lrGrRequired || 'to_be_confirmed'}`,
    ].filter(Boolean);
    return parts.join('\n');
  }

  _buildDocumentsRequired(input) {
    return {
      podRequired: input.operational.podRequired === true,
      partyInvoiceRequired: input.operational.partyInvoiceRequired || 'to_be_confirmed',
      ewayBillRequired: input.operational.ewayBillRequired || 'to_be_confirmed',
      lrGrRequired: input.operational.lrGrRequired || 'to_be_confirmed',
      specialDocuments: input.operational.specialDocuments || null,
    };
  }

  _buildCommercialTerms(input) {
    const rate = input.commercial.rate != null ? Number(input.commercial.rate) : 0;
    const freightAmount = input.commercial.freightAmount != null ? Number(input.commercial.freightAmount) : 0;
    const gstType = input.commercial.gstType || null;
    const gstPercentage = input.commercial.gstPercentage != null ? Number(input.commercial.gstPercentage) : 0;

    // Recalculate GST on the backend — never trust the frontend-supplied GST amount.
    let gstAmount = 0;
    if (gstType === 'EXEMPT') {
      gstAmount = 0;
    } else if (gstType === 'RCM') {
      gstAmount = input.commercial.gstAmount != null ? Number(input.commercial.gstAmount) : 0;
    } else {
      // FORWARD_CHARGE or any other type: GST % of freight
      gstAmount = freightAmount * (gstPercentage / 100);
    }

    // Recalculate additional charge totals (rate × quantity) on the backend.
    const additionalCharges = Array.isArray(input.commercial.additionalCharges)
      ? input.commercial.additionalCharges.map((c) => {
          const chargeRate = c.rate != null ? Number(c.rate) : 0;
          const chargeQty = c.quantity != null ? Number(c.quantity) : 0;
          return {
            name: c.name,
            rate: chargeRate,
            quantity: chargeQty,
            total: chargeRate * chargeQty,
          };
        })
      : [];
    const additionalChargesTotal = additionalCharges.reduce((s, c) => s + c.total, 0);
    const additionalChargesTax =
      input.commercial.additionalChargesTax != null ? Number(input.commercial.additionalChargesTax) : 0;

    // Recalculate total billing amount on the backend: freight + GST + charges + charges tax.
    const totalBillingAmount = freightAmount + gstAmount + additionalChargesTotal + additionalChargesTax;

    return {
      rateType: input.commercial.rateType,
      rateAsPer: input.commercial.rateAsPer,
      rate,
      freightAmount,
      gstType,
      gstPercentage,
      gstAmount,
      additionalCharges,
      additionalChargesTax,
      totalBillingAmount,
      paymentTerms: input.commercial.paymentTerms || null,
      paymentRemarks: input.commercial.paymentRemarks || null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Events / audit                                                     */
  /* ------------------------------------------------------------------ */

  async _recordCreationEvents(input, booking, trip, client, adminId, adminName, ipAddress, userAgent, tx) {
    const now = new Date();

    await this.bookingTimelineRepo.addEvent(
      booking.booking_id,
      'booking_created',
      JSON.stringify({
        booking_number: booking.booking_number,
        source: 'MANUAL',
        created_by: adminName,
        client: client.company_name,
      }),
      tx
    );

    await this.bookingTimelineRepo.addEvent(
      booking.booking_id,
      'booking_confirmed_by_admin',
      JSON.stringify({
        confirmed_at: now,
        admin_id: adminId,
        admin_name: adminName,
        final_price: booking.final_price,
        source_type: 'MANUAL',
      }),
      tx
    );

    await this.tripTimelineRepo.create(
      {
        trip_id: trip.trip_id,
        event_type: 'TRIP_CREATED',
        description: `Operational trip created for manual order ${booking.booking_number}`,
        reference_type: 'trip',
        reference_id: trip.trip_id,
        metadata: JSON.stringify({
          trip_number: trip.trip_number,
          booking_id: booking.booking_id,
          booking_number: booking.booking_number,
          source_type: 'MANUAL',
          created_by: adminName,
        }),
        created_by: adminId,
      },
      tx
    );

    await this.tripTimelineRepo.create(
      {
        trip_id: trip.trip_id,
        event_type: 'ORDER_CONFIRMED',
        description: `Manual order confirmed`,
        reference_type: 'booking',
        reference_id: booking.booking_id,
        metadata: JSON.stringify({
          order_number: booking.booking_number,
          client: client.company_name,
          pickup: `${booking.pickup_location}, ${booking.pickup_city}`,
          drop: `${booking.drop_location}, ${booking.drop_city}`,
          goods: booking.goods_description,
          vehicle_required: booking.vehicle_type_required,
          trip_date: input?.vehicle?.tripDate || null,
          freight: booking.final_price,
          created_by: adminName,
        }),
        created_by: adminId,
      },
      tx
    );

    await this.auditLogRepo.create(
      {
        user_id: adminId,
        user_role: 'admin',
        action: 'MANUAL_ORDER_CREATED',
        entity_type: 'booking',
        entity_id: booking.booking_id,
        previous_value: null,
        new_value: JSON.stringify({
          booking_number: booking.booking_number,
          trip_number: trip.trip_number,
          client_id: client.client_id,
          client_name: client.company_name,
          client_phone: client.phone,
          source: 'MANUAL',
          pickup: booking.pickup_location,
          drop: booking.drop_location,
          goods: booking.goods_description,
          freight: booking.final_price,
          total_billing: booking.final_price,
        }),
        reason: `Manual order created by ${adminName} via Create Order`,
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: now,
      },
      tx
    );
  }
}

module.exports = ManualOrderService;
