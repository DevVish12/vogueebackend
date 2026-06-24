const db = require('../../config/db');

const normalizeKycStatus = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'verified' || v === 'rejected' || v === 'pending') return v;
  return null;
};

class AdminPartnerKycService {
  static async listAll() {
    const [rows] = await db.query(
      `
        SELECT
          pk.id,
          pk.partner_id,
          pk.partner_type,
          pk.full_name,
          pk.mobile,
          pk.service_area,
          pk.service_latitude,
          pk.service_longitude,
          pk.experience,
          pk.skills,
          pk.salon_name,
          pk.salon_address,
          pk.salon_latitude,
          pk.salon_longitude,
          pk.salon_logo,
          pk.salon_gallery,
          pk.opening_time,
          pk.closing_time,
          pk.aadhaar_url,
          pk.pan_url,
          pk.certificate_url,
          pk.selfie_url,
          pk.kyc_status,
          pk.submit_count,
          pk.created_at,
          pk.updated_at,
          p.name AS partner_name,
          p.kyc_status AS partner_kyc_status
        FROM partner_kyc pk
        LEFT JOIN partners p ON p.id = pk.partner_id
        ORDER BY pk.created_at DESC
      `
    );

    return rows;
  }

  static async getById(id) {
    const [rows] = await db.query(
      `
        SELECT
          pk.id,
          pk.partner_id,
          pk.partner_type,
          pk.full_name,
          pk.mobile,
          pk.service_area,
          pk.service_latitude,
          pk.service_longitude,
          pk.experience,
          pk.skills,
          pk.salon_name,
          pk.salon_address,
          pk.salon_latitude,
          pk.salon_longitude,
          pk.salon_logo,
          pk.salon_gallery,
          pk.opening_time,
          pk.closing_time,
          pk.aadhaar_url,
          pk.pan_url,
          pk.certificate_url,
          pk.selfie_url,
          pk.kyc_status,
          pk.submit_count,
          pk.created_at,
          pk.updated_at,
          p.name AS partner_name,
          p.kyc_status AS partner_kyc_status
        FROM partner_kyc pk
        LEFT JOIN partners p ON p.id = pk.partner_id
        WHERE pk.id = ?
        LIMIT 1
      `,
      [id]
    );

    return rows.length ? rows[0] : null;
  }

  static async updateStatus(id, nextStatus) {
    const status = normalizeKycStatus(nextStatus);
    if (!status || (status !== 'verified' && status !== 'rejected')) {
      const err = new Error('Invalid kyc_status');
      err.statusCode = 400;
      throw err;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query('SELECT id, partner_id FROM partner_kyc WHERE id = ? LIMIT 1', [id]);
      const existing = rows && rows.length ? rows[0] : null;
      if (!existing) {
        const err = new Error('KYC record not found');
        err.statusCode = 404;
        throw err;
      }

      await conn.query('UPDATE partner_kyc SET kyc_status = ? WHERE id = ?', [status, id]);
      await conn.query('UPDATE partners SET kyc_status = ? WHERE id = ?', [status, existing.partner_id]);

      await conn.commit();

      return await AdminPartnerKycService.getById(id);
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

  static async getDocumentMeta({ id, docType, index = 0 }) {
    const allowed = ['aadhaar', 'pan', 'selfie', 'certificate', 'salon_logo', 'salon_gallery'];
    if (!allowed.includes(docType)) {
      const err = new Error('Invalid document type');
      err.statusCode = 400;
      throw err;
    }

    const row = await AdminPartnerKycService.getById(id);
    if (!row) {
      const err = new Error('KYC record not found');
      err.statusCode = 404;
      throw err;
    }

    if (docType === 'salon_gallery') {
      const rawGallery = row.salon_gallery;
      let gallery = [];
      if (Array.isArray(rawGallery)) gallery = rawGallery;
      else if (typeof rawGallery === 'string') {
        try {
          const parsed = JSON.parse(rawGallery);
          gallery = Array.isArray(parsed) ? parsed : [];
        } catch {
          gallery = [];
        }
      }

      const rel = gallery[Number(index) || 0];
      if (!rel) {
        const err = new Error('Document not found');
        err.statusCode = 404;
        throw err;
      }

      return { relPath: String(rel), kycId: row.id, partnerId: row.partner_id };
    }

    const urlKey = docType === 'salon_logo' ? 'salon_logo' : `${docType}_url`;
    const rel = row[urlKey];
    if (!rel) {
      const err = new Error('Document not found');
      err.statusCode = 404;
      throw err;
    }

    return { relPath: String(rel), kycId: row.id, partnerId: row.partner_id };
  }
}

module.exports = AdminPartnerKycService;
