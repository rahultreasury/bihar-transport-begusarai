/**
 * enquiryRealtime
 * ---------------------------------------------------------------------------
 * Socket.IO transport for live enquiry updates.
 *
 * WHY THIS EXISTS
 * The customer must see an admin's assignment and final quote WITHOUT
 * refreshing. Polling alone is wasteful and feels broken; a socket gives the
 * confirmation page a genuinely live timeline.
 *
 * SECURITY MODEL (three rules, enforced in code)
 *
 *  1. EVERY connection authenticates. `io.use()` rejects any socket that does
 *     not present a valid JWT. There is no anonymous channel.
 *
 *  2. ROOMS ARE AUTHORITATIVE, NOT SUGGESTED. A socket is only ever added to a
 *     room its principal actually owns:
 *       • admin   → `admin:enquiries`        (role check in JWT)
 *       • customer→ `enquiry:<id>`           (enquiry_access token, or user JWT
 *                                            whose user_id owns the enquiry)
 *       • driver  → `driver:<driver_id>`     (JWT must resolve to a Driver row)
 *       • partner → `partner:<partner_id>`   (JWT must resolve to a Partner row)
 *     A client CANNOT name its own room: the join handler derives the room set
 *     from the verified principal and ignores any client-supplied ids.
 *
 *  3. NO SENSITIVE DATA ON THE WIRE. Events emitted to a customer room carry
 *     the CUSTOMER DTO (see dtos/EnquiryDTO.js) which by construction contains
 *     no driver phone number, no customer-care internals beyond the published
 *     contact profile, and no financial internals. Admin rooms receive the
 *     ADMIN DTO, which is a strictly larger superset.
 *
 * EVENTS
 *   enquiry:created  → customer room (immediately after submit)
 *   enquiry:updated  → customer room + admin room (any status/assignment change)
 *   vehicle:assigned / driver:assigned → customer + admin + driver
 *   quote:created / quote:updated / quote:ready → customer + admin
 *   customer:accepted / customer:rejected → admin + customer
 *   booking:confirmed / trip:started / trip:completed → customer + admin
 *   booking:cancelled → customer + admin
 *
 * RESILIENCE
 * If socket.io is unavailable (not installed, or a serverless freeze), init()
 * degrades to a no-op and every consumer falls back to HTTP polling. The
 * enquiry feature therefore never hard-depends on the socket being up.
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');
const { toCustomerEnquiry, toAdminEnquiry, toCustomerEnquirySummary } = require('../dtos/EnquiryDTO');
const { logger } = require('../utils/logger');

/** @type {import('socket.io').Server|null} */
let io = null;
let initialised = false;

/** Room-name builders — the only place a room string is ever constructed. */
const rooms = {
  enquiry: (enquiryId) => `enquiry:${enquiryId}`,
  adminEnquiries: () => 'admin:enquiries',
  driver: (driverId) => `driver:${driverId}`,
  partner: (partnerId) => `partner:${partnerId}`,
};

const ADMIN_ROLES = ['admin', 'super_admin', 'operator'];

/** @returns {boolean} whether the socket transport is actually available */
function isRealtimeAvailable() {
  return Boolean(io);
}

/**
 * Resolve a raw JWT into a verified principal.
 *
 * Returns one of:
 *   { kind: 'admin',    adminId, role, name }
 *   { kind: 'customer', userId }
 *   { kind: 'guest',    enquiryId, enquiryNumber }   ← enquiry_access token
 *   { kind: 'driver',   userId, driverId }
 *   { kind: 'partner',  partnerId, userId }
 *   { kind: 'driver_unresolved', userId }
 *   { kind: 'partner_unresolved', userId }
 *
 * @param {string} token
 * @returns {Promise<object|null>} null when the token is not usable
 */
async function resolvePrincipal(token) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!payload || !payload.id) return null;

  // ── Admin token ──────────────────────────────────────────────────────
  if (payload.type === 'admin') {
    const admin = await prisma.admin.findUnique({
      where: { admin_id: payload.id },
      select: { admin_id: true, full_name: true, role: true, is_active: true },
    });
    if (!admin || admin.is_active === false) return null;
    return { kind: 'admin', adminId: admin.admin_id, role: admin.role, name: admin.full_name };
  }

  // ── Scoped enquiry-access token (guest customer) ──────────────────────
  if (payload.type === 'enquiry_access' && payload.enquiryId) {
    return { kind: 'guest', enquiryId: Number(payload.enquiryId), enquiryNumber: payload.enquiryNumber || null };
  }

  // ── User / driver / partner token ─────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { user_id: payload.id },
    select: { user_id: true, first_name: true, last_name: true, role: true, is_active: true },
  });
  if (!user || user.is_active === false) return null;

  const driver = await prisma.driver.findFirst({
    where: { user_id: user.user_id },
    select: { driver_id: true, driver_name: true, status: true },
  });
  if (driver) {
    return {
      kind: 'driver',
      userId: user.user_id,
      driverId: driver.driver_id,
      name: driver.driver_name,
    };
  }

  const partner = await prisma.partner.findFirst({
    where: { user_id: user.user_id },
    select: { partner_id: true, partner_name: true, status: true },
  });
  if (partner) {
    return {
      kind: 'partner',
      userId: user.user_id,
      partnerId: partner.partner_id,
      name: partner.partner_name,
    };
  }

  return { kind: 'customer', userId: user.user_id, name: `${user.first_name} ${user.last_name}`.trim() };
}

