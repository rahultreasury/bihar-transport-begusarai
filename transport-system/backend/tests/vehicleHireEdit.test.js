/**
 * vehicleHireEdit.test.js
 * ============================================================================
 * "Edit Vehicle Hire" — proof that correcting an agreed hire UPDATES it and can
 * never fork it into two.
 *
 * THE RISK THIS FILE EXISTS TO CLOSE
 *   A hire is a contractual obligation. If editing could INSERT, the same truck
 *   would be owed twice for one consignment. `vehicle_hires.trip_id` is UNIQUE,
 *   so a duplicate is not representable in the database — but the test asserts
 *   the SERVICE never even attempts one, which is a stronger and clearer
 *   guarantee than relying on a constraint alone.
 *
 * WHAT IS REAL HERE
 *   The real `VehicleHireWorkflowService`, the real `config/vehicleHirePolicy`
 *   and the real commission arithmetic. Only Prisma is doubled, and the double
 *   records every write so "no second row" is observable rather than assumed.
 *
 * WHAT IS NOT HERE
 *   Any React code. The browser sends rate inputs and the server computes
 *   gross / commission / net; there is no frontend calculation to test, and
 *   none is introduced.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const VehicleHireWorkflowService = require('../services/VehicleHireWorkflowService');
const policy = require('../config/vehicleHirePolicy');
const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/AppError');

const ADMIN = { user_id: 1, role: 'super_admin' };

/**
 * A hire-workflow world with ONE existing hire already agreed.
 *
 * The stored hire is the documented worked example: a ₹42,000 gross hire with a
 * 5% percentage commission ⇒ ₹2,000 commission and ₹40,000 net payable.
 */
function buildEditWorld(overrides = {}) {
  const writes = [];
  const hire = {
    hire_id: 900,
    trip_id: 700,
    booking_id: 300,
    challan_number: 'VH-2026-0001',
    status: 'ACTIVE',
    vehicle_id: 10,
    vendor_id: 100,
    driver_id: 20,

    billing_to: 'CONSIGNOR',
    business_model: 'CONTRACT',
    business_model_overridden: false,

    rate_basis: 'FIXED',
    rate_value: 42000,
    rate_quantity: null,
    rate_unit: null,

    gross_hire: 42000,
    commission_type: 'percentage',
    commission_rate: 5,
    commission_amount: 2000,
    net_vendor_payable: 40000,

    remarks: 'Original terms',
    documents_snapshot: null,
    documents_expired_ack: false,
    documents_expired_ack_by: null,
    documents_expired_ack_at: null,
    created_by: 1,
    created_at: new Date('2026-09-30T00:00:00Z'),
    updated_at: new Date('2026-09-30T00:00:00Z'),
    ...overrides,
  };

  const trip = {
    trip_id: 700,
    trip_number: 'BTBT-2026-00007',
    booking_id: 300,
    // After a hire the trip is ASSIGNED — the create path moved it there.
    status: 'ASSIGNED',
    transport_owner_id: 100,
    vehicle_id: 10,
    driver_id: 20,
    pickup_location: 'Patna',
    pickup_city: 'Patna',
    drop_location: 'Begusarai',
    drop_city: 'Begusarai',
    trip_date: new Date('2026-09-30'),
    vehicle: { vehicle_id: 10, vehicle_number: 'BR09CC0004', vehicle_name: 'Tempo', vehicle_type: 'Tempo', owner_id: 100 },
    driver: { driver_id: 20, driver_name: 'Kaushal', mobile: '9000000000', status: 'active', transport_owner_id: 100, is_available: true, current_vehicle_id: 10 },
    transportOwner: { owner_id: 100, owner_name: 'Vishal Transport', mobile: '9000000001', owner_type: 'TRANSPORT_COMPANY', status: 'active', is_active: true },
    client: null,
    user: null,
    booking: null,
  };

  const vehicle = { ...trip.vehicle, current_status: 'available', is_available: true };
  const owner = { ...trip.transportOwner };

  const prisma = {
    trip: {
      findUnique: async () => ({ ...trip }),
      // The conflict probe. An edit re-checks that the vehicle/driver are not
      // double-booked; this trip is excluded, so it reports no conflict.
      findFirst: async () => null,
      update: async ({ data }) => {
        writes.push({ op: 'trip.update', data: { ...data } });
        Object.assign(trip, data);
        return { ...trip };
      },
    },
    vehicleHire: {
      findUnique: async ({ where }) => {
        if (where.trip_id !== undefined && where.trip_id !== hire.trip_id) return null;
        if (where.hire_id !== undefined && where.hire_id !== hire.hire_id) return null;
        // The real read includes the masters it serialises, so the double does
        // too — otherwise `serializeHire` would have nothing to render.
        return { ...hire, vehicle, vendor: owner, driver: trip.driver, trip };
      },
      // A duplicate is not merely rejected — it is counted, so a test can prove
      // the update path never even tries.
      create: async ({ data }) => {
        writes.push({ op: 'vehicleHire.create', data: { ...data } });
        throw new Error('updateVehicleHire must never INSERT a second hire');
      },
      update: async ({ where, data }) => {
        writes.push({ op: 'vehicleHire.update', data: { ...data } });
        Object.assign(hire, data);
        return { ...hire };
      },
    },
    // An unknown vehicle resolves to null, exactly as the real table would —
    // which is what makes "edit against a different vehicle" fail loudly.
    transportVehicle: {
      findUnique: async ({ where }) => (
        where.vehicle_id === vehicle.vehicle_id ? { ...vehicle, owner: { ...owner } } : null
      ),
    },
    driver: { findUnique: async () => ({ ...trip.driver }) },
    vehicleOwner: { findUnique: async () => ({ ...owner }) },
    $transaction: async (fn) => fn(prisma),
  };

  const service = new VehicleHireWorkflowService({ prisma });
  // The timeline + audit repositories write through this double.
  service.timelineRepo = {
    create: async (data) => {
      writes.push({ op: 'timeline.create', data: { ...data, metadata: JSON.stringify(data.metadata) } });
      return data;
    },
  };
  service.auditRepo = {
    create: async (data) => {
      writes.push({ op: 'audit.create', data: { ...data } });
      return data;
    },
  };

  return { prisma, service, hire, trip, vehicle, owner, writes };
}

