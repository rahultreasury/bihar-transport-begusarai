'use strict';

/**
 * Conservative production test-data classifier.
 *
 * This module is the single source of truth for both the cleanup plan
 * generator and the cleanup executor. It intentionally uses narrow,
 * reviewed rules instead of broad mobile-number or enquiry-number patterns.
 *
 * IMPORTANT: the canonical BTB-YYYYMMDD-NNNNN enquiry format is genuine and
 * must never be treated as test data.
 */

const RULES_VERSION = '2026-11-06-conservative-v1';

const TABLES = {
  users: { model: 'user', id: 'user_id' },
  drivers: { model: 'driver', id: 'driver_id' },
  vehicle_owners: { model: 'vehicleOwner', id: 'owner_id' },
  transport_vehicles: { model: 'transportVehicle', id: 'vehicle_id' },
  bookings: { model: 'booking', id: 'booking_id' },
  booking_assignments: { model: 'bookingAssignment', id: 'booking_assignment_id' },
  booking_events: { model: 'bookingEvent', id: 'booking_event_id' },
  deliveries: { model: 'delivery', id: 'delivery_id' },
  enquiries: { model: 'enquiry', id: 'enquiry_id' },
  enquiry_events: { model: 'enquiryEvent', id: 'enquiry_event_id' },
  quotations: { model: 'quotations', id: 'quotation_id' },
  quotation_charges: { model: 'quotation_charges', id: 'charge_id' },
  quotation_milestones: { model: 'quotation_milestones', id: 'milestone_id' },
  quotation_versions: { model: 'quotation_versions', id: 'version_id' },
  booking_quotation_snapshots: { model: 'booking_quotation_snapshots', id: 'snapshot_id' },
  trips: { model: 'trip', id: 'trip_id' },
  trip_financials: { model: 'tripFinancial', id: 'trip_financial_id' },
  financial_transactions: { model: 'financialTransaction', id: 'transaction_id' },
  trip_advances: { model: 'tripAdvance', id: 'advance_id' },
  trip_settlements: { model: 'tripSettlement', id: 'settlement_id' },
  commission_records: { model: 'commissionRecord', id: 'commission_id' },
  invoices: { model: 'invoice', id: 'invoice_id' },
  partners: { model: 'partner', id: 'partner_id' },
  partner_applications: { model: 'partnerApplication', id: 'application_id' },
  partner_documents: { model: 'partnerDocument', id: 'document_id' },
  partner_ledger: { model: 'partnerLedger', id: 'ledger_id' },
  partner_payments: { model: 'partnerPayment', id: 'payment_id' },
  settlements: { model: 'settlement', id: 'settlement_id' },
  journal_entries: { model: 'journalEntry', id: 'journal_id' },
  journal_lines: { model: 'journalLine', id: 'line_id' },
  driver_transactions: { model: 'driverTransaction', id: 'transaction_id' },
  driver_timeline: { model: 'driverTimeline', id: 'event_id' },
  driver_assignments: { model: 'driverAssignment', id: 'assignment_id' },
  vehicle_assignments: { model: 'vehicleAssignment', id: 'assignment_id' },
  trip_timeline: { model: 'tripTimeline', id: 'timeline_id' },
  trip_documents: { model: 'tripDocument', id: 'document_id' },
  trip_payments: { model: 'tripPayment', id: 'payment_id' },
  trip_expenses: { model: 'tripExpense', id: 'expense_id' },
  trip_incidents: { model: 'trip_incidents', id: 'incident_id' },
  trip_vehicle_changes: { model: 'trip_vehicle_changes', id: 'change_id' },
  trip_dispatches: { model: 'tripDispatch', id: 'dispatch_id' },
  eway_bills: { model: 'ewayBill', id: 'eway_bill_id' },
  trip_insurances: { model: 'tripInsurance', id: 'insurance_id' },
  vehicle_hires: { model: 'vehicleHire', id: 'hire_id' },
  reservations: { model: 'reservation', id: 'reservation_id' },
  clients: { model: 'client', id: 'client_id' },
  petrol_pumps: { model: 'petrolPump', id: 'pump_id' },
  petrol_pump_bills: { model: 'petrolPumpBill', id: 'bill_id' },
  petrol_pump_payments: { model: 'petrolPumpPayment', id: 'payment_id' },
  petrol_pump_fuel_transactions: { model: 'petrolPumpFuelTransaction', id: 'transaction_id' },
  party_opening_balances: { model: 'partyOpeningBalance', id: 'opening_id' },
  password_reset_tokens: { model: 'passwordResetToken', id: 'id' },
  otp_verifications: { model: 'otpVerification', id: 'id' },
  audit_logs: { model: 'auditLog', id: 'audit_id' },
  accounting_accounts: { model: 'accountingAccount', id: 'account_id' },
  document_sequences: { model: 'documentSequence', id: 'sequence_id' },
  admins: { model: 'admin', id: 'admin_id' },
};