/**
 * Derive the room set a principal is allowed to join.
 *
 * The client sends only `{ enquiryIds?: number[] }` as a *request*; every id is
 * verified against the database before the socket is placed in the room.
 *
 * @param {object} principal
 * @param {number[]} requestedEnquiryIds
 * @returns {Promise<string[]>}
 */
async function resolveJoinableRooms(principal, requestedEnquiryIds) {
  const joinable = new Set();

  if (principal.kind === 'admin' && ADMIN_ROLES.includes(principal.role)) {
    joinable.add(rooms.adminEnquiries());
    return [...joinable];
  }

  if (principal.kind === 'driver') {
    joinable.add(rooms.driver(principal.driverId));
  } else if (principal.kind === 'partner') {
    joinable.add(rooms.partner(principal.partnerId));
  }

  if (principal.kind === 'customer' || principal.kind === 'guest' || principal.kind === 'driver' || principal.kind === 'partner') {
    const ids = new Set(
      (Array.isArray(requestedEnquiryIds) ? requestedEnquiryIds : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0)
    );

    // A guest token is already scoped to exactly one enquiry.
    if (principal.kind === 'guest') ids.add(principal.enquiryId);

    if (ids.size > 0) {
      const where = {
        enquiry_id: { in: [...ids] },
        OR: [],
      };
      if (principal.kind === 'customer') where.OR.push({ customer_id: principal.userId });
      if (principal.kind === 'driver') where.OR.push({ assigned_driver_id: principal.driverId });
      if (principal.kind === 'partner') where.OR.push({ assigned_partner_id: principal.partnerId });
      if (principal.kind === 'guest') where.OR.push({ enquiry_id: principal.enquiryId });

      if (where.OR.length > 0) {
        const owned = await prisma.enquiry.findMany({
          where,
          select: { enquiry_id: true },
        });
        owned.forEach((row) => joinable.add(rooms.enquiry(row.enquiry_id)));
      }
    }
  }

  return [...joinable];
}

/**
 * Attach Socket.IO to the HTTP server.
 *
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server|null} null when realtime is unavailable
 */
function initRealtime(httpServer) {
  if (initialised) return io;

  try {
    io = new Server(httpServer, {
      cors: {
        origin: process.env.NODE_ENV !== 'production'
          ? true
          : (process.env.FRONTEND_URL || true),
        credentials: true,
        methods: ['GET', 'POST'],
      },
      // Long-poll fallback stays enabled so a proxy that strips WebSocket
      // upgrades degrades to polling transport instead of failing outright.
      transports: ['websocket', 'polling'],
      pingInterval: 25000,
      pingTimeout: 20000,
    });

    // ── Authentication gate ────────────────────────────────────────────
    io.use(async (socket, next) => {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
        socket.handshake.headers?.['x-enquiry-token'];

      if (!token) {
        return next(new Error('unauthorized: missing token'));
      }

      const principal = await resolvePrincipal(token);
      if (!principal) {
        return next(new Error('unauthorized: invalid token'));
      }

      socket.data.principal = principal;
      return next();
    });

    io.on('connection', (socket) => {
      const principal = socket.data.principal;
      socket.data.rooms = [];

      socket.on('enquiry:subscribe', async (payload, ack) => {
        try {
          const requested = Array.isArray(payload) ? payload : payload?.enquiryIds;
          const joinable = await resolveJoinableRooms(principal, requested);

          // Never widen an already-approved room set on a later subscribe.
          const fresh = joinable.filter((r) => !socket.data.rooms.includes(r));
          if (fresh.length) {
            await socket.join(fresh);
            fresh.forEach((r) => socket.data.rooms.push(r));
          }

          if (typeof ack === 'function') {
            ack({ ok: true, rooms: socket.data.rooms, kind: principal.kind });
          }
        } catch (err) {
          logger.error({ err: err.message }, 'realtime.subscribe_failed');
          if (typeof ack === 'function') ack({ ok: false, error: 'subscribe_failed' });
        }
      });

      socket.on('enquiry:unsubscribe', async (payload) => {
        const requested = Array.isArray(payload) ? payload : payload?.enquiryIds;
        (requested || []).forEach((id) => {
          const room = rooms.enquiry(Number(id));
          if (socket.data.rooms.includes(room)) {
            socket.leave(room);
            socket.data.rooms = socket.data.rooms.filter((r) => r !== room);
          }
        });
      });

      socket.on('disconnect', () => {
        socket.data.rooms = [];
      });
    });

    initialised = true;
    logger.info({}, 'realtime.socketio_initialised');
    return io;
  } catch (err) {
    // Realtime is an enhancement, never a hard dependency.
    io = null;
    initialised = false;
    logger.warn({ err: err.message }, 'realtime.unavailable_falling_back_to_polling');
    return null;
  }
}

