/**
 * PartnerRepository
 * Database-only repository for transport partner operations.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

/**
 * Retry wrapper for transient Prisma connection errors
 */
async function withRetry(fn, context = 'operation', maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isPrismaConnectionError =
        err?.code === 'P1001' ||
        err?.code === 'P1002' ||
        err?.code === 'P2024' ||
        (err?.message && (
          err.message.includes('Closed') ||
          err.message.includes('Can\'t reach database') ||
          err.message.includes('Connection pool') ||
          err.message.includes('timed out') ||
          err.message.includes('already disconnected')
        ));

      if (isPrismaConnectionError && attempt < maxRetries) {
        console.warn(`[prisma] ${context} attempt ${attempt}/${maxRetries} failed. Retrying...`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

class PartnerRepository {
/**
   * Generate next partner code (PRT000001, PRT000002, etc.)
   */
  async generatePartnerCode(tx = null) {
    console.log('[REPO] generatePartnerCode called');
    try {
      const client = tx || prisma;
      const lastPartner = await client.partner.findFirst({
        orderBy: { partner_code: 'desc' },
        select: { partner_code: true },
      });
      console.log('[REPO] generatePartnerCode - lastPartner:', lastPartner ? lastPartner.partner_code : 'none');

      let nextNum = 1;
      if (lastPartner && lastPartner.partner_code) {
        const match = lastPartner.partner_code.match(/PRT(\d+)/);
        if (match) {
          nextNum = parseInt(match[1]) + 1;
        }
      }
      const code = `PRT${String(nextNum).padStart(6, '0')}`;
      console.log('[REPO] generatePartnerCode generated:', code);
      return code;
    } catch (err) {
      console.error('[REPO] generatePartnerCode ERROR:', err.message, 'code:', err.code);
      throw err;
    }
  }

  /**
   * Generate transaction ID for ledger (LED-YYYYMMDD-XXXXX)
   */
  async generateTransactionId(tx = null) {
    const client = tx || prisma;
    const date = new Date();
    const prefix = `LED-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-`;
    
    const lastTxn = await client.partnerLedger.findFirst({
      where: { transaction_id: { startsWith: prefix } },
      orderBy: { transaction_id: 'desc' },
      select: { transaction_id: true },
    });

    let nextNum = 1;
    if (lastTxn) {
      const parts = lastTxn.transaction_id.split('-');
      nextNum = parseInt(parts[3] || '0') + 1;
    }
    return `${prefix}${String(nextNum).padStart(5, '0')}`;
  }

  /**
   * Generate payment number (PAY-YYYYMMDD-XXXXX)
   */
  async generatePaymentNumber(tx = null) {
    const client = tx || prisma;
    const date = new Date();
    const prefix = `PAY-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-`;
    
    const lastPay = await client.partnerPayment.findFirst({
      where: { payment_number: { startsWith: prefix } },
      orderBy: { payment_number: 'desc' },
      select: { payment_number: true },
    });

    let nextNum = 1;
    if (lastPay) {
      const parts = lastPay.payment_number.split('-');
      nextNum = parseInt(parts[3] || '0') + 1;
    }
    return `${prefix}${String(nextNum).padStart(5, '0')}`;
  }

  /**
   * Generate settlement number (STL-YYYYMM-XXXXX)
   */
  async generateSettlementNumber(month, year, tx = null) {
    const client = tx || prisma;
    const prefix = `STL-${year}${String(month).padStart(2, '0')}-`;
    
    const lastStl = await client.settlement.findFirst({
      where: { settlement_number: { startsWith: prefix } },
      orderBy: { settlement_number: 'desc' },
      select: { settlement_number: true },
    });

    let nextNum = 1;
    if (lastStl) {
      const parts = lastStl.settlement_number.split('-');
      nextNum = parseInt(parts[2] || '0') + 1;
    }
    return `${prefix}${String(nextNum).padStart(5, '0')}`;
  }

/**
   * Find partner by mobile number
   */
  async findByMobile(mobile) {
    console.log('[REPO] findByMobile called with:', mobile);
    try {
      const result = await prisma.partner.findFirst({
        where: { mobile },
      });
      console.log('[REPO] findByMobile result:', result ? 'found' : 'not found');
      return result;
    } catch (err) {
      console.error('[REPO] findByMobile ERROR:', err.message, 'code:', err.code);
      throw err;
    }
  }

  /**
   * Find partner by ID with full relations
   */
  async findById(partnerId) {
    return await prisma.partner.findUnique({
      where: { partner_id: partnerId },
      include: {
        trucks: {
          where: { is_available: true },
          orderBy: { created_at: 'desc' },
        },
        drivers: {
          where: { is_available: true },
          select: {
            driver_id: true,
            driver_code: true,
            driver_name: true,
            mobile: true,
            status: true,
            is_available: true,
            total_deliveries: true,
          },
          orderBy: { created_at: 'desc' },
        },
        _count: {
          select: {
            bookings: true,
            trucks: true,
            drivers: true,
            ledgerEntries: true,
            payments: true,
          },
        },
      },
    });
  }

  /**
   * List partners with search, filter, sort, pagination
   */
  async findAll(filters = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      city = '',
      state = '',
      sort_by = 'created_at',
      sort_order = 'desc',
    } = filters;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = { deleted_at: null };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { partner_code: { contains: searchTerm, mode: 'insensitive' } },
        { partner_name: { contains: searchTerm, mode: 'insensitive' } },
        { owner_name: { contains: searchTerm, mode: 'insensitive' } },
        { company_name: { contains: searchTerm, mode: 'insensitive' } },
        { mobile: { contains: searchTerm } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }
    if (state) {
      where.state = { contains: state, mode: 'insensitive' };
    }

    const allowedSortFields = ['partner_code', 'partner_name', 'status', 'created_at', 'city', 'state'];
    const field = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const order = sort_order === 'asc' ? 'asc' : 'desc';

    const result = await withRetry(async () => {
      const [partners, total] = await Promise.all([
        prisma.partner.findMany({
          where,
          include: {
            _count: {
              select: {
                bookings: true,
                trucks: true,
                drivers: true,
              },
            },
          },
          orderBy: { [field]: order },
          skip,
          take,
        }),
        prisma.partner.count({ where }),
      ]);
      return { partners, total };
    }, 'findAll partners');

    return {
      partners: result.partners,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

/**
   * Create a new transport partner
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    console.log('[REPO] create() called - BEFORE prisma.partner.create');
    try {
      const result = await client.partner.create({ data });
      console.log('[REPO] create() - AFTER prisma.partner.create. partner_id:', result.partner_id);
      return result;
    } catch (err) {
      console.error('[REPO] create() ERROR:', err.message, 'code:', err.code);
      throw err;
    }
  }

  /**
   * Update a partner
   */
  async update(partnerId, data, tx = null) {
    const client = tx || prisma;
    return await client.partner.update({
      where: { partner_id: partnerId },
      data,
    });
  }

/**
   * Soft delete a partner
   */
  async softDelete(partnerId, tx = null) {
    const client = tx || prisma;
    return await client.partner.update({
      where: { partner_id: partnerId },
      data: {
        status: 'inactive',
        is_active: false,
        deleted_at: new Date(),
      },
    });
  }

  /**
   * Count protected dependencies for a Transport Owner (Partner) so the
   * service can decide whether a hard delete is safe.
   *
   * Verified against the actual schema (0_init/migration.sql). The owner's own
   * module tables (ledger, payments, settlements, documents, assignments) are
   * CASCADE on partner delete — but they are FINANCIAL / HISTORICAL records
   * and therefore PROTECTED (we must NOT destroy them just to remove an owner).
   * Bookings/vehicles/drivers are SET NULL on the owner — those are retained.
   *
   * @param {number} partnerId
   * @param {object} [tx] optional transaction client
   */
  async findDependencyCounts(partnerId, tx = null) {
    const client = tx || prisma;
    const ACTIVE_BOOKING_STATUSES = ['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit'];

    const [
      drivers,
      vehicles,
      bookings,
      activeBookings,
      ledgerEntries,
      payments,
      settlements,
      documents,
      assignments,
    ] = await Promise.all([
      client.driver.count({ where: { partner_id: partnerId } }),
      client.transportVehicle.count({ where: { partner_id: partnerId } }),
      client.booking.count({ where: { partner_id: partnerId } }),
      client.booking.count({ where: { partner_id: partnerId, status: { in: ACTIVE_BOOKING_STATUSES } } }),
      client.partnerLedger.count({ where: { partner_id: partnerId } }),
      client.partnerPayment.count({ where: { partner_id: partnerId } }),
      client.settlement.count({ where: { partner_id: partnerId } }),
      client.partnerDocument.count({ where: { partner_id: partnerId } }),
      client.driverAssignment.count({ where: { partner_id: partnerId } }),
    ]);

    return {
      drivers,
      vehicles,
      bookings,
      activeBookings,
      ledgerEntries,
      payments,
      settlements,
      documents,
      assignments,
      // Any financial/historical record → protected.
      hasProtectedFinancialHistory: ledgerEntries > 0 || payments > 0 || settlements > 0,
      // Any operational dependency that must not be silently destroyed.
      hasOperationalDependency: drivers > 0 || vehicles > 0 || activeBookings > 0,
      hasAnyDependency: drivers > 0 || vehicles > 0 || bookings > 0 || ledgerEntries > 0 || payments > 0 || settlements > 0 || documents > 0 || assignments > 0,
    };
  }

  /**
   * Hard-delete a partner inside the given transaction client.
   * Only call this after the service has verified deletion is safe (i.e. no
   * protected financial/historical record exists). The DB CASCADE rules for
   * the owner's own module tables are only reached when the owner has no
   * protected records, so no business history is destroyed.
   */
  async hardDelete(partnerId, tx) {
    return await tx.partner.delete({ where: { partner_id: partnerId } });
  }

  /**
   * Get partner dashboard summary
   */
  async getDashboardSummary(partnerId) {
    const partner = await prisma.partner.findUnique({
      where: { partner_id: partnerId },
      select: {
        partner_id: true,
        partner_code: true,
        partner_name: true,
        status: true,
      },
    });

    if (!partner) return null;

    const totalBookings = await prisma.booking.count({
      where: { partner_id: partnerId },
    });

    const activeBookings = await prisma.booking.count({
      where: {
        partner_id: partnerId,
        status: { in: ['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit'] },
      },
    });

    const completedBookings = await prisma.booking.count({
      where: {
        partner_id: partnerId,
        status: { in: ['delivered', 'completed'] },
      },
    });

    const cancelledBookings = await prisma.booking.count({
      where: {
        partner_id: partnerId,
        status: 'cancelled',
      },
    });

    // Revenue from completed bookings
    const revenueAgg = await prisma.booking.aggregate({
      where: {
        partner_id: partnerId,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { final_price: true },
    });

    // Commission from completed bookings
    const commissionAgg = await prisma.booking.aggregate({
      where: {
        partner_id: partnerId,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { commission_amount: true },
    });

    // Ledger summary
    const debitAgg = await prisma.partnerLedger.aggregate({
      where: { partner_id: partnerId, transaction_type: { in: ['fuel_advance', 'driver_advance', 'toll', 'repair', 'penalty', 'other_expense'] } },
      _sum: { debit: true },
    });

    const creditAgg = await prisma.partnerLedger.aggregate({
      where: { partner_id: partnerId, transaction_type: { in: ['booking_income', 'cash', 'online_transfer'] } },
      _sum: { credit: true },
    });

    // Get latest ledger entry for running balance
    const latestLedger = await prisma.partnerLedger.findFirst({
      where: { partner_id: partnerId },
      orderBy: { created_at: 'desc' },
      select: { running_balance: true },
    });

    // Pending settlements
    const pendingSettlements = await prisma.settlement.count({
      where: {
        partner_id: partnerId,
        status: { in: ['pending', 'partially_paid'] },
      },
    });

    // Fuel advance total
    const fuelAdvanceAgg = await prisma.partnerLedger.aggregate({
      where: { partner_id: partnerId, transaction_type: 'fuel_advance' },
      _sum: { debit: true },
    });

    return {
      partner,
      totalBookings,
      activeBookings,
      completedBookings,
      cancelledBookings,
      totalRevenue: revenueAgg._sum.final_price || 0,
      commissionEarned: commissionAgg._sum.commission_amount || 0,
      outstandingBalance: latestLedger?.running_balance || 0,
      advanceGiven: (debitAgg._sum.debit || 0),
      fuelAdvance: fuelAdvanceAgg._sum.debit || 0,
      pendingSettlements,
      totalCredit: creditAgg._sum.credit || 0,
      totalDebit: debitAgg._sum.debit || 0,
    };
  }

  /**
   * Get partner stats for admin dashboard
   */
  async getPartnerStats() {
    const [total, active, inactive, suspended] = await Promise.all([
      prisma.partner.count({ where: { deleted_at: null } }),
      prisma.partner.count({ where: { status: 'active', deleted_at: null } }),
      prisma.partner.count({ where: { status: 'inactive', deleted_at: null } }),
      prisma.partner.count({ where: { status: 'suspended', deleted_at: null } }),
    ]);

    // Total outstanding across all partners
    const latestLedgers = await prisma.partnerLedger.groupBy({
      by: ['partner_id'],
      _max: { running_balance: true },
    });

    const totalOutstanding = latestLedgers.reduce((sum, l) => sum + (l._max.running_balance || 0), 0);

    // Pending settlements count
    const pendingSettlements = await prisma.settlement.count({
      where: { status: { in: ['pending', 'partially_paid'] } },
    });

    return {
      total,
      active,
      inactive,
      suspended,
      totalOutstanding,
      pendingSettlements,
    };
  }

  // ============================
  // TRUCK OPERATIONS
  // ============================

  /**
   * Get trucks for a partner
   */
  async getTrucks(partnerId) {
    return await prisma.transportVehicle.findMany({
      where: { partner_id: partnerId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Add a truck to a partner
   */
  async addTruck(partnerId, data, tx = null) {
    const client = tx || prisma;
    return await client.transportVehicle.create({
      data: {
        ...data,
        partner_id: partnerId,
        driver_id: data.driver_id || null,
      },
    });
  }

  /**
   * Update a truck
   */
  async updateTruck(truckId, data, tx = null) {
    const client = tx || prisma;
    return await client.transportVehicle.update({
      where: { vehicle_id: truckId },
      data,
    });
  }

  /**
   * Remove a truck (soft - set partner_id to null)
   */
  async removeTruck(truckId, tx = null) {
    const client = tx || prisma;
    return await client.transportVehicle.update({
      where: { vehicle_id: truckId },
      data: { partner_id: null },
    });
  }

  // ============================
  // LEDGER OPERATIONS
  // ============================

  /**
   * Record a ledger transaction (immutable)
   */
  async createLedgerEntry(data, tx = null) {
    const client = tx || prisma;

    // Get current running balance
    const lastEntry = await client.partnerLedger.findFirst({
      where: { partner_id: data.partner_id },
      orderBy: { created_at: 'desc' },
      select: { running_balance: true },
    });

    const currentBalance = lastEntry?.running_balance || 0;
    const debitAmount = data.debit || 0;
    const creditAmount = data.credit || 0;
    const runningBalance = currentBalance + debitAmount - creditAmount;

    return await client.partnerLedger.create({
      data: {
        ...data,
        running_balance: runningBalance,
        debit: debitAmount,
        credit: creditAmount,
      },
    });
  }

  /**
   * Get ledger entries for a partner
   */
  async getLedger(partnerId, filters = {}) {
    const { page = 1, limit = 50, from_date, to_date, transaction_type } = filters;
    const skip = (page - 1) * limit;

    const where = { partner_id: partnerId };
    if (from_date || to_date) {
      where.date = {};
      if (from_date) where.date.gte = new Date(from_date);
      if (to_date) where.date.lte = new Date(to_date);
    }
    if (transaction_type) {
      where.transaction_type = transaction_type;
    }

    const [entries, total] = await Promise.all([
      prisma.partnerLedger.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.partnerLedger.count({ where }),
    ]);

    // Get running balance summary
    const debitAgg = await prisma.partnerLedger.aggregate({
      where: { partner_id: partnerId },
      _sum: { debit: true },
    });

    const creditAgg = await prisma.partnerLedger.aggregate({
      where: { partner_id: partnerId },
      _sum: { credit: true },
    });

    return {
      entries,
      summary: {
        totalDebit: debitAgg._sum.debit || 0,
        totalCredit: creditAgg._sum.credit || 0,
        balance: (debitAgg._sum.debit || 0) - (creditAgg._sum.credit || 0),
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  // ============================
  // PAYMENT OPERATIONS
  // ============================

  /**
   * Record a payment to partner
   */
  async createPayment(data, tx = null) {
    const client = tx || prisma;
    return await client.partnerPayment.create({ data });
  }

  /**
   * Get payments for a partner
   */
  async getPayments(partnerId, filters = {}) {
    const { page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.partnerPayment.findMany({
        where: { partner_id: partnerId },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.partnerPayment.count({ where: { partner_id: partnerId } }),
    ]);

    return {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  // ============================
  // SETTLEMENT OPERATIONS
  // ============================

  /**
   * Create a settlement
   */
  async createSettlement(data, tx = null) {
    const client = tx || prisma;
    return await client.settlement.create({ data });
  }

  /**
   * Get settlements for a partner
   */
  async getSettlements(partnerId, filters = {}) {
    const { page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const [settlements, total] = await Promise.all([
      prisma.settlement.findMany({
        where: { partner_id: partnerId },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.settlement.count({ where: { partner_id: partnerId } }),
    ]);

    return {
      settlements,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Update settlement status
   */
  async updateSettlementStatus(settlementId, status, tx = null) {
    const client = tx || prisma;
    const updateData = { status };
    if (status === 'locked') {
      updateData.locked_at = new Date();
    }
    if (status === 'paid') {
      updateData.settled_at = new Date();
    }
    return await client.settlement.update({
      where: { settlement_id: settlementId },
      data: updateData,
    });
  }

  /**
   * Check if settlement exists for partner/month/year
   */
  async findSettlementByMonth(partnerId, month, year) {
    return await prisma.settlement.findFirst({
      where: {
        partner_id: partnerId,
        month,
        year,
      },
    });
  }

  /**
   * Get bookings for settlement calculation
   */
  async getBookingsForSettlement(partnerId, month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    return await prisma.booking.findMany({
      where: {
        partner_id: partnerId,
        status: { in: ['delivered', 'completed'] },
        delivered_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  /**
   * Update multiple bookings with settlement ID
   */
  async updateBookingsSettlement(bookingIds, settlementId, tx = null) {
    const client = tx || prisma;
    return await client.booking.updateMany({
      where: { booking_id: { in: bookingIds } },
      data: {
        settlement_id: settlementId,
        settlement_status: 'settled',
      },
    });
  }

  // ============================
  // DOCUMENT OPERATIONS
  // ============================

  async getDocuments(partnerId) {
    return await prisma.partnerDocument.findMany({
      where: { partner_id: partnerId },
      orderBy: { created_at: 'desc' },
    });
  }

  async createDocument(data, tx = null) {
    const client = tx || prisma;
    return await client.partnerDocument.create({ data });
  }

  async deleteDocument(documentId, tx = null) {
    const client = tx || prisma;
    return await client.partnerDocument.delete({
      where: { document_id: documentId },
    });
  }

  // ============================
  // DRIVER ASSIGNMENT
  // ============================

  async assignDriverToPartner(driverId, partnerId, assignedBy, tx = null) {
    const client = tx || prisma;

    // Update driver's current partner
    await client.driver.update({
      where: { driver_id: driverId },
      data: { partner_id: partnerId },
    });

    // Create assignment record
    return await client.driverAssignment.create({
      data: {
        driver_id: driverId,
        partner_id: partnerId,
        assigned_by: assignedBy,
        status: 'active',
      },
    });
  }

  async unassignDriverFromPartner(driverId, partnerId, tx = null) {
    const client = tx || prisma;

    // Remove partner reference from driver
    await client.driver.update({
      where: { driver_id: driverId },
      data: { partner_id: null },
    });

    // Update assignment record
    await client.driverAssignment.updateMany({
      where: {
        driver_id: driverId,
        partner_id: partnerId,
        status: 'active',
      },
      data: {
        status: 'inactive',
        unassigned_at: new Date(),
      },
    });
  }

  async getDriverAssignmentHistory(driverId) {
    return await prisma.driverAssignment.findMany({
      where: { driver_id: driverId },
      include: {
        partner: {
          select: {
            partner_id: true,
            partner_code: true,
            partner_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getPartnerDrivers(partnerId) {
    return await prisma.driver.findMany({
      where: { partner_id: partnerId },
      select: {
        driver_id: true,
        driver_code: true,
        driver_name: true,
        mobile: true,
        status: true,
        is_available: true,
        total_deliveries: true,
        rating: true,
        performance_rating: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ============================
  // OWNER MODULE ENHANCEMENTS
  // ============================

  /**
   * Get today's assigned trips for a specific partner or all partners
   */
  async getTodayAssignedTrips(partnerId = null) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const where = {
      created_at: { gte: todayStart, lte: todayEnd },
      status: { notIn: ['cancelled', 'completed', 'delivered'] },
    };

    if (partnerId) {
      where.partner_id = partnerId;
    }

    return await prisma.booking.count({ where });
  }

  /**
   * Get owner stats for admin dashboard (enhanced with today's trips)
   */
  async getOwnerStats() {
    const [total, active, inactive, suspended] = await Promise.all([
      prisma.partner.count({ where: { deleted_at: null } }),
      prisma.partner.count({ where: { status: 'active', deleted_at: null } }),
      prisma.partner.count({ where: { status: 'inactive', deleted_at: null } }),
      prisma.partner.count({ where: { status: 'suspended', deleted_at: null } }),
    ]);

    // Total outstanding across all partners
    const latestLedgers = await prisma.partnerLedger.groupBy({
      by: ['partner_id'],
      _max: { running_balance: true },
    });

    const totalOutstanding = latestLedgers.reduce((sum, l) => sum + (l._max.running_balance || 0), 0);

    // Today's assigned trips across all partners
    const todayTrips = await this.getTodayAssignedTrips();

    return {
      total,
      active,
      inactive,
      suspended,
      totalOutstanding,
      todayAssignedTrips: todayTrips,
    };
  }

  /**
   * Get bookings for an owner with status filter
   */
  async getOwnerBookings(partnerId, filters = {}) {
    const { page = 1, limit = 20, status = '', sort_by = 'created_at', sort_order = 'desc' } = filters;
    const skip = (page - 1) * limit;

    const where = { partner_id: partnerId };
    if (status) {
      where.status = status;
    }

    const allowedSortFields = ['created_at', 'pickup_date', 'final_price', 'status'];
    const field = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const order = sort_order === 'asc' ? 'asc' : 'desc';

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          driver: {
            select: {
              driver_id: true,
              driver_code: true,
              driver_name: true,
              mobile: true,
            },
          },
          vehicle: {
            select: {
              vehicle_id: true,
              vehicle_number: true,
              vehicle_type: true,
            },
          },
        },
        orderBy: { [field]: order },
        skip,
        take: parseInt(limit),
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get commission summary for an owner
   */
  async getCommissionSummary(partnerId) {
    const partner = await prisma.partner.findUnique({
      where: { partner_id: partnerId },
      select: {
        commission_percentage: true,
        commission_type: true,
        fixed_commission: true,
      },
    });

    if (!partner) return null;

    // Total commission from completed bookings
    const commissionAgg = await prisma.booking.aggregate({
      where: {
        partner_id: partnerId,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { commission_amount: true },
    });

    // Total revenue
    const revenueAgg = await prisma.booking.aggregate({
      where: {
        partner_id: partnerId,
        status: { in: ['delivered', 'completed'] },
      },
      _sum: { final_price: true },
    });

    // Current outstanding from ledger
    const latestLedger = await prisma.partnerLedger.findFirst({
      where: { partner_id: partnerId },
      orderBy: { created_at: 'desc' },
      select: { running_balance: true },
    });

    return {
      commissionPercentage: partner.commission_percentage,
      commissionType: partner.commission_type,
      fixedCommission: partner.fixed_commission,
      totalCommission: commissionAgg._sum.commission_amount || 0,
      totalRevenue: revenueAgg._sum.final_price || 0,
      outstandingBalance: latestLedger?.running_balance || 0,
    };
  }
}

module.exports = PartnerRepository;