/** The operator inputs the form sends — rates only, never the money. */
const terms = (overrides = {}) => ({
  vehicle_id: 10,
  vendor_id: 100,
  driver_id: 20,
  billing_to: 'CONSIGNOR',
  rate_basis: 'FIXED',
  rate_value: 50000,
  commission_type: 'PERCENTAGE',
  commission_rate: 5,
  ...overrides,
});

// ============================================================================
// 1. edit=1 LOADS THE EXISTING VALUES
// ============================================================================

test('EDIT 1 — the existing hire is loaded in full for pre-filling', async () => {
  const { service } = buildEditWorld();

  // This is what the page's edit path calls: read, then pre-fill from it.
  const loaded = await service.getHire(700);

  assert.ok(loaded, 'the existing hire is returned');
  // Every field the form must pre-fill.
  assert.equal(loaded.vehicle.vehicle_number, 'BR09CC0004', 'vehicle');
  assert.equal(loaded.driver.driver_name, 'Kaushal', 'driver');
  assert.equal(loaded.vendor.owner_name, 'Vishal Transport', 'vendor/owner');
  assert.equal(loaded.billing_to, 'CONSIGNOR', 'billing to');
  assert.equal(loaded.business_model, 'CONTRACT', 'business model');
  assert.equal(loaded.rate_basis, 'FIXED', 'rate as per');
  assert.equal(loaded.rate_value, 42000, 'rate / gross');
  assert.equal(loaded.commission_type, 'percentage', 'commission type');
  assert.equal(loaded.commission_rate, 5, 'commission %');
  assert.equal(loaded.commission_amount, 2000, 'commission amount');
  assert.equal(loaded.net_vendor_payable, 40000, 'net vendor payable');
  assert.equal(loaded.remarks, 'Original terms', 'remarks');
  assert.equal(loaded.challan_number, 'VH-2026-0001', 'challan is identifiable');
});