/**
 * Child-first deletion order. Every table that can receive a test row must
 * appear before any table it references.
 */
const DELETION_ORDER = [
  'petrol_pump_fuel_transactions',
  'petrol_pump_payments',
  'petrol_pump_bills',
  'petrol_pumps',
  'journal_lines',
  'journal_entries',
  'financial_transactions',
  'commission_records',
  'trip_settlements',
  'trip_advances',
  'trip_payments',
  'trip_vehicle_changes',
  'trip_dispatches',
  'eway_bills',
  'trip_insurances',
  'trip_documents',
  'trip_timeline',
  'trip_expenses',
  'trip_incidents',
  'vehicle_hires',
  'invoices',
  'trip_financials',
  'deliveries',
  'booking_assignments',
  'booking_events',
  'booking_quotation_snapshots',
  'reservations',
  'partner_ledger',
  'partner_payments',
  'partner_documents',
  'partner_applications',
  'quotation_charges',
  'quotation_milestones',
  'quotation_versions',
  'quotations',
  'enquiry_events',
  'enquiries',
  'trips',
  'bookings',
  'driver_transactions',
  'driver_timeline',
  'driver_assignments',
  'vehicle_assignments',
  'drivers',
  'transport_vehicles',
  'vehicle_owners',
  'password_reset_tokens',
  'otp_verifications',
  'users',
  'settlements',
  'partners',
  'party_opening_balances',
];

const PRESERVE_ONLY_TABLES = new Set([
  'admins',
  'audit_logs',
  'accounting_accounts',
  'document_sequences',
  'clients',
]);

const EXPLICIT_TEST_USERS = new Set([8, 16, 20, 21]);
const PRESERVE_USER_IDS = new Set([
  1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 18, 19, 22, 23, 24, 25,
]);
const EXPLICIT_TEST_BOOKINGS = new Set([
  26, 27, 28, 31, 32, 33, 34, 35, 39, 40, 88, 89, 90, 91,
]);
const EXPLICIT_TEST_ENQUIRIES = new Set([8, 13, 124]);

const TEST_NAME_RE = /^(Reservation Test|Test Customer$|Test User$|Test No License$|Phase B Test Party$|Aasan OPD$|Transport Partner A$|REV[ -]|HA Driver|P[3479] (Driver|Owner|\d)|P[3479] Driver)/i;
const TEST_NUMBER_RE = /^(T-RES-|TB-TL-|TB-QT-|REV-|PH7-|P9B-|BTBT-P[3479]-|P[3479]-)/i;
const TEST_VEHICLE_RE = /^(T-RES-V-|REV|PH7-|P[3479])/i;
const TEST_EMAIL_RE = /@example\.(test|invalid)$/i;

function text(value) {
  return value == null ? '' : String(value);
}

