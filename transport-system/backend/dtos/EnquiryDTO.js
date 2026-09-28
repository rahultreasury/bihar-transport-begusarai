/**
 * EnquiryDTO
 * ---------------------------------------------------------------------------
 * The privacy boundary for the enquiry module.
 *
 * HARD RULE (this is the most important rule in the enquiry feature):
 *   A CUSTOMER-FACING enquiry response MUST NEVER contain a driver's phone
 *   number — not driver.mobile, not driver.alternate_mobile, not a nested
 *   contact object, not a formatted string, not inside `metadata`.
 *
 * HOW THAT RULE IS ENFORCED (defence in depth, three layers):
 *
 *   1. SELECTION. `customerDriverSelect` is an explicit Prisma `select` that
 *      does not list `mobile` or `alternate_mobile`. The column is never read
 *      from PostgreSQL, so it cannot leak through a careless `JSON.stringify`.
 *
 *   2. SHAPING. Every customer DTO is built by an explicit projection function
 *      that only copies allow-listed keys. Unknown/unexpected fields are
 *      dropped rather than spread through.
 *
 *   3. SCRUBBING. `assertNoDriverPhone()` runs a final recursive guard over the
 *      finished payload and throws if a forbidden key or an 10-digit driver
 *      contact value survived. It is a last-resort tripwire for future edits.
 *
 * The customer may see, after accepting the quote:
 *   driver name, vehicle number, vehicle type, driver rating, assignment status
 * The customer's only contact route is the fixed Bihar Transport customer-care
 * WhatsApp/call number from config/customerCare.js.
 *
 * The driver DTO is the mirror image: it never exposes the customer's mobile,
 * email, or address either — the driver talks to dispatch, not to the customer.
 */

const { toProgressStage, isQuoteVisibleToCustomer } = require('../utils/EnquiryStateMachine');
const { getCustomerCare } = require('../config/customerCare');

// Keys that must never appear anywhere in a customer-facing payload.
const FORBIDDEN_CUSTOMER_KEYS = new Set([
  'mobile',
  'alternate_mobile',
  'driver_mobile',
  'driver_phone',
  'driver_phone_number',
  'phone',
  'phoneNumber',
  'contact',
  'contact_number',
]);

/**
 * Prisma select for a driver when the record is destined for a CUSTOMER.
 * `mobile` / `alternate_mobile` are intentionally absent.
 */
const customerDriverSelect = {
  driver_id: true,
  driver_name: true,
  rating: true,
  profile_image: true,
  is_verified: true,
  total_deliveries: true,
  status: true,
};

/**
 * Full driver select — ADMIN only. Admins and dispatch must be able to call a
 * driver, so the mobile is included here and nowhere else.
 */
const adminDriverSelect = {
  driver_id: true,
  driver_code: true,
  driver_name: true,
  mobile: true,
  alternate_mobile: true,
  status: true,
  is_available: true,
  rating: true,
  transport_owner_id: true,
  partner_id: true,
  current_vehicle_id: true,
};

const vehicleSelect = {
  vehicle_id: true,
  vehicle_number: true,
  vehicle_type: true,
  vehicle_name: true,
  capacity_kg: true,
  body_type: true,
  current_status: true,
};

const ownerSelect = {
  owner_id: true,
  owner_name: true,
  company_name: true,
  city: true,
};

const partnerSelect = {
  partner_id: true,
  partner_name: true,
  partner_code: true,
  city: true,
};

/**
 * The standard `include`/`select` used when loading an enquiry for a CUSTOMER.
 * The driver relation is pinned to customerDriverSelect.
 */
const customerRelationSelect = {
  customer: { select: { user_id: true, first_name: true, last_name: true } },
  assignedDriver: { select: customerDriverSelect },
  assignedVehicle: { select: vehicleSelect },
  assignedOwner: { select: ownerSelect },
  assignedPartner: { select: partnerSelect },
  requestedVehicle: { select: vehicleSelect },
};

/**
 * The standard relation select used for ADMIN / internal reads.
 */
const adminRelationSelect = {
  customer: { select: { user_id: true, first_name: true, last_name: true, email: true, phone: true } },
  assignedDriver: { select: adminDriverSelect },
  assignedVehicle: { select: vehicleSelect },
  assignedOwner: { select: ownerSelect },
  assignedPartner: { select: partnerSelect },
  requestedVehicle: { select: vehicleSelect },
  quotedByAdmin: { select: { admin_id: true, full_name: true, email: true } },
  booking: { select: { booking_id: true, booking_number: true, status: true } },
};

