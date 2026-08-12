/**
 * BookingRepository
 * Database-only repository for interacting with the `bookings` table.
 *
 * Uses Prisma Client for all database operations.
 * Accepts an optional Prisma transaction client (`tx`) for interactive transactions.
 */

const { prisma } = require('../config/prisma');
const { NotFoundError } = require('../utils/AppError');
const { flattenBooking, flattenBookingAdminDetail, flattenBookingForDriver } = require('../utils/BookingMapper');

/**
 * Shared Prisma `include` shape for fetching a booking with its relations.
 */
const BookingInclude = {
  user: {
    select: {
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
      address: true,
    },
  },
  driver: {
    select: {
      driver_id: true,
      user_id: true,
      driver_name: true,
      mobile: true,
      license_number: true,
      rating: true,
      total_deliveries: true,
      profile_image: true,
      user: {
        select: {
          first_name: true,
          last_name: true,
          phone: true,
        },
      },
    },
  },
  vehicle: {
    select: {
      vehicle_id: true,
      vehicle_number: true,
      vehicle_name: true,
      vehicle_type: true,
      capacity_kg: true,
      capacity_volume: true,
      vehicle_make: true,
      vehicle_model: true,
      current_status: true,
    },
  },
  delivery: {
    select: {
      current_status: true,
      status_description: true,
      estimated_pickup_time: true,
      estimated_delivery_time: true,
      actual_pickup_time: true,
      actual_delivery_time: true,
      delivery_otp: true,
      otp_verified: true,
      recipient_name: true,
      delivery_notes: true,
    },
  },
};

class BookingRepository {
  /**
   * Create a new booking row.
   *
   * Canonical booking-number logic:
   *   - The booking_number (BTB-YYYY-NNNNN) is DERIVED from the DB primary
   *     key (booking_id) by BookingNumberService. It is the single canonical
   *     customer/admin-facing identifier. It is NEVER random and NEVER
   *     generated in the frontend.
   *   - booking_reference is kept as a legacy/backward-compatible alias. For
   *     new bookings it mirrors booking_number so tracking/email/WhatsApp
   *     links continue to work uniformly.
   *
   * @param {Object} data
   * @param {string=} tx - Prisma transaction client
   * @returns {Promise<{booking_id: number}>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    // booking_number is required by the schema but the canonical BTB-YYYY-NNNNN
    // is derived from the auto-increment PK after creation. Generate a temporary
    // unique placeholder here; BookingService.createBooking updates it atomically.
    const tempBookingNumber = data.booking_number || `TEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const booking = await client.booking.create({
      data: {
        booking_reference: data.booking_reference || tempBookingNumber,
        booking_number: tempBookingNumber,
        user: {
          connect: {
            user_id: data.user_id,
          },
        },
        driver: data.driver_id ? { connect: { driver_id: data.driver_id } } : undefined,
        vehicle: data.vehicle_id ? { connect: { vehicle_id: data.vehicle_id } } : undefined,
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
        quote_status: data.quote_status || 'PENDING',
        confirmation_source: data.confirmation_source || null,
        quote_remarks: data.quote_remarks != null ? data.quote_remarks : null,
        quote_sent_at: data.quote_sent_at || null,
        quote_accepted_at: data.quote_accepted_at || null,
      },
    });
    return { booking_id: booking.booking_id };
  }

  /**
   * Get a booking by numeric primary key.
   * @param {number} bookingId
   * @param {string=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findById(bookingId, tx = null) {
    const client = tx || prisma;
    return await client.booking.findUnique({
      where: { booking_id: bookingId },
    });
  }

  /**
   * Get a booking by booking_reference.
   * @param {string} bookingReference
   * @param {string=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async findByReference(bookingReference, tx = null) {
    const client = tx || prisma;
    return await client.booking.findUnique({
      where: { booking_reference: bookingReference },
    });
  }

  /**
   * Get a booking by its CANONICAL booking_number (BTB-YYYY-NNNNN) OR its
   * legacy booking_reference alias. This is the single lookup used by
   * admin read-only detail / assign pages and the public tracking page so
   * the system never silently accepts unrelated identifier formats.
   *
   * @param {string} identifier - canonical booking_number or legacy reference
   * @returns {Promise<Object|null>} booking with full relations
   */
  async findByIdentifier(identifier) {
    if (!identifier || typeof identifier !== 'string') return null;
    const value = String(identifier).trim();
    return await prisma.booking.findFirst({
      where: {
        OR: [
          { booking_number: value },
          { booking_reference: value },
        ],
      },
      include: BookingInclude,
    });
  }