function isTestEmail(value) {
  return TEST_EMAIL_RE.test(text(value));
}

function isTestName(value) {
  return TEST_NAME_RE.test(text(value));
}

function isTestNumber(value) {
  const normalized = text(value);
  return TEST_NUMBER_RE.test(normalized) || /^P[3479]\d/i.test(normalized);
}

function isTestVehicleNumber(value) {
  return TEST_VEHICLE_RE.test(text(value));
}

function sortedIds(set) {
  return Array.from(set).sort((a, b) => a - b);
}

function emptyTestSets() {
  const sets = {};
  for (const table of Object.keys(TABLES)) sets[table] = new Set();
  return sets;
}

async function fetchRows(db, table, select) {
  const meta = TABLES[table];
  if (!meta) throw new Error(`Unknown table: ${table}`);
  return db[meta.model].findMany({ select });
}

/**
 * Classify test rows using the reviewed rules. Returns:
 *   { test: { table: Set<number> }, totals: { table: number }, rows: { table: [] } }
 */
async function classify(db) {
  const test = emptyTestSets();
  const totals = {};
  const rows = {};

  async function load(table, select) {
    const data = await fetchRows(db, table, select);
    rows[table] = data;
    totals[table] = data.length;
    return data;
  }

  // Users: test email domains and the four explicitly reviewed test accounts.
  // Admins and the manual-order system user are never deleted.
  const users = await load('users', { user_id: true, email: true, role: true });
  for (const user of users) {
    if (user.role === 'admin') continue;
    if (PRESERVE_USER_IDS.has(user.user_id)) continue;
    if (isTestEmail(user.email) || EXPLICIT_TEST_USERS.has(user.user_id)) {
      test.users.add(user.user_id);
    }
  }

  const drivers = await load('drivers', { driver_id: true, driver_name: true, user_id: true });
  for (const driver of drivers) {
    if (isTestName(driver.driver_name) || test.users.has(driver.user_id)) {
      test.drivers.add(driver.driver_id);
    }
  }

  const owners = await load('vehicle_owners', { owner_id: true, owner_name: true, email: true });
  for (const owner of owners) {
    if (isTestName(owner.owner_name) || /^REV/i.test(text(owner.owner_name))) {
      test.vehicle_owners.add(owner.owner_id);
    }
  }

  const vehicles = await load('transport_vehicles', {
    vehicle_id: true, vehicle_number: true, owner_id: true, driver_id: true,
  });
  for (const vehicle of vehicles) {
    if (
      isTestVehicleNumber(vehicle.vehicle_number) ||
      test.vehicle_owners.has(vehicle.owner_id) ||
      test.drivers.has(vehicle.driver_id)
    ) {
      test.transport_vehicles.add(vehicle.vehicle_id);
    }
  }

  const bookings = await load('bookings', {
    booking_id: true,
    booking_number: true,
    booking_reference: true,
    user_id: true,
    pickup_location: true,
    goods_description: true,
  });
  for (const booking of bookings) {
    if (
      isTestNumber(booking.booking_number) ||
      isTestNumber(booking.booking_reference) ||
      test.users.has(booking.user_id) ||
      EXPLICIT_TEST_BOOKINGS.has(booking.booking_id) ||
      /test/i.test(text(booking.pickup_location)) ||
      /test/i.test(text(booking.goods_description))
    ) {
      test.bookings.add(booking.booking_id);
    }
  }

  const enquiries = await load('enquiries', {
    enquiry_id: true,
    enquiry_number: true,
    customer_name: true,
    customer_id: true,
  });
  for (const enquiry of enquiries) {
    if (
      isTestNumber(enquiry.enquiry_number) ||
      isTestName(enquiry.customer_name) ||
      test.users.has(enquiry.customer_id) ||
      EXPLICIT_TEST_ENQUIRIES.has(enquiry.enquiry_id)
    ) {
      test.enquiries.add(enquiry.enquiry_id);
    }
  }

  const quotations = await load('quotations', {
    quotation_id: true, enquiry_id: true, quotation_number: true,
  });
  for (const quotation of quotations) {
    if (test.enquiries.has(quotation.enquiry_id) || isTestNumber(quotation.quotation_number)) {
      test.quotations.add(quotation.quotation_id);
    }
  }

  const trips = await load('trips', {
    trip_id: true,
    trip_number: true,
    booking_id: true,
    enquiry_id: true,
    driver_id: true,
    vehicle_id: true,
    transport_owner_id: true,
    user_id: true,
  });
  for (const trip of trips) {
    if (
      isTestNumber(trip.trip_number) ||
      test.bookings.has(trip.booking_id) ||
      test.enquiries.has(trip.enquiry_id) ||
      test.drivers.has(trip.driver_id) ||
      test.transport_vehicles.has(trip.vehicle_id) ||
      test.vehicle_owners.has(trip.transport_owner_id) ||
      test.users.has(trip.user_id)
    ) {
      test.trips.add(trip.trip_id);
    }
  }

  const invoices = await load('invoices', {
    invoice_id: true, invoice_number: true, booking_id: true, trip_id: true,
  });
  for (const invoice of invoices) {
    if (
      test.bookings.has(invoice.booking_id) ||
      test.trips.has(invoice.trip_id) ||
      isTestNumber(invoice.invoice_number)
    ) {
      test.invoices.add(invoice.invoice_id);
    }
  }

  const tripFinancials = await load('trip_financials', {
    trip_financial_id: true, trip_id: true, booking_id: true,
  });
  for (const financial of tripFinancials) {
    if (test.trips.has(financial.trip_id) || test.bookings.has(financial.booking_id)) {
      test.trip_financials.add(financial.trip_financial_id);
    }
  }

  const financialTransactions = await load('financial_transactions', {
    transaction_id: true,
    trip_id: true,
    booking_id: true,
    trip_financial_id: true,
    invoice_id: true,
  });
  for (const transaction of financialTransactions) {
    if (
      test.trips.has(transaction.trip_id) ||
      test.bookings.has(transaction.booking_id) ||
      test.trip_financials.has(transaction.trip_financial_id) ||
      test.invoices.has(transaction.invoice_id)
    ) {
      test.financial_transactions.add(transaction.transaction_id);
    }
  }

  const advances = await load('trip_advances', {
    advance_id: true, trip_id: true, booking_id: true, trip_financial_id: true,
  });
  for (const advance of advances) {
    if (
      test.trips.has(advance.trip_id) ||
      test.bookings.has(advance.booking_id) ||
      test.trip_financials.has(advance.trip_financial_id)
    ) {
      test.trip_advances.add(advance.advance_id);
    }
  }

  const tripSettlements = await load('trip_settlements', {
    settlement_id: true, trip_id: true, booking_id: true, trip_financial_id: true,
  });
  for (const settlement of tripSettlements) {
    if (
      test.trips.has(settlement.trip_id) ||
      test.bookings.has(settlement.booking_id) ||
      test.trip_financials.has(settlement.trip_financial_id)
    ) {
      test.trip_settlements.add(settlement.settlement_id);
    }
  }

  const commissions = await load('commission_records', {
    commission_id: true, trip_financial_id: true, booking_id: true,
  });
  for (const commission of commissions) {
    if (
      test.trip_financials.has(commission.trip_financial_id) ||
      test.bookings.has(commission.booking_id)
    ) {
      test.commission_records.add(commission.commission_id);
    }
  }

  const partners = await load('partners', { partner_id: true, partner_name: true, email: true });
  for (const partner of partners) {
    if (isTestName(partner.partner_name) || isTestEmail(partner.email)) {
      test.partners.add(partner.partner_id);
    }
  }

  const partnerApplications = await load('partner_applications', {
    application_id: true, first_name: true, last_name: true, email: true,
  });
  for (const application of partnerApplications) {
    if (
      isTestEmail(application.email) ||
      isTestName(`${text(application.first_name)} ${text(application.last_name)}`)
    ) {
      test.partner_applications.add(application.application_id);
    }
  }

  const partnerDocuments = await load('partner_documents', { document_id: true, partner_id: true });
  for (const document of partnerDocuments) {
    if (test.partners.has(document.partner_id)) {
      test.partner_documents.add(document.document_id);
    }
  }

  const settlements = await load('settlements', { settlement_id: true, partner_id: true });
  for (const settlement of settlements) {
    if (test.partners.has(settlement.partner_id)) {
      test.settlements.add(settlement.settlement_id);
    }
  }

  const partnerLedger = await load('partner_ledger', { ledger_id: true, partner_id: true, booking_id: true });
  for (const entry of partnerLedger) {
    if (test.partners.has(entry.partner_id) || test.bookings.has(entry.booking_id)) {
      test.partner_ledger.add(entry.ledger_id);
    }
  }

  const partnerPayments = await load('partner_payments', {
    payment_id: true, partner_id: true, settlement_id: true,
  });
  for (const payment of partnerPayments) {
    if (test.partners.has(payment.partner_id) || test.settlements.has(payment.settlement_id)) {
      test.partner_payments.add(payment.payment_id);
    }
  }

  const bookingAssignments = await load('booking_assignments', {
    booking_assignment_id: true, booking_id: true,
  });
  for (const assignment of bookingAssignments) {
    if (test.bookings.has(assignment.booking_id)) {
      test.booking_assignments.add(assignment.booking_assignment_id);
    }
  }

  const bookingEvents = await load('booking_events', { booking_event_id: true, booking_id: true });
  for (const event of bookingEvents) {
    if (test.bookings.has(event.booking_id)) {
      test.booking_events.add(event.booking_event_id);
    }
  }

  const deliveries = await load('deliveries', { delivery_id: true, booking_id: true });
  for (const delivery of deliveries) {
    if (test.bookings.has(delivery.booking_id)) {
      test.deliveries.add(delivery.delivery_id);
    }
  }

  const enquiryEvents = await load('enquiry_events', { enquiry_event_id: true, enquiry_id: true });
  for (const event of enquiryEvents) {
    if (test.enquiries.has(event.enquiry_id)) {
      test.enquiry_events.add(event.enquiry_event_id);
    }
  }

  const quotationCharges = await load('quotation_charges', { charge_id: true, quotation_id: true });
  for (const charge of quotationCharges) {
    if (test.quotations.has(charge.quotation_id)) {
      test.quotation_charges.add(charge.charge_id);
    }
  }

  const quotationMilestones = await load('quotation_milestones', {
    milestone_id: true, quotation_id: true,
  });
  for (const milestone of quotationMilestones) {
    if (test.quotations.has(milestone.quotation_id)) {
      test.quotation_milestones.add(milestone.milestone_id);
    }
  }

  const quotationVersions = await load('quotation_versions', { version_id: true, quotation_id: true });
  for (const version of quotationVersions) {
    if (test.quotations.has(version.quotation_id)) {
      test.quotation_versions.add(version.version_id);
    }
  }

  const bookingSnapshots = await load('booking_quotation_snapshots', {
    snapshot_id: true, booking_id: true, quotation_id: true,
  });
  for (const snapshot of bookingSnapshots) {
    if (test.bookings.has(snapshot.booking_id) || test.quotations.has(snapshot.quotation_id)) {
      test.booking_quotation_snapshots.add(snapshot.snapshot_id);
    }
  }

  const tripTimeline = await load('trip_timeline', { timeline_id: true, trip_id: true });
  for (const event of tripTimeline) {
    if (test.trips.has(event.trip_id)) test.trip_timeline.add(event.timeline_id);
  }

  const tripDocuments = await load('trip_documents', { document_id: true, trip_id: true });
  for (const document of tripDocuments) {
    if (test.trips.has(document.trip_id)) test.trip_documents.add(document.document_id);
  }

  const tripPayments = await load('trip_payments', { payment_id: true, trip_id: true });
  for (const payment of tripPayments) {
    if (test.trips.has(payment.trip_id)) test.trip_payments.add(payment.payment_id);
  }

  const tripExpenses = await load('trip_expenses', { expense_id: true, trip_id: true });
  for (const expense of tripExpenses) {
    if (test.trips.has(expense.trip_id)) test.trip_expenses.add(expense.expense_id);
  }

  const tripIncidents = await load('trip_incidents', { incident_id: true, trip_id: true });
  for (const incident of tripIncidents) {
    if (test.trips.has(incident.trip_id)) test.trip_incidents.add(incident.incident_id);
  }

  const tripVehicleChanges = await load('trip_vehicle_changes', { change_id: true, trip_id: true });
  for (const change of tripVehicleChanges) {
    if (test.trips.has(change.trip_id)) test.trip_vehicle_changes.add(change.change_id);
  }

  const tripDispatches = await load('trip_dispatches', { dispatch_id: true, trip_id: true });
  for (const dispatch of tripDispatches) {
    if (test.trips.has(dispatch.trip_id)) test.trip_dispatches.add(dispatch.dispatch_id);
  }

  const ewayBills = await load('eway_bills', { eway_bill_id: true, trip_id: true });
  for (const bill of ewayBills) {
    if (test.trips.has(bill.trip_id)) test.eway_bills.add(bill.eway_bill_id);
  }

  const tripInsurances = await load('trip_insurances', { insurance_id: true, trip_id: true });
  for (const insurance of tripInsurances) {
    if (test.trips.has(insurance.trip_id)) test.trip_insurances.add(insurance.insurance_id);
  }

  const vehicleHires = await load('vehicle_hires', {
    hire_id: true,
    trip_id: true,
    booking_id: true,
    vehicle_id: true,
    driver_id: true,
    vendor_id: true,
  });
  for (const hire of vehicleHires) {
    if (
      test.trips.has(hire.trip_id) ||
      test.bookings.has(hire.booking_id) ||
      test.transport_vehicles.has(hire.vehicle_id) ||
      test.drivers.has(hire.driver_id) ||
      test.vehicle_owners.has(hire.vendor_id)
    ) {
      test.vehicle_hires.add(hire.hire_id);
    }
  }

  const reservations = await load('reservations', {
    reservation_id: true, booking_id: true, enquiry_id: true, driver_id: true, vehicle_id: true,
  });
  for (const reservation of reservations) {
    if (
      test.bookings.has(reservation.booking_id) ||
      test.enquiries.has(reservation.enquiry_id) ||
      test.drivers.has(reservation.driver_id) ||
      test.transport_vehicles.has(reservation.vehicle_id)
    ) {
      test.reservations.add(reservation.reservation_id);
    }
  }

  const driverTransactions = await load('driver_transactions', {
    transaction_id: true, driver_id: true,
  });
  for (const transaction of driverTransactions) {
    if (test.drivers.has(transaction.driver_id)) {
      test.driver_transactions.add(transaction.transaction_id);
    }
  }

  const driverTimeline = await load('driver_timeline', { event_id: true, driver_id: true });
  for (const event of driverTimeline) {
    if (test.drivers.has(event.driver_id)) test.driver_timeline.add(event.event_id);
  }

  const driverAssignments = await load('driver_assignments', {
    assignment_id: true, driver_id: true, partner_id: true,
  });
  for (const assignment of driverAssignments) {
    if (test.drivers.has(assignment.driver_id) || test.partners.has(assignment.partner_id)) {
      test.driver_assignments.add(assignment.assignment_id);
    }
  }

  const vehicleAssignments = await load('vehicle_assignments', {
    assignment_id: true, driver_id: true, vehicle_id: true,
  });
  for (const assignment of vehicleAssignments) {
    if (
      test.drivers.has(assignment.driver_id) ||
      test.transport_vehicles.has(assignment.vehicle_id)
    ) {
      test.vehicle_assignments.add(assignment.assignment_id);
    }
  }

  const passwordResetTokens = await load('password_reset_tokens', { id: true, user_id: true });
  for (const token of passwordResetTokens) {
    if (test.users.has(token.user_id)) test.password_reset_tokens.add(token.id);
  }

  const otpVerifications = await load('otp_verifications', { id: true, user_id: true });
  for (const otp of otpVerifications) {
    if (test.users.has(otp.user_id)) test.otp_verifications.add(otp.id);
  }

  // Every current journal entry and line belongs to a test accounting flow.
  // This is intentionally a one-off rule for the reviewed 2026-11-06 cleanup.
  const journalEntries = await load('journal_entries', { journal_id: true });
  for (const entry of journalEntries) test.journal_entries.add(entry.journal_id);

  const journalLines = await load('journal_lines', { line_id: true, journal_id: true });
  for (const line of journalLines) {
    if (test.journal_entries.has(line.journal_id)) test.journal_lines.add(line.line_id);
  }

  const petrolPumps = await load('petrol_pumps', { pump_id: true, pump_name: true });
  for (const pump of petrolPumps) {
    if (isTestName(pump.pump_name)) test.petrol_pumps.add(pump.pump_id);
  }

  const petrolBills = await load('petrol_pump_bills', { bill_id: true, pump_id: true });
  for (const bill of petrolBills) {
    if (test.petrol_pumps.has(bill.pump_id)) test.petrol_pump_bills.add(bill.bill_id);
  }

  const petrolPayments = await load('petrol_pump_payments', {
    payment_id: true, pump_id: true, bill_id: true,
  });
  for (const payment of petrolPayments) {
    if (
      test.petrol_pumps.has(payment.pump_id) ||
      test.petrol_pump_bills.has(payment.bill_id)
    ) {
      test.petrol_pump_payments.add(payment.payment_id);
    }
  }

  const petrolFuel = await load('petrol_pump_fuel_transactions', {
    transaction_id: true, pump_id: true, trip_id: true, vehicle_id: true, driver_id: true, bill_id: true,
  });
  for (const fuel of petrolFuel) {
    if (
      test.petrol_pumps.has(fuel.pump_id) ||
      test.trips.has(fuel.trip_id) ||
      test.transport_vehicles.has(fuel.vehicle_id) ||
      test.drivers.has(fuel.driver_id) ||
      test.petrol_pump_bills.has(fuel.bill_id)
    ) {
      test.petrol_pump_fuel_transactions.add(fuel.transaction_id);
    }
  }

  const openingBalances = await load('party_opening_balances', {
    opening_id: true, party_type: true, party_id: true,
  });
  for (const balance of openingBalances) {
    if (balance.party_type === 'CUSTOMER' && test.users.has(balance.party_id)) {
      test.party_opening_balances.add(balance.opening_id);
    } else if (balance.party_type === 'DRIVER' && test.drivers.has(balance.party_id)) {
      test.party_opening_balances.add(balance.opening_id);
    } else if (balance.party_type === 'VENDOR' && test.vehicle_owners.has(balance.party_id)) {
      test.party_opening_balances.add(balance.opening_id);
    } else if (balance.party_type === 'PETROL_PUMP' && test.petrol_pumps.has(balance.party_id)) {
      test.party_opening_balances.add(balance.opening_id);
    }
  }

  // Preserved-only tables are counted but never classified as test.
  await load('clients', { client_id: true });
  await load('admins', { admin_id: true });
  await load('audit_logs', { audit_id: true });
  await load('accounting_accounts', { account_id: true });
  await load('document_sequences', { sequence_id: true });

  return { test, totals, rows };
}