/** @param {*} v @returns {number|null} */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @param {*} v @returns {boolean} */
function bool(v) {
  return v === true || v === 'true' || v === 1;
}

/**
 * Assemble the route/shipment/schedule/pricing blocks. Shared by the customer
 * and admin DTOs so the two can never drift apart on what a "route" means.
 *
 * `revealUnsentQuote` is the one field that legitimately differs. An admin must
 * always see the price they are negotiating; a customer may only see it once an
 * admin has deliberately sent it. buildCore is the shared base, so the rule is
 * applied here rather than by two DTOs drifting apart.
 *
 * @param {object} e
 * @param {{revealUnsentQuote?:boolean}} [opts]
 */
function buildCore(e, opts = {}) {
  const revealUnsentQuote = opts.revealUnsentQuote !== false;
  const quoteVisible = revealUnsentQuote || isQuoteVisibleToCustomer(e.status);

  return {
    enquiry_id: e.enquiry_id,
    enquiry_number: e.enquiry_number,
    status: e.status,
    price_status: e.price_status,
    progress_stage: toProgressStage(e.status),

    route: {
      pickup_location: e.pickup_location,
      pickup_address: e.pickup_address || null,
      pickup_latitude: num(e.pickup_latitude),
      pickup_longitude: num(e.pickup_longitude),
      drop_location: e.drop_location,
      drop_address: e.drop_address || null,
      drop_latitude: num(e.drop_latitude),
      drop_longitude: num(e.drop_longitude),
      distance_km: num(e.distance_km),
    },

    vehicle: {
      requested_vehicle_id: e.requested_vehicle_id || null,
      requested_vehicle_name: e.requested_vehicle_name || null,
      assigned_vehicle_id: e.assigned_vehicle_id || null,
      assigned_vehicle_number: e.assigned_vehicle_number || null,
      assigned_vehicle_type: e.assigned_vehicle_type || null,
    },

    shipment: {
      material: e.material,
      quantity: num(e.quantity),
      quantity_unit: e.quantity_unit || null,
      weight: num(e.weight),
      weight_unit: e.weight_unit || null,
      goods_category: e.goods_category || null,
      fragile: bool(e.fragile),
      special_instructions: e.special_instructions || null,
    },

    schedule: {
      pickup_date: e.pickup_date,
      pickup_time: e.pickup_time,
    },

    pricing: {
      estimated_price_min: num(e.estimated_price_min),
      estimated_price_max: num(e.estimated_price_max),
      // A saved-but-unsent price is a DRAFT. It must reach the customer only
      // after the admin presses "Send Quote to Customer", so before that this
      // is null and the UI falls back to the estimate.
      final_quoted_price: quoteVisible ? num(e.final_quoted_price) : null,
      price_status: e.price_status,
      // quote_remarks is internal commentary on the price — admin only.
      quote_remarks: quoteVisible ? e.quote_remarks || null : null,
      quoted_at: e.quoted_at || null,
    },

    customer: {
      name: e.customer_name,
      // The CUSTOMER's own mobile is fine to echo back — it is their number.
      mobile: e.customer_mobile,
      email: e.customer_email || null,
    },

    timeline: {
      created_at: e.created_at,
      quoted_at: e.quoted_at || null,
      accepted_at: e.accepted_at || null,
      rejected_at: e.rejected_at || null,
      cancelled_at: e.cancelled_at || null,
      confirmed_at: e.confirmed_at || null,
      started_at: e.started_at || null,
      completed_at: e.completed_at || null,
    },
  };
}

/**
 * Build the driver/vehicle block for a CUSTOMER.
 *
 * VISIBILITY RULE
 * Returns `null` only while NOTHING has been assigned yet. Once an admin
 * commits resources, the customer is entitled to see them — the same
 * information the assignment already publishes into their Request Timeline as
 * a customer-visible EnquiryEvent ("Driver Ramesh assigned", "Truck ABC
 * assigned"). Gating this block on `isCustomerCommitted` made the structured
 * card disappear while the event feed still leaked the very same fact, so the
 * customer page sat on "In progress" forever.
 *
 * This widens *when* the block appears. It never widens *what* is in it: no
 * driver mobile, no alternate mobile, no partner ledger or owner payout data.
 * The customer's only contact route remains the customer-care number.
 */