test('EDIT 1b — the context exposes the existing hire so the form can pre-fill', async () => {
  const { service } = buildEditWorld();

  const context = await service.getHireContext(700);

  assert.ok(context.existing_hire, 'the context carries the existing hire');
  assert.equal(context.existing_hire.gross_hire, 42000);
  // `can_hire` is FALSE now that a hire exists — which is exactly why the page
  // has a separate edit path rather than re-offering "Hire Vehicle".
  assert.equal(context.can_hire, false, 'a second hire is not offered');
});

// ============================================================================
// 2. SAVE UPDATES THE EXISTING HIRE
// ============================================================================

test('EDIT 2 — saving in edit mode UPDATES the one existing hire', async () => {
  const { service, hire, writes } = buildEditWorld();

  const result = await service.updateVehicleHire(700, terms(), ADMIN);

  assert.equal(result.updated, true, 'the service reports an update');
  assert.equal(
    writes.filter((w) => w.op === 'vehicleHire.update').length,
    1,
    'exactly one hire write'
  );
  // The new rate took effect.
  assert.equal(Number(hire.gross_hire), 50000, 'gross updated to the new rate');
  assert.equal(Number(hire.rate_value), 50000);
});

test('EDIT 2b — the challan number is preserved across an edit', async () => {
  const { service, hire } = buildEditWorld();

  await service.updateVehicleHire(700, terms({ rate_value: 60000 }), ADMIN);

  // A challan already handed to a driver must keep identifying this hire.
  assert.equal(hire.challan_number, 'VH-2026-0001', 'the challan is unchanged');
  assert.equal(hire.hire_id, 900, 'and it is still the SAME hire row');
});

test('EDIT 2c — the superseded figures are recorded before being overwritten', async () => {
  const { service, writes } = buildEditWorld();

  await service.updateVehicleHire(700, terms({ rate_value: 50000 }), ADMIN);

  const timeline = writes.find((w) => w.op === 'timeline.create');
  assert.ok(timeline, 'a timeline entry was appended');
  const meta = JSON.parse(timeline.data.metadata);

  // The OLD figures are recoverable months later.
  assert.equal(meta.from.gross_hire, 42000, 'the previous gross is retained');
  assert.equal(meta.from.commission_amount, 2000);
  assert.equal(meta.from.net_vendor_payable, 40000);
  assert.equal(meta.to.gross_hire, 50000, 'and the new ones recorded');
  assert.equal(meta.to.net_vendor_payable, 47500);
});

// ============================================================================
// 3. NO DUPLICATE vehicle_hire RECORD IS EVER CREATED
// ============================================================================

test('EDIT 3 — editing NEVER creates a second vehicle_hire record', async () => {
  const { service, writes } = buildEditWorld();

  await service.updateVehicleHire(700, terms(), ADMIN);
  await service.updateVehicleHire(700, terms({ rate_value: 55000 }), ADMIN);
  await service.updateVehicleHire(700, terms({ rate_value: 60000 }), ADMIN);

  assert.equal(
    writes.filter((w) => w.op === 'vehicleHire.create').length,
    0,
    'no INSERT was ever attempted across three edits'
  );
  assert.equal(writes.filter((w) => w.op === 'vehicleHire.update').length, 3, 'all three were UPDATEs');
});

test('EDIT 3b — editing a trip with NO hire is refused instead of creating one', async () => {
  const { service } = buildEditWorld();

  // Simulate a trip that has never been hired: the hire read returns null.
  service.prisma.vehicleHire.findUnique = async () => null;

  await assert.rejects(
    () => service.updateVehicleHire(700, terms(), ADMIN),
    (err) => err instanceof NotFoundError && /no vehicle hire to edit/i.test(err.message)
  );
});

test('EDIT 3c — a cancelled hire cannot be edited', async () => {
  const { service } = buildEditWorld({ status: 'CANCELLED' });

  await assert.rejects(
    () => service.updateVehicleHire(700, terms(), ADMIN),
    (err) => err instanceof ValidationError && /cancelled/i.test(err.message)
  );
});