async function loadForeignKeys(db) {
  return db.$queryRawUnsafe(`
    SELECT
      tc.table_name AS child,
      kcu.column_name AS child_column,
      ccu.table_name AS parent,
      ccu.column_name AS parent_column,
      rc.delete_rule AS delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name
  `);
}

/**
 * Detect any preserved row that references a test parent. Such a row would be
 * deleted by CASCADE, silently mutated by SET NULL, or block deletion with
 * RESTRICT/NO ACTION, so it must stop the cleanup.
 */
async function guardCheck(db, test) {
  const foreignKeys = await loadForeignKeys(db);
  const columnsByTable = {};
  for (const fk of foreignKeys) {
    if (!columnsByTable[fk.child]) columnsByTable[fk.child] = new Set();
    if (!columnsByTable[fk.parent]) columnsByTable[fk.parent] = new Set();
    columnsByTable[fk.child].add(fk.child_column);
    columnsByTable[fk.parent].add(fk.parent_column);
  }

  const rowsByTable = {};
  for (const table of Object.keys(TABLES)) {
    const meta = TABLES[table];
    const select = { [meta.id]: true };
    for (const column of columnsByTable[table] || []) select[column] = true;
    rowsByTable[table] = await fetchRows(db, table, select);
  }

  const blockers = [];
  for (const fk of foreignKeys) {
    const parentTest = test[fk.parent];
    if (!parentTest || parentTest.size === 0) continue;
    const childRows = rowsByTable[fk.child];
    const childMeta = TABLES[fk.child];
    if (!childRows || !childMeta) continue;
    const childTest = test[fk.child] || new Set();
    for (const row of childRows) {
      const parentId = row[fk.child_column];
      if (parentId == null) continue;
      if (!parentTest.has(parentId)) continue;
      if (childTest.has(row[childMeta.id])) continue;
      blockers.push({
        child: fk.child,
        child_id: row[childMeta.id],
        child_column: fk.child_column,
        parent: fk.parent,
        parent_id: parentId,
        delete_rule: fk.delete_rule,
      });
    }
  }

  return { foreignKeysChecked: foreignKeys.length, blockers };
}

