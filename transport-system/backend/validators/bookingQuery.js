/**
 * Zod validation for booking list query parameters.
 *
 * All query parameters are validated and coerced BEFORE they reach the
 * repository. This guarantees that Prisma only ever receives well-typed,
 * sanitized values — preventing invalid SQL / NaN / type errors that can
 * cause HTTP 500s.
 */

const { z } = require('zod');

// Allowed booking statuses (must match the Booking schema's status values).
const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'driver_assigned',
  'pickup_completed',
  'in_transit',
  'delivered',
  'cancelled',
  'completed',
];

// Allowed sort fields (must be columns that exist on the Booking model).
const SORTABLE_FIELDS = ['created_at', 'pickup_date', 'final_price', 'status', 'booking_reference'];

const bookingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional().default(''),
  search: z.string().trim().max(200).optional().default(''),
  goods_type: z.string().trim().max(100).optional().default(''),
  pickup_city: z.string().trim().max(100).optional().default(''),
  drop_city: z.string().trim().max(100).optional().default(''),
  date_from: z.string().optional().default(''),
  date_to: z.string().optional().default(''),
  price_min: z.coerce.number().nonnegative().optional().default(''),
  price_max: z.coerce.number().nonnegative().optional().default(''),
  sort_by: z.string().optional().default('created_at'),
  sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
  driver_id: z.coerce.number().int().positive().optional().default(''),
  vehicle_id: z.coerce.number().int().positive().optional().default(''),
}).refine((data) => {
  // Validate status against allowed set, if provided.
  if (data.status && !BOOKING_STATUSES.includes(data.status)) {
    return false;
  }
  return true;
}, { message: 'invalid status', path: ['status'] })
.refine((data) => {
  // Validate sort_by against allowed set.
  if (data.sort_by && !SORTABLE_FIELDS.includes(data.sort_by)) {
    return false;
  }
  return true;
}, { message: 'invalid sort_by', path: ['sort_by'] })
.refine((data) => {
  // price_min <= price_max when both present.
  if (data.price_min !== '' && data.price_max !== '' && data.price_min > data.price_max) {
    return false;
  }
  return true;
}, { message: 'price_min must be <= price_max', path: ['price_min'] });

/**
 * Parse and validate booking query params.
 * @param {Record<string, unknown>} query - Express req.query
 * @returns {{data: object, error?: {message: string, details: Array}}} 
 */
function parseBookingQuery(query = {}) {
  const result = bookingQuerySchema.safeParse(query);
  if (result.success) {
    return { data: result.data };
  }
  return {
    error: {
      message: 'Invalid booking query parameters',
      details: result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    },
  };
}

module.exports = { parseBookingQuery, bookingQuerySchema, BOOKING_STATUSES, SORTABLE_FIELDS };