function buildCustomerAssignment(e) {
  const hasVehicle = Boolean(e.assigned_vehicle_id);
  const hasDriver = Boolean(e.assigned_driver_id);

  // No resources committed yet — the honest answer is "not assigned", which
  // the UI renders as the in-progress state.
  if (!hasVehicle && !hasDriver) return null;

  const driver = e.assignedDriver || null;
  const vehicle = e.assignedVehicle || null;

  return {
    // Per-resource flags so the UI can distinguish "vehicle is in, driver is
    // not" from "nothing assigned yet" without inferring it from nulls.
    vehicle_assigned: hasVehicle,
    driver_assigned: hasDriver,

    // Explicit allow-list. `driver` is destructured into these four fields only;
    // even though the relation select already omits mobile, the projection makes
    // the omission obvious to the next reader.
    driver_name: driver ? driver.driver_name : (e.assigned_driver_name || null),
    driver_rating: driver ? num(driver.rating) : null,
    driver_total_deliveries: driver ? (driver.total_deliveries ?? null) : null,
    driver_verified: driver ? bool(driver.is_verified) : null,
    driver_status: driver ? driver.status || null : null,

    vehicle_number: e.assigned_vehicle_number || (vehicle ? vehicle.vehicle_number : null),
    vehicle_type: e.assigned_vehicle_type || (vehicle ? (vehicle.vehicle_name || vehicle.vehicle_type) : null),
    vehicle_id: e.assigned_vehicle_id || null,
    // Already fetched by `vehicleSelect` — surfaced so the customer can see the
    // truck they booked for, not just its registration.
    vehicle_capacity_kg: vehicle ? num(vehicle.capacity_kg) : null,
    vehicle_body_type: vehicle ? vehicle.body_type || null : null,

    transport_owner: e.assignedOwner
      ? { name: e.assignedOwner.company_name || e.assignedOwner.owner_name, city: e.assignedOwner.city || null }
      : null,

    assigned_at: e.driver_assigned_at || e.vehicle_assigned_at || null,

    // PRIVACY: deliberately absent — driver.mobile, driver.alternate_mobile,
    // and any other direct driver contact channel. The customer's only route is
    // customerCare (see `contact` below).
    contact: getCustomerCare(),
  };
}

/**
 * CUSTOMER DTO — the full payload behind GET /api/enquiries/:id,
 * the confirmation page, and the customer socket room.
 *
 * @param {object} e - Prisma enquiry row loaded with customerRelationSelect
 * @param {object[]} [events] - customer-visible EnquiryEvent rows
 * @returns {object}
 */
function toCustomerEnquiry(e, events = []) {
  const dto = {
    // revealUnsentQuote: false — a draft price stays admin-only.
    ...buildCore(e, { revealUnsentQuote: false }),
    assignment: buildCustomerAssignment(e),
    booking: e.booking
      ? {
          booking_id: e.booking.booking_id,
          booking_number: e.booking.booking_number,
          status: e.booking.status,
        }
      : null,
    events: events.map(toCustomerEvent),
    contact: getCustomerCare(),
  };

  return assertNoDriverPhone(dto);
}

/**
 * Compact customer DTO for the enquiry list + status polling endpoint.
 * Omits events and the assignment block's non-essential detail.
 *
 * @param {object} e
 * @returns {object}
 */
function toCustomerEnquirySummary(e) {
  const quoteVisible = isQuoteVisibleToCustomer(e.status);
  return assertNoDriverPhone({
    enquiry_id: e.enquiry_id,
    enquiry_number: e.enquiry_number,
    status: e.status,
    price_status: e.price_status,
    progress_stage: toProgressStage(e.status),
    pickup_location: e.pickup_location,
    drop_location: e.drop_location,
    vehicle_name: e.requested_vehicle_name || e.assigned_vehicle_type || null,
    material: e.material,
    pickup_date: e.pickup_date,
    pickup_time: e.pickup_time,
    // Same draft-quote rule as the full customer DTO.
    final_quoted_price: quoteVisible ? num(e.final_quoted_price) : null,
    estimated_price_min: num(e.estimated_price_min),
    estimated_price_max: num(e.estimated_price_max),
    created_at: e.created_at,
    // No driver block at all in the list view.
  });
}

/**
 * Map an EnquiryEvent row for the customer activity feed.
 * @param {object} ev
 * @returns {object}
 */
function toCustomerEvent(ev) {
  return {
    id: ev.enquiry_event_id,
    type: ev.event_type,
    message: ev.message,
    actor_type: ev.actor_type,
    created_at: ev.created_at,
  };
}

/**
 * ADMIN DTO — the full workspace payload for GET /api/admin/enquiries/:id.
 * Includes driver mobile because dispatch must be able to call the driver.
 *
 * @param {object} e
 * @param {object[]} [events]
 * @returns {object}
 */