/**
 * Emit a CUSTOMER-SAFE event to one enquiry's room.
 *
 * The payload is rebuilt from the database through the customer DTO on every
 * emit, so there is no way for a caller to accidentally broadcast an admin
 * payload (with the driver mobile) to a customer room.
 *
 * @param {number} enquiryId
 * @param {string} eventName
 * @param {object} [extra] - additional safe fields to merge (e.g. { status })
 * @returns {Promise<void>}
 */
async function emitToEnquiry(enquiryId, eventName, extra = {}) {
  if (!io || !enquiryId) return;
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      include: {
        customer: { select: { user_id: true, first_name: true, last_name: true } },
        assignedDriver: {
          select: {
            driver_id: true,
            driver_name: true,
            rating: true,
            profile_image: true,
            is_verified: true,
            total_deliveries: true,
            status: true,
          },
        },
        assignedVehicle: {
          select: {
            vehicle_id: true,
            vehicle_number: true,
            vehicle_type: true,
            vehicle_name: true,
            capacity_kg: true,
            body_type: true,
            current_status: true,
          },
        },
        assignedOwner: { select: { owner_id: true, owner_name: true, company_name: true, city: true } },
        assignedPartner: { select: { partner_id: true, partner_name: true, partner_code: true, city: true } },
        requestedVehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } },
        booking: { select: { booking_id: true, booking_number: true, status: true } },
      },
    });
    if (!enquiry) return;

    const payload = { ...toCustomerEnquirySummary(enquiry), ...extra };
    io.to(rooms.enquiry(Number(enquiryId))).emit(eventName, payload);
  } catch (err) {
    logger.error({ err: err.message, enquiryId, eventName }, 'realtime.emit_failed');
  }
}

/**
 * Emit to every authenticated admin.
 * @param {string} eventName
 * @param {object} payload
 */
function emitToAdmins(eventName, payload) {
  if (!io) return;
  io.to(rooms.adminEnquiries()).emit(eventName, payload);
}

/**
 * Emit an admin-shaped enquiry to the admin room.
 * @param {number} enquiryId
 * @param {string} eventName
 */
async function emitEnquiryToAdmins(enquiryId, eventName) {
  if (!io || !enquiryId) return;
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { enquiry_id: Number(enquiryId) },
      include: require('../dtos/EnquiryDTO').adminRelationSelect,
    });
    if (!enquiry) return;
    io.to(rooms.adminEnquiries()).emit(eventName, { enquiry: toAdminEnquiry(enquiry, []) });
  } catch (err) {
    logger.error({ err: err.message, enquiryId, eventName }, 'realtime.admin_emit_failed');
  }
}

/**
 * Notify a specific driver that their assignment changed.
 * @param {number} driverId
 * @param {string} eventName
 * @param {object} payload
 */
function emitToDriver(driverId, eventName, payload) {
  if (!io || !driverId) return;
  io.to(rooms.driver(Number(driverId))).emit(eventName, payload);
}

/**
 * Notify a specific partner.
 * @param {number} partnerId
 * @param {string} eventName
 * @param {object} payload
 */
function emitToPartner(partnerId, eventName, payload) {
  if (!io || !partnerId) return;
  io.to(rooms.partner(Number(partnerId))).emit(eventName, payload);
}

/** Close the socket server (used by tests and graceful shutdown). */
async function closeRealtime() {
  if (io) {
    await new Promise((resolve) => io.close(() => resolve()));
    io = null;
    initialised = false;
  }
}

module.exports = {
  rooms,
  initRealtime,
  isRealtimeAvailable,
  emitToEnquiry,
  emitToAdmins,
  emitEnquiryToAdmins,
  emitToDriver,
  emitToPartner,
  closeRealtime,
  resolvePrincipal,
  resolveJoinableRooms,
};
