/**
 * phase8VehicleHirePage.test.js
 * ---------------------------------------------------------------------------
 * PHASE 8 — THE UNIVERSAL VEHICLE HIRE PAGE
 * ---------------------------------------------------------------------------
 *
 *   ORDER CONFIRMED → WAITING FOR VEHICLE → [ Hire Vehicle ] → VEHICLE HIRED
 *
 * The contract under test — the one the whole module rests on:
 *
 *      GROSS VEHICLE HIRE  −  COMMISSION  =  NET VENDOR PAYABLE
 *
 * AND, just as important, that the GROSS IS NEVER REPLACED BY THE NET.
 *
 * Covered here (no database, no live server):
 *
 *   A. BILLING TO → BUSINESS MODEL
 *      1.  Consignor  → CONTRACT
 *      2.  Consignee  → CONTRACT
 *      3.  Third Party→ CONTRACT
 *      4.  Vehicle Vendor → COMMISSION
 *
 *   B. RATE AS PER → GROSS VEHICLE HIRE
 *      5.  Per Trip               gross = rate
 *      6.  Per Ton   5,000 × 8    gross = 40,000
 *      7.  Per Kg, Per Day, Monthly, Transport Commission
 *      8.  Net Freight solves the gross from the entered net
 *      9.  an unknown basis is rejected
 *      10. Per Ton without a quantity is rejected
 *
 *   C. COMMISSION (spec §6)
 *      11. percentage 5%     42,000 → 2,100 → 39,900
 *      12. fixed ₹2,000      42,000 → 2,000 → 40,000   ← the spec's worked example
 *      13. no commission    42,000 →     0 → 42,000
 *      14. a commission above 100% is rejected
 *      15. a negative rate is rejected
 *
 *   D. THE SPEC'S EXACT EXPECTATION
 *      16. gross 42000 · commission 2000 · net 40000
 *
 *   E. FINANCIAL INTEGRITY
 *      17. gross − commission === net across a table of amounts
 *      18. the gross is never overwritten by the net
 *      19. the three figures are returned separately
 *
 *   F. VEHICLE DOCUMENT EXPIRY (spec §3 / §17)
 *      20. a future date beyond the window  → VALID
 *      21. a future date inside the window  → EXPIRING_SOON
 *      22. a past date                     → EXPIRED
 *      23. an absent date                  → NOT_RECORDED, never VALID
 *      24. an expired CRITICAL document blocks the hire
 *      25. a national permit the vehicle does not hold is not treated as expired
 *      26. Indian and ISO date formats both parse
 *
 *   G. TRIP STATUS TRANSITION (spec §10)
 *      23.  a vehicle may be hired only while the trip is WAITING FOR VEHICLE
 *      24.  the hire moves the trip to VEHICLE HIRED (ASSIGNED)
 *      25.  the next operational state is WAITING FOR LOADING, and the hire
 *            never performs it
 *
 *   H. HIRE IS NOT PAYMENT (spec §14 / §15)
 *      26.  hiring creates an obligation, never a payment
 *      27.  partial payments remain compatible — nothing is marked paid
 *
 *   I. THE SINGLE MODULE RULE (spec §1)
 *      28.  there is one billing-to catalogue covering both models
 *      29.  the three contract parties and the one vendor party are all present
 *
 * Uses node:test + node:assert (no extra deps), matching phase2VehicleHire.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const VehicleHireWorkflowService = require('../services/VehicleHireWorkflowService');
const policy = require('../config/vehicleHirePolicy');
const { ValidationError, ForbiddenError } = require('../utils/AppError');
const tripStateMachine = require('../utils/TripStateMachine');

const service = new VehicleHireWorkflowService({ prisma: {} });

/** Convenience: run the gross + commission pipeline for a set of terms. */
function quote({ billingTo = 'CONSIGNOR', rateBasis = 'FIXED', rate, quantity, commissionType = 'PERCENTAGE', commissionRate = 5 }) {
  const grossCalc = service.computeGrossHire({ rateBasis, rate, quantity, commissionType, commissionRate });
  return service.computeMoney({
    billingTo,
    grossHire: grossCalc.gross_hire,
    commissionType,
    commissionRate,
  });
}