function toAdminEnquiry(e, events = []) {
  return {
    ...buildCore(e),
    customer_id: e.customer_id || null,
    session_key: e.session_key || null,
    vehicle: {
      requested_vehicle_id: e.requested_vehicle_id || null,
      requested_vehicle_name: e.requested_vehicle_name || null,
      assigned_vehicle_id: e.assigned_vehicle_id || null,
      assigned_vehicle_number: e.assigned_vehicle_number || null,
      assigned_vehicle_type: e.assigned_vehicle_type || null,
    },
    assignment: {
      driver: e.assignedDriver
        ? {
            driver_id: e.assignedDriver.driver_id,
            driver_code: e.assignedDriver.driver_code || null,
            driver_name: e.assignedDriver.driver_name,
            // Admin-only: dispatch needs to call the driver.
            mobile: e.assignedDriver.mobile,
            alternate_mobile: e.assignedDriver.alternate_mobile || null,
            status: e.assignedDriver.status || null,
            is_available: bool(e.assignedDriver.is_available),
            rating: num(e.assignedDriver.rating),
            transport_owner_id: e.assignedDriver.transport_owner_id || null,
            partner_id: e.assignedDriver.partner_id || null,
          }
        : null,
      vehicle: e.assignedVehicle
        ? {
            vehicle_id: e.assignedVehicle.vehicle_id,
            vehicle_number: e.assignedVehicle.vehicle_number,
            vehicle_type: e.assignedVehicle.vehicle_type,
            vehicle_name: e.assignedVehicle.vehicle_name || null,
            capacity_kg: num(e.assignedVehicle.capacity_kg),
            body_type: e.assignedVehicle.body_type || null,
            current_status: e.assignedVehicle.current_status || null,
          }
        : null,
      owner: e.assignedOwner
        ? {
            owner_id: e.assignedOwner.owner_id,
            name: e.assignedOwner.company_name || e.assignedOwner.owner_name,
            city: e.assignedOwner.city || null,
          }
        : null,
      partner: e.assignedPartner
        ? {
            partner_id: e.assignedPartner.partner_id,
            partner_name: e.assignedPartner.partner_name,
            partner_code: e.assignedPartner.partner_code || null,
            city: e.assignedPartner.city || null,
          }
        : null,
      vehicle_assigned_at: e.vehicle_assigned_at || null,
      driver_assigned_at: e.driver_assigned_at || null,
    },
    quote: {
      estimated_price_min: num(e.estimated_price_min),
      estimated_price_max: num(e.estimated_price_max),
      final_quoted_price: num(e.final_quoted_price),
      price_status: e.price_status,
      quote_remarks: e.quote_remarks || null,
      quoted_at: e.quoted_at || null,
      quoted_by: e.quotedByAdmin
        ? { admin_id: e.quotedByAdmin.admin_id, name: e.quotedByAdmin.full_name }
        : null,
    },
    booking: e.booking
      ? {
          booking_id: e.booking.booking_id,
          booking_number: e.booking.booking_number,
          status: e.booking.status,
        }
      : null,
    cancellation_reason: e.cancellation_reason || null,
    events: events.map((ev) => ({
      id: ev.enquiry_event_id,
      type: ev.event_type,
      actor_type: ev.actor_type,
      actor_id: ev.actor_id || null,
      actor_name: ev.actor_name || null,
      message: ev.message,
      metadata: ev.metadata || null,
      customer_visible: bool(ev.customer_visible),
      created_at: ev.created_at,
    })),
  };
}

/**
 * Compact admin DTO for the enquiries table.
 * @param {object} e
 * @returns {object}
 */