function summarize(test, totals) {
  const tables = {};
  let testRows = 0;
  let totalRows = 0;
  for (const table of Object.keys(TABLES)) {
    const testCount = test[table] ? test[table].size : 0;
    const totalCount = totals[table] || 0;
    tables[table] = { total: totalCount, test: testCount, preserve: totalCount - testCount };
    testRows += testCount;
    totalRows += totalCount;
  }
  return { testRows, totalRows, preservedRows: totalRows - testRows, tables };
}

function idsObject(test) {
  const output = {};
  for (const table of Object.keys(TABLES)) output[table] = sortedIds(test[table] || new Set());
  return output;
}

function diffTestIds(planned, live) {
  const diffs = [];
  for (const table of Object.keys(TABLES)) {
    const a = planned[table] || [];
    const b = live[table] || [];
    if (a.length !== b.length || a.some((id, index) => id !== b[index])) {
      const plannedSet = new Set(a);
      const liveSet = new Set(b);
      diffs.push({
        table,
        planned_count: a.length,
        live_count: b.length,
        missing_from_live: a.filter((id) => !liveSet.has(id)).slice(0, 20),
        new_in_live: b.filter((id) => !plannedSet.has(id)).slice(0, 20),
      });
    }
  }
  return diffs;
}

module.exports = {
  RULES_VERSION,
  TABLES,
  DELETION_ORDER,
  PRESERVE_ONLY_TABLES,
  classify,
  guardCheck,
  summarize,
  idsObject,
  diffTestIds,
  sortedIds,
  isTestEmail,
  isTestName,
  isTestNumber,
  isTestVehicleNumber,
};
