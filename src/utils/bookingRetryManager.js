// const keyFor = (paymentId) => String(paymentId);

// // paymentId -> { timer }
// const activeRetryIntervals = new Map();

// const stopBookingRetryInterval = (paymentId) => {
//   const key = keyFor(paymentId);
//   const entry = activeRetryIntervals.get(key);
//   if (entry?.timer) {
//     clearInterval(entry.timer);
//   }
//   activeRetryIntervals.delete(key);
// };

// const startBookingRetryInterval = ({
//   paymentId,
//   userId,
//   bookingPayload,
//   nearbyPartners,
//   onlinePartners,
//   io,
//   db,
//   intervalMs = 15000,
//   maxAttempts = 3,
//   expiresInSec = 30,
// }) => {
//   const pid = Number(paymentId);
//   if (!Number.isFinite(pid)) return;
//   if (!io || !db) return;
//   if (!Array.isArray(nearbyPartners)) return;

//   stopBookingRetryInterval(pid);

//   let retryCount = 0;

//   const timer = setInterval(async () => {
//     try {
//       const [rows] = await db.query(
//         'SELECT booking_status, partner_id, user_id, booking_id FROM payments WHERE id = ? LIMIT 1',
//         [pid]
//       );

//       if (!rows || !rows.length) {
//         stopBookingRetryInterval(pid);
//         return;
//       }

//       const row = rows[0];
//       const status = String(row?.booking_status || '').trim();

//       // STOP if accepted/closed
//       if (status !== 'searching') {
//         stopBookingRetryInterval(pid);
//         return;
//       }

//       // Defensive: if partner already set, stop.
//       if (row?.partner_id != null) {
//         stopBookingRetryInterval(pid);
//         return;
//       }

//       retryCount += 1;
//       // eslint-disable-next-line no-console
//       console.log('RETRY ATTEMPT:', retryCount);

//       const onlineNearbyPartners = nearbyPartners.filter((p) => onlinePartners?.has?.(String(p?.partner_id)));

//       onlineNearbyPartners.forEach((p) => {
//         const partnerId = p?.partner_id;
//         if (partnerId == null) return;
//         const distanceKm = Number(p?.distanceKm);
//         const distance = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : undefined;

//         io.to(`partner:${partnerId}`).emit('newBookingRequest', {
//           ...bookingPayload,
//           expiresIn: expiresInSec,
//           distanceKm: Number.isFinite(distanceKm) ? distanceKm : undefined,
//           distance,
//           retry: true,
//           retryCount,
//         });
//       });

//       // STOP after N attempts
//       if (retryCount >= maxAttempts) {
//         stopBookingRetryInterval(pid);

//         await db.query("UPDATE payments SET booking_status='no_partner' WHERE id=?", [pid]);

//         const noPartnerPayload = {
//           ...bookingPayload,
//           status: 'no_partner',
//           booking_status: 'no_partner',
//         };

//         const uid = userId ?? row?.user_id;
//         if (uid != null) {
//           io.to(`user:${uid}`).emit('noPartnerFound', noPartnerPayload);
//         }

//         io.emit('bookingClosed', { bookingId: bookingPayload?.bookingId ?? row?.booking_id ?? pid });
//       }
//     } catch (_) {
//       // ignore
//     }
//   }, intervalMs);

//   activeRetryIntervals.set(keyFor(pid), { timer });
// };

// module.exports = {
//   startBookingRetryInterval,
//   stopBookingRetryInterval,
// };


const { getPartnerSocketIds } = require('../../socket/socket');

const keyFor = (paymentId) => String(paymentId);

// paymentId -> { timer }
const activeRetryIntervals = new Map();

const stopBookingRetryInterval = (paymentId) => {
  const key = keyFor(paymentId);
  const entry = activeRetryIntervals.get(key);
  if (entry?.timer) {
    clearInterval(entry.timer);
  }
  activeRetryIntervals.delete(key);
};

const startBookingRetryInterval = ({
  paymentId,
  userId,
  bookingPayload,
  nearbyPartners,
  io,
  db,
  intervalMs = 15000,
  maxAttempts = 3,
  expiresInSec = 30,
}) => {
  const pid = Number(paymentId);
  if (!Number.isFinite(pid)) return;
  if (!io || !db) return;
  if (!Array.isArray(nearbyPartners)) return;

  stopBookingRetryInterval(pid);

  let retryCount = 0;

  const timer = setInterval(async () => {
    try {
      const [rows] = await db.query(
        'SELECT booking_status, partner_id, user_id, booking_id FROM payments WHERE id = ? LIMIT 1',
        [pid]
      );

      if (!rows || !rows.length) {
        stopBookingRetryInterval(pid);
        return;
      }

      const row = rows[0];
      const status = String(row?.booking_status || '').trim();

      // STOP if accepted/closed
      if (status !== 'searching' && status !== 'pending') {
        stopBookingRetryInterval(pid);
        return;
      }

      // Defensive: if partner already set, stop.
      if (row?.partner_id != null) {
        stopBookingRetryInterval(pid);
        return;
      }

      retryCount += 1;
      // eslint-disable-next-line no-console
      console.log('RETRY ATTEMPT:', retryCount);

      const onlineNearbyPartners = nearbyPartners.filter((p) => getPartnerSocketIds(p?.partner_id).length > 0);

      let socketDelivered = false;

      onlineNearbyPartners.forEach((p) => {
        const partnerId = p?.partner_id;
        if (partnerId == null) return;
        const socketIds = getPartnerSocketIds(partnerId);
        if (!socketIds.length) return;
        const distanceKm = Number(p?.distanceKm);
        const distance = Number.isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : undefined;

        io.to(`partner:${partnerId}`).emit('newBookingRequest', {
          ...bookingPayload,
          expiresIn: expiresInSec,
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : undefined,
          distance,
          retry: true,
          retryCount,
        });
        socketDelivered = true;

        if (process.env.NODE_ENV !== 'production') {
          console.log('[RETRY]', {
            bookingId: bookingPayload?.bookingId ?? row?.booking_id ?? pid,
            partnerId,
            socketId: socketIds.join(','),
            socketConnected: true,
            socketDelivered: true,
          });
        }
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log('[RETRY]', {
          bookingId: bookingPayload?.bookingId ?? row?.booking_id ?? pid,
          candidatePartnerIds: nearbyPartners.map((p) => p?.partner_id),
          onlinePartnerIds: onlineNearbyPartners.map((p) => p?.partner_id),
          socketClientsFound: onlineNearbyPartners.reduce(
            (total, p) => total + getPartnerSocketIds(p?.partner_id).length,
            0
          ),
          socketDelivered,
        });
      }

      if (socketDelivered) {
        stopBookingRetryInterval(pid);
        await db.query("UPDATE payments SET dispatched=1, booking_status='searching' WHERE id=?", [pid]);
        return;
      }

      // STOP after N attempts
      if (retryCount >= maxAttempts) {
        stopBookingRetryInterval(pid);

        await db.query("UPDATE payments SET dispatched=0, booking_status='pending' WHERE id=?", [pid]);
      }
    } catch (_) {
      // ignore
    }
  }, intervalMs);

  activeRetryIntervals.set(keyFor(pid), { timer });
};

module.exports = {
  startBookingRetryInterval,
  stopBookingRetryInterval,
};