const iso = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/* ══════════════════════════════════════════════════════════════════════════
   A. BILLING TO → BUSINESS MODEL   (spec §4)
   ══════════════════════════════════════════════════════════════════════════ */

test('A. Consignor / Consignee / Third Party all resolve to CONTRACT', () => {
  for (const party of ['CONSIGNOR', 'CONSIGNEE', 'THIRD_PARTY']) {
    const money = quote({ billingTo: party, rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });
    assert.equal(money.business_model, 'CONTRACT', `${party} must be CONTRACT`);
  }
});

test('A. Vehicle Vendor resolves to COMMISSION', () => {
  const money = quote({ billingTo: 'VEHICLE_VENDOR', rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });
  assert.equal(money.business_model, 'COMMISSION');
});

test('A. every catalogue billing party derives a business model — the field is never blank', () => {
  for (const option of policy.BILLING_TO_OPTIONS) {
    const model = policy.businessModelForBillingTo(option.value);
    assert.ok(model, `${option.value} must derive a business model`);
    assert.ok(['CONTRACT', 'COMMISSION'].includes(model));
  }
});

test('A. an unknown billing party is rejected', () => {
  assert.throws(() => quote({ billingTo: 'SOMEONE_ELSE', rate: 1000 }), ValidationError);
});

/* ══════════════════════════════════════════════════════════════════════════
   B. RATE AS PER → GROSS   (spec §5)
   ══════════════════════════════════════════════════════════════════════════ */

test('B. Per Trip: gross = the agreed vehicle hire rate', () => {
  const result = service.computeGrossHire({ rateBasis: 'FIXED', rate: 42000 });
  assert.equal(result.gross_hire, 42000);
  assert.equal(result.rate_label, 'Vehicle Hire Rate');
  assert.equal(result.mode, 'RATE');
});

test("B. Per Ton: the spec's worked example — 5,000 × 8 Ton = 40,000", () => {
  const result = service.computeGrossHire({ rateBasis: 'PER_TON', rate: 5000, quantity: 8 });
  assert.equal(result.gross_hire, 40000);
  assert.equal(result.rate_label, 'Rate Per Ton');
  assert.equal(result.quantity_label, 'Quantity');
  assert.equal(result.unit, 'Ton');
  assert.equal(result.quantity, 8);
});

test('B. Per Kg, Per Day, Monthly and Transport Commission all compute a gross', () => {
  assert.equal(service.computeGrossHire({ rateBasis: 'PER_KG', rate: 12, quantity: 1000 }).gross_hire, 12000);
  assert.equal(service.computeGrossHire({ rateBasis: 'PER_DAY', rate: 1500, quantity: 3 }).gross_hire, 4500);
  assert.equal(service.computeGrossHire({ rateBasis: 'MONTHLY', rate: 45000, quantity: 2 }).gross_hire, 90000);
  assert.equal(service.computeGrossHire({ rateBasis: 'TRANSPORT_COMMISSION', rate: 55000 }).gross_hire, 55000);
});

test('B. Net Freight solves the gross so that gross − commission = the entered net exactly', () => {
  const grossCalc = service.computeGrossHire({
    rateBasis: 'NET_FREIGHT',
    rate: 40000,
    commissionType: 'PERCENTAGE',
    commissionRate: 5,
  });
  const money = service.computeMoney({
    billingTo: 'CONSIGNOR',
    grossHire: grossCalc.gross_hire,
    commissionType: 'PERCENTAGE',
    commissionRate: 5,
  });
  assert.equal(money.net_vendor_payable, 40000);
  assert.equal(
    Number((money.gross_hire - money.commission_amount).toFixed(2)),
    money.net_vendor_payable
  );
});

test('B. an unknown rate basis is rejected', () => {
  assert.throws(() => service.computeGrossHire({ rateBasis: 'PER_HORSE', rate: 10 }), ValidationError);
});