  /**
   * Update a booking row by id.
   * @param {number} bookingId
   * @param {Object} data - partial fields to update
   * @param {string=} tx - Prisma transaction client
   * @returns {Promise<{changes: number}>}
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
      'quote_status',
      'confirmation_source',
      'quote_remarks',
      'quote_sent_at',
      'quote_accepted_at',
      'quote_rejected_at',
      'quote_valid_until',
      'confirmed_at',
      'driver_assigned_at',
      'pickup_completed_at',
      'delivered_at',
      'driver_id',
      'vehicle_id',
      'booking_reference',
      'booking_number',
      'driver_name_snapshot',
      'truck_number_snapshot',
      'partner_name_snapshot',
      'mobile_snapshot',
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        updateData[key] = input[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error('BookingRepository.update: no allowed fields provided');
    }

    const result = await client.booking.update({
      where: { booking_id: bookingId },
      data: updateData,
    });
    return { changes: result ? 1 : 0 };
  }

  /**
   * Search bookings with optional filters.
   * @param {Object} filters
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

    return await prisma.booking.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * List bookings with pagination.
   * @param {number=} limit
   * @param {number=} offset
   * @returns {Promise<Object[]>}
   */
  async list(limit = 20, offset = 0) {
    return await prisma.booking.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * List bookings with filters, pagination, sorting, and full relation data.
   * @param {Object} filters - validated query params
   * @returns {Promise<{data: Object[], pagination: Object}>}
   */
  async listBookings(filters = {}) {
    const where = {};

    // By default, exclude archived bookings from the active list.
    // Pass ?archived=true to view archived records.
    if (filters.archived) {
      where.archived_at = { not: null };
    } else {
      where.archived_at = null;
    }

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.driver_id) {
      where.driver_id = Number(filters.driver_id);
    }
    if (filters.goods_type) {
      where.goods_type = { contains: String(filters.goods_type), mode: 'insensitive' };
    }
    if (filters.pickup_city) {
      where.pickup_city = { contains: String(filters.pickup_city), mode: 'insensitive' };
    }
    if (filters.drop_city) {
      where.drop_city = { contains: String(filters.drop_city), mode: 'insensitive' };
    }
    if (filters.search) {
      const term = String(filters.search);
      where.OR = [
        { booking_reference: { contains: term, mode: 'insensitive' } },
        { pickup_city: { contains: term, mode: 'insensitive' } },
        { drop_city: { contains: term, mode: 'insensitive' } },
        { goods_description: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (filters.date_from || filters.date_to) {
      where.pickup_date = {};
      if (filters.date_from) where.pickup_date.gte = filters.date_from;
      if (filters.date_to) where.pickup_date.lte = filters.date_to;
    }
    if (filters.price_min !== '' && filters.price_min != null) {
      where.final_price = { ...(where.final_price || {}), gte: Number(filters.price_min) };
    }
    if (filters.price_max !== '' && filters.price_max != null) {
      where.final_price = { ...(where.final_price || {}), lte: Number(filters.price_max) };
    }

    const sortField = filters.sort_by || 'created_at';
    const sortOrder = filters.sort_order === 'asc' ? 'asc' : 'desc';
    const allowedSortFields = ['created_at', 'pickup_date', 'final_price', 'status', 'booking_reference'];
    const orderByField = allowedSortFields.includes(sortField) ? sortField : 'created_at';
    const orderBy = { [orderByField]: sortOrder };

    const page = Number(filters.page) || 1;
    const limit = Math.min(Number(filters.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: BookingInclude,
        orderBy,
        take: limit,
        skip,
      }),
      prisma.booking.count({ where }),
    ]);

    const data = bookings.map(flattenBooking);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 0,
      },
    };
  }

  /**
   * Get a booking by id with full relations (for admin detail view).
   * @param {number} bookingId
   * @returns {Promise<Object|null>}
   */
  async findByIdWithRelations(bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { booking_id: bookingId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
            address: true,
          },
        },
        driver: {
          select: {
            driver_id: true,
            user_id: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
          },
        },
        delivery: {
          select: {
            current_status: true,
            status_description: true,
          },
        },
      },
    });

    if (!booking) return null;
    return flattenBookingAdminDetail(booking);
  }

  /**
   * Get bookings for a user.
   * @param {number} userId
   * @returns {Promise<Object[]>}
   */
  async findByUserId(userId) {
    const bookings = await prisma.booking.findMany({
      where: { user_id: userId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
        driver: {
          select: {
            license_number: true,
            rating: true,
            total_deliveries: true,
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return bookings.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      booking_number: b.booking_number,
      user_id: b.user_id,
      driver_id: b.driver_id,
      pickup_location: b.pickup_location,
      pickup_address: b.pickup_address,
      pickup_city: b.pickup_city,
      pickup_state: b.pickup_state,
      pickup_pincode: b.pickup_pincode,
      pickup_date: b.pickup_date,
      pickup_time: b.pickup_time,
      drop_location: b.drop_location,
      drop_address: b.drop_address,
      drop_city: b.drop_city,
      drop_state: b.drop_state,
      drop_pincode: b.drop_pincode,
      goods_description: b.goods_description,
      goods_type: b.goods_type,
      goods_weight_kg: b.goods_weight_kg,
      goods_volume: b.goods_volume,
      number_of_items: b.number_of_items,
      fragile: b.fragile,
      vehicle_type_required: b.vehicle_type_required,
      estimated_distance_km: b.estimated_distance_km,
      estimated_price: b.estimated_price,
      final_price: b.final_price,
      status: b.status,
      created_at: b.created_at,
      updated_at: b.updated_at,
      confirmed_at: b.confirmed_at,
      driver_assigned_at: b.driver_assigned_at,
      pickup_completed_at: b.pickup_completed_at,
      delivered_at: b.delivered_at,
      customer_first_name: b.user?.first_name ?? null,
      customer_last_name: b.user?.last_name ?? null,
      customer_phone: b.user?.phone ?? null,
      driver_first_name: b.driver?.user?.first_name ?? null,
      driver_last_name: b.driver?.user?.last_name ?? null,
      driver_phone: b.driver?.user?.phone ?? null,
      vehicle_number: b.truck_number_snapshot ?? null,
      vehicle_type: null,
      vehicle_name: null,
    }));
  }

  /**
   * Get current user's bookings with delivery info.
   * @param {number} userId
   * @returns {Promise<Object[]>}
   */
  async findMyBookings(userId) {
    const bookings = await prisma.booking.findMany({
      where: { user_id: userId },
      include: {
        delivery: {
          select: {
            current_status: true,
            status_description: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return bookings.map((b) => ({
      booking_id: b.booking_id,
      booking_reference: b.booking_reference,
      booking_number: b.booking_number,
      user_id: b.user_id,
      driver_id: b.driver_id,
      pickup_location: b.pickup_location,
      pickup_address: b.pickup_address,
      pickup_city: b.pickup_city,
      pickup_state: b.pickup_state,
      pickup_pincode: b.pickup_pincode,
      pickup_date: b.pickup_date,
      pickup_time: b.pickup_time,
      drop_location: b.drop_location,
      drop_address: b.drop_address,
      drop_city: b.drop_city,
      drop_state: b.drop_state,
      drop_pincode: b.drop_pincode,
      goods_description: b.goods_description,
      goods_type: b.goods_type,
      goods_weight_kg: b.goods_weight_kg,
      goods_volume: b.goods_volume,
      number_of_items: b.number_of_items,
      fragile: b.fragile,
      vehicle_type_required: b.vehicle_type_required,
      estimated_distance_km: b.estimated_distance_km,
      estimated_price: b.estimated_price,
      final_price: b.final_price,
      status: b.status,
      created_at: b.created_at,
      updated_at: b.updated_at,
      confirmed_at: b.confirmed_at,
      driver_assigned_at: b.driver_assigned_at,
      pickup_completed_at: b.pickup_completed_at,
      delivered_at: b.delivered_at,
      vehicle_number: b.truck_number_snapshot ?? null,
      vehicle_type: null,
      vehicle_name: null,
      current_status: b.delivery?.current_status ?? null,
      status_description: b.delivery?.status_description ?? null,
    }));
  }

  /**
   * Get available jobs for a driver based on their vehicle types.
   * Only bookings that are still pending (no quote sent yet) and have no
   * active quote in flight are shown to drivers. This prevents drivers from
   * seeing jobs that are awaiting customer quote approval.
   * @param {number} driverId
   * @param {string[]} vehicleTypes
   * @returns {Promise<Object[]>}
   */
  async findAvailableJobs(driverId, vehicleTypes) {
    const jobs = await prisma.booking.findMany({
      where: {
        status: 'pending',
        quote_status: 'PENDING',
        vehicle_type_required: { in: vehicleTypes },
      },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
          },
        },
        vehicle: {
          select: {
            vehicle_id: true,
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
            capacity_kg: true,
            per_km_rate: true,
          },
        },
      },
      orderBy: [
        { pickup_date: 'asc' },
        { pickup_time: 'asc' },
      ],
    });

    return jobs.map(flattenBookingForDriver);
  }

  /**
   * Get driver's current jobs.
   * @param {number} driverId
   * @returns {Promise<Object[]>}
   */
  async findDriverJobs(driverId) {
    const jobs = await prisma.booking.findMany({
      where: { driver_id: driverId },
      include: {
        user: {
          select: {
            first_name: true,
            last_name: true,
            phone: true,
            address: true,
          },
        },
        vehicle: {
          select: {
            vehicle_number: true,
            vehicle_name: true,
            vehicle_type: true,
            vehicle_make: true,
            vehicle_model: true,
          },
        },
        delivery: {
          select: {
            current_status: true,
            status_description: true,
            estimated_pickup_time: true,
            estimated_delivery_time: true,
            actual_pickup_time: true,
            actual_delivery_time: true,
            delivery_otp: true,
          },
        },
      },
    });

    const statusOrder = {
      confirmed: 1,
      pickup_started: 2,
      pickup_completed: 3,
      in_transit: 4,
      out_for_delivery: 5,
      delivered: 6,
    };
    const sorted = [...jobs].sort((a, b) => {
      const aOrder = statusOrder[a.status] || 10;
      const bOrder = statusOrder[b.status] || 10;
      return aOrder - bOrder;
    });

    return sorted.map(flattenBookingForDriver);
  }

  /**
   * Get a booking by id for driver status updates.
   * @param {number} bookingId
   * @param {number} driverId
   * @returns {Promise<Object|null>}
   */
  async findByIdForDriver(bookingId, driverId) {
    return await prisma.booking.findFirst({
      where: {
        booking_id: bookingId,
        driver_id: driverId,
      },
      select: {
        booking_id: true,
        vehicle_id: true,
        status: true,
      },
    });
  }
}

module.exports = BookingRepository;
