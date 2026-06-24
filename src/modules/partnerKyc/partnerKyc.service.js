const db = require('../../config/db');
const PartnerKycModel = require('./partnerKyc.model');
const PartnerAuthModel = require('../partnerAuth/partnerAuth.model');

const normalizeMobile = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const sanitizeText = (value, { max = 255 } = {}) => {
  const s = String(value || '').trim();
  if (!s) return '';
  // basic neutralization of HTML brackets
  const cleaned = s.replace(/[<>]/g, '');
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

const toNullableNumber = (value) => {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

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

class PartnerKycService {
  static async getMyKyc({ partnerId, jwtMobile }) {
    const partner = await PartnerAuthModel.findById(partnerId);
    if (!partner) {
      const err = new Error('Partner not found');
      err.statusCode = 404;
      throw err;
    }

    const partnerMobile = normalizeMobile(partner.mobile);
    const tokenMobile = normalizeMobile(jwtMobile);
    if (!partnerMobile || !tokenMobile || partnerMobile !== tokenMobile) {
      const err = new Error('Not authorized, token failed');
      err.statusCode = 401;
      throw err;
    }

    return await PartnerKycModel.findByPartnerId(partnerId);
  }

  static async submitKyc({ partnerId, jwtMobile, body, filePaths }) {
    const partner = await PartnerAuthModel.findById(partnerId);
    if (!partner) {
      const err = new Error('Partner not found');
      err.statusCode = 404;
      throw err;
    }

    const partnerMobile = normalizeMobile(partner.mobile);
    const tokenMobile = normalizeMobile(jwtMobile);
    if (!partnerMobile || !tokenMobile || partnerMobile !== tokenMobile) {
      const err = new Error('Not authorized, token failed');
      err.statusCode = 401;
      throw err;
    }

    const inputMobile = normalizeMobile(body.mobile);
    if (!inputMobile || inputMobile !== partnerMobile) {
      const err = new Error('Mobile mismatch');
      err.statusCode = 400;
      throw err;
    }

    const full_name = sanitizeText(body.full_name, { max: 120 });
    const service_area = sanitizeText(body.service_area, { max: 255 });
    const experience = sanitizeText(body.experience, { max: 60 }) || null;
    const partner_type = sanitizeText(body.partner_type || 'solo_partner', { max: 50 }) || 'solo_partner';

    const salon_name = sanitizeText(body.salon_name, { max: 255 }) || null;
    const salon_address = sanitizeText(body.salon_address, { max: 1000 }) || null;
    const opening_time = sanitizeText(body.opening_time, { max: 30 }) || null;
    const closing_time = sanitizeText(body.closing_time, { max: 30 }) || null;

    const service_latitude = toNullableNumber(body.service_latitude);
    const service_longitude = toNullableNumber(body.service_longitude);
    const salon_latitude = toNullableNumber(body.salon_latitude);
    const salon_longitude = toNullableNumber(body.salon_longitude);

    // Validate lat/lon ranges if provided
    if (service_latitude !== null && Math.abs(service_latitude) > 90) {
      const err = new Error('Invalid service_latitude');
      err.statusCode = 400;
      throw err;
    }
    if (service_longitude !== null && Math.abs(service_longitude) > 180) {
      const err = new Error('Invalid service_longitude');
      err.statusCode = 400;
      throw err;
    }

    if (salon_latitude !== null && Math.abs(salon_latitude) > 90) {
      const err = new Error('Invalid salon_latitude');
      err.statusCode = 400;
      throw err;
    }
    if (salon_longitude !== null && Math.abs(salon_longitude) > 180) {
      const err = new Error('Invalid salon_longitude');
      err.statusCode = 400;
      throw err;
    }

    const skills = body.skills;
    if (!Array.isArray(skills)) {
      const err = new Error('Skills must be an array');
      err.statusCode = 400;
      throw err;
    }

    const skillsClean = skills
      .map((s) => sanitizeText(s, { max: 60 }))
      .filter(Boolean);

    const skillsJson = JSON.stringify(skillsClean);
    const salonGalleryFromBody = parseArrayValue(body.salon_gallery);

    if (partner_type === 'partner_salon_owner') {
      if (!salon_name) {
        const err = new Error('salon_name required');
        err.statusCode = 400;
        throw err;
      }

      if (!salon_address) {
        const err = new Error('salon_address required');
        err.statusCode = 400;
        throw err;
      }
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const existing = await PartnerKycModel.findByPartnerId(partnerId, conn);

      if (existing && Number(existing.submit_count || 1) >= 3) {
        const err = new Error('Too many attempts');
        err.statusCode = 429;
        throw err;
      }

      const aadhaar_url = filePaths.aadhaar_url || existing?.aadhaar_url || null;
      const pan_url = filePaths.pan_url || existing?.pan_url || null;
      const certificate_url = filePaths.certificate_url || existing?.certificate_url || null;
      const selfie_url = filePaths.selfie_url || existing?.selfie_url || null;
      const salon_logo = filePaths.salon_logo_url || sanitizeText(body.salon_logo, { max: 255 }) || existing?.salon_logo || null;
      const salon_gallery_files = Array.isArray(filePaths.salon_gallery_urls) ? filePaths.salon_gallery_urls : [];
      const salon_gallery = salon_gallery_files.length
        ? JSON.stringify(salon_gallery_files)
        : (salonGalleryFromBody.length ? JSON.stringify(salonGalleryFromBody) : existing?.salon_gallery || null);

      if (!aadhaar_url || !pan_url || !selfie_url) {
        const err = new Error('Missing required documents');
        err.statusCode = 400;
        throw err;
      }

      if (!existing) {
        await PartnerKycModel.create(
          partnerId,
          {
            partner_type,
            full_name,
            mobile: partnerMobile,
            service_area,
            service_latitude,
            service_longitude,
            experience,
            skillsJson,
            salon_name,
            salon_address,
            salon_latitude,
            salon_longitude,
            salon_logo,
            salon_gallery,
            opening_time,
            closing_time,
            aadhaar_url,
            pan_url,
            certificate_url,
            selfie_url,
          },
          conn
        );
      } else {
        const nextCount = Number(existing.submit_count || 1) + 1;
        await PartnerKycModel.updateByPartnerId(
          partnerId,
          {
            partner_type,
            full_name,
            mobile: partnerMobile,
            service_area,
            service_latitude,
            service_longitude,
            experience,
            skillsJson,
            salon_name,
            salon_address,
            salon_latitude,
            salon_longitude,
            salon_logo,
            salon_gallery,
            opening_time,
            closing_time,
            aadhaar_url,
            pan_url,
            certificate_url,
            selfie_url,
            submit_count: nextCount,
          },
          conn
        );
      }

      await conn.query("UPDATE partners SET kyc_status = 'pending' WHERE id = ?", [partnerId]);

      await conn.commit();

      const saved = await PartnerKycModel.findByPartnerId(partnerId);
      return saved;
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
      throw e;
    } finally {
      conn.release();
    }
  }
}

module.exports = PartnerKycService;
