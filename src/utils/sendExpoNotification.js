const axios = require('axios');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification via Expo Push API
 * @param {string} expo_push_token - The Expo push token to send to
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Additional data to send with notification (optional)
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
async function sendExpoNotification(expo_push_token, title, body, data = {}) {
    try {
        if (!expo_push_token || typeof expo_push_token !== 'string') {
            console.warn('[Expo] Invalid expo_push_token:', expo_push_token);
            return false;
        }

        const payload = {
            to: expo_push_token,
            sound: 'default',
            title,
            body,
            priority: 'high',
            channelId: 'booking',
            data: data || {},
        };

        console.log('[PUSH PAYLOAD]', payload);
        console.log('[SEND PUSH]', {
            token: expo_push_token,
            title,
            body,
            channelId: 'booking'
        });

        const response = await axios.post(EXPO_PUSH_URL, payload);
        console.log('[EXPO RESPONSE]', response.data);

        if (response?.status === 200) {
            // eslint-disable-next-line no-console
            console.log('[Expo] Notification sent successfully:', expo_push_token.substring(0, 20));
            return true;
        }

        console.warn('[Expo] Unexpected response status:', response?.status);
        return false;
    } catch (error) {
        console.warn('[Expo] Failed to send notification:', error?.message || error);
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
