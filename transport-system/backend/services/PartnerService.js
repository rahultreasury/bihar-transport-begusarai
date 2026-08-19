/**
 * PartnerService
 * Business logic for transport partner management.
 * Handles partner CRUD, ledger, payments, settlements, trucks, documents, driver assignments.
 */

const PartnerRepository = require('../repositories/PartnerRepository');

class PartnerService {
  constructor() {
    this.repo = new PartnerRepository();
  }

/**
   * Register a new transport partner
   */
  async registerPartner(data) {
    const { mobile } = data;

    console.log('[SERVICE] registerPartner ENTERED. mobile:', mobile);

    // Validate commission
    const commission = parseFloat(data.commission_percentage) || 10;
    if (commission < 0 || commission > 100) {
      const err = new Error('Commission must be between 0 and 100');
      err.code = 'INVALID_COMMISSION';
      throw err;
    }

    console.log('[SERVICE] Commission validated:', commission);

    // Check unique mobile
    console.log('[SERVICE] Checking existing partner by mobile:', mobile);
    const existing = await this.repo.findByMobile(mobile);
    console.log('[SERVICE] findByMobile returned:', existing ? 'FOUND - partner_id:' + existing.partner_id : 'NOT FOUND');
    if (existing) {
      const err = new Error('A partner with this mobile number already exists');
      err.code = 'PARTNER_ALREADY_EXISTS';
      err.data = {
        partner_id: existing.partner_id,
        partner_name: existing.partner_name,
        partner_code: existing.partner_code,
      };
      throw err;
    }

    console.log('[SERVICE] Generating partner code...');
    const partnerCode = await this.repo.generatePartnerCode();
    console.log('[SERVICE] Partner code generated:', partnerCode);

    // Normalize: all upper layers pass 'partner_name' or 'owner_name'
    const partnerName = data.partner_name || data.owner_name ? (data.partner_name || data.owner_name).trim() : null;
    if (!partnerName) {
      const err = new Error('Partner name is required');
      err.code = 'MISSING_PARTNER_NAME';
      throw err;
    }

    console.log('[SERVICE] partnerName:', partnerName);

    const partnerData = {
      partner_code: partnerCode,
      partner_name: partnerName,
      owner_name: partnerName,
      company_name: data.company_name || null,
      email: data.email || null,
      mobile: data.mobile,
      alternate_mobile: data.alternate_mobile || null,
      city: data.city || null,
      state: data.state || 'Bihar',
      gst_number: data.gst_number || null,
      pan_number: data.pan_number || null,
      bank_account: data.bank_account || null,
      bank_ifsc: data.bank_ifsc || null,
      bank_name: data.bank_name || null,
      upi_id: data.upi_id || null,
      address: data.address || null,
      status: 'active',
      notes: data.notes || null,
      available_capacity: data.available_capacity || null,
      network_locations: data.network_locations || null,
      commission_percentage: commission,
      commission_type: data.commission_type || 'percentage',
      fixed_commission: data.fixed_commission || 0,
      is_active: true,
    };

    console.log('[SERVICE] Calling repo.create()...');
    const result = await this.repo.create(partnerData);
    console.log('[SERVICE] repo.create returned. partner_id:', result?.partner_id);
    return result;
  }

  async getPartnerProfile(partnerId) {
    return await this.repo.findById(partnerId);
  }

  async getPartnerDashboard(partnerId) {
    return await this.repo.getDashboardSummary(partnerId);
  }

  async listPartners(filters = {}) {
    return await this.repo.findAll(filters);
  }

  async updatePartner(partnerId, data) {
    const allowedFields = [
      'partner_name', 'owner_name', 'company_name',
      'email', 'mobile', 'alternate_mobile', 'city', 'state',
      'gst_number', 'pan_number',
      'bank_account', 'bank_ifsc', 'bank_name', 'upi_id',
      'address', 'notes',
      'commission_percentage', 'commission_type', 'fixed_commission',
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('No valid fields provided for update');
    }

    return await this.repo.update(partnerId, updateData);
  }

async deletePartner(partnerId) {
    const partner = await this.repo.findById(partnerId);
    if (!partner) throw new Error('Partner not found');
    return await this.repo.softDelete(partnerId);
  }

