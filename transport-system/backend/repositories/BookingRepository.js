/**
 * BookingRepository
 * Database-only repository for interacting with the `bookings` table.
 *
 * Notes:
 * - Uses the sqlite connection exported from ../config/database.js.
 * - Parameterized SQL only.
 * - No business logic, validation, or HTTP/Express dependencies.
 */

const { query, run, get } = require('../config/database');

/**
 * @typedef {Object} BookingSearchFilters
 * @property {string=} status
 * @property {number=} userId
 * @property {number=} driverId
 * @property {string=} bookingReference
 * @property {string=} pickupCity
 * @property {string=} dropCity
 * @property {string=} dateFrom - ISO date (YYYY-MM-DD) or sqlite-compatible date
 * @property {string=} dateTo - ISO date (YYYY-MM-DD) or sqlite-compatible date
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
   * @param {number|boolean=} data.fragile
   * @param {string} data.vehicle_type_required
   * @param {number=} data.estimated_distance_km
   * @param {number=} data.estimated_price
   * @param {number=} data.final_price
   * @param {string=} data.status
   * @param {string=} data.booking_number
   * @returns {Promise<{booking_id:number}>}
   */
  async create(data, tx = null) {
    const fields = [
      'booking_reference',
      'booking_number',
      'user_id',
      'driver_id',
      'vehicle_id',
      'pickup_location',
      'pickup_address',
      'pickup_city',
      'pickup_state',
      'pickup_pincode',
      'pickup_date',
      'pickup_time',
      'drop_location',
      'drop_address',
      'drop_city',
      'drop_state',
      'drop_pincode',
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
      'status'
    ];

    // Build insert list using only provided keys (keeps backward compatibility).
    const keys = [];
    const values = [];
    const placeholders = [];

    for (const k of fields) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        keys.push(k);
        values.push(data[k]);
        placeholders.push('?');
      }
    }

    if (keys.length === 0) throw new Error('BookingRepository.create: no fields provided');

    const sql = `INSERT INTO bookings (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`;
    try {
      const runner = tx?.run ?? run;
      const result = await runner(sql, values);
      return { booking_id: result.lastID };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get a booking by numeric primary key.
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async findById(bookingId, tx = null) {
    try {
      const getter = tx?.get ?? get;
      return await getter(
        'SELECT booking_id, booking_reference, booking_number, user_id, driver_id, vehicle_id, pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode, pickup_date, pickup_time, drop_location, drop_address, drop_city, drop_state, drop_pincode, goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile, vehicle_type_required, estimated_distance_km, estimated_price, final_price, status, created_at, updated_at, confirmed_at, driver_assigned_at, pickup_completed_at, delivered_at FROM bookings WHERE booking_id = ?',
        [bookingId]
      );
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get a booking by booking_reference.
   * @param {string} bookingReference
   * @returns {Promise<Object|null>}
   */
  async findByReference(bookingReference, tx = null) {
    try {
      const getter = tx?.get ?? get;
      return await getter(
        'SELECT booking_id, booking_reference, booking_number, user_id, driver_id, vehicle_id, pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode, pickup_date, pickup_time, drop_location, drop_address, drop_city, drop_state, drop_pincode, goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile, vehicle_type_required, estimated_distance_km, estimated_price, final_price, status, created_at, updated_at, confirmed_at, driver_assigned_at, pickup_completed_at, delivered_at FROM bookings WHERE booking_reference = ?',
        [bookingReference]
      );
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update a booking row by id.
   * @param {number} bookingId
   * @param {Object} data - partial fields to update
   * @returns {Promise<{changes:number}>}
   */
  async update(bookingId, data, tx = null) {
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
      'booking_number'
    ];

    const keys = Object.keys(input).filter(k => allowedFields.includes(k));

    // Ignore unknown fields to preserve repository contracts.
    if (keys.length === 0) {
      throw new Error('BookingRepository.update: no allowed fields provided');
    }

    const setClause = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => input[k]);

    const sql = `UPDATE bookings SET ${setClause} WHERE booking_id = ?`;
    values.push(bookingId);

    try {
      const runner = tx?.run ?? run;
      const result = await runner(sql, values);
      return { changes: result.changes };
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
    const safeFilters = filters || {};
    let where = '1=1';
    const params = [];


    if (filters.status) {
      where += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.userId) {
      where += ' AND user_id = ?';
      params.push(filters.userId);
    }
    if (filters.driverId) {
      where += ' AND driver_id = ?';
      params.push(filters.driverId);
    }
    if (filters.bookingReference) {
      where += ' AND booking_reference = ?';
      params.push(filters.bookingReference);
    }
    if (filters.pickupCity) {
      where += ' AND pickup_city LIKE ?';
      params.push(`%${filters.pickupCity}%`);
    }
    if (filters.dropCity) {
      where += ' AND drop_city LIKE ?';
      params.push(`%${filters.dropCity}%`);
    }
    if (filters.dateFrom) {
      where += ' AND DATE(pickup_date) >= DATE(?)';
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      where += ' AND DATE(pickup_date) <= DATE(?)';
      params.push(filters.dateTo);
    }

    const maxLimit = 100;
    const limit = Math.min(Number(filters.limit ?? 50), maxLimit);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const sql = `SELECT booking_id, booking_reference, booking_number, user_id, driver_id, vehicle_id, pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode, pickup_date, pickup_time, drop_location, drop_address, drop_city, drop_state, drop_pincode, goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile, vehicle_type_required, estimated_distance_km, estimated_price, final_price, status, created_at, updated_at, confirmed_at, driver_assigned_at, pickup_completed_at, delivered_at
                 FROM bookings
                 WHERE ${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`;

    try {
      const runner = tx?.query ?? query;
      return await runner(sql, [...params, limit, offset]);
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
      return await query(
        'SELECT booking_id, booking_reference, booking_number, user_id, driver_id, vehicle_id, pickup_location, pickup_address, pickup_city, pickup_state, pickup_pincode, pickup_date, pickup_time, drop_location, drop_address, drop_city, drop_state, drop_pincode, goods_description, goods_type, goods_weight_kg, goods_volume, number_of_items, fragile, vehicle_type_required, estimated_distance_km, estimated_price, final_price, status, created_at, updated_at, confirmed_at, driver_assigned_at, pickup_completed_at, delivered_at FROM bookings ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
    } catch (err) {
      throw err;
    }
  }

  /**
   * Delete a booking by id.
   * Note: existing DB uses deliveries.booking_id as UNIQUE, and routes delete deliveries first.
   * Repository does NOT enforce any ordering; callers can manage ordering if needed.
   * @param {number} bookingId
   * @returns {Promise<{changes:number}>}
   */
  async delete(bookingId) {
    try {
      const result = await run('DELETE FROM bookings WHERE booking_id = ?', [bookingId]);
      return { changes: result.changes };
    } catch (err) {
      throw err;
    }
  }
}

module.exports = BookingRepository;