test('B. Per Ton without a quantity is rejected — gross is never guessed', () => {
  assert.throws(() => service.computeGrossHire({ rateBasis: 'PER_TON', rate: 5000 }), ValidationError);
  assert.throws(() => service.computeGrossHire({ rateBasis: 'PER_TON', rate: 5000, quantity: 0 }), ValidationError);
  assert.throws(() => service.computeGrossHire({ rateBasis: 'PER_TON', rate: 5000, quantity: -3 }), ValidationError);
});

test('B. a negative rate is rejected', () => {
  assert.throws(() => service.computeGrossHire({ rateBasis: 'FIXED', rate: -1 }), ValidationError);
});

/* ══════════════════════════════════════════════════════════════════════════
   C. COMMISSION   (spec §6)
   ══════════════════════════════════════════════════════════════════════════ */

test('C. Percentage 5%: 42,000 → 2,100 → 39,900', () => {
  const m = quote({ rate: 42000, commissionType: 'PERCENTAGE', commissionRate: 5 });
  assert.equal(m.gross_hire, 42000);
  assert.equal(m.commission_amount, 2100);
  assert.equal(m.net_vendor_payable, 39900);
});

test("C. Fixed ₹2,000: 42,000 → 2,000 → 40,000  (the spec's worked example)", () => {
  const m = quote({ rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });
  assert.equal(m.gross_hire, 42000);
  assert.equal(m.commission_amount, 2000);
  assert.equal(m.net_vendor_payable, 40000);
});

test('C. No Commission: 42,000 → 0 → 42,000', () => {
  const m = quote({ rate: 42000, commissionType: 'NO_COMMISSION', commissionRate: 0 });
  assert.equal(m.gross_hire, 42000);
  assert.equal(m.commission_amount, 0);
  assert.equal(m.net_vendor_payable, 42000);
});

test('C. No Commission is a real stored state (percentage @ 0%), not a missing value', () => {
  const m = quote({ rate: 42000, commissionType: 'NO_COMMISSION', commissionRate: 0 });
  assert.equal(m.commission_type, 'percentage');
  assert.equal(m.commission_rate, 0);
  assert.equal(m.commission_type_option, 'NO_COMMISSION');
});

test('C. an unknown commission type is rejected', () => {
  assert.throws(() => quote({ rate: 1000, commissionType: 'BARTER' }), ValidationError);
});

test('C. a percentage above 100 is rejected', () => {
  assert.throws(() => quote({ rate: 42000, commissionType: 'PERCENTAGE', commissionRate: 120 }), ValidationError);
});

test('C. a fixed commission larger than the gross is rejected — the payable can never go negative', () => {
  assert.throws(() => quote({ rate: 5000, commissionType: 'FIXED', commissionRate: 6000 }), ValidationError);
});

/* ══════════════════════════════════════════════════════════════════════════
   D. THE SPEC'S EXACT EXPECTATION   (spec §21)
   ══════════════════════════════════════════════════════════════════════════ */

test("D. EXACT: Gross = 42000, Commission = 2000, Net = 40000", () => {
  const m = quote({
    billingTo: 'VEHICLE_VENDOR',
    rateBasis: 'FIXED',
    rate: 42000,
    commissionType: 'FIXED',
    commissionRate: 2000,
  });
  assert.equal(m.gross_hire, 42000);
  assert.equal(m.commission_amount, 2000);
  assert.equal(m.net_vendor_payable, 40000);
  // And the business model follows Billing To, not a separate choice.
  assert.equal(m.business_model, 'COMMISSION');
});

test('D. the spec’s PER TRIP + COMMISSION / Vehicle Vendor scenario end to end', () => {
  const m = quote({
    billingTo: 'VEHICLE_VENDOR',
    rateBasis: 'FIXED',
    rate: 42000,
    commissionType: 'FIXED',
    commissionRate: 2000,
  });
  // Vehicle / vendor / driver are validated elsewhere; the money is this:
  assert.deepEqual(
    { gross: m.gross_hire, commission: m.commission_amount, net: m.net_vendor_payable },
    { gross: 42000, commission: 2000, net: 40000 }
  );
});

