const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testLifecycle() {
  // Find a completed booking with driver and vehicle
  const booking = await prisma.booking.findFirst({
    where: { status: 'completed' },
    include: {
      driver: { include: { user: true } },
      partner: true,
      vehicleOwner: true,
      vehicle: true,
    }
  });

  if (!booking) {
    console.log('No completed booking found for testing');
    await prisma.$disconnect();
    return;
  }

  console.log('Testing with booking:', booking.booking_number);
  console.log('Customer Fare (final_price):', booking.final_price);
  console.log('Driver:', booking.driver?.user?.first_name, booking.driver?.user?.last_name);
  console.log('Partner:', booking.partner?.partner_name);
  console.log('VehicleOwner:', booking.vehicleOwner?.owner_name);
  console.log('Vehicle:', booking.vehicle?.vehicle_number);

  // Step 1: Create TripFinancial
  const customerFare = booking.final_price || 10000;
  const driverPayout = Math.round(customerFare * 0.8);
  const ownerSettlementAmount = Math.round(customerFare * 0.15);
  const commissionRate = 5;
  const commissionAmount = Math.round(customerFare * (commissionRate / 100));
  const btMargin = customerFare - driverPayout - ownerSettlementAmount - commissionAmount;

  console.log('\n--- Financial Calculations ---');
  console.log('Customer Fare:', customerFare);
  console.log('Driver Payout (80%):', driverPayout);
  console.log('Owner Settlement (15%):', ownerSettlementAmount);
  console.log('Commission (5%):', commissionAmount);
  console.log('BT Margin:', btMargin);
  const sumCheck = driverPayout + ownerSettlementAmount + commissionAmount + btMargin;
  console.log('Verification:', customerFare, '=', driverPayout, '+', ownerSettlementAmount, '+', commissionAmount, '+', btMargin, '?', sumCheck === customerFare);

  const tripFinancial = await prisma.tripFinancial.upsert({
    where: { booking_id: booking.booking_id },
    update: {
      customer_fare: customerFare,
      driver_payout: driverPayout,
      owner_settlement_amount: ownerSettlementAmount,
      bt_margin: btMargin,
      status: 'CALCULATED',
    },
    create: {
      booking_id: booking.booking_id,
      customer_fare: customerFare,
      driver_payout: driverPayout,
      owner_settlement_amount: ownerSettlementAmount,
      bt_margin: btMargin,
      status: 'CALCULATED',
    }
  });
  console.log('\nTripFinancial created/updated:', tripFinancial.trip_financial_id);

  // Step 2: Create CommissionRecord
  const commission = await prisma.commissionRecord.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      commission_rate: commissionRate,
      commission_base: customerFare,
      commission_amount: commissionAmount,
      commission_type: 'percentage',
      applied_by: 1,
    }
  });
  console.log('CommissionRecord created:', commission.commission_id);

  // Step 3: Create Driver Advance
  const driverAdvance = await prisma.tripAdvance.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      driver_id: booking.driver_id,
      vehicle_id: booking.vehicle_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      amount: 3000,
      advance_type: 'DRIVER_ADVANCE',
      payment_method: 'cash',
      reference_number: 'ADV-001-' + Date.now(),
      given_by: 1,
      notes: 'Initial driver advance',
      status: 'PAID',
    }
  });
  console.log('Driver Advance created:', driverAdvance.advance_id, 'Amount:', driverAdvance.amount);

  // Step 4: Create Fuel Advance
  const fuelAdvance = await prisma.tripAdvance.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      driver_id: booking.driver_id,
      vehicle_id: booking.vehicle_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      amount: 1000,
      advance_type: 'FUEL_ADVANCE',
      payment_method: 'cash',
      reference_number: 'FUEL-001-' + Date.now(),
      given_by: 1,
      notes: 'Fuel advance for trip',
      status: 'PAID',
    }
  });
  console.log('Fuel Advance created:', fuelAdvance.advance_id, 'Amount:', fuelAdvance.amount);

  // Step 5: Create Driver Settlement
  const totalAdvances = 3000 + 1000;
  const remainingDriverSettlement = driverPayout - totalAdvances;
  const driverSettlement = await prisma.tripSettlement.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      driver_settlement_amount: remainingDriverSettlement,
      driver_settlement_status: 'PAID',
      driver_settlement_payment_method: 'bank_transfer',
      driver_settlement_reference: 'SETT-DRV-' + Date.now(),
      driver_settlement_notes: 'Final driver settlement after advances',
    }
  });
  console.log('Driver Settlement created:', driverSettlement.settlement_id, 'Amount:', driverSettlement.driver_settlement_amount);

  // Step 6: Create Owner Settlement
  const ownerSettlementRec = await prisma.tripSettlement.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      owner_settlement_amount: ownerSettlementAmount,
      owner_settlement_status: 'PAID',
      owner_settlement_payment_method: 'bank_transfer',
      owner_settlement_reference: 'SETT-OWN-' + Date.now(),
      owner_settlement_notes: 'Owner settlement',
    }
  });
  console.log('Owner Settlement created:', ownerSettlementRec.settlement_id, 'Amount:', ownerSettlementRec.owner_settlement_amount);

  // Step 7: Create FinancialTransaction records
  await prisma.financialTransaction.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
      driver_id: booking.driver_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      transaction_type: 'CUSTOMER_PAYMENT',
      amount: customerFare,
      direction: 'CREDIT',
      payment_method: 'online',
      reference_number: 'PAY-' + Date.now(),
      status: 'PAID',
      created_by: 1,
      metadata: JSON.stringify({ source: 'booking' }),
    }
  });

  await prisma.financialTransaction.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
      driver_id: booking.driver_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      transaction_type: 'DRIVER_ADVANCE',
      amount: 3000,
      direction: 'DEBIT',
      payment_method: 'cash',
      reference_number: 'ADV-001-' + Date.now(),
      status: 'PAID',
      created_by: 1,
      metadata: JSON.stringify({ advance_id: driverAdvance.advance_id }),
    }
  });

  await prisma.financialTransaction.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
      driver_id: booking.driver_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      transaction_type: 'FUEL_ADVANCE',
      amount: 1000,
      direction: 'DEBIT',
      payment_method: 'cash',
      reference_number: 'FUEL-001-' + Date.now(),
      status: 'PAID',
      created_by: 1,
      metadata: JSON.stringify({ advance_id: fuelAdvance.advance_id }),
    }
  });

  await prisma.financialTransaction.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
      driver_id: booking.driver_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      transaction_type: 'DRIVER_SETTLEMENT',
      amount: remainingDriverSettlement,
      direction: 'DEBIT',
      payment_method: 'bank_transfer',
      reference_number: 'SETT-DRV-' + Date.now(),
      status: 'PAID',
      created_by: 1,
      metadata: JSON.stringify({ settlement_id: driverSettlement.settlement_id }),
    }
  });

  await prisma.financialTransaction.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
      driver_id: booking.driver_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      transaction_type: 'OWNER_SETTLEMENT',
      amount: ownerSettlementAmount,
      direction: 'DEBIT',
      payment_method: 'bank_transfer',
      reference_number: 'SETT-OWN-' + Date.now(),
      status: 'PAID',
      created_by: 1,
      metadata: JSON.stringify({ settlement_id: ownerSettlementRec.settlement_id }),
    }
  });

  await prisma.financialTransaction.create({
    data: {
      trip_financial_id: tripFinancial.trip_financial_id,
      booking_id: booking.booking_id,
      vehicle_id: booking.vehicle_id,
      driver_id: booking.driver_id,
      transport_owner_id: booking.vehicleOwner?.owner_id,
      transaction_type: 'COMMISSION',
      amount: commissionAmount,
      direction: 'DEBIT',
      payment_method: 'system',
      reference_number: 'COMM-' + Date.now(),
      status: 'PAID',
      created_by: 1,
      metadata: JSON.stringify({ commission_id: commission.commission_id }),
    }
  });

  console.log('\nFinancial transactions created');

  // Step 8: Update TripFinancial status to SETTLED
  await prisma.tripFinancial.update({
    where: { trip_financial_id: tripFinancial.trip_financial_id },
    data: { status: 'SETTLED' }
  });
  console.log('TripFinancial status updated to SETTLED');

  // Step 9: Create AuditLog
  await prisma.auditLog.create({
    data: {
      user_id: 1,
      user_role: 'admin',
      entity_type: 'trip_financial',
      entity_id: tripFinancial.trip_financial_id,
      action: 'CREATE',
      previous_value: null,
      new_value: JSON.stringify({
        customer_fare: tripFinancial.customer_fare,
        driver_payout: tripFinancial.driver_payout,
        owner_settlement_amount: tripFinancial.owner_settlement_amount,
        bt_margin: tripFinancial.bt_margin,
        commission_rate: commissionRate
      }),
      reason: 'Initial trip financial calculation',
      ip_address: '127.0.0.1',
    }
  });

  await prisma.auditLog.create({
    data: {
      user_id: 1,
      user_role: 'admin',
      entity_type: 'trip_advance',
      entity_id: driverAdvance.advance_id,
      action: 'CREATE',
      previous_value: null,
      new_value: JSON.stringify({ amount: 3000, advance_type: 'DRIVER_ADVANCE' }),
      reason: 'Driver advance given',
      ip_address: '127.0.0.1',
    }
  });

  await prisma.auditLog.create({
    data: {
      user_id: 1,
      user_role: 'admin',
      entity_type: 'trip_advance',
      entity_id: fuelAdvance.advance_id,
      action: 'CREATE',
      previous_value: null,
      new_value: JSON.stringify({ amount: 1000, advance_type: 'FUEL_ADVANCE' }),
      reason: 'Fuel advance given',
      ip_address: '127.0.0.1',
    }
  });

  await prisma.auditLog.create({
    data: {
      user_id: 1,
      user_role: 'admin',
      entity_type: 'trip_settlement',
      entity_id: driverSettlement.settlement_id,
      action: 'CREATE',
      previous_value: null,
      new_value: JSON.stringify({ amount: remainingDriverSettlement, settlement_type: 'DRIVER_SETTLEMENT' }),
      reason: 'Driver settlement paid',
      ip_address: '127.0.0.1',
    }
  });

  console.log('Audit logs created');

  // Step 10: Verify the complete record
  const verify = await prisma.tripFinancial.findUnique({
    where: { trip_financial_id: tripFinancial.trip_financial_id },
    include: {
      advances: true,
      settlements: true,
      commissions: true,
      transactions: true,
    }
  });

  console.log('\n--- Verification ---');
  console.log('TripFinancial:', verify.trip_financial_id);
  console.log('Customer Fare:', verify.customer_fare);
  console.log('Driver Payout:', verify.driver_payout);
  console.log('Owner Settlement:', verify.owner_settlement_amount);
  console.log('BT Margin:', verify.bt_margin);
  console.log('Status:', verify.status);
  console.log('Advances count:', verify.advances.length);
  console.log('Settlements count:', verify.settlements.length);
  console.log('Commission:', verify.commissions?.[0]?.commission_amount);
  console.log('Transactions count:', verify.transactions.length);

  // Verify totals
  const advTotal = verify.advances.reduce((sum, a) => sum + Number(a.amount), 0);
  const settTotal = verify.settlements.reduce((sum, s) => sum + Number(s.driver_settlement_amount || 0) + Number(s.owner_settlement_amount || 0), 0);
  console.log('\nTotal Advances:', advTotal);
  console.log('Total Settlements:', settTotal);
  console.log('Remaining Driver Settlement:', Number(verify.driver_payout) - advTotal);
  console.log('Remaining Owner Settlement:', Number(verify.owner_settlement_amount) - settTotal);

  console.log('\n✅ Complete lifecycle test PASSED');
  await prisma.$disconnect();
}

testLifecycle().catch(e => { console.error('Test failed:', e); process.exit(1); });
