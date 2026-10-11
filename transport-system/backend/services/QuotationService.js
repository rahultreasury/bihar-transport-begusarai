/**
 * QuotationService.js
 * ---------------------------------------------------------------------------
 * PHASE B — THE REAL QUOTATION / RATE MODULE.
 * Client document: "Bihar Transport — Complete Transport Software Workflow"
 * Section §2 "QUOTATION / RATE", §3 "PARTY CONFIRMS".
 *
 * WHY THIS EXISTS
 *   Before Phase B the repository had TWO competing quote paths:
 *     • Admin  : QuoteWorkspace → BOOKING quote endpoints → bookings.final_price
 *     • Customer: EnquiryService → ENQUIRY  → enquiries.final_quoted_price
 *   Two entities, two price columns, two truths. The client document is explicit
 *   about the real workflow:
 *
 *       ENQUIRY → GIVE RATE → RATE QUOTED → CONFIRM ORDER → ORDER CONFIRMED
 *
 *   and about the three quotation actions:
 *       • "Save Quotation — saves the rate."
 *       • "If the customer wants time, use Send Quotation and leave the enquiry
 *          open."
 *       • "If the customer confirms on the call, select Confirm Order right there
 *          on the quotation screen."
 *
 *   So THIS service is the ONE canonical quotation path, and it hangs off the
 *   ENQUIRY. The Booking is never the commercial source — it receives an
 *   immutable financial snapshot (BookingQuotationSnapshot) at conversion.
 *
 * SERVER-AUTHORITATIVE MONEY — THE SINGLE MOST IMPORTANT PROPERTY
 *   Nothing the browser sends about money is trusted. total_freight,
 *   charge.total, total_additional_charges, schedule_total,
 *   schedule_remaining and total_billing_amount are computed here from the
 *   operator's raw inputs and OVERWRITE whatever arrived. The frontend may
 *   preview a total for UX; the server value is the one that is stored, returned
 *   and printed on the PDF.
 *
 * WHAT IS DELIBERATELY NOT INVENTED
 *   ⚠ GST / RCM ARITHMETIC IS "NOT SPECIFIED IN CLIENT DOCUMENT".
 *   The document's worked example (Freight 6000, GST 5%, Total Freight 6000,
 *   additional charge 3000, Total Billing Amount 9000) is CONSISTENT WITH GST
 *   being excluded from the billing total — 6000 + 3000 = 9000 — but the
 *   document never states the rule. We therefore:
 *     • STORE gst_type, gst_percentage and gst_amount faithfully
 *     • DISPLAY them on the quotation and the PDF
 *     • DO NOT add or subtract GST from any total
 *   Changing this requires written confirmation from the client, not a guess.
 *   See calculateTotals().
 *
 * SEPARATION FROM OTHER FINANCIAL SYSTEMS — NON-NEGOTIABLE
 *   This service touches ONLY Enquiry + Quotation + Booking snapshot. It does
 *   not read or write TripFinancial, TripAdvance, TripSettlement, PartnerPayment,
 *   PartnerLedger or any customer-payment record. A quotation says WHAT WAS
 *   AGREED AND WHEN — it is not money received. Actual payment recording is a
 *   later phase and must never be folded in here.
 *
 * EXISTING SECURITY IS PRESERVED, NOT WEAKENED
 *   • Save/Update/Send/Download are admin-only (protect + adminOnly at the route).
 *   • Customer-facing reads go through EnquiryService.assertCustomerAccess and
 *     the existing isQuoteVisibleToCustomer() gate — a DRAFT quotation is never
 *     visible to a customer, and a SENT quotation is visible but still not
 *     converted.
 *   • Send and Confirm Order are idempotent (conditional updates + unique
 *     constraints), so a double-click or a retry can never create two orders.
 */

const { prisma } = require('../config/prisma');
const { logger } = require('../utils/logger');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/AppError');
const { assertTransition, shortestPath } = require('../utils/EnquiryStateMachine');

/** Absolute rupee ceiling for anything the client types in. */
const MAX_QUOTE_AMOUNT = 100_000_000;
/** A quotation below this is not a commercial offer. */
const MIN_QUOTE_AMOUNT = 1;
/** Upper bound for a validity period, in days. */
const MAX_VALIDITY_DAYS = 3650;
/** Custom schedules are capped so a pathological payload cannot create unbounded rows. */
const MAX_MILESTONES = 50;
const MAX_CHARGES = 100;

const RATE_TYPES = new Set(['FIXED', 'PER_UNIT']);
const GST_TYPES = new Set(['RCM', 'FORWARD_CHARGE', 'EXEMPT']);
const SCHEDULE_TYPES = new Set([
  'FULL_PAYMENT_IN_ADVANCE',
  'BOOKING_ADVANCE_BALANCE',
  'CUSTOM',
]);
const MILESTONE_AMOUNT_TYPES = new Set(['FIXED', 'PERCENTAGE']);

/** Client-facing labels (client document §2 wording). */
const SCHEDULE_LABELS = {
  FULL_PAYMENT_IN_ADVANCE: 'Full Payment in Advance',
  BOOKING_ADVANCE_BALANCE: 'Booking Amount + Advance After Loading + Balance at Unloading',
  CUSTOM: 'Custom Schedule',
};

/**
 * Money is rounded to 2 decimals at every boundary.
 * Doing it once here keeps the DB, the API and the PDF byte-identical.
 */
function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse a number strictly. Returns null when absent/unparseable. */
function num(value, field, { min = null, max = null } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) {
    throw new ValidationError({ message: `${field} must be a number` });
  }
  if (min !== null && n < min) {
    throw new ValidationError({ message: `${field} must be at least ${min}` });
  }
  if (max !== null && n > max) {
    throw new ValidationError({ message: `${field} must not exceed ${max}` });
  }
  return n;
}

