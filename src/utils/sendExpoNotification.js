

// const axios = require('axios');

// const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// /**
//  * Send a push notification via Expo Push API
//  * @param {string} expo_push_token - The Expo push token to send to
//  * @param {string} title - Notification title
//  * @param {string} body - Notification body
//  * @param {object} data - Additional data to send with notification (optional)
//  * @returns {Promise<boolean>} - True if successful, false otherwise
//  */
// async function sendExpoNotification(expo_push_token, title, body, data = {}) {
//     try {
//         if (!expo_push_token || typeof expo_push_token !== 'string') {
//             console.warn('[PUSH] No Expo Push Token Found');
//             return false;
//         }

//         const payload = {
//             to: expo_push_token,
//             sound: 'default',
//             title,
//             body,
//             priority: 'high',
//             channelId: 'booking',
//             data: data || {},
//         };

//         console.log('[PUSH] Booking Event', {
//             expoToken: expo_push_token,
//             title,
//             body,
//             payload,
//             channelId: 'booking',
//         });

//         const response = await axios.post(EXPO_PUSH_URL, payload);
//         const expoErrors = response?.data?.errors || [];

//         console.log('[PUSH] Expo Response', response?.data);

//         if (response?.status === 200 && (!Array.isArray(expoErrors) || expoErrors.length === 0)) {
//             // eslint-disable-next-line no-console
//             console.log('[PUSH] Success', { expoToken: expo_push_token, title, body });
//             return true;
//         }

//         console.warn('[PUSH] Failure', {
//             status: response?.status,
//             errors: expoErrors,
//             expoToken: expo_push_token,
//         });
//         return false;
//     } catch (error) {
//         console.warn('[PUSH] Failed to send notification:', error?.message || error);
//         if (error?.response?.data) {
//             console.warn('[PUSH] Expo error detail:', error.response.data);
//         } else {
//             console.warn('[PUSH] Expo error detail:', error);
//         }
//         return false;
//     }
// }

// /**
//  * Send notifications to multiple recipients
//  * @param {string[]} expo_push_tokens - Array of Expo push tokens
//  * @param {string} title - Notification title
//  * @param {string} body - Notification body
//  * @param {object} data - Additional data (optional)
//  * @returns {Promise<number>} - Number of successfully sent notifications
//  */
// async function sendExpoNotificationBatch(expo_push_tokens, title, body, data = {}) {
//     if (!Array.isArray(expo_push_tokens) || expo_push_tokens.length === 0) {
//         return 0;
//     }

//     let successCount = 0;
//     for (const token of expo_push_tokens) {
//         if (token && typeof token === 'string') {
//             const sent = await sendExpoNotification(token, title, body, data);
//             if (sent) {
//                 successCount += 1;
//             }
//         }
//     }

//     return successCount;
// }

// module.exports = {
//     sendExpoNotification,
//     sendExpoNotificationBatch,
// };


const axios = require('axios');
const db = require('../config/db');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_ATTEMPTS = 2;
const INVALID_TOKEN_ERRORS = new Set(['DeviceNotRegistered']);
let deliveryTableReady;

const ensureDeliveryTable = async () => {
    if (!deliveryTableReady) {
        deliveryTableReady = db.query(`
            CREATE TABLE IF NOT EXISTS notification_deliveries (
                event_id VARCHAR(191) NOT NULL,
                recipient_id VARCHAR(80) NOT NULL,
                recipient_role VARCHAR(20) NOT NULL,
                type VARCHAR(80) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'processing',
                sent_at DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (event_id, recipient_id, recipient_role)
            )
        `).catch((error) => {
            deliveryTableReady = null;
            throw error;
        });
    }
    await deliveryTableReady;
};

const getChannelId = (type) => {
    if (type === 'NEW_BOOKING') return 'booking_requests';
    if (type === 'SERVICE_REMINDER') return 'service_reminders';
    if (type === 'PAYOUT_COMPLETED' || type === 'PAYMENT_SUCCESS') return 'payments';
    return 'booking_updates';
};

const isExpoToken = (token) => typeof token === 'string' && /^(Expo|Exponent)PushToken\[.+\]$/.test(token.trim());

const isTransientError = (error) => {
    if (error?.expoError) return false;
    const status = Number(error?.response?.status || 0);
    return !status || status === 408 || status === 429 || status >= 500;
};

const getExpoErrorCode = (response) => response?.data?.data?.status === 'error'
    ? response?.data?.data?.details?.error
    : response?.data?.errors?.[0]?.code;

const removeInvalidToken = async ({ recipientId, recipientRole, token }) => {
    if (!recipientId || !isExpoToken(token)) return;
    const table = recipientRole === 'partner' ? 'partners' : 'users';
    await db.query(`UPDATE ${table} SET expo_push_token = NULL WHERE id = ? AND expo_push_token = ?`, [recipientId, token]);
};

