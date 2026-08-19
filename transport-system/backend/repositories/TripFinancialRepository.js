/**
 * TripFinancialRepository
 * Database-only repository for TripFinancial model.
 */

const { prisma } = require('../config/prisma');
const { NotFoundError } = require('../utils/AppError');

class TripFinancialRepository {
  /**
   * Create a trip financial record.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    return await client.tripFinancial.create({
      data,
      include: {
        booking: {
          include: {
            user: { select: { first_name: true, last_name: true, phone: true } },
            driver: { select: { driver_id: true, driver_name: true, mobile: true } },
            vehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } },
            vehicleOwner: { select: { owner_id: true, owner_name: true, company_name: true } },
          },
        },
      },
    });
  }

  /**
   * Find trip financial by booking ID.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async findByBookingId(bookingId) {
    return await prisma.tripFinancial.findUnique({
      where: { booking_id: bookingId },
      include: {
        booking: {
          include: {
            user: { select: { first_name: true, last_name: true, phone: true } },
            driver: { select: { driver_id: true, driver_name: true, mobile: true } },
            vehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } },
            vehicleOwner: { select: { owner_id: true, owner_name: true, company_name: true } },
          },
        },
        advances: { orderBy: { given_at: 'desc' } },
        settlements: true,
        commissions: { orderBy: { applied_at: 'desc' } },
        transactions: { orderBy: { created_at: 'desc' } },
      },
    });
  }

  /**
   * Find trip financial by ID.
   * @param {number} tripFinancialId
   * @returns {Promise<Object|null>}
   */
  async findById(tripFinancialId) {
    return await prisma.tripFinancial.findUnique({
      where: { trip_financial_id: tripFinancialId },
      include: {
        booking: true,
        advances: { orderBy: { given_at: 'desc' } },
        settlements: true,
        commissions: { orderBy: { applied_at: 'desc' } },
        transactions: { orderBy: { created_at: 'desc' } },
      },
    });
  }

  /**
   * Update trip financial.
   * @param {number} tripFinancialId
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async update(tripFinancialId, data, tx = null) {
    const client = tx || prisma;
    return await client.tripFinancial.update({
      where: { trip_financial_id: tripFinancialId },
      data,
    });
  }

  /**
   * Find or create trip financial for a booking.
   * @param {number} bookingId
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async findOrCreateByBookingId(bookingId, tx = null) {
    const client = tx || prisma;
    const existing = await client.tripFinancial.findUnique({
      where: { booking_id: bookingId },
    });

    if (existing) {
      return existing;
    }

    return await client.tripFinancial.create({
      data: {
        booking_id: bookingId,
        status: 'DRAFT',
      },
    });
  }

  /**
   * List trip financials with filters.
   * @param {Object} filters
   * @returns {Promise<{data: Array, total: number}>}
   */
  async findAll(filters = {}) {
    const where = {};
    if (filters.booking_id) where.booking_id = parseInt(filters.booking_id);
    if (filters.status) where.status = filters.status;
    if (filters.driver_id) {
      where.booking = { driver_id: parseInt(filters.driver_id) };
    }
    if (filters.transport_owner_id) {
      where.booking = { vehicle_owner_id: parseInt(filters.transport_owner_id) };
    }

    const skip = filters.skip || 0;
    const take = filters.take || 20;

    const [data, total] = await Promise.all([
      prisma.tripFinancial.findMany({
        where,
        include: {
          booking: {
            include: {
              user: { select: { first_name: true, last_name: true } },
              driver: { select: { driver_id: true, driver_name: true } },
              vehicle: { select: { vehicle_id: true, vehicle_number: true } },
              vehicleOwner: { select: { owner_id: true, owner_name: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.tripFinancial.count({ where }),
    ]);

    return { data, total };
  }
}

module.exports = TripFinancialRepository;
