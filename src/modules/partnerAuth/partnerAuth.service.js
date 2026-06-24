const PartnerAuthModel = require('./partnerAuth.model');
const { generateToken } = require('../../utils/jwt');
const { sendNimbusSms } = require('../../utils/sms');

const normalizeMobile = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const parseArrayValue = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
};

class PartnerAuthService {
  static async devLogin({ mobile, countryCode }) {
    const cleanMobile = normalizeMobile(mobile);

    let partner = await PartnerAuthModel.findByMobile(cleanMobile);
    let isNewPartner = false;

    if (!partner) {
      isNewPartner = true;
      const id = await PartnerAuthModel.createPartner({ mobile: cleanMobile, countryCode });
      partner = await PartnerAuthModel.findById(id);
    } else {
      partner = await PartnerAuthModel.findById(partner.id);
    }

    const token = generateToken({ id: partner.id, role: 'partner', mobile: partner.mobile });

    return {
      partner,
      token,
      isNewPartner,
    };
  }

  static async sendOtp({ mobile, countryCode }) {
      const cleanMobile = normalizeMobile(mobile);

      // Rate limiting: Max 5 OTPs per 15 minutes
      const recentCount = await PartnerAuthModel.countRecentOtps(cleanMobile, 15);
      if (recentCount >= 5) {
          const error = new Error('Too many OTP requests. Please try again after 15 minutes.');
          error.statusCode = 429;
          throw error;
      }

      // Generate 6 digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      console.log(`[PARTNER OTP GENERATED] Mobile: ${cleanMobile}, OTP: ${otp}`);

      // Invalidate old OTPs
      await PartnerAuthModel.invalidateOldOtps(cleanMobile);

      // Expiry 10 minutes from now
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      // Save OTP
      await PartnerAuthModel.saveOtp(cleanMobile, otp, expiresAt);
      console.log(`[PARTNER OTP SAVED] Mobile: ${cleanMobile}`);

      // Send SMS via Nimbus
      await sendNimbusSms(cleanMobile, otp);

      return { success: true, message: 'OTP sent successfully' };
  }

  static async resendOtp({ mobile }) {
      return this.sendOtp({ mobile });
  }

  static async verifyOtp({ mobile, otp }) {
      const cleanMobile = normalizeMobile(mobile);

      const otpRecord = await PartnerAuthModel.findOtp(cleanMobile, otp);

      if (!otpRecord) {
          console.log(`[PARTNER OTP VERIFY FAILED] Mobile: ${cleanMobile}, Reason: Invalid OTP`);
          const error = new Error('Invalid OTP');
          error.statusCode = 400;
          throw error;
      }

      if (new Date() > new Date(otpRecord.expires_at)) {
          console.log(`[PARTNER OTP VERIFY FAILED] Mobile: ${cleanMobile}, Reason: OTP Expired`);
          const error = new Error('OTP has expired');
          error.statusCode = 400;
          throw error;
      }

      // Mark OTP as verified
      await PartnerAuthModel.markOtpVerified(otpRecord.id);
      console.log(`[PARTNER OTP VERIFY SUCCESS] Mobile: ${cleanMobile}`);

      // Reuse devLogin logic to create or fetch partner and generate token
      return this.devLogin({ mobile: cleanMobile });
  }

  static async me(partnerId) {
    const row = await PartnerAuthModel.findByIdWithKyc(partnerId);
    if (!row) {
      const error = new Error('Partner not found');
      error.statusCode = 404;
      throw error;
    }

    const partner = {
      id: row.id,
      mobile: row.mobile,
      country_code: row.country_code,
      name: row.name,
      rating: row.rating,
      experience: row.experience,
      avatar: row.avatar,
      kyc_status: row.kyc_status,
      status: row.status,
      upi_id: row.upi_id,
      upi_verified: row.upi_verified,
      upi_verified_at: row.upi_verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    const kyc = row.kyc_id
      ? {
          id: row.kyc_id,
          partner_id: row.id,
          partner_type: row.partner_type || 'solo_partner',
          full_name: row.kyc_full_name || row.name || null,
          mobile: row.mobile,
          service_area: row.service_area,
          service_latitude: row.service_latitude,
          service_longitude: row.service_longitude,
          experience: row.kyc_experience || row.experience || null,
          skills: parseArrayValue(row.skills),
          salon_name: row.salon_name,
          salon_address: row.salon_address,
          salon_latitude: row.salon_latitude,
          salon_longitude: row.salon_longitude,
          salon_logo: row.salon_logo,
          salon_gallery: parseArrayValue(row.salon_gallery),
          opening_time: row.opening_time,
          closing_time: row.closing_time,
          aadhaar_url: row.aadhaar_url,
          pan_url: row.pan_url,
          certificate_url: row.certificate_url,
          selfie_url: row.selfie_url,
          kyc_status: row.kyc_record_status || kyc_status || 'pending',
          submit_count: row.kyc_submit_count || 0,
        }
      : null;

    return { partner, kyc };
  }
}

module.exports = PartnerAuthService;