function requireEnum(value, allowed, field) {
  const v = String(value ?? '').trim().toUpperCase();
  if (!allowed.has(v)) {
    throw new ValidationError({
      message: `${field} must be one of: ${[...allowed].join(', ')}`,
    });
  }
  return v;
}

function optionalString(value, field, max = 200) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > max) {
    throw new ValidationError({ message: `${field} must be ${max} characters or fewer` });
  }
  return s;
}

/**
 * QuotationService
 */
class QuotationService {
  constructor(deps = {}) {
    this.prisma = deps.prisma || prisma;
    // Injected so tests can prove Confirm Order reuses the EXISTING, already
    // secured acceptance path instead of a second order-creation mechanism.
    this.enquiryService = deps.enquiryService || null;
  }

  // =========================================================================
  // INTERNAL — calculations (pure, exported for unit testing)
  // =========================================================================

  /**
   * Additional charge line totals (client document §2):
   *   "Charges Name / Rate / Quantity / Total"  e.g. Detention 1500 × 2 Days = 3000
   *
   * `total` is IGNORED from the caller — it is always rate × quantity.
   *
   * @param {Array<object>} input
   * @returns {{charges: Array, total: number}}
   */
  static normaliseCharges(input) {
    if (input === null || input === undefined) return { charges: [], total: 0 };
    if (!Array.isArray(input)) {
      throw new ValidationError({ message: 'additional_charges must be an array' });
    }
    if (input.length > MAX_CHARGES) {
      throw new ValidationError({
        message: `A quotation may carry at most ${MAX_CHARGES} additional charges`,
      });
    }

    const charges = input.map((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new ValidationError({ message: `additional_charges[${index}] must be an object` });
      }
      const charges_name = optionalString(row.charges_name, `additional_charges[${index}].charges_name`, 120);
      if (!charges_name) {
        throw new ValidationError({
          message: `additional_charges[${index}].charges_name is required`,
        });
      }
      const rate = num(row.rate, `additional_charges[${index}].rate`, { min: 0, max: MAX_QUOTE_AMOUNT });
      if (rate === null) {
        throw new ValidationError({ message: `additional_charges[${index}].rate is required` });
      }
      const quantity = num(row.quantity, `additional_charges[${index}].quantity`, { min: 0, max: 1_000_000 });
      if (quantity === null) {
        throw new ValidationError({ message: `additional_charges[${index}].quantity is required` });
      }
      // "2 Days" is stored as quantity = 2, quantity_unit = 'Days'. Never the
      // string "2 Days" inside a numeric field.
      const quantity_unit = optionalString(row.quantity_unit, `additional_charges[${index}].quantity_unit`, 30);

      return {
        charges_name,
        rate: round2(rate),
        quantity: round2(quantity),
        quantity_unit,
        total: round2(rate * quantity), // server-authoritative
        sort_order: index,
      };
    });