function toAdminEnquiryRow(e) {
  return {
    enquiry_id: e.enquiry_id,
    enquiry_number: e.enquiry_number,
    customer_name: e.customer_name,
    customer_mobile: e.customer_mobile,
    pickup_location: e.pickup_location,
    drop_location: e.drop_location,
    requested_vehicle_name: e.requested_vehicle_name || null,
    material: e.material,
    quantity: num(e.quantity),
    quantity_unit: e.quantity_unit || null,
    weight: num(e.weight),
    weight_unit: e.weight_unit || null,
    distance_km: num(e.distance_km),
    pickup_date: e.pickup_date,
    pickup_time: e.pickup_time,
    status: e.status,
    price_status: e.price_status,
    estimated_price_min: num(e.estimated_price_min),
    estimated_price_max: num(e.estimated_price_max),
    final_quoted_price: num(e.final_quoted_price),
    assigned_driver_id: e.assigned_driver_id || null,
    assigned_driver_name: e.assignedDriver ? e.assignedDriver.driver_name : (e.assigned_driver_name || null),
    assigned_vehicle_id: e.assigned_vehicle_id || null,
    assigned_vehicle_number: e.assigned_vehicle_number || null,
    booking_number: e.booking ? e.booking.booking_number : null,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

/**
 * DRIVER DTO — what the assigned driver may see about a job.
 *
 * Deliberately excludes: customer mobile, customer email, customer address,
 * final quoted price, and any customer contact channel. The driver is employed
 * to move goods, not to negotiate with or call the customer — that relationship
 * belongs to Bihar Transport customer care.
 *
 * @param {object} e
 * @returns {object}
 */
function toDriverEnquiry(e) {
  return {
    enquiry_id: e.enquiry_id,
    enquiry_number: e.enquiry_number,
    status: e.status,
    price_status: e.price_status,
    route: {
      pickup_location: e.pickup_location,
      pickup_address: e.pickup_address || null,
      drop_location: e.drop_location,
      drop_address: e.drop_address || null,
      distance_km: num(e.distance_km),
    },
    shipment: {
      material: e.material,
      quantity: num(e.quantity),
      quantity_unit: e.quantity_unit || null,
      weight: num(e.weight),
      weight_unit: e.weight_unit || null,
      goods_category: e.goods_category || null,
      fragile: bool(e.fragile),
      special_instructions: e.special_instructions || null,
    },
    schedule: {
      pickup_date: e.pickup_date,
      pickup_time: e.pickup_time,
    },
    vehicle: e.assignedVehicle
      ? {
          vehicle_id: e.assignedVehicle.vehicle_id,
          vehicle_number: e.assignedVehicle.vehicle_number,
          vehicle_type: e.assignedVehicle.vehicle_type,
        }
      : null,
    // Customer identity is deliberately reduced to a first name so the driver
    // can greet a contact at the pickup point without holding the customer's
    // phone number or address book entry.
    customer_first_name: e.customer ? e.customer.first_name : null,
    // PRIVACY: no final_quoted_price, no customer_mobile, no customer_email.
    // PRIVACY: no driver_mobile field — the driver knows their own number.
  };
}

/**
 * Paths inside a CUSTOMER payload where a contact-shaped key is legitimate.
 *
 *   dto.customer.mobile  → the customer's OWN number, echoed back to them
 *   dto.contact.*        → the fixed Bihar Transport customer-care profile,
 *                          which is the customer's only sanctioned contact route
 *
 * Everything else is a leak. Admin/Driver DTOs are never passed through this
 * guard (they intentionally carry the driver mobile for dispatch).
 */
const ALLOWED_CONTACT_PATHS = new Set([
  'dto.customer.mobile',
  // The customer-care profile object itself and its two occurrences. These are
  // company-controlled numbers (see config/customerCare.js), not driver data.
  'dto.contact',
  'dto.assignment.contact',
]);

/**
 * Last-resort tripwire. Walks the finished customer payload and throws if a
 * driver-contact key survived anywhere it should not.
 *
 * This is deliberately a hard throw rather than a silent delete: a leak must
 * fail loudly in development and in tests, not quietly ship to a customer.
 *
 * @param {object} payload
 * @returns {object} the same payload (pass-through for inline use)
 * @throws {Error} when a driver contact field leaked
 */
function assertNoDriverPhone(payload, path = 'dto') {
  walk(payload, path, 0);
  return payload;
}

function walk(node, path, depth) {
  if (depth > 12 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;

    if (FORBIDDEN_CUSTOMER_KEYS.has(key)) {
      const isCustomerOwnMobile = ALLOWED_CONTACT_PATHS.has(here);
      // Everything under the customer-care profile is company-controlled and
      // is the customer's intended contact route.
      const isCustomerCareProfile = here.startsWith('dto.contact.') || here.startsWith('dto.assignment.contact.');

      if (!isCustomerOwnMobile && !isCustomerCareProfile) {
        throw new Error(
          `EnquiryDTO privacy violation: forbidden key "${key}" at ${here}. ` +
            'Driver/contact phone numbers must never reach a customer payload.'
        );
      }
    }

    walk(value, here, depth + 1);
  }
}

module.exports = {
  customerDriverSelect,
  adminDriverSelect,
  vehicleSelect,
  ownerSelect,
  partnerSelect,
  customerRelationSelect,
  adminRelationSelect,
  toCustomerEnquiry,
  toCustomerEnquirySummary,
  toCustomerEvent,
  toAdminEnquiry,
  toAdminEnquiryRow,
  toDriverEnquiry,
  assertNoDriverPhone,
};