test('EDIT 3d — an edit cannot silently repoint an agreed hire at another vehicle', async () => {
  const { service } = buildEditWorld();

  // Reassigning the vehicle is TripVehicleAssignmentService's job, and it is
  // refused while a hire is agreed against the current one.
  await assert.rejects(
    () => service.updateVehicleHire(700, terms({ vehicle_id: 999 }), ADMIN),
    (err) => err instanceof ValidationError
  );
});

// ============================================================================
// 4. GROSS / COMMISSION / NET REMAIN CORRECT (recalculated by the server)
// ============================================================================

test('EDIT 4 — percentage commission is recalculated by the existing calculator', async () => {
  const { service, hire } = buildEditWorld();

  // 50,000 × 5% = 2,500 commission ⇒ 47,500 net.
  await service.updateVehicleHire(700, terms({ rate_value: 50000, commission_rate: 5 }), ADMIN);

  assert.equal(Number(hire.gross_hire), 50000);
  assert.equal(Number(hire.commission_amount), 2500);
  assert.equal(Number(hire.net_vendor_payable), 47500);
  // The identity the specification requires.
  assert.equal(
    Number(hire.net_vendor_payable),
    Number(hire.gross_hire) - Number(hire.commission_amount),
    'net = gross − commission holds after an edit'
  );
});

test('EDIT 4b — the commission type can be changed when editing', async () => {
  const { service, hire } = buildEditWorld();

  // FIXED ₹3,000 commission on a ₹50,000 gross ⇒ ₹47,000 net.
  await service.updateVehicleHire(
    700,
    terms({ rate_value: 50000, commission_type: 'FIXED', commission_rate: 3000 }),
    ADMIN
  );

  assert.equal(hire.commission_type, 'fixed', 'the stored type changed');
  assert.equal(Number(hire.commission_amount), 3000);
  assert.equal(Number(hire.net_vendor_payable), 47000);
});

test('EDIT 4c — "No Commission" yields a zero commission, not a missing one', async () => {
  const { service, hire } = buildEditWorld();

  await service.updateVehicleHire(
    700,
    terms({ rate_value: 50000, commission_type: 'NO_COMMISSION', commission_rate: 0 }),
    ADMIN
  );

  assert.equal(Number(hire.gross_hire), 50000);
  assert.equal(Number(hire.commission_amount), 0, 'commission is a real zero');
  assert.equal(Number(hire.net_vendor_payable), 50000, 'net equals the gross');
});

test('EDIT 4d — a per-ton rate is recalculated the same way as on creation', async () => {
  const { service, hire } = buildEditWorld();

  // Per Ton: 5,000 × 8 Ton = 40,000 gross; 5% ⇒ 38,000 net.
  await service.updateVehicleHire(
    700,
    terms({
      rate_basis: 'PER_TON',
      rate_value: 5000,
      rate_quantity: 8,
      commission_rate: 5,
    }),
    ADMIN
  );

  assert.equal(hire.rate_basis, 'PER_TON');
  assert.equal(Number(hire.rate_quantity), 8, 'the quantity is stored');
  assert.equal(Number(hire.gross_hire), 40000, 'gross = rate × quantity');
  assert.equal(Number(hire.commission_amount), 2000);
  assert.equal(Number(hire.net_vendor_payable), 38000);
});

test('EDIT 4e — billing to still derives the business model on an edit', async () => {
  const { service, hire } = buildEditWorld();

  await service.updateVehicleHire(
    700,
    terms({ rate_value: 50000, billing_to: 'VEHICLE_VENDOR' }),
    ADMIN
  );

  assert.equal(hire.billing_to, 'VEHICLE_VENDOR');
  assert.equal(
    hire.business_model,
    'COMMISSION',
    'billing to the vehicle vendor implies a commission model'
  );
});