  /**
   * Permanently delete a Transport Owner (Partner) — but only when safe.
   *
   * Business rule:
   *   - Financial / payment / settlement / ledger / document history is
   *     PROTECTED. If any exists, we REJECT hard deletion
   *     (OWNER_HAS_DEPENDENCIES) rather than silently destroying history.
   *   - If the owner still has drivers or vehicles linked, or active
   *     bookings → REJECT hard deletion (OWNER_HAS_DEPENDENCIES).
   *   - If the owner has only historical bookings (SET NULL on delete) and
   *     NO protected financial/module records, we may hard-delete.
   *
   * Only returns success AFTER the DB confirms the row is gone.
   *
   * @param {number} partnerId
   * @param {number|null} adminId  admin performing the delete (for audit)
   * @returns {Promise<{partner_id:number}>}
   * @throws {Error} with `.code` = structured rejection code
   */
  async permanentlyDeletePartner(partnerId, adminId = null) {
    const { prisma } = require('../config/prisma');
    const partner = await this.repo.findById(partnerId);
    if (!partner) {
      const err = new Error('Transport owner not found');
      err.code = 'OWNER_NOT_FOUND';
      throw err;
    }

    const deps = await this.repo.findDependencyCounts(partnerId);

    // Protected financial / historical records → reject hard delete.
    if (deps.hasProtectedFinancialHistory) {
      const err = new Error(
        'This transport owner cannot be deleted because financial records (ledger, payments or settlements) are still associated with this account.'
      );
      err.code = 'OWNER_HAS_DEPENDENCIES';
      err.data = {
        ledgerEntries: deps.ledgerEntries,
        payments: deps.payments,
        settlements: deps.settlements,
      };
      throw err;
    }

    // Operational dependencies that must not be destroyed → reject.
    if (deps.hasOperationalDependency) {
      const parts = [];
      if (deps.drivers > 0) parts.push(`${deps.drivers} driver(s)`);
      if (deps.vehicles > 0) parts.push(`${deps.vehicles} vehicle(s)`);
      if (deps.activeBookings > 0) parts.push(`${deps.activeBookings} active booking(s)`);
      const err = new Error(
        `This transport owner cannot be deleted because ${parts.join(', ')} are still associated with this account.`
      );
      err.code = 'OWNER_HAS_DEPENDENCIES';
      err.data = deps;
      throw err;
    }

    // Safe to hard-delete. Use a transaction + verification.
    const result = await prisma.$transaction(async (tx) => {
      await this.repo.hardDelete(partnerId, tx);
      const stillThere = await tx.partner.findUnique({
        where: { partner_id: partnerId },
        select: { partner_id: true },
      });
      if (stillThere) {
        const err = new Error('Transport owner could not be fully removed from the database.');
        err.code = 'OWNER_DELETE_FAILED';
        throw err;
      }
      return { partner_id: partnerId };
    });

    return result;
  }

  async toggleStatus(partnerId, status) {
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    return await this.repo.update(partnerId, {
      status,
      is_active: status === 'active',
    });
  }

  async getPartnerStats() {
    return await this.repo.getPartnerStats();
  }

  // ============================
  // SOURCED VEHICLES MANAGEMENT
  // ============================

  async getSourcedVehicles(partnerId) {
    return await this.repo.getSourcedVehicles(partnerId);
  }

  async addSourcedVehicle(partnerId, data) {
    const vehicleData = {
      ...data,
      capacity_kg: data.capacity_kg ? parseFloat(data.capacity_kg) : null,
      capacity_volume: data.capacity_volume ? parseFloat(data.capacity_volume) : null,
      manufacturing_year: data.manufacturing_year ? parseInt(data.manufacturing_year) : null,
      hourly_rate: data.hourly_rate ? parseFloat(data.hourly_rate) : null,
      per_km_rate: data.per_km_rate ? parseFloat(data.per_km_rate) : null,
    };
    return await this.repo.addSourcedVehicle(partnerId, vehicleData);
  }

  async updateSourcedVehicle(vehicleId, data) {
    return await this.repo.updateSourcedVehicle(vehicleId, data);
  }

