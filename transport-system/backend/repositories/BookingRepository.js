/**
 * BookingRepository
 * Database-only repository for interacting with the `bookings` table.
 *
 * Uses Prisma Client for all database operations.
 * Accepts an optional Prisma transaction client (`tx`) for interactive transactions.
 */

const { prisma } = require('../config/prisma');

/**
 * @typedef {Object} BookingSearchFilters
 * @property {string=} status
 * @property {number=} userId
 * @property {number=} driverId
 * @property {string=} bookingReference
 * @property {string=} pickupCity
 * @property {string=} dropCity
 * @property {string=} dateFrom - ISO date (YYYY-MM-DD)
 * @property {string=} dateTo - ISO date (YYYY-MM-DD)
 */

class BookingRepository {
  /**
   * Create a new booking row.
   * @param {Object} data
   * @param {string} data.booking_reference
   * @param {number} data.user_id
   * @param {number=} data.driver_id
   * @param {number=} data.vehicle_id
   * @param {string} data.pickup_location
   * @param {string=} data.pickup_address
   * @param {string} data.pickup_city
   * @param {string=} data.pickup_state
   * @param {string=} data.pickup_pincode
   * @param {string} data.pickup_date
   * @param {string} data.pickup_time
   * @param {string} data.drop_location
   * @param {string=} data.drop_address
   * @param {string} data.drop_city
   * @param {string=} data.drop_state
   * @param {string=} data.drop_pincode
   * @param {string} data.goods_description
   * @param {string=} data.goods_type
   * @param {number=} data.goods_weight_kg
   * @param {number=} data.goods_volume
   * @param {number=} data.number_of_items
   * @param {boolean=} data.fragile
   * @param {string} data.vehicle_type_required
   * @param {number=} data.estimated_distance_km
   * @param {number=} data.estimated_price
   * @param {number=} data.final_price
   * @param {string=} data.status
   * @param {string=} data.booking_number
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{booking_id:number}>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    try {
      const booking = await client.booking.create({
        data: {
          booking_reference: data.booking_reference,
          booking_number: data.booking_number,
          user_id: data.user_id,
          driver_id: data.driver_id || null,
          vehicle_id: data.vehicle_id || null,
          pickup_location: data.pickup_location,
          pickup_address: data.pickup_address || null,
          pickup_city: data.pickup_city,
          pickup_state: data.pickup_state || 'Bihar',
          pickup_pincode: data.pickup_pincode || null,
          pickup_date: data.pickup_date,
          pickup_time: data.pickup_time,
          drop_location: data.drop_location,
          drop_address: data.drop_address || null,
          drop_city: data.drop_city,
          drop_state: data.drop_state || 'Bihar',
          drop_pincode: data.drop_pincode || null,
          goods_description: data.goods_description,
          goods_type: data.goods_type || null,
          goods_weight_kg: data.goods_weight_kg != null ? Number(data.goods_weight_kg) : null,
          goods_volume: data.goods_volume != null ? Number(data.goods_volume) : null,
          number_of_items: data.number_of_items != null ? Number(data.number_of_items) : 1,
          fragile: data.fragile == null ? false : Boolean(data.fragile),
          vehicle_type_required: data.vehicle_type_required,
          estimated_distance_km: data.estimated_distance_km != null ? Number(data.estimated_distance_km) : null,
          estimated_price: data.estimated_price != null ? Number(data.estimated_price) : null,
          final_price: data.final_price != null ? Number(data.final_price) : null,
          status: data.status || 'pending',
        },
      });
      return { booking_id: booking.booking_id };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get a booking by numeric primary key.
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findById(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.booking.findUnique({
        where: { booking_id: bookingId },
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get a booking by booking_reference.
   * @param {string} bookingReference
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findByReference(bookingReference, tx = null) {
    const client = tx || prisma;
    try {
      return await client.booking.findUnique({
        where: { booking_reference: bookingReference },
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update a booking row by id.
   * @param {number} bookingId
   * @param {Object} data - partial fields to update
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{changes:number}>}
   */
  async update(bookingId, data, tx = null) {
    const client = tx || prisma;
    const input = data || {};
    const allowedFields = [
      'pickup_address',
      'drop_address',
      'pickup_city',
      'drop_city',
      'goods_description',
      'goods_type',
      'goods_weight_kg',
      'goods_volume',
      'number_of_items',
      'fragile',
      'vehicle_type_required',
      'estimated_distance_km',
      'estimated_price',
      'final_price',
      'status',
      'confirmed_at',
      'driver_assigned_at',
      'pickup_completed_at',
      'delivered_at',
      'driver_id',
      'vehicle_id',
      'booking_reference',
      'booking_number',
    ];

    // Build update payload with only allowed fields that are present
    const updateData = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        updateData[key] = input[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('BookingRepository.update: no allowed fields provided');
    }

    try {
      const result = await client.booking.update({
        where: { booking_id: bookingId },
        data: updateData,
      });
      return { changes: result ? 1 : 0 };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Search bookings with optional filters.
   * @param {BookingSearchFilters} filters
   * @returns {Promise<Object[]>}
   */
  async search(filters = {}) {
    const where = {};
    const filter = filters || {};

    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.userId) {
      where.user_id = filter.userId;
    }
    if (filter.driverId) {
      where.driver_id = filter.driverId;
    }
    if (filter.bookingReference) {
      where.booking_reference = filter.bookingReference;
    }
    if (filter.pickupCity) {
      where.pickup_city = { contains: filter.pickupCity };
    }
    if (filter.dropCity) {
      where.drop_city = { contains: filter.dropCity };
    }
    if (filter.dateFrom || filter.dateTo) {
      where.pickup_date = {};
      if (filter.dateFrom) {
        where.pickup_date.gte = filter.dateFrom;
      }
      if (filter.dateTo) {
        where.pickup_date.lte = filter.dateTo;
      }
    }

    const maxLimit = 100;
    const limit = Math.min(Number(filter.limit ?? 50), maxLimit);
    const offset = Math.max(Number(filter.offset ?? 0), 0);

    try {
      return await prisma.booking.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * List bookings with pagination.
   * @param {number=} limit
   * @param {number=} offset
   * @returns {Promise<Object[]>}
   */
  async list(limit = 20, offset = 0) {
    try {
      return await prisma.booking.findMany({
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete a booking by id.
   * Prisma cascade will handle related records.
   * @param {number} bookingId
   * @returns {Promise<{changes:number}>}
   */
  async delete(bookingId) {
    try {
      await prisma.booking.delete({
        where: { booking_id: bookingId },
      });
      return { changes: 1 };
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingRepository;

