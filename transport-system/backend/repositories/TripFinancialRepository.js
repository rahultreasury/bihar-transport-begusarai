/**
 * TripFinancialRepository
 * Database-only repository for TripFinancial model.
 */

const { prisma } = require('../config/prisma');
const { NotFoundError } = require('../utils/AppError');

class TripFinancialRepository {
  /**
   * @param {Object} [tx] - Optional Prisma transaction client
   */
  _client(tx = null) {
    return tx || prisma;
  }

  /**
   * Create a trip financial record.
   * @param {Object} data
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async create(data, tx = null) {
    const client = this._client(tx);
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
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findByBookingId(bookingId, tx = null) {
    const client = this._client(tx);
    return await client.tripFinancial.findUnique({
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
        trip: { select: { trip_id: true, trip_number: true, pickup_city: true, drop_city: true } },
        advances: { orderBy: { given_at: 'desc' } },
        settlements: true,
        commissions: { orderBy: { applied_at: 'desc' } },
        transactions: { orderBy: { transaction_date: 'desc' } },
      },
    });
  }

  /**
   * Find trip financial by ID.
   * @param {number} tripFinancialId
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findById(tripFinancialId, tx = null) {
    const client = this._client(tx);
    return await client.tripFinancial.findUnique({
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
    const client = this._client(tx);
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
    const client = this._client(tx);
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
        customer_fare: 0,
      },
    });
  }

  /**
   * Find or create trip financial for a trip (standalone trip support).
   * @param {number} tripId
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object>}
   */
  async findOrCreateByTripId(tripId, tx = null) {
    const client = this._client(tx);

    // Check if a trip financial already exists linked to this trip
    const existing = await client.tripFinancial.findFirst({
      where: { trip_id: tripId },
    });

    if (existing) {
      return existing;
    }

    // Get trip to find booking_id (if any)
    const trip = await client.trip.findUnique({
      where: { trip_id: tripId },
      select: { trip_id: true, booking_id: true, freight_amount: true, source_type: true, client_id: true },
    });

    return await client.tripFinancial.create({
      data: {
        booking_id: trip?.booking_id || null,
        trip_id: tripId,
        status: 'DRAFT',
        customer_fare: trip?.freight_amount || 0,
      },
    });
  }

  /**
   * Find trip financial by trip ID.
   * @param {number} tripId
   * @param {Object} tx - Optional Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findByTripId(tripId, tx = null) {
    const client = this._client(tx);
    return await client.tripFinancial.findFirst({
      where: { trip_id: tripId },
      include: {
        advances: { orderBy: { given_at: 'desc' } },
        settlements: true,
        transactions: { orderBy: { transaction_date: 'desc' } },
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
              user: { select: { user_id: true, first_name: true, last_name: true } },
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