test('D. the spec’s PER TON scenario: ₹5,000/ton × 8 ton = ₹40,000', () => {
  const grossCalc = service.computeGrossHire({ rateBasis: 'PER_TON', rate: 5000, quantity: 8 });
  const m = service.computeMoney({
    billingTo: 'CONSIGNOR',
    grossHire: grossCalc.gross_hire,
    commissionType: 'FIXED',
    commissionRate: 2000,
  });
  assert.equal(m.gross_hire, 40000);
  assert.equal(m.commission_amount, 2000);
  assert.equal(m.net_vendor_payable, 38000);
  assert.equal(m.business_model, 'CONTRACT');
});

/* ══════════════════════════════════════════════════════════════════════════
   E. FINANCIAL INTEGRITY   (spec §7)
   ══════════════════════════════════════════════════════════════════════════ */

test('E. gross − commission === net holds across a table of amounts', () => {
  for (const rate of [0, 1, 999, 10000, 33333.33, 42000, 123456.78]) {
    for (const pct of [0, 1, 5, 12.5, 100]) {
      const m = quote({ rate, commissionType: 'PERCENTAGE', commissionRate: pct });
      assert.equal(
        Number((m.gross_hire - m.commission_amount).toFixed(2)),
        m.net_vendor_payable,
        `gross ${m.gross_hire} − ${m.commission_amount} must equal ${m.net_vendor_payable} @ ${pct}%`
      );
    }
  }
});

test('E. the gross is NEVER overwritten by the net — the two are separate figures', () => {
  const m = quote({ rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });
  assert.notEqual(m.gross_hire, m.net_vendor_payable);
  assert.equal(m.gross_hire, 42000);
  assert.equal(m.net_vendor_payable, 40000);
  // The gross is still the gross even when the commission is zero.
  const zero = quote({ rate: 42000, commissionType: 'NO_COMMISSION', commissionRate: 0 });
  assert.equal(zero.gross_hire, 42000);
});

test('E. all three figures are returned separately and are never merged', () => {
  const m = quote({ rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });
  for (const key of ['gross_hire', 'commission_amount', 'net_vendor_payable']) {
    assert.ok(Object.prototype.hasOwnProperty.call(m, key), `${key} must be present`);
    assert.equal(typeof m[key], 'number');
  }
});

test('E. money is rounded to the paisa, never left with float drift', () => {
  const m = quote({ rate: 1000.005, commissionType: 'PERCENTAGE', commissionRate: 5 });
  assert.equal(Number(m.gross_hire.toFixed(2)), m.gross_hire);
  assert.equal(Number(m.commission_amount.toFixed(2)), m.commission_amount);
  assert.equal(Number(m.net_vendor_payable.toFixed(2)), m.net_vendor_payable);
});

