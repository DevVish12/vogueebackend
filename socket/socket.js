const { Server } = require('socket.io');
const PaymentModel = require('../src/modules/payment/payment.model');
const db = require('../src/config/db');
const { verifyToken } = require('../src/utils/jwt');
const AdminAuthModel = require('../src/modules/adminAuth/adminAuth.model');
const SOCKET_EVENTS = require('../server/constants/socketEvents');

let io;

// Track partners who are currently online (i.e., have registered / joined their room).
// Used by auto-assignment so we don't emit booking requests to offline partners.
const onlinePartners = new Set();

const normalizeRoomId = (value) => {
  const s = value == null ? '' : String(value).trim();
  if (!s) return null;
  if (s.toLowerCase() === 'undefined') return null;
  if (s.toLowerCase() === 'null') return null;
  return s;
};

const ADMIN_DASHBOARD_ROOM = 'admin-dashboard';

const toPartnerRoom = (partnerId) => {
  const id = normalizeRoomId(partnerId);
  return id ? `partner:${id}` : null;
};

const toUserRoom = (userId) => {
  const id = normalizeRoomId(userId);
  return id ? `user:${id}` : null;
};

const parseAllowedOrigins = () => {
  const raw = (process.env.SOCKET_CORS_ORIGINS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const buildCorsOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const origins = parseAllowedOrigins();

  // If no origins are configured:
  // - allow all in dev to avoid blocking local setups
  // - disallow in production unless explicitly configured
  if (!origins.length) {
    return {
      origin: isProduction ? false : true,
      credentials: true
    };
  }

  return {
    origin: (origin, cb) => {
      // React Native / non-browser clients may not send an Origin header.
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  };
};

const fetchPartnerWithKyc = async (partnerId) => {
  const [rows] = await db.query(
    `
    SELECT
      p.id,
      p.mobile AS phone,
      COALESCE(p.avatar, pk.selfie_url) AS avatar,
      pk.full_name AS name,
      pk.experience,
      pk.skills,
      pk.service_latitude AS lat,
      pk.service_longitude AS lng,
      p.rating
    FROM partners p
    LEFT JOIN partner_kyc pk ON pk.partner_id = p.id
    WHERE p.id = ?
    `,
    [partnerId]
  );
  return (rows && rows[0]) || {};
};

const parseSkills = (rawSkills) => {
  let skills = [];

  try {
    skills = typeof rawSkills === 'string' ? JSON.parse(rawSkills) : rawSkills;
  } catch {
    skills = [];
  }

  return Array.isArray(skills) ? skills : [];
};

const toSafePartner = (partner, fallbackId) => {
  const skills = parseSkills(partner?.skills);
  const safePartner = {
    id: partner?.id || fallbackId,
    name: partner?.name || 'Verified Professional',
    phone: partner?.phone || '',
    rating: partner?.rating || '4.5',
    experience: partner?.experience || '1+ Years',
    avatar: partner?.avatar || '',
    skills: skills || [],
    lat: partner?.lat ?? null,
    lng: partner?.lng ?? null,
  };

  // eslint-disable-next-line no-console
  console.log('FINAL PARTNER FULL DATA:', safePartner);
  return safePartner;
};

const fetchCustomerById = async (userId) => {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return {};

  const [rows] = await db.query(
    `
    SELECT
      u.name,
      u.mobile
    FROM users u
    WHERE u.id = ?
    LIMIT 1
    `,
    [uid]
  );

  return (rows && rows[0]) || {};
};

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const a1 = toNumber(lat1);
  const o1 = toNumber(lon1);
  const a2 = toNumber(lat2);
  const o2 = toNumber(lon2);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;

  const R = 6371;
  const dLat = ((a2 - a1) * Math.PI) / 180;
  const dLon = ((o2 - o1) * Math.PI) / 180;
  const sLat1 = (a1 * Math.PI) / 180;
  const sLat2 = (a2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/**
 * Attach Socket.IO to an existing HTTP server.
 * This must be called exactly once during startup.
 */
const attachSocket = (httpServer) => {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket']
  });

  io.on('connection', (socket) => {
    const userIdRaw =
      socket?.handshake?.auth?.userId ??
      socket?.handshake?.query?.userId ??
      socket?.handshake?.headers?.['x-user-id'];
    const partnerIdRaw =
      socket?.handshake?.auth?.partnerId ??
      socket?.handshake?.query?.partnerId ??
      socket?.handshake?.headers?.['x-partner-id'];

    const userId = normalizeRoomId(userIdRaw);
    const partnerId = normalizeRoomId(partnerIdRaw);

    if (userId) {
      socket.data.userId = userId;
      socket.join(toUserRoom(userId));
    }

    if (partnerId) {
      socket.data.partnerId = partnerId;
      socket.partnerId = partnerId;
      socket.join(toPartnerRoom(partnerId));

      onlinePartners.add(String(partnerId));
      io.to(ADMIN_DASHBOARD_ROOM).emit(SOCKET_EVENTS.ADMIN_ANALYTICS_UPDATED, {
        reason: 'partner_online',
        partnerId,
        updatedAt: new Date().toISOString()
      });
      // eslint-disable-next-line no-console
      console.log('ONLINE PARTNER:', partnerId);
      // eslint-disable-next-line no-console
      console.log('ONLINE PARTNERS SET:', [...onlinePartners]);
    }

    if (process.env.NODE_ENV !== 'production') {
      const tags = [userId ? `(user:${userId})` : null, partnerId ? `(partner:${partnerId})` : null]
        .filter(Boolean)
        .join(' ');
      // eslint-disable-next-line no-console
      console.log('[socket] connected:', socket.id, tags);
    }

    const registerUserRoom = (rawUserId) => {
      const nextUser = normalizeRoomId(rawUserId);
      if (!nextUser) return null;
      socket.data.userId = nextUser;
      socket.join(toUserRoom(nextUser));
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[socket] joined room:', socket.id, `user:${nextUser}`);
      }
      return nextUser;
    };

    const registerPartnerRoom = (rawPartnerId) => {
      const nextPartner = normalizeRoomId(rawPartnerId);
      if (!nextPartner) return null;
      socket.data.partnerId = nextPartner;
      socket.partnerId = nextPartner;
      socket.join(toPartnerRoom(nextPartner));

      onlinePartners.add(String(nextPartner));
      io.to(ADMIN_DASHBOARD_ROOM).emit(SOCKET_EVENTS.ADMIN_ANALYTICS_UPDATED, {
        reason: 'partner_online',
        partnerId: nextPartner,
        updatedAt: new Date().toISOString()
      });
      // eslint-disable-next-line no-console
      console.log('ONLINE PARTNER:', nextPartner);
      // eslint-disable-next-line no-console
      console.log('ONLINE PARTNERS SET:', [...onlinePartners]);

      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[socket] joined room:', socket.id, `partner:${nextPartner}`);
      }
      return nextPartner;
    };

    const registerAdminDashboardRoom = async (rawToken) => {
      const token = rawToken && typeof rawToken === 'object' ? rawToken.token : rawToken;
      const safeToken = typeof token === 'string' ? token.trim() : '';
      if (!safeToken) return false;

      const { decoded } = verifyToken(safeToken, { detailed: true });
      const adminId = decoded?.id;
      if (!adminId) return false;

      // Ensure admins table exists and that this admin id is real.
      try {
        await AdminAuthModel.ensureTables();
      } catch {
        // ignore table ensure errors; fallback to denying join
      }

      const admin = await AdminAuthModel.findById(adminId);
      if (!admin?.id) return false;

      socket.data.adminId = String(admin.id);
      socket.join(ADMIN_DASHBOARD_ROOM);

      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[socket] joined room:', socket.id, ADMIN_DASHBOARD_ROOM, `(admin:${admin.id})`);
      }
      return true;
    };

    // Allow late registration (if client connects before auth is ready).
    // Legacy: accepts { userId?, partnerId? }
    socket.on('register', (payload) => {
      registerUserRoom(payload?.userId);
      registerPartnerRoom(payload?.partnerId);
    });

    // Explicit events (per mobile-app flow)
    // Supports both: socket.emit('registerUser', userId) and socket.emit('registerUser', { userId })
    socket.on('registerUser', (payload) => {
      const nextUserId = payload && typeof payload === 'object' ? payload.userId : payload;
      const joined = registerUserRoom(nextUserId);
      if (joined) {
        // eslint-disable-next-line no-console
        console.log('USER JOINED ROOM:', `user:${joined}`);
      }
    });

    socket.on('registerPartner', ({ partnerId } = {}) => {
      registerPartnerRoom(partnerId);
    });

    // Admin dashboard registration (token-verified). Additive; safe for existing clients.
    // Supports: socket.emit('registerAdminDashboard', token) OR ({ token })
    socket.on('registerAdminDashboard', async (payload) => {
      try {
        await registerAdminDashboardRoom(payload);
      } catch {
        // ignore
      }
    });

    // Partner accepts a booking (reference flow)
    // Expected payload: { bookingId: <paymentId or booking_id>, partner: {...}, partnerId?: number }
    socket.on('partnerAcceptBooking', async (payload) => {
      try {
        const key = payload?.bookingId ?? payload?.id;
        const paymentId = Number(key);

        const row = Number.isFinite(paymentId)
          ? await PaymentModel.getById(paymentId)
          : await PaymentModel.getByBookingId(key);
        if (!row) return;

        const currentStatus = String(row?.booking_status || '').trim();
        if (currentStatus !== 'searching') return;

        const partnerId = payload?.partnerId ?? payload?.partner?.id ?? null;
        if (partnerId == null) return;

        const accepted = Number.isFinite(paymentId)
          ? await PaymentModel.tryAcceptBookingById(paymentId, partnerId)
          : await PaymentModel.tryAcceptBookingByBookingId(key, partnerId);
        if (!accepted) return;

        const updated = Number.isFinite(paymentId)
          ? await PaymentModel.getById(paymentId)
          : await PaymentModel.getByBookingId(key);
        if (!updated) return;

        const partnerRow = partnerId != null ? await fetchPartnerWithKyc(partnerId) : null;
        const safePartner = toSafePartner(partnerRow, partnerId);

        const customer = updated?.user_id ? await fetchCustomerById(updated.user_id) : {};
        const distanceKm = calculateDistanceKm(updated?.lat, updated?.lng, safePartner?.lat, safePartner?.lng);
        const distance = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} km` : undefined;

        const bookingAssignedPayload = {
          id: updated.id,
          bookingId: updated.booking_id || updated.id,
          userId: updated.user_id,
          customerName: customer?.name || 'Customer',
          customerPhone: customer?.mobile || '',
          serviceName: updated.service_name,
          amount: updated.amount,
          address: updated.address,
          slotDate: updated.slot_date,
          slotTime: updated.slot_time,
          lat: updated.lat,
          lng: updated.lng,
          distance,
          status: 'accepted',
          booking_status: 'accepted',
          partner: safePartner,
          partnerId: partnerId,
        };

        // eslint-disable-next-line no-console
        console.log('EMIT TO USER:', updated.user_id);
        io.to(`user:${updated.user_id}`).emit('bookingAssigned', bookingAssignedPayload);

        if (partnerId != null) {
          // eslint-disable-next-line no-console
          console.log('EMIT TO PARTNER:', partnerId);
          io.to(`partner:${partnerId}`).emit('bookingAssigned', bookingAssignedPayload);
        }

        io.emit('bookingClosed', { bookingId: updated.booking_id || updated.id });
      } catch (_) {
        // ignore
      }
    });

    // Partner cancels an accepted booking => reopen it and auto-reassign.
    // Expected payload: { bookingId: <payments.id>, partnerId?: <partner.id> }
    socket.on('cancelBooking', async ({ bookingId, partnerId } = {}) => {
      try {
        const paymentId = Number(bookingId);
        if (!Number.isFinite(paymentId)) return;

        await PaymentModel.ensureTable();

        await db.query("UPDATE payments SET booking_status='searching', partner_id=NULL WHERE id=?", [paymentId]);

        // eslint-disable-next-line no-console
        console.log('REASSIGN BOOKING:', paymentId);

        const updated = await PaymentModel.getById(paymentId);
        if (!updated) return;

        // Inform user that the booking is back to searching.
        io.to(`user:${updated.user_id}`).emit('bookingStatusUpdate', {
          id: updated.id,
          bookingId: updated.booking_id || updated.id,
          userId: updated.user_id,
          status: 'searching',
          booking_status: 'searching',
          timestamp: Date.now(),
        });

        // Broadcast minimal request so partners can refresh.
        // (Partner app currently listens to newBookingRequest.)
        const payload = {
          id: updated.id,
          bookingId: updated.booking_id || updated.id,
          userId: updated.user_id,
          serviceName: updated.service_name,
          amount: updated.amount,
          address: updated.address,
          slotDate: updated.slot_date,
          slotTime: updated.slot_time,
          lat: updated.lat,
          lng: updated.lng,
          status: 'searching',
          booking_status: 'searching',
          reassignedFromPartnerId: partnerId ?? null,
        };

        io.emit('newBookingRequest', payload);
      } catch (_) {
        // ignore
      }
    });

    // Partner updates booking stage; backend persists and relays to user/partner/admin rooms.
    // Expected payload: { bookingId: <paymentId or booking_id>, status: 'on_the_way'|'arrived'|... }
    socket.on('updateBookingStatus', async ({ bookingId, status } = {}, ack) => {
      try {
        const key = bookingId;
        const nextStatus = status == null ? '' : String(status).trim();
        if (!nextStatus) return;

        // Keep this permissive but bounded.
        // NOTE: Salon appointments use: confirmed -> arrived -> service_started -> completed.
        const allowed = new Set([
          'accepted',
          'on_the_way',
          'arrived',
          'reached',
          'in_service',
          'service_started',
          'completed',
          'no_partner',
          'searching'
        ]);
        if (!allowed.has(nextStatus)) {
          if (typeof ack === 'function') ack({ ok: false, error: 'invalid_status' });
          return;
        }

        const paymentId = Number(key);
        const row = Number.isFinite(paymentId)
          ? await PaymentModel.getById(paymentId)
          : await PaymentModel.getByBookingId(key);
        if (!row) return;

        if (Number.isFinite(paymentId)) {
          await PaymentModel.updateBookingStatusById(paymentId, nextStatus);
        } else {
          await PaymentModel.updateBookingStatusByBookingId(key, nextStatus);
        }

        const payload = {
          id: row.id,
          bookingId: row.booking_id || row.id,
          userId: row.user_id,
          status: nextStatus,
          booking_status: nextStatus,
          booking_type: row.booking_type ?? null,
          service_mode: row.service_mode ?? null,
          partnerId: row.partner_id ?? null,
          updatedAt: new Date().toISOString(),
          timestamp: Date.now(),
        };

        const isSalonVisit =
          String(row?.booking_type || '').trim() === 'visit_salon' ||
          String(row?.service_mode || '').trim() === 'visit_salon';

        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.log('[socket] updateBookingStatus:', {
            bookingId: payload.bookingId,
            nextStatus,
            userId: row.user_id,
            partnerId: row.partner_id ?? null,
            isSalonVisit,
          });
        }

        io.to(`user:${row.user_id}`).emit('bookingStatusUpdate', payload);
        if (row?.partner_id != null) {
          io.to(`partner:${row.partner_id}`).emit('bookingStatusUpdate', payload);
        }
        io.to(ADMIN_DASHBOARD_ROOM).emit('bookingStatusUpdate', payload);

        if (typeof ack === 'function') ack({ ok: true });
      } catch (_) {
        if (typeof ack === 'function') ack({ ok: false, error: 'server_error' });
      }
    });

    // Partner sends live GPS updates; backend relays to the booking's user room.
    // Expected payload: { bookingId: <paymentId or booking_id>, lat: number, lng: number }
    socket.on('partnerLocationUpdate', async (payload) => {
      try {
        const key = payload?.bookingId ?? payload?.id;
        const paymentId = Number(key);
        const lat = Number(payload?.lat);
        const lng = Number(payload?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const row = Number.isFinite(paymentId)
          ? await PaymentModel.getById(paymentId)
          : await PaymentModel.getByBookingId(key);
        if (!row) return;

        io.to(`user:${row.user_id}`).emit('partnerLocationUpdate', {
          id: row.id,
          bookingId: String(row.id),
          userId: row.user_id,
          lat,
          lng,
          timestamp: Date.now(),
        });
      } catch (_) {
        // ignore
      }
    });

    socket.on('disconnect', (reason) => {
      const pid = socket?.partnerId ?? socket?.data?.partnerId;
      if (pid != null) {
        onlinePartners.delete(String(pid));
        io.to(ADMIN_DASHBOARD_ROOM).emit(SOCKET_EVENTS.ADMIN_ANALYTICS_UPDATED, {
          reason: 'partner_offline',
          partnerId: pid,
          updatedAt: new Date().toISOString()
        });
      }
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log('[socket] disconnected:', socket.id, reason);
      }
    });
  });

  return io;
};

/**
 * Access the initialized Socket.IO server instance.
 * Throws if called before attachSocket().
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO is not initialized. Call attachSocket(httpServer) during startup.');
  }
  return io;
};

module.exports = {
  attachSocket,
  getIO,
  onlinePartners
};
