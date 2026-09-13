const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const trips = await prisma.trip.findMany({ select: { trip_id: true, trip_number: true, status: true, freight_amount: true, source_type: true, booking_id: true, client_id: true, user_id: true, transport_owner_id: true, vehicle_id: true, driver_id: true, created_at: true } });
  console.log("=== TRIPS ===");
  for (const t of trips) {
    console.log(JSON.stringify(t));
  }
  console.log("=== TRIP PAYMENTS ===");
  const tp = await prisma.tripPayment.findMany({ select: { payment_id: true, trip_id: true, amount: true, payment_type: true, payment_category: true, payment_date: true } });
  for (const p of tp) console.log(JSON.stringify(p));
  console.log("=== TRIP EXPENSES ===");
  const te = await prisma.tripExpense.findMany({ select: { expense_id: true, trip_id: true, amount: true, expense_type: true, paid_by: true, paid_to: true, expense_date: true } });
  for (const e of te) console.log(JSON.stringify(e));
  console.log("=== FINANCIAL TRANSACTIONS ===");
  const ft = await prisma.financialTransaction.findMany({ select: { transaction_id: true, trip_financial_id: true, booking_id: true, trip_id: true, transaction_type: true, amount: true, direction: true, from_party: true, to_party: true, purpose: true, transaction_date: true, status: true, metadata: true, client_id: true } });
  for (const f of ft) console.log(JSON.stringify(f));
  console.log("=== TRIP FINANCIALS ===");
  const tf = await prisma.tripFinancial.findMany({ select: { trip_financial_id: true, booking_id: true, status: true, customer_fare: true, driver_payout: true, owner_settlement_amount: true, commission_amount: true, total_advance: true, total_owner_advance: true } });
  for (const f of tf) console.log(JSON.stringify(f));
  console.log("=== BOOKINGS ===");
  const b = await prisma.booking.findMany({ select: { booking_id: true, booking_number: true, status: true, final_price: true, vehicle_owner_id: true, driver_id: true, vehicle_id: true, user_id: true } });
  for (const x of b) console.log(JSON.stringify(x));
  console.log("=== TRIP ADVANCES ===");
  const ta = await prisma.tripAdvance.findMany({ select: { advance_id: true, trip_financial_id: true, booking_id: true, trip_id: true, amount: true, advance_type: true, transport_owner_id: true } });
  for (const a of ta) console.log(JSON.stringify(a));
  console.log("=== TRIP SETTLEMENTS ===");
  const ts = await prisma.tripSettlement.findMany({ select: { settlement_id: true, trip_financial_id: true, booking_id: true, driver_settlement_amount: true, owner_settlement_amount: true, driver_settlement_status: true, owner_settlement_status: true } });
  for (const s of ts) console.log(JSON.stringify(s));
  console.log("=== CLIENTS ===");
  const c = await prisma.client.findMany({ select: { client_id: true, client_code: true, company_name: true } });
  for (const x of c) console.log(JSON.stringify(x));
  console.log("=== VEHICLE OWNERS ===");
  const vo = await prisma.vehicleOwner.findMany({ select: { owner_id: true, owner_name: true, company_name: true } });
  for (const x of vo) console.log(JSON.stringify(x));
  await prisma.$disconnect();
})();