const claimDelivery = async ({ eventId, recipientId, recipientRole, type }) => {
    await ensureDeliveryTable();
    const [insertResult] = await db.query(
        `INSERT IGNORE INTO notification_deliveries
            (event_id, recipient_id, recipient_role, type, status)
         VALUES (?, ?, ?, ?, 'processing')`,
        [eventId, String(recipientId), recipientRole, type]
    );
    if (Number(insertResult?.affectedRows || 0) === 1) return true;

    const [rows] = await db.query(
        `SELECT status FROM notification_deliveries
         WHERE event_id = ? AND recipient_id = ? AND recipient_role = ? LIMIT 1`,
        [eventId, String(recipientId), recipientRole]
    );
    if (rows?.[0]?.status === 'sent' || rows?.[0]?.status === 'processing') return false;

    const [retryResult] = await db.query(
        `UPDATE notification_deliveries SET status = 'processing', type = ?
         WHERE event_id = ? AND recipient_id = ? AND recipient_role = ? AND status = 'failed'`,
        [type, eventId, String(recipientId), recipientRole]
    );
    return Number(retryResult?.affectedRows || 0) === 1;
};

const updateDelivery = async ({ eventId, recipientId, recipientRole, status }) => {
    await db.query(
        `UPDATE notification_deliveries SET status = ?, sent_at = IF(? = 'sent', NOW(), sent_at)
         WHERE event_id = ? AND recipient_id = ? AND recipient_role = ?`,
        [status, status, eventId, String(recipientId), recipientRole]
    );
};

/**
 * Send a push notification via Expo Push API
 * @param {string} expo_push_token - The Expo push token to send to
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data to send with notification (optional)
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
async function sendExpoNotification(expo_push_token, title, body, data = {}, options = {}) {
    try {
        if (!isExpoToken(expo_push_token)) {
            console.warn('[NOTIFICATION] push skipped: invalid token');
            return false;
        }

        const type = String(options.type || data?.type || 'IMPORTANT_UPDATE');
        const eventId = options.eventId;
        const recipientId = options.recipientId;
        const recipientRole = options.recipientRole;
        if (eventId && recipientId && recipientRole && !(await claimDelivery({ eventId, recipientId, recipientRole, type }))) {
            return false;
        }

        const payload = {
            to: expo_push_token,
            sound: 'default',
            title,
            body,
            priority: 'high',
            channelId: getChannelId(type),
            data: { ...data, type },
        };

        let response;
        let lastError;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            try {
                response = await axios.post(EXPO_PUSH_URL, payload, { timeout: 10000 });
                const expoError = getExpoErrorCode(response);
                if (expoError) {
                    if (INVALID_TOKEN_ERRORS.has(expoError)) {
                        await removeInvalidToken({ recipientId, recipientRole, token: expo_push_token });
                    }
                    throw Object.assign(new Error(expoError), { expoError });
                }
                if (response?.status === 200) break;
            } catch (error) {
                lastError = error;
                if (!isTransientError(error) || attempt === MAX_ATTEMPTS) break;
            }
        }

        const sent = response?.status === 200 && !lastError;
        if (eventId && recipientId && recipientRole) {
            await updateDelivery({ eventId, recipientId, recipientRole, status: sent ? 'sent' : 'failed' });
        }
        console.log('[NOTIFICATION]', {
            type,
            recipient: `${recipientRole || 'unknown'}:${recipientId || 'unknown'}`,
            eventId: eventId || null,
            push: sent ? 'sent' : 'failed',
            reason: sent ? undefined : (lastError?.message || `HTTP ${response?.status || 'unknown'}`),
        });
        return sent;
    } catch (error) {
        if (options.eventId && options.recipientId && options.recipientRole) {
            await updateDelivery({ eventId: options.eventId, recipientId: options.recipientId, recipientRole: options.recipientRole, status: 'failed' });
        }
        console.warn('[NOTIFICATION] push failed:', error?.message || 'unknown error');
        return false;
    }
}

/**
 * Send notifications to multiple recipients
 * @param {string[]} expo_push_tokens - Array of Expo push tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data (optional)
 * @returns {Promise<number>} - Number of successfully sent notifications
 */
async function sendExpoNotificationBatch(expo_push_tokens, title, body, data = {}) {
    if (!Array.isArray(expo_push_tokens) || expo_push_tokens.length === 0) {
        return 0;
    }

    let successCount = 0;
    for (const token of expo_push_tokens) {
        if (token && typeof token === 'string') {
            const sent = await sendExpoNotification(token, title, body, data);
            if (sent) {
                successCount += 1;
            }
        }
    }

    return successCount;
}

module.exports = {
    sendExpoNotification,
    sendExpoNotificationBatch,
};