test('E. Per Ton arithmetic is exact to the paisa across several rates', () => {
  for (const [rate, qty] of [[5000, 8], [1234.56, 17.5], [999.99, 3]]) {
    const g = service.computeGrossHire({ rateBasis: 'PER_TON', rate, quantity: qty });
    assert.equal(g.gross_hire, Number((rate * qty).toFixed(2)));
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   F. VEHICLE DOCUMENT EXPIRY   (spec §3 / §17)
   ══════════════════════════════════════════════════════════════════════════ */

test('F. a date beyond the warning window is VALID', () => {
  const r = service.evaluateDocuments({ insurance_expiry: iso(200) });
  const doc = r.documents.find((d) => d.key === 'INSURANCE');
  assert.equal(doc.status, 'VALID');
  assert.equal(doc.blocking, false);
});

test('F. a date inside the configured warning window is EXPIRING SOON', () => {
  const r = service.evaluateDocuments({ insurance_expiry: iso(10) });
  const doc = r.documents.find((d) => d.key === 'INSURANCE');
  assert.equal(doc.status, 'EXPIRING_SOON');
  assert.equal(doc.critical, true);
  assert.equal(doc.blocking, false, 'expiring soon is a warning, not a block');
  assert.equal(r.expiring_soon.length, 1);
});

test('F. a past date is EXPIRED', () => {
  const r = service.evaluateDocuments({ permit_expiry: iso(-5) });
  const doc = r.documents.find((d) => d.key === 'PERMIT');
  assert.equal(doc.status, 'EXPIRED');
  assert.equal(doc.days_remaining, -5);
});

test('F. an EXPIRED critical document is flagged as blocking', () => {
  const r = service.evaluateDocuments({ fitness_expiry: iso(-30) });
  const doc = r.documents.find((d) => d.key === 'FITNESS');
  assert.equal(doc.status, 'EXPIRED');
  assert.equal(doc.critical, true);
  assert.equal(doc.blocking, true);
  assert.equal(r.has_blocking_issue, true);
  assert.equal(r.expired_critical.length, 1);
});

test('F. an absent date is NOT_RECORDED — never silently treated as VALID', () => {
  const r = service.evaluateDocuments({ insurance_expiry: null, permit_expiry: '' });
  for (const key of ['INSURANCE', 'PERMIT']) {
    const doc = r.documents.find((d) => d.key === key);
    assert.equal(doc.status, 'NOT_RECORDED');
    assert.equal(doc.blocking, false, 'an unknown date must not read as an expired one');
  }
});

test('F. a national permit the vehicle does not hold is not treated as expired', () => {
  const r = service.evaluateDocuments({ national_permit_number: null, national_permit_expiry: null });
  const doc = r.documents.find((d) => d.key === 'NATIONAL_PERMIT');
  assert.equal(doc.critical, false, 'an intra-state truck does not need a national permit');
  assert.equal(doc.blocking, false);
});

test('F. a held national permit IS critical', () => {
  const r = service.evaluateDocuments({
    national_permit_number: 'NP-123',
    national_permit_expiry: iso(-10),
  });
  const doc = r.documents.find((d) => d.key === 'NATIONAL_PERMIT');
  assert.equal(doc.critical, true);
  assert.equal(doc.blocking, true);
});

test('F. all six documents the spec lists are reported', () => {
  const r = service.evaluateDocuments({});
  const labels = r.documents.map((d) => d.label);
  for (const label of [
    'Tax Expiry', 'Insurance Expiry', 'PUCC Expiry',
    'Fitness Expiry', 'Permit Expiry', 'National Permit Expiry',
  ]) {
    assert.ok(labels.includes(label), `${label} must be reported`);
  }
});

test('F. both ISO and Indian date formats are parsed from the vehicle master', () => {
  const isoDoc = service.evaluateDocuments({ insurance_expiry: '2027-04-30' })
    .documents.find((d) => d.key === 'INSURANCE');
  const indianDoc = service.evaluateDocuments({ insurance_expiry: '30-04-2027' })
    .documents.find((d) => d.key === 'INSURANCE');
  assert.equal(isoDoc.expiry_date.slice(0, 10), '2027-04-30');
  assert.equal(indianDoc.expiry_date.slice(0, 10), '2027-04-30');
});

test('F. an unparseable date is reported as NOT_RECORDED rather than as valid', () => {
  const r = service.evaluateDocuments({ insurance_expiry: 'not-a-date' });
  const doc = r.documents.find((d) => d.key === 'INSURANCE');
  assert.equal(doc.status, 'NOT_RECORDED');
});

test('F. the warning window is read from the policy, not hardcoded on the page', () => {
  const r = service.evaluateDocuments({ insurance_expiry: iso(1) });
  assert.equal(r.warning_days, policy.DOCUMENT_WARNING_DAYS);
});

/* ══════════════════════════════════════════════════════════════════════════
   G. TRIP STATUS TRANSITION   (spec §10 / §11)
   ══════════════════════════════════════════════════════════════════════════ */

test('G. a vehicle may be hired only while the trip is HIRE READY', () => {
  // The vehicle and driver are assigned BEFORE the customer accepts the quote, so
  // an already-ASSIGNED consignment must still be able to complete its hire.
  // The rule is asserted against the POLICY, not a list copied here, so the two
  // cannot drift apart again.
  for (const status of policy.HIRE_READY_TRIP_STATUSES) {
    assert.equal(service.canHireTripStatus(status), true, `${status} must be hireable`);
  }
  // Once the consignment is physically moving it is a dispatch correction, not a
  // hiring decision, and is refused.
  for (const status of ['AT_LOADING_POINT', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED']) {
    assert.equal(service.canHireTripStatus(status), false, `${status} must not be hireable`);
  }
});

test('G. the hire moves the trip PENDING → ASSIGNED (VEHICLE HIRED)', () => {
  assert.equal(policy.HIRED_TRIP_STATUS, 'ASSIGNED');
  assert.doesNotThrow(() =>
    tripStateMachine.validateOperationalTransition('PENDING', policy.HIRED_TRIP_STATUS)
  );
});

test('G. the hire cannot move a trip backwards or out of order', () => {
  assert.throws(
    () => tripStateMachine.validateOperationalTransition('COMPLETED', policy.HIRED_TRIP_STATUS),
    ValidationError
  );
  assert.throws(
    () => tripStateMachine.validateOperationalTransition('IN_TRANSIT', policy.HIRED_TRIP_STATUS),
    ValidationError
  );
});

test('G. the next operational state is WAITING FOR LOADING, and it is not performed automatically', () => {
  assert.equal(policy.NEXT_OPERATIONAL_TRIP_STATUS, 'TO_LOADING_POINT');
  // The hire does NOT move the trip there — the operator does that next, through
  // the existing operational endpoint. A hired vehicle is not loaded or
  // dispatched.
  assert.notEqual(policy.HIRED_TRIP_STATUS, policy.NEXT_OPERATIONAL_TRIP_STATUS);
});

test('G. WAITING FOR LOADING is reachable from VEHICLE HIRED through the existing state machine', () => {
  assert.doesNotThrow(() =>
    tripStateMachine.validateOperationalTransition(policy.HIRED_TRIP_STATUS, policy.NEXT_OPERATIONAL_TRIP_STATUS)
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   H. HIRE IS NOT PAYMENT   (spec §14 / §15)
   ══════════════════════════════════════════════════════════════════════════ */

test('H. hiring an obligation never marks the vendor as paid', () => {
  const hire = {
    hire_id: 1,
    net_vendor_payable: '40000.00',
    gross_hire: '42000.00',
    commission_amount: '2000.00',
  };
  const serialized = service.serializeHire(hire);

  // Deliberately NO paid_amount and NO payment_status on the hire: how much has
  // been paid to the vendor is a question the existing ledger already answers.
  assert.equal(serialized.paid_amount, undefined);
  assert.equal(serialized.payment_status, undefined);
  assert.equal(serialized.payments.settled, false);
  assert.equal(serialized.net_vendor_payable, 40000);
});

test('H. the service exposes no payment-writing method', () => {
  // A hire creates an obligation; money movement lives in FinancialTransaction /
  // TripAdvance / TripSettlement. Nothing on this service can write one.
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
  for (const forbidden of ['recordPayment', 'createPayment', 'payVendor', 'settleVendor', 'markPaid']) {
    assert.ok(!methods.includes(forbidden), `VehicleHireWorkflowService must not expose ${forbidden}`);
  }
});

test('H. partial payment compatibility — the net payable is not reduced by hiring', () => {
  // Spec §15: gross 10,000, commission 500 → net 9,500. Later a 5,000 payment
  // settles part of it; the hire itself still says 9,500 is owed.
  const m = quote({ rate: 10000, commissionType: 'PERCENTAGE', commissionRate: 5 });
  assert.equal(m.gross_hire, 10000);
  assert.equal(m.commission_amount, 500);
  assert.equal(m.net_vendor_payable, 9500);

  const partial = 5000;
  assert.equal(Number((m.net_vendor_payable - partial).toFixed(2)), 4500, 'remaining after a partial payment');
  // Hiring did not record that payment — the hire is still an obligation.
  assert.equal(m.settled, undefined);
});

/* ══════════════════════════════════════════════════════════════════════════
   I. THE SINGLE MODULE RULE   (spec §1 / §22)
   ══════════════════════════════════════════════════════════════════════════ */

test('I. ONE module serves both commercial models', () => {
  // There is no contract-hire module and no commission-hire module: the same
  // catalogue describes both, differentiated by billing party.
  const values = policy.BILLING_TO_OPTIONS.map((o) => o.value);
  assert.deepEqual(values, ['CONSIGNOR', 'CONSIGNEE', 'THIRD_PARTY', 'VEHICLE_VENDOR']);
  assert.equal(values.length, 4);
});

test('I. the two models are reached by Billing To, not by a separate flow', () => {
  const contract = quote({ billingTo: 'CONSIGNOR', rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });
  const commission = quote({ billingTo: 'VEHICLE_VENDOR', rate: 42000, commissionType: 'FIXED', commissionRate: 2000 });

  // Identical arithmetic, different reporting — which is the whole point of
  // having one module.
  assert.equal(contract.gross_hire, commission.gross_hire);
  assert.equal(contract.commission_amount, commission.commission_amount);
  assert.equal(contract.net_vendor_payable, commission.net_vendor_payable);
  assert.equal(contract.business_model, 'CONTRACT');
  assert.equal(commission.business_model, 'COMMISSION');
});

test('I. the catalogue the page renders offers exactly the documented options', () => {
  const catalogue = service.getCatalogue();
  assert.equal(catalogue.default_rate_basis, 'FIXED');
  assert.equal(catalogue.default_commission_type, 'PERCENTAGE');
  assert.equal(catalogue.default_commission_percentage, policy.DEFAULT_COMMISSION_PERCENTAGE);
  assert.equal(catalogue.hired_status, 'ASSIGNED');
  assert.equal(catalogue.next_operational_status, 'TO_LOADING_POINT');
  assert.deepEqual(catalogue.hire_ready_statuses, policy.HIRE_READY_TRIP_STATUSES);
  assert.ok(catalogue.business_model_override_roles.includes('super_admin'));
  assert.ok(catalogue.expired_document_override_roles.includes('super_admin'));
});

test('I. an authorised override is a super_admin capability, not a free choice', () => {
  // The policy exposes the roles; the service enforces them. An operator sees the
  // business model but cannot change it.
  assert.ok(policy.BUSINESS_MODEL_OVERRIDE_ROLES.length > 0);
  assert.ok(!policy.BUSINESS_MODEL_OVERRIDE_ROLES.includes('operator'));
  assert.ok(!policy.BUSINESS_MODEL_OVERRIDE_ROLES.includes('admin'));
});

/* ══════════════════════════════════════════════════════════════════════════
   J. EXISTING ARCHITECTURE REUSE
   ══════════════════════════════════════════════════════════════════════════ */

test('J. the rate bases reuse the repository’s existing catalogue', () => {
  // Every basis the booking form already ships is available, so a hire stored
  // from the booking form and one stored from the hire page cannot disagree.
  for (const value of ['FIXED', 'PER_TON', 'PER_KG', 'PER_DAY', 'MONTHLY', 'TRANSPORT_COMMISSION', 'NET_FREIGHT']) {
    assert.ok(policy.RATE_BASIS.includes(value), `${value} must be a supported basis`);
    assert.ok(policy.getRateBasis(value), `${value} must resolve to a descriptor`);
  }
});

test('J. the commission types reuse the existing percentage/fixed vocabulary', () => {
  const stored = policy.COMMISSION_TYPE_OPTIONS.map((o) => o.stored);
  for (const value of stored) {
    assert.ok(['percentage', 'fixed'].includes(value), `${value} must be an existing CommissionRecord value`);
  }
});

test('J. the challan number is derived from the trip, so re-downloading is stable', () => {
  const a = service.buildChallanNumber({ trip_id: 125 });
  const b = service.buildChallanNumber({ trip_id: 125 });
  assert.equal(a, b);
  assert.ok(a.includes('125'));
});

test('J. ForbiddenError is available for the authorised-override refusals', () => {
  assert.equal(typeof ForbiddenError, 'function');
  assert.ok(new ForbiddenError({ message: 'nope' }) instanceof Error);
});