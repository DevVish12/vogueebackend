const axios = require('axios');

async function sendNimbusSms(mobile, otp) {
    const userId = process.env.NIMBUS_USER_ID;
    const password = process.env.NIMBUS_PASSWORD;
    const senderId = process.env.NIMBUS_SENDER_ID;
    const entityId = process.env.NIMBUS_ENTITY_ID;
    const templateId = process.env.NIMBUS_TEMPLATE_ID;

    // DEV MODE fallback if credentials are not provided
    if (!userId || !password) {
        console.log('\n=======================================');
        console.log(`[OTP SMS SENT] (DEV MODE - NO NIMBUS CREDS)`);
        console.log(`Mobile: ${mobile}`);
        console.log(`OTP: ${otp}`);
        console.log('=======================================\n');
        return true;
    }

    try {
        const message = `Voguee: Your One-Time PASSCODE is ${otp}. Valid for 10 minutes. Do not share this code with anyone. Visit www.voguee.co.in`;
        console.log("[OTP MESSAGE]", message);
        console.log("[TEMPLATE ID]", templateId);
        console.log("[SENDER ID]", senderId);
        console.log("[ENTITY ID]", entityId);

        const finalUrl = `http://nimbusit.biz/api/SmsApi/SendSingleApi?UserID=${userId}&Password=${encodeURIComponent(password)}&SenderID=${senderId}&Phno=${mobile}&Msg=${encodeURIComponent(message)}&EntityID=${entityId}&TemplateID=${templateId}`;

        console.log('[NIMBUS FINAL URL]', finalUrl);

        const response = await axios.get(finalUrl);
        
        console.log('[NIMBUS STATUS]', response.status);
        console.log('[NIMBUS RESPONSE BODY]', response.data);
        return true;
    } catch (error) {
        console.error('[NIMBUS ERROR RESPONSE]', error.response ? error.response.data : error.message);
        throw new Error('Failed to send SMS');
    }
}

module.exports = {
    sendNimbusSms
};
