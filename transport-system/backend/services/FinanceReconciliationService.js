const { prisma: defaultPrisma } = require('../config/prisma');
const { parseMetadata, num, invoiceTotal } = require('./finance/financeUtils');
const money = require('./finance/money');

class FinanceReconciliationService {
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
  }

  async run(filters = {}) {
    const discrepancies = [];
    const limit = Math.min(Number(filters.limit) || 200, 1000);

    // 1. Invoice vs posted receipts
    const invoices = await this.prisma.invoice.findMany({
      take: limit,
      orderBy: { invoice_id: 'desc' },
    });
    for (const invoice of invoices) {
      const receipts = await this.prisma.financialTransaction.findMany({
        where: {
          invoice_id: invoice.invoice_id,
          transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
        select: { amount: true, transaction_id: true },
      });
      const receivedPaise = receipts.reduce((s, r) => s + money.toPaise(r.amount || 0), 0);
      const totalPaise = money.toPaise(invoiceTotal(invoice));
      const balancePaise = Math.max(0, totalPaise - receivedPaise);
      const expectedStatus = balancePaise <= 0 && totalPaise > 0
        ? 'PAID'
        : receivedPaise > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
      if (String(invoice.payment_status || '').toUpperCase() !== expectedStatus) {
        discrepancies.push({
          entity_type: 'INVOICE',
          entity_reference: invoice.invoice_number || String(invoice.invoice_id),
          expected_amount: money.fromPaise(totalPaise - balancePaise),
          actual_amount: money.fromPaise(receivedPaise),
          difference: money.fromPaise(balancePaise),
          severity: 'HIGH',
          explanation: `Invoice payment_status is ${invoice.payment_status} but ledger indicates ${expectedStatus}`,
          source_references: receipts.map((r) => `FT-${r.transaction_id}`),
        });
      }
    }

    // 2. Journal balance
    const journals = await this.prisma.journalEntry.findMany({
      take: limit,
      include: { lines: true },
      orderBy: { journal_id: 'desc' },
    });
    for (const j of journals) {
      let d = 0, c = 0;
      for (const l of j.lines) {
        const p = money.toPaise(l.amount);
        if (l.direction === 'DEBIT') d += p; else c += p;
      }
      if (d !== c) {
        discrepancies.push({
          entity_type: 'JOURNAL_ENTRY',
          entity_reference: j.reference,
          expected_amount: money.fromPaise(d),
          actual_amount: money.fromPaise(c),
          difference: money.fromPaise(Math.abs(d - c)),
          severity: 'CRITICAL',
          explanation: 'Journal debits do not equal credits',
          source_references: [`JE-${j.journal_id}`],
        });
      }
      if (j.lines.length < 2) {
        discrepancies.push({
          entity_type: 'JOURNAL_ENTRY',
          entity_reference: j.reference,
          expected_amount: 0,
          actual_amount: j.lines.length,
          difference: 0,
          severity: 'HIGH',
          explanation: 'Journal has fewer than two lines',
          source_references: [`JE-${j.journal_id}`],
        });
      }
    }

    // 3. Advance outstanding consistency
    const advances = await this.prisma.tripAdvance.findMany({ take: limit });
    for (const a of advances) {
      const issued = money.toPaise(a.amount || 0);
      const adjusted = money.toPaise(a.adjusted_amount || 0);
      if (adjusted > issued) {
        discrepancies.push({
          entity_type: 'TRIP_ADVANCE',
          entity_reference: `ADV-${a.advance_id}`,
          expected_amount: money.fromPaise(issued),
          actual_amount: money.fromPaise(adjusted),
          difference: money.fromPaise(adjusted - issued),
          severity: 'HIGH',
          explanation: 'Adjusted amount exceeds issued advance',
          source_references: [`ADV-${a.advance_id}`],
        });
      }
    }

    // 4. Petrol pump payable vs fuel/payment
    const pumps = await this.prisma.petrolPump.findMany({ take: limit });
    for (const pump of pumps) {
      const fuelAgg = await this.prisma.petrolPumpFuelTransaction.aggregate({
        where: { pump_id: pump.pump_id },
        _sum: { total_amount: true },
      });
      const payAgg = await this.prisma.petrolPumpPayment.aggregate({
        where: { pump_id: pump.pump_id },
        _sum: { amount: true },
      });
      const fuelTotal = money.toPaise(fuelAgg._sum.total_amount || 0);
      const payTotal = money.toPaise(payAgg._sum.amount || 0);
      const expected = fuelTotal - payTotal + money.toPaise(pump.opening_balance || 0);
      const actual = money.toPaise(pump.current_balance || 0);
      if (expected !== actual) {
        discrepancies.push({
          entity_type: 'PETROL_PUMP',
          entity_reference: `PUMP-${pump.pump_id}`,
          expected_amount: money.fromPaise(expected),
          actual_amount: money.fromPaise(actual),
          difference: money.fromPaise(Math.abs(expected - actual)),
          severity: 'HIGH',
          explanation: 'Pump current balance does not match fuel transactions minus payments plus opening balance',
          source_references: [`PUMP-${pump.pump_id}`],
        });
      }
    }

    return {
      generated_at: new Date(),
      discrepancy_count: discrepancies.length,
      discrepancies,
    };
  }
}

module.exports = FinanceReconciliationService;
module.exports.FinanceReconciliationService = FinanceReconciliationService;