  async removeSourcedVehicle(vehicleId) {
    return await this.repo.removeSourcedVehicle(vehicleId);
  }

  // ============================
  // LEDGER MANAGEMENT
  // ============================

  async recordTransaction(partnerId, data) {
    const partner = await this.repo.findById(partnerId);
    if (!partner) throw new Error('Partner not found');

    const transactionId = await this.repo.generateTransactionId();

    return await this.repo.createLedgerEntry({
      partner_id: partnerId,
      transaction_id: transactionId,
      transaction_type: data.transaction_type,
      description: data.description || `${data.transaction_type.replace(/_/g, ' ')}`,
      debit: data.type === 'debit' ? parseFloat(data.amount) : 0,
      credit: data.type === 'credit' ? parseFloat(data.amount) : 0,
      payment_mode: data.payment_mode || 'cash',
      remarks: data.remarks || null,
      reference_number: data.reference_number || null,
      created_by: data.created_by || null,
      booking_id: data.booking_id || null,
      is_reversal: false,
    });
  }

  async recordReversal(partnerId, originalTransactionId, data) {
    const { prisma } = require('../config/prisma');
    const originalTxn = await prisma.partnerLedger.findUnique({
      where: { transaction_id: originalTransactionId },
    });

    if (!originalTxn) throw new Error('Original transaction not found');

    const reversalTxnId = await this.repo.generateTransactionId();

    return await this.repo.createLedgerEntry({
      partner_id: partnerId,
      transaction_id: reversalTxnId,
      transaction_type: originalTxn.transaction_type,
      description: `Reversal: ${originalTxn.description}`,
      debit: originalTxn.credit,
      credit: originalTxn.debit,
      payment_mode: originalTxn.payment_mode,
      remarks: data.remarks || `Reversal of ${originalTransactionId}`,
      created_by: data.created_by || null,
      is_reversal: true,
      reversal_of: originalTransactionId,
    });
  }

  async getLedger(partnerId, filters = {}) {
    return await this.repo.getLedger(partnerId, filters);
  }

  // ============================
  // PAYMENT MANAGEMENT
  // ============================

  async recordPayment(partnerId, data) {
    const partner = await this.repo.findById(partnerId);
    if (!partner) throw new Error('Partner not found');

    const paymentNumber = await this.repo.generatePaymentNumber();

    const payment = await this.repo.createPayment({
      payment_number: paymentNumber,
      partner_id: partnerId,
      amount: parseFloat(data.amount),
      payment_method: data.payment_method || 'cash',
      reference_number: data.reference_number || null,
      created_by: data.created_by || null,
      status: data.status || 'paid',
      remarks: data.remarks || null,
      settlement_id: data.settlement_id || null,
    });

    if (payment.status === 'paid') {
      const transactionId = await this.repo.generateTransactionId();
      await this.repo.createLedgerEntry({
        partner_id: partnerId,
        transaction_id: transactionId,
        transaction_type: 'cash',
        description: `Payment: ${paymentNumber}`,
        debit: 0,
        credit: payment.amount,
        payment_mode: payment.payment_method,
        remarks: `Payment ref: ${payment.reference_number || paymentNumber}`,
        created_by: data.created_by || null,
      });
    }

    return payment;
  }

  async getPayments(partnerId, filters = {}) {
    return await this.repo.getPayments(partnerId, filters);
  }

  // ============================
  // SETTLEMENT MANAGEMENT
  // ============================