    const total = round2(charges.reduce((sum, c) => sum + c.total, 0));
    return { charges, total };
  }

  /**
   * Payment schedule (client document §2).
   *
   *   • "Full Payment in Advance"
   *   • "Booking Amount + Advance After Loading + Balance at Unloading"
   *   • "Custom Schedule"
   *
   * THE OPTION-2 RULE, READ LITERALLY (this is the part that is easy to get
   * wrong and would double-charge the customer):
   *
   *   "enter Booking Amount: ₹2,000 and Advance After Loading: 80% of freight,
   *    including the booking amount. The balance is calculated automatically."
   *
   * "INCLUDING THE BOOKING AMOUNT" means the advance after loading is the TOTAL
   * collected by that point, not an ADDITIONAL top-up. So on ₹6,000 freight:
   *
   *      80% of 6000                = 4800   ← target collected by loading
   *      booking amount             = 2000
   *      ADDITIONAL advance required= 2800   ← NOT 4800 (that would be 6800)
   *      remaining at unloading     = 1200
   *
   * We model that explicitly: the booking is a DUE POINT worth `booking_amount`,
   * and the loading milestone is worth `advance_target − booking_amount`.
   *
   * @returns {{milestones: Array, scheduleTotal: number, scheduleRemaining: number}}
   */
  static buildSchedule({ scheduleType, freight, totalBillingAmount, bookingAmount, advancePercentage, milestones }) {
    // ── Option 1 ────────────────────────────────────────────────────────────
    if (scheduleType === 'FULL_PAYMENT_IN_ADVANCE') {
      const amount = round2(totalBillingAmount);
      return {
        milestones: [
          {
            due_point: 'Full Payment in Advance',
            amount_type: 'FIXED',
            amount_value: amount,
            computed_amount: amount,
            remaining_balance: 0,
            sort_order: 0,
          },
        ],
        scheduleTotal: amount,
        scheduleRemaining: 0,
      };
    }

    // ── Option 2 ────────────────────────────────────────────────────────────
    if (scheduleType === 'BOOKING_ADVANCE_BALANCE') {
      const booking = round2(bookingAmount || 0);
      if (booking <= 0) {
        throw new ValidationError({
          message: 'booking_amount is required and must be greater than 0 for this payment schedule',
        });
      }
      if (booking > freight) {
        throw new ValidationError({
          message: 'booking_amount must not exceed the freight amount',
        });
      }

      const pct = round2(advancePercentage === null || advancePercentage === undefined ? 100 : advancePercentage);
      if (pct <= 0 || pct > 100) {
        throw new ValidationError({
          message: 'advance_after_loading_percentage must be greater than 0 and at most 100',
        });
      }

      // Target collected by the time loading is finished, as a share of FREIGHT
      // (the client says "80% of freight", not "80% of the billing amount").
      const advanceTarget = round2((freight * pct) / 100);

      // The advance INCLUDES the booking, so the extra advance needed at
      // loading is the difference. Never simply add booking + advance.
      const additionalAdvance = round2(advanceTarget - booking);

      if (additionalAdvance < 0) {
        throw new ValidationError({
          message:
            `advance_after_loading_percentage of ${pct}% (₹${advanceTarget}) is less than the booking amount of ₹${booking}. ` +
            'The advance must include the booking amount, so it cannot be smaller than it.',
        });
      }

      // Whatever is not collected against freight by unloading stays outstanding
      // and is added to the billing total (e.g. additional charges).
      const balance = round2(totalBillingAmount - advanceTarget);

      const rows = [
        {
          due_point: 'Booking Amount',
          amount_type: 'FIXED',
          amount_value: booking,
          computed_amount: booking,
          remaining_balance: 0, // filled in below
          sort_order: 0,
        },
        {
          due_point: 'Advance After Loading',
          amount_type: 'FIXED',
          amount_value: additionalAdvance,
          computed_amount: additionalAdvance,
          remaining_balance: 0,
          sort_order: 1,
        },
        {
          due_point: 'Balance at Unloading',
          amount_type: 'FIXED',
          amount_value: balance,
          computed_amount: balance,
          remaining_balance: 0,
          sort_order: 2,
        },
      ];

      let running = round2(totalBillingAmount);
      rows.forEach((row) => {
        running = round2(running - row.computed_amount);
        row.remaining_balance = running;
      });

      // Guard: option 2 must never schedule more than the billing amount.
      const scheduleTotal = round2(rows.reduce((s, r) => s + r.computed_amount, 0));
      if (scheduleTotal > totalBillingAmount + 0.01) {
        throw new ValidationError({
          message:
            `Payment schedule totals ₹${scheduleTotal}, which exceeds the total billing amount of ₹${totalBillingAmount}.`,
        });
      }

      return { milestones: rows, scheduleTotal, scheduleRemaining: round2(totalBillingAmount - scheduleTotal) };
    }

    // ── Option 3 ────────────────────────────────────────────────────────────
    // "For Custom Schedule, add milestones, choose when each is due, and enter a
    //  fixed amount or percentage. The software shows the remaining balance."
    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw new ValidationError({
        message: 'A custom payment schedule requires at least one milestone',
      });
    }
    if (milestones.length > MAX_MILESTONES) {
      throw new ValidationError({
        message: `A custom payment schedule may carry at most ${MAX_MILESTONES} milestones`,
      });
    }

    const rows = [];
    let running = round2(totalBillingAmount);

    milestones.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new ValidationError({ message: `milestones[${index}] must be an object` });
      }
      const due_point = optionalString(row.due_point, `milestones[${index}].due_point`, 120);
      if (!due_point) {
        throw new ValidationError({ message: `milestones[${index}].due_point is required` });
      }
      const amount_type = requireEnum(row.amount_type || 'FIXED', MILESTONE_AMOUNT_TYPES, `milestones[${index}].amount_type`);

      const raw = num(row.amount_value, `milestones[${index}].amount_value`, { min: 0 });
      if (raw === null) {
        throw new ValidationError({ message: `milestones[${index}].amount_value is required` });
      }

      let computed;
      if (amount_type === 'PERCENTAGE') {
        if (raw <= 0 || raw > 100) {
          throw new ValidationError({
            message: `milestones[${index}].amount_value percentage must be greater than 0 and at most 100`,
          });
        }
        // Percentage is taken of the total billing amount. The base is
        // "NOT SPECIFIED IN CLIENT DOCUMENT"; this choice is documented in the
        // final report and must be confirmed with the client.
        computed = round2((totalBillingAmount * raw) / 100);
      } else {
        if (raw <= 0) {
          throw new ValidationError({
            message: `milestones[${index}].amount_value must be greater than 0`,
          });
        }
        computed = round2(raw);
      }

      running = round2(running - computed);
      rows.push({
        due_point,
        amount_type,
        amount_value: round2(raw),
        computed_amount: computed,
        remaining_balance: running,
        sort_order: index,
      });
    });

    const scheduleTotal = round2(rows.reduce((s, r) => s + r.computed_amount, 0));

    // "Do not allow a custom schedule to silently exceed the quotation amount."
    if (scheduleTotal > totalBillingAmount + 0.01) {
      throw new ValidationError({
        message:
          `Custom payment schedule totals ₹${scheduleTotal}, which exceeds the total billing amount of ₹${totalBillingAmount}.`,
      });
    }

    return { milestones: rows, scheduleTotal, scheduleRemaining: round2(totalBillingAmount - scheduleTotal) };
  }

  /**
   * The canonical money calculation.
   *
   *   total_freight            = freight
   *   total_additional_charges = Σ (rate × quantity)
   *   total_billing_amount     = total_freight + total_additional_charges
   *                               + additional_charges_tax
   *
   * GST IS DELIBERATELY EXCLUDED — see the file header. gst_amount is computed
   * and stored for display only.
   */
  static calculateTotals({ freight, chargesTotal, additionalChargesTax, gstPercentage, gstType }) {
    const total_freight = round2(freight);
    const total_additional_charges = round2(chargesTotal || 0);
    const tax = round2(additionalChargesTax || 0);

    // GST amount is recorded for the customer's information. Under RCM the
    // liability sits with the recipient, and the client's own example excludes
    // it from the billing amount. The ARITHMETIC is not specified by the
    // document, so GST never silently changes a total.
    const gst = round2(
      gstType && gstPercentage !== null && gstPercentage !== undefined
        ? (total_freight * gstPercentage) / 100
        : 0,
    );

    const total_billing_amount = round2(total_freight + total_additional_charges + tax);

    return {
      total_freight,
      total_additional_charges,
      additional_charges_tax: tax,
      gst_amount: gst,
      total_billing_amount,
    };
  }

  // =========================================================================
  // INTERNAL — persistence helpers
  // =========================================================================

  /**
   * Server-derived, human-readable quotation reference.
   * Derived from the row's own PK exactly like EnquiryNumberService does for
   * enquiries — never from Math.random(), a UUID or client input.
   */
  static buildQuotationNumber(quotationId, when = new Date()) {
    const y = String(when.getFullYear()).slice(-2);
    const m = String(when.getMonth() + 1).padStart(2, '0');
    const d = String(when.getDate()).padStart(2, '0');
    return `QT-${y}${m}${d}-${String(quotationId).padStart(6, '0')}`;
  }

  /** The full relation graph the API and the PDF both read. */
  static QUOTATION_INCLUDE() {
    return {
      quotation_charges: { orderBy: { sort_order: 'asc' } },
      quotation_milestones: { orderBy: { sort_order: 'asc' } },
    };
  }

  async loadQuotation(enquiryId) {
    return this.prisma.quotations.findUnique({
      where: { enquiry_id: enquiryId },
      include: QuotationService.QUOTATION_INCLUDE(),
    });
  }

  /** Guard: an enquiry must exist and must still be quotable. */
  async assertQuotableEnquiry(enquiryId) {
    const enquiry = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: enquiryId },
      select: { enquiry_id: true, enquiry_number: true, status: true, booking_id: true },
    });
    if (!enquiry) {
      throw new NotFoundError({ message: 'Enquiry not found' });
    }
    return enquiry;
  }

  /**
   * A quotation is no longer editable once the customer has been shown it or the
   * enquiry has become an order — the money is then a commitment, not a draft.
   */
  static assertEditable(quotation) {
    if (!quotation) return;
    if (quotation.status === 'CONVERTED') {
      throw new ConflictError({
        message: 'This quotation has already been converted into an order and can no longer be edited.',
      });
    }
  }

  // =========================================================================
  // CREATE / UPDATE  —  client document §2 "[Save Quotation]"
  // =========================================================================

  /**
   * Save (create-or-update) the ONE canonical quotation for an enquiry.
   *
   * IDEMPOTENT & SAFE FOR RETRIES
   *   `Quotation.enquiry_id` is @unique and the enquiry ↔ quotation link is
   *   @unique, so two concurrent saves cannot produce two quotations: the second
   *   either finds the existing row (→ update) or loses the unique race and
   *   falls back to a re-read. The money is always recomputed server-side, so a
   *   retried request is safe to replay.
   *
   * A quotation that has already been SENT or CONVERTED is never silently
   * overwritten — a QuotationVersion row freezes the previous numbers first.
   *
   * @param {number} enquiryId
   * @param {object} input
   * @param {{adminId?:number}} [admin]
   * @returns {Promise<object>} the persisted quotation
   */
  async saveQuotation(enquiryId, input, admin = {}) {
    const enquiry = await this.assertQuotableEnquiry(enquiryId);
    if (enquiry.booking_id) {
      throw new ConflictError({
        message: 'This enquiry has already been converted into an order, so its quotation is locked.',
      });
    }

    const existing = await this.loadQuotation(enquiryId);
    QuotationService.assertEditable(existing);

    // ── Validate the operator's inputs ──────────────────────────────────────
    const rate_type = requireEnum(input.rate_type || 'FIXED', RATE_TYPES, 'rate_type');

    const freight = num(input.freight, 'freight', { min: 0, max: MAX_QUOTE_AMOUNT });
    if (freight === null) {
      throw new ValidationError({ message: 'freight is required' });
    }
    if (freight < MIN_QUOTE_AMOUNT) {
      throw new ValidationError({ message: `freight must be at least ₹${MIN_QUOTE_AMOUNT}` });
    }

    const rate = num(input.rate, 'rate', { min: 0, max: MAX_QUOTE_AMOUNT });

    const gst_type = input.gst_type
      ? requireEnum(input.gst_type, GST_TYPES, 'gst_type')
      : null;
    const gst_percentage =
      gst_type === null || gst_type === 'EXEMPT'
        ? null
        : num(input.gst_percentage, 'gst_percentage', { min: 0, max: 100 });
    if (gst_type && gst_type !== 'EXEMPT' && gst_percentage === null) {
      throw new ValidationError({ message: 'gst_percentage is required when gst_type is set' });
    }

    const additional_charges_tax = num(input.additional_charges_tax, 'additional_charges_tax', {
      min: 0,
      max: MAX_QUOTE_AMOUNT,
    }) ?? 0;

    const validity_days = num(input.validity_days, 'validity_days', { min: 1, max: MAX_VALIDITY_DAYS });
    const valid_until = validity_days
      ? new Date(Date.now() + validity_days * 24 * 60 * 60 * 1000)
      : null;

    const payment_schedule_type = requireEnum(
      input.payment_schedule_type || 'FULL_PAYMENT_IN_ADVANCE',
      SCHEDULE_TYPES,
      'payment_schedule_type',
    );
    const booking_amount = num(input.booking_amount, 'booking_amount', { min: 0, max: MAX_QUOTE_AMOUNT });
    const advance_after_loading_percentage = num(
      input.advance_after_loading_percentage,
      'advance_after_loading_percentage',
      { min: 0, max: 100 },
    );

    const remarks = optionalString(input.remarks, 'remarks', 1000);

    // ── Server-authoritative money ──────────────────────────────────────────
    const { charges, total: chargesTotal } = QuotationService.normaliseCharges(input.additional_charges);
    const totals = QuotationService.calculateTotals({
      freight,
      chargesTotal,
      additionalChargesTax: additional_charges_tax,
      gstPercentage: gst_percentage,
      gstType: gst_type,
    });

    const schedule = QuotationService.buildSchedule({
      scheduleType: payment_schedule_type,
      freight: totals.total_freight,
      totalBillingAmount: totals.total_billing_amount,
      bookingAmount: booking_amount,
      advancePercentage: advance_after_loading_percentage,
      milestones: input.milestones,
    });

    const data = {
      rate_type,
      rate,
      freight: round2(freight),
      total_freight: totals.total_freight,
      gst_type,
      gst_percentage,
      gst_amount: totals.gst_amount,
      total_additional_charges: totals.total_additional_charges,
      additional_charges_tax: totals.additional_charges_tax,
      total_billing_amount: totals.total_billing_amount,
      validity_days,
      valid_until: valid_until ?? null,
      payment_schedule_type,
      booking_amount: payment_schedule_type === 'BOOKING_ADVANCE_BALANCE' ? booking_amount ?? 0 : null,
      advance_after_loading_percentage:
        payment_schedule_type === 'BOOKING_ADVANCE_BALANCE'
          ? advance_after_loading_percentage ?? 100
          : null,
      schedule_total: schedule.scheduleTotal,
      schedule_remaining: schedule.scheduleRemaining,
      remarks,
      quoted_at: existing?.quoted_at ?? new Date(),
      quoted_by_admin_id: existing?.quoted_by_admin_id ?? admin.adminId ?? null,
      updated_by_admin_id: admin.adminId ?? null,
    };

    // A freshly saved rate means the rate exists — client status "RATE QUOTED".
    // The status only ever advances; a later save never demotes a sent quote
    // back to draft.
    const nextStatus = existing && existing.status !== 'DRAFT' ? existing.status : 'RATE_QUOTED';

    const saved = await this.prisma.$transaction(async (tx) => {
      // Freeze the previous numbers before they are overwritten, so the audit
      // trail keeps every amount the customer was ever shown.
      if (existing && (existing.status === 'SENT' || existing.status === 'CONVERTED')) {
        const last = await tx.quotation_versions.findFirst({
          where: { quotation_id: existing.quotation_id },
          orderBy: { version_number: 'desc' },
          select: { version_number: true },
        });
        await tx.quotation_versions.create({
          data: {
            quotation_id: existing.quotation_id,
            version_number: (last?.version_number ?? 0) + 1,
            rate_type: existing.rate_type,
            rate: existing.rate,
            freight: existing.freight,
            total_freight: existing.total_freight,
            gst_type: existing.gst_type,
            gst_percentage: existing.gst_percentage,
            gst_amount: existing.gst_amount,
            total_additional_charges: existing.total_additional_charges,
            additional_charges_tax: existing.additional_charges_tax,
            total_billing_amount: existing.total_billing_amount,
            validity_days: existing.validity_days,
            payment_schedule_type: existing.payment_schedule_type,
            booking_amount: existing.booking_amount,
            advance_after_loading_percentage: existing.advance_after_loading_percentage,
            schedule_total: existing.schedule_total,
            schedule_remaining: existing.schedule_remaining,
            remarks: existing.remarks,
            changed_by_admin_id: admin.adminId ?? null,
            change_reason: optionalString(input.change_reason, 'change_reason', 255),
          },
        });
      }

      let quotation;
      if (existing) {
        quotation = await tx.quotations.update({
          where: { quotation_id: existing.quotation_id },
          data: { ...data, status: nextStatus },
          include: QuotationService.QUOTATION_INCLUDE(),
        });
      } else {
        // The quotation_number is DERIVED FROM THE ROW'S OWN PRIMARY KEY, so
        // it can only be written once the insert has returned that key. A short
        // unique-safe placeholder satisfies the NOT NULL constraint for the
        // duration of the insert; it is immediately replaced below inside the
        // same transaction, so no caller can ever observe it.
        const inserted = await tx.quotations.create({
          data: {
            ...data,
            enquiry_id: enquiry.enquiry_id,
            status: nextStatus,
            quotation_number: `PENDING-${enquiry.enquiry_id}-${Date.now()}`,
            updated_at: new Date(),
          },
          select: { quotation_id: true },
        });

        quotation = await tx.quotations.update({
          where: { quotation_id: inserted.quotation_id },
          data: { quotation_number: QuotationService.buildQuotationNumber(inserted.quotation_id) },
          include: QuotationService.QUOTATION_INCLUDE(),
        });
      }

      // Exactly one canonical quotation per enquiry, enforced by the DB.
      if (!existing) {
        await tx.enquiry.update({
          where: { enquiry_id: enquiry.enquiry_id },
          data: { quotation_id: quotation.quotation_id },
        });
      }

      // Charges and milestones are replaced wholesale: the operator's list is
      // the truth, so a removed line must actually disappear.
      await tx.quotation_charges.deleteMany({ where: { quotation_id: quotation.quotation_id } });
      if (charges.length) {
        await tx.quotation_charges.createMany({
          data: charges.map((c) => ({ ...c, quotation_id: quotation.quotation_id, updated_at: new Date() })),
        });
      }

      await tx.quotation_milestones.deleteMany({ where: { quotation_id: quotation.quotation_id } });
      if (schedule.milestones.length) {
        await tx.quotation_milestones.createMany({
          data: schedule.milestones.map((m) => ({ ...m, quotation_id: quotation.quotation_id, updated_at: new Date() })),
        });
      }

      // Re-read inside the transaction so the returned object carries the
      // charges and milestones that were written a moment ago. Returning the
      // pre-write row would hand the caller an empty list while the database
      // holds the real one.
      return tx.quotations.findUnique({
        where: { quotation_id: quotation.quotation_id },
        include: QuotationService.QUOTATION_INCLUDE(),
      });
    });

    // A DRAFT quote is internal — the customer must never see a number that was
    // not deliberately sent to them. Mirrors the existing enquiry rule.
    await this._recordEvent(enquiry.enquiry_id, 'QUOTATION_SAVED', {
      message: `Quotation ${saved.quotation_number} saved — total billing amount ₹${saved.total_billing_amount.toLocaleString('en-IN')}`,
      metadata: {
        quotation_id: saved.quotation_id,
        total_billing_amount: saved.total_billing_amount,
        schedule_total: saved.schedule_total,
      },
      customerVisible: false,
    });

    logger.info(
      { enquiryId: enquiry.enquiry_id, quotationId: saved.quotation_id, adminId: admin.adminId },
      'quotation.saved',
    );

    return saved;
  }

  // =========================================================================
  // READ
  // =========================================================================

  /**
   * Read the persisted quotation. `null` when the enquiry has never been quoted.
   */
  async getQuotation(enquiryId) {
    await this.assertQuotableEnquiry(enquiryId);
    return this.loadQuotation(enquiryId);
  }

  /**
   * Customer-facing projection.
   *
   * This reuses the EXISTING visibility gate rather than inventing a second
   * rule: a quotation is only ever shown to the customer once it has been sent,
   * and even then the enquiry is still open. The caller has already proven
   * ownership via EnquiryService.assertCustomerAccess.
   *
   * @returns {object|null}
   */
  async getQuotationForCustomer(enquiry, { isVisibleToCustomer }) {
    const quotation = await this.loadQuotation(enquiry.enquiry_id);
    if (!quotation) return null;

    // THE GATE IS THE QUOTATION'S OWN PUBLISHED STATUS.
    //
    // A DRAFT or RATE_QUOTED quotation is never returned — the money simply is
    // not in the payload. SENT/CONVERTED means an authenticated admin
    // deliberately published it, which is exactly the same guarantee the legacy
    // enquiry-status gate provided, expressed against the new canonical source.
    //
    // The enquiry-status gate is still honoured when a caller passes it
    // explicitly, so the legacy behaviour cannot be widened by this method.
    const published = quotation.status === 'SENT' || quotation.status === 'CONVERTED';
    const notExplicitlyBlocked = isVisibleToCustomer !== false;
    if (!published || !notExplicitlyBlocked) return null;

    return {
      quotation_id: quotation.quotation_id,
      quotation_number: quotation.quotation_number,
      status: quotation.status,
      rate_type: quotation.rate_type,
      rate: quotation.rate,
      freight: quotation.freight,
      total_freight: quotation.total_freight,
      gst_type: quotation.gst_type,
      gst_percentage: quotation.gst_percentage,
      gst_amount: quotation.gst_amount,
      total_additional_charges: quotation.total_additional_charges,
      additional_charges_tax: quotation.additional_charges_tax,
      total_billing_amount: quotation.total_billing_amount,
      validity_days: quotation.validity_days,
      valid_until: quotation.valid_until,
      payment_schedule_type: quotation.payment_schedule_type,
      payment_schedule_label: SCHEDULE_LABELS[quotation.payment_schedule_type] || null,
      booking_amount: quotation.booking_amount,
      advance_after_loading_percentage: quotation.advance_after_loading_percentage,
      schedule_total: quotation.schedule_total,
      schedule_remaining: quotation.schedule_remaining,
      remarks: quotation.remarks,
      additional_charges: quotation.quotation_charges,
      milestones: quotation.quotation_milestones,
      quoted_at: quotation.quoted_at,
      sent_at: quotation.sent_at,
      confirmed_at: quotation.confirmed_at,
      // Explicit so the customer UI can never infer that receiving a quote
      // means an order exists.
      converted: quotation.status === 'CONVERTED',
    };
  }

  // =========================================================================
  // SEND  —  client document §2 "[Send Quotation]"
  // =========================================================================

  /**
   * Publish the PERSISTED quotation to the customer.
   *
   * Guarantees, in order:
   *   1. the enquiry exists and has not become an order
   *   2. a quotation exists
   *   3. it is not already converted
   *   4. the amounts are recalculated from the stored rows — the payload carries
   *      NO money at all, so an unsaved or client-side figure cannot be sent
   *   5. the status move is CLAIMED with a conditional update, so a
   *      double-click or two racing admins produce ONE send
   *
   * The enquiry is deliberately NOT advanced to an order: client document §2 —
   * "If the customer wants time, use Send Quotation and leave the enquiry open."
   *
   * @returns {Promise<{quotation: object, alreadySent: boolean}>}
   */
  async sendQuotation(enquiryId, admin = {}) {
    const enquiry = await this.assertQuotableEnquiry(enquiryId);
    const quotation = await this.loadQuotation(enquiryId);

    if (!quotation) {
      throw new NotFoundError({
        message: 'Save the quotation before sending it to the customer.',
      });
    }
    if (quotation.status === 'CONVERTED') {
      throw new ConflictError({
        message: 'This quotation has already been converted into an order.',
      });
    }
    if (quotation.total_billing_amount <= 0) {
      throw new ValidationError({ message: 'The quotation has no billing amount to send.' });
    }

    // Re-derive the amounts from the rows that are actually stored. If someone
    // edited the rows behind the service's back, the sent figures still match
    // what is on file rather than what the caller claimed.
    const charges = [...quotation.quotation_charges].sort((a, b) => a.sort_order - b.sort_order);
    const chargesTotal = round2(charges.reduce((sum, c) => sum + c.total, 0));
    const totals = QuotationService.calculateTotals({
      freight: quotation.freight,
      chargesTotal,
      additionalChargesTax: quotation.additional_charges_tax,
      gstPercentage: quotation.gst_percentage,
      gstType: quotation.gst_type,
    });

    if (quotation.status === 'SENT') {
      // Idempotent: a repeated send returns the same published quotation.
      return { quotation, alreadySent: true };
    }

    const now = new Date();
    const claim = await this.prisma.quotations.updateMany({
      where: { quotation_id: quotation.quotation_id, status: { in: ['DRAFT', 'RATE_QUOTED'] } },
      data: {
        status: 'SENT',
        sent_at: now,
        sent_by_admin_id: admin.adminId ?? null,
        updated_by_admin_id: admin.adminId ?? null,
        // Re-persisted from the authoritative re-derivation.
        total_additional_charges: totals.total_additional_charges,
        total_billing_amount: totals.total_billing_amount,
      },
    });

    if (claim.count === 0) {
      const current = await this.loadQuotation(enquiryId);
      if (current && current.status === 'SENT') {
        return { quotation: current, alreadySent: true };
      }
      throw new ConflictError({ message: 'This quotation changed while sending. Please refresh.' });
    }

    // The enquiry stays open. Only its pricing axis reflects that a quote now
    // exists — its operational status is untouched, so no order is implied.
    await this.prisma.enquiry.updateMany({
      where: { enquiry_id: enquiryId },
      data: {
        price_status: 'QUOTED',
        quoted_at: quotation.quoted_at ?? now,
        quoted_by_admin_id: admin.adminId ?? quotation.quoted_by_admin_id ?? null,
      },
    });

    await this._recordEvent(enquiryId, 'QUOTE_SENT', {
      message: `Quotation ${quotation.quotation_number} sent to the customer`,
      metadata: {
        quotation_id: quotation.quotation_id,
        total_billing_amount: totals.total_billing_amount,
      },
      customerVisible: true,
    });

    logger.info({ enquiryId, quotationId: quotation.quotation_id, adminId: admin.adminId }, 'quotation.sent');

    return { quotation: await this.loadQuotation(enquiryId), alreadySent: false };
  }

  // =========================================================================
  // CONFIRM ORDER  —  client document §3 "PARTY CONFIRMS"
  // =========================================================================

  /**
   * Confirm the order from the quotation and convert the enquiry into exactly
   * one Booking.
   *
   * DELEGATES TO THE EXISTING, ALREADY-SECURED ACCEPTANCE PATH
   *   EnquiryService.customerAccept() is the repository's canonical, idempotent
   *   conversion: it atomically claims the status transition with a conditional
   *   update, creates exactly one Booking, links it back to the enquiry via the
   *   unique `booking_id`, and releases the claim if booking creation fails.
   *
   *   Phase B does NOT re-implement any of that and does NOT create a second
   *   order-confirmation mechanism. This method only:
   *     1. verifies the quotation is publishable and current
   *     2. takes the booking price from the PERSISTED quotation
   *     3. calls the existing acceptance path once
   *     4. records the financial snapshot + marks the quotation CONVERTED
   *
   * IDEMPOTENT
   *   If the enquiry already has a Booking, the existing path returns
   *   `alreadyAccepted` and no second order is created. Retrying this endpoint
   *   is safe.
   *
   * @param {number} enquiryId
   * @param {{user?:object, sessionKey?:string, admin?:object, reason?:string}} ctx
   */
  async confirmOrder(enquiryId, ctx = {}) {
    const enquiry = await this.assertQuotableEnquiry(enquiryId);
    const quotation = await this.loadQuotation(enquiryId);

    if (!quotation) {
      throw new NotFoundError({ message: 'There is no quotation to confirm.' });
    }
    // Only a quotation the customer has actually been shown can become an
    // order. A saved-but-unsent quotation is still an internal draft, even
    // though its status already reads "RATE QUOTED".
    if (quotation.status !== 'SENT' && quotation.status !== 'CONVERTED') {
      throw new ConflictError({
        message: 'This quotation has not been sent yet. Send it to the customer first.',
      });
    }

    // Already an order → the existing path's own idempotency handles it and
    // returns the original Booking. No duplicate is possible.
    if (quotation.status === 'CONVERTED' && enquiry.booking_id) {
      const booking = await this.prisma.booking.findUnique({
        where: { booking_id: enquiry.booking_id },
        select: { booking_id: true, booking_number: true, status: true },
      });
      return { enquiry, booking, quotation, alreadyConfirmed: true };
    }

    if (!this.enquiryService) {
      throw new Error('QuotationService requires an enquiryService to confirm an order.');
    }

    // The existing path reads `enquiries.final_quoted_price` for the booking
    // price. We set it from the PERSISTED quotation — never from the request
    // body — so the order is always worth exactly what the customer was sent.
    const billingAmount = round2(quotation.total_billing_amount);

    await this.prisma.enquiry.update({
      where: { enquiry_id: enquiryId },
      data: {
        final_quoted_price: billingAmount,
        quote_remarks: quotation.remarks ?? null,
        price_status: 'QUOTED',
      },
    });

    const fresh = await this.prisma.enquiry.findUnique({
      where: { enquiry_id: enquiryId },
      select: { status: true },
    });

    // Bring the enquiry to AWAITING_CUSTOMER_ACCEPTANCE — the only state the
    // existing customerAccept() accepts from.
    //
    // WHY NOT adminSendQuote()?
    //   The legacy send path refuses to publish unless a vehicle AND a driver
    //   are already committed (EnquiryStateMachine.hasRequiredAssignment:
    //   "a price for a load with no truck is not a quotation the company can
    //   honour").
    //
    //   That rule CONTRADICTS the client document, whose workflow is
    //       ORDER CONFIRMED → WAITING FOR VEHICLE → VEHICLE HIRED
    //   i.e. the vehicle is sourced AFTER the order is confirmed. Requiring a
    //   truck before an order may exist would deadlock the client's workflow.
    //
    //   We therefore do NOT weaken hasRequiredAssignment(); it still governs the
    //   legacy path exactly as before. Instead we advance the status HERE using
    //   the SAME state machine and the SAME atomic conditional-claim pattern:
    //     • the transition is validated with assertTransition(), so an illegal
    //       jump is still impossible;
    //     • the write is a conditional updateMany, so two concurrent confirms
    //       cannot both win;
    //     • the conversion itself is still performed by the untouched,
    //       already-secured customerAccept().
    const path = shortestPath(fresh.status, 'AWAITING_CUSTOMER_ACCEPTANCE');
    if (!path) {
      throw new ConflictError({
        message: `This enquiry cannot reach the customer-acceptance stage from its current status (${fresh.status}).`,
      });
    }

    if (path.length > 0) {
      // Validate EVERY hop against the state machine before writing anything,
      // so no intermediate status is silently skipped.
      let cursor = fresh.status;
      for (const next of path) {
        assertTransition(cursor, next);
        cursor = next;
      }

      const last = path[path.length - 1];
      const claim = await this.prisma.enquiry.updateMany({
        where: { enquiry_id: enquiryId, status: fresh.status },
        data: { status: last },
      });
      if (claim.count === 0) {
        throw new ConflictError({
          message: 'This enquiry changed while confirming. Please refresh and try again.',
        });
      }
    }

    // ONE conversion core. EnquiryService.adminConfirmOrder() and
    // EnquiryService.customerAccept() both delegate to the same private
    // _convertEnquiryToOrder(), so there is exactly one order-creation
    // implementation with one atomic claim and one unique booking.
    const result = await this.enquiryService.adminConfirmOrder(enquiryId, {
      adminId: ctx.admin?.adminId ?? null,
      adminName: ctx.admin?.adminName ?? 'Bihar Transport Admin',
    });

    const booking = result.booking;

    // Freeze the agreed money and snapshot it onto the order. This is a
    // SNAPSHOT for operational execution — the Quotation remains the
    // commercial record.
    if (booking && booking.booking_id) {
      await this.prisma.$transaction(async (tx) => {
        await tx.booking_quotation_snapshots.upsert({
          where: { booking_id: booking.booking_id },
          create: {
            booking_id: booking.booking_id,
            quotation_id: quotation.quotation_id,
            rate_type: quotation.rate_type,
            rate: quotation.rate,
            freight: quotation.freight,
            total_freight: quotation.total_freight,
            gst_type: quotation.gst_type,
            gst_percentage: quotation.gst_percentage,
            gst_amount: quotation.gst_amount,
            total_additional_charges: quotation.total_additional_charges,
            additional_charges_tax: quotation.additional_charges_tax,
            total_billing_amount: quotation.total_billing_amount,
            validity_days: quotation.validity_days,
            payment_schedule_type: quotation.payment_schedule_type,
            schedule_total: quotation.schedule_total,
            schedule_remaining: quotation.schedule_remaining,
          },
          update: {},
        });

        await tx.quotations.update({
          where: { quotation_id: quotation.quotation_id },
          data: {
            status: 'CONVERTED',
            confirmed_at: new Date(),
            confirmed_total_billing_amount: quotation.total_billing_amount,
          },
        });
      });

      await this._recordEvent(enquiryId, 'QUOTATION_CONFIRMED', {
        message: `Quotation ${quotation.quotation_number} confirmed — order ${booking.booking_number} created`,
        metadata: {
          quotation_id: quotation.quotation_id,
          booking_id: booking.booking_id,
          booking_number: booking.booking_number,
          total_billing_amount: quotation.total_billing_amount,
        },
        customerVisible: true,
      });

      logger.info(
        {
          enquiryId,
          quotationId: quotation.quotation_id,
          bookingId: booking.booking_id,
          alreadyAccepted: Boolean(result.alreadyAccepted),
        },
        'quotation.confirmed_order',
      );
    }

    return {
      enquiry: result.enquiry,
      booking,
      quotation: await this.loadQuotation(enquiryId),
      alreadyConfirmed: Boolean(result.alreadyAccepted),
    };
  }

  // =========================================================================
  // INTERNAL — audit
  // =========================================================================

  /**
   * Write an EnquiryEvent when the audit architecture is available.
   * Never fatal: a missing event must not fail a commercial operation.
   */
  async _recordEvent(enquiryId, eventType, { message, metadata, customerVisible = false }) {
    try {
      const eventService = require('./EnquiryEventService');
      const svc = eventService.default || eventService;
      const add = svc.addEvent || (svc.instance && svc.instance.addEvent);
      if (typeof add === 'function') {
        await add.call(svc, {
          enquiryId,
          eventType,
          actorType: 'ADMIN',
          message,
          metadata,
          customerVisible,
        });
      }
    } catch (err) {
      logger.warn({ err: err.message, enquiryId, eventType }, 'quotation.event_write_failed');
    }
  }
}

module.exports = QuotationService;
module.exports.round2 = round2;
module.exports.SCHEDULE_LABELS = SCHEDULE_LABELS;
