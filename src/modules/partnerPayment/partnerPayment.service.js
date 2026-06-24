const db = require('../../config/db');
const PartnerPaymentModel = require('./partnerPayment.model');
const PartnerAuthModel = require('../partnerAuth/partnerAuth.model');

const normalizeMobile = (value) => String(value || '').replace(/\D/g, '').slice(-10);

// UPI ID format validation (basic regex)
// Format: name@bankname or mobilenumber@bankname or username@bankname
const validateUpiFormat = (upiId) => {
  const upiRegex = /^[a-zA-Z0-9._-]{3,}@[a-zA-Z]{3,}$/;
  return upiRegex.test(String(upiId || '').trim());
};

const sanitizeText = (value, { max = 100 } = {}) => {
  const s = String(value || '').trim();
  if (!s) return '';
  // basic neutralization of HTML brackets
  const cleaned = s.replace(/[<>]/g, '');
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

class PartnerPaymentService {
  static async saveUpi({ partnerId, jwtMobile, body }) {
    // Step 1: Verify partner exists
    const partner = await PartnerAuthModel.findById(partnerId);
    if (!partner) {
      const err = new Error('Partner not found');
      err.statusCode = 404;
      throw err;
    }

    // Step 2: Verify token matches
    const partnerMobile = normalizeMobile(partner.mobile);
    const tokenMobile = normalizeMobile(jwtMobile);
    if (!partnerMobile || !tokenMobile || partnerMobile !== tokenMobile) {
      const err = new Error('Not authorized, token failed');
      err.statusCode = 401;
      throw err;
    }

    // Step 3: Validate UPI ID format
    const upiId = sanitizeText(body.upi_id, { max: 100 });
    if (!upiId) {
      const err = new Error('UPI ID is required');
      err.statusCode = 400;
      throw err;
    }

    if (!validateUpiFormat(upiId)) {
      const err = new Error('Invalid UPI format. Use format: name@bankname');
      err.statusCode = 400;
      throw err;
    }

    // Optional safety/audit: log UPI changes (no DB writes, no API changes)
    try {
      const oldUpi = String(partner.upi_id || '').trim();
      if (oldUpi && oldUpi !== upiId) {
        console.log(`UPI_CHANGE partnerId=${partnerId} old=${oldUpi} new=${upiId}`);
      }
    } catch {
      // ignore logging failures
    }

    // Step 4: Save UPI to database
    const saved = await PartnerPaymentModel.saveUpi(partnerId, upiId);
    if (!saved) {
      const err = new Error('Failed to save UPI');
      err.statusCode = 500;
      throw err;
    }

    return {
      success: true,
      message: 'UPI verified and saved successfully',
      upi_id: upiId,
    };
  }

  static async getUpiStatus({ partnerId, jwtMobile }) {
    // Verify partner exists
    const partner = await PartnerAuthModel.findById(partnerId);
    if (!partner) {
      const err = new Error('Partner not found');
      err.statusCode = 404;
      throw err;
    }

    // Verify token matches
    const partnerMobile = normalizeMobile(partner.mobile);
    const tokenMobile = normalizeMobile(jwtMobile);
    if (!partnerMobile || !tokenMobile || partnerMobile !== tokenMobile) {
      const err = new Error('Not authorized, token failed');
      err.statusCode = 401;
      throw err;
    }

    return {
      upi_id: partner.upi_id || null,
      upi_verified: !!partner.upi_verified,
      upi_verified_at: partner.upi_verified_at || null,
    };
  }
}

module.exports = PartnerPaymentService;