  async generateSettlement(partnerId, month, year) {
    const partner = await this.repo.findById(partnerId);
    if (!partner) throw new Error('Partner not found');

    const existing = await this.repo.findSettlementByMonth(partnerId, month, year);
    if (existing) {
      throw new Error(`Settlement already exists for ${month}/${year} (${existing.settlement_number})`);
    }

    const bookings = await this.repo.getBookingsForSettlement(partnerId, month, year);
    const totalBookings = bookings.length;
    const grossRevenue = bookings.reduce((sum, b) => sum + (b.final_price || 0), 0);
    const commission = bookings.reduce((sum, b) => sum + (b.commission_amount || 0), 0);

    const { prisma } = require('../config/prisma');
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const categoryExpenses = await prisma.partnerLedger.groupBy({
      by: ['transaction_type'],
      where: {
        partner_id: partnerId,
        date: { gte: startDate, lte: endDate },
        transaction_type: { in: ['fuel_advance', 'driver_advance', 'toll', 'repair', 'penalty', 'bonus', 'other_expense'] },
      },
      _sum: { debit: true },
    });

    const getCat = (type) => {
      const found = categoryExpenses.find(c => c.transaction_type === type);
      return found?._sum?.debit || 0;
    };

    const fuelAdvance = getCat('fuel_advance');
    const driverAdvance = getCat('driver_advance');
    const tollAmount = getCat('toll');
    const repairAmount = getCat('repair');
    const penaltyAmount = getCat('penalty');
    const bonusAmount = getCat('bonus');
    const otherExpenses = getCat('other_expense');

    const totalExpenses = fuelAdvance + driverAdvance + tollAmount + repairAmount + penaltyAmount + otherExpenses;
    const netPayable = grossRevenue - commission - totalExpenses + bonusAmount;

    const settlementNumber = await this.repo.generateSettlementNumber(month, year);

    // Create settlement within transaction
    const settlement = await prisma.$transaction(async (tx) => {
      const s = await this.repo.createSettlement({
        settlement_number: settlementNumber,
        partner_id: partnerId,
        month,
        year,
        total_bookings: totalBookings,
        gross_revenue: grossRevenue,
        commission,
        fuel_advance: fuelAdvance,
        driver_advance: driverAdvance,
        toll_amount: tollAmount,
        repair_amount: repairAmount,
        penalty_amount: penaltyAmount,
        bonus_amount: bonusAmount,
        other_expenses: otherExpenses,
        net_payable: netPayable,
        amount_paid: 0,
        balance_due: netPayable,
        status: 'pending',
      }, tx);

      if (bookings.length > 0) {
        const bookingIds = bookings.map(b => b.booking_id);
        await this.repo.updateBookingsSettlement(bookingIds, s.settlement_id, tx);
      }

      return s;
    });

    return settlement;
  }

  async getSettlements(partnerId, filters = {}) {
    return await this.repo.getSettlements(partnerId, filters);
  }

  async updateSettlementStatus(settlementId, status) {
    return await this.repo.updateSettlementStatus(settlementId, status);
  }

  // ============================
  // DOCUMENT MANAGEMENT
  // ============================

  async getDocuments(partnerId) {
    return await this.repo.getDocuments(partnerId);
  }

  async uploadDocument(partnerId, data) {
    return await this.repo.createDocument({
      partner_id: partnerId,
      document_type: data.document_type,
      document_name: data.document_name,
      file_url: data.file_url,
      file_size: data.file_size || null,
      mime_type: data.mime_type || null,
      expiry_date: data.expiry_date ? new Date(data.expiry_date) : null,
      is_verified: false,
      notes: data.notes || null,
      uploaded_by: data.uploaded_by || null,
    });
  }

  async deleteDocument(documentId) {
    return await this.repo.deleteDocument(documentId);
  }

  // ============================
  // DRIVER ASSIGNMENT
  // ============================

  async assignDriverToPartner(driverId, partnerId, assignedBy) {
    return await this.repo.assignDriverToPartner(driverId, partnerId, assignedBy);
  }

  async unassignDriverFromPartner(driverId, partnerId) {
    return await this.repo.unassignDriverFromPartner(driverId, partnerId);
  }

  async getPartnerDrivers(partnerId) {
    return await this.repo.getPartnerDrivers(partnerId);
  }

  async getDriverAssignmentHistory(driverId) {
    return await this.repo.getDriverAssignmentHistory(driverId);
  }

  // ============================
  // OWNER MODULE ENHANCEMENTS
  // ============================

  async getOwnerStats() {
    return await this.repo.getOwnerStats();
  }

  async getTodayAssignedTrips(partnerId = null) {
    return await this.repo.getTodayAssignedTrips(partnerId);
  }

  async getOwnerBookings(partnerId, filters = {}) {
    return await this.repo.getOwnerBookings(partnerId, filters);
  }

  async getCommissionSummary(partnerId) {
    return await this.repo.getCommissionSummary(partnerId);
  }
}

module.exports = PartnerService;