test('EDIT 4f — an unauthorised business-model override is still refused on edit', async () => {
  const { service } = buildEditWorld();

  await assert.rejects(
    () => service.updateVehicleHire(
      700,
      // The backend would DERIVE CONTRACT for CONSIGNOR; only super_admin may
      // override, so an operator is refused.
      terms({ billing_to: 'CONSIGNOR', business_model: 'COMMISSION' }),
      { user_id: 9, role: 'operator' }
    ),
    (err) => err instanceof ForbiddenError
  );
});

// ============================================================================
// 5. THE NORMAL NEW-HIRE FLOW STILL WORKS EXACTLY AS BEFORE
// ============================================================================

test('NEW HIRE — the create path is untouched and still produces a fresh hire', async () => {
  // `vehicle`, `owner` and `trip` are needed by the overrides below, which stand
  // in for the relations a real Prisma `include` would hydrate.
  const { service, prisma, hire, trip, vehicle, owner, writes } = buildEditWorld();

  // Start from a trip with no hire — the normal "Hire Vehicle" case.
  prisma.vehicleHire.findUnique = async () => null;
  prisma.trip.findFirst = async () => null;

  let created = null;
  prisma.vehicleHire.create = async ({ data }) => {
    writes.push({ op: 'vehicleHire.create', data: { ...data } });
    // A real INSERT returns a row with its generated key.
    created = { hire_id: 901, ...data };
    Object.assign(hire, created);
    return { ...created };
  };
  // Until the INSERT happens there is no hire — which is what lets the create
  // path's own "one hire per trip" guard pass. Afterwards the row is readable,
  // so the service's post-write read-back serialises the real figures.
  prisma.vehicleHire.findUnique = async ({ where }) => {
    if (!created) return null;
    if (where.hire_id !== undefined && where.hire_id !== hire.hire_id) return null;
    if (where.trip_id !== undefined && where.trip_id !== hire.trip_id) return null;
    return { ...hire, vehicle, vendor: owner, driver: trip.driver, trip };
  };

  const result = await service.hireVehicle(700, terms(), ADMIN);

  assert.ok(created, 'a hire was CREATED (not updated)');
  assert.equal(result.hire.gross_hire, 50000, 'the returned hire is serialised');
  assert.equal(result.hire.net_vendor_payable, 47500);
  assert.equal(
    result.status_after,
    policy.HIRED_TRIP_STATUS,
    'the trip still moves to VEHICLE HIRED on creation'
  );
  // The create path still guards against a second hire, and now says WHICH.
  prisma.vehicleHire.findUnique = async () => ({ hire_id: 1, challan_number: 'VH-1' });
  await assert.rejects(
    () => service.hireVehicle(700, terms(), ADMIN),
    (err) => err instanceof ConflictError
      && /already has a vehicle hire \(VH-1\)/.test(err.message)
  );
});

test('NEW HIRE — preview writes nothing, in either mode', async () => {
  const { service, writes } = buildEditWorld();

  const preview = await service.previewHire(700, terms({ rate_value: 50000, commission_rate: 5 }));

  assert.equal(preview.gross_hire, 50000);
  assert.equal(preview.commission_amount, 2500);
  assert.equal(preview.net_vendor_payable, 47500);
  assert.equal(
    writes.length,
    0,
    'the preview is a pure calculation — it is also what the edit form shows'
  );
});

test('MODES — edit and create are the same calculation, not two implementations', async () => {
  const { service } = buildEditWorld();
  const input = terms({ rate_value: 50000, commission_rate: 5 });

  // The preview used by BOTH the create form and the edit form.
  const viaPreview = await service.previewHire(700, input);

  // The stored result of an edit with the same inputs.
  const { service: s2, hire } = buildEditWorld();
  await s2.updateVehicleHire(700, input, ADMIN);

  assert.equal(
    Number(hire.gross_hire),
    viaPreview.gross_hire,
    'the stored gross equals what the preview showed'
  );
  assert.equal(
    Number(hire.commission_amount),
    viaPreview.commission_amount,
    'one commission calculator, not one per mode'
  );
  assert.equal(
    Number(hire.net_vendor_payable),
    viaPreview.net_vendor_payable,
    'and the net matches too'
  );
  assert.equal(typeof service.updateVehicleHire, 'function');
});
