const path = require('path');
const fs = require('fs');
const AdminPartnerKycService = require('./adminPartnerKyc.service');
const { successResponse, errorResponse } = require('../../utils/response');

const parseSkills = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // If stored as CSV-ish string
      return s.split(',').map((x) => x.trim()).filter(Boolean);
    }
  }
  return [];
};

const parseGallery = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed.map((x) => String(x || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const toKycDto = (row) => {
  if (!row) return row;
  return {
    id: row.id,
    partner_id: row.partner_id,
    partner_type: row.partner_type || 'solo_partner',
    full_name: row.full_name,
    mobile: row.mobile,
    service_area: row.service_area,
    service_latitude: row.service_latitude,
    service_longitude: row.service_longitude,
    experience: row.experience,
    skills: parseSkills(row.skills),
    salon_name: row.salon_name,
    salon_address: row.salon_address,
    salon_latitude: row.salon_latitude,
    salon_longitude: row.salon_longitude,
    salon_logo: row.salon_logo,
    salon_gallery: parseGallery(row.salon_gallery),
    opening_time: row.opening_time,
    closing_time: row.closing_time,
    aadhaar_url: row.aadhaar_url,
    pan_url: row.pan_url,
    certificate_url: row.certificate_url,
    selfie_url: row.selfie_url,
    kyc_status: row.kyc_status,
    submit_count: row.submit_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

class AdminPartnerKycController {
  static async list(req, res, next) {
    try {
      const rows = await AdminPartnerKycService.listAll();
      return successResponse(res, 200, 'Partner KYC records', rows.map(toKycDto));
    } catch (e) {
      next(e);
    }
  }

  static async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { kyc_status } = req.body || {};
      if (!kyc_status) {
        return errorResponse(res, 400, 'Validation Error', ['kyc_status is required']);
      }

      const updated = await AdminPartnerKycService.updateStatus(Number(id), kyc_status);

      const io = req.app.get('io');
      if (io) {
        io.emit('partner:kyc_updated', {
          id: Number(id),
          partner_id: Number(updated?.partner_id),
          kyc_status: String(updated?.kyc_status || '').toLowerCase(),
        });
      }

      return successResponse(res, 200, 'KYC status updated', toKycDto(updated));
    } catch (e) {
      next(e);
    }
  }

  static async downloadDocument(req, res, next) {
    try {
      const { id, docType } = req.params;
      const galleryIndex = Number(req.query?.index || 0);
      const meta = await AdminPartnerKycService.getDocumentMeta({
        id: Number(id),
        docType: String(docType),
        index: galleryIndex,
      });

      // Ensure path stays within uploads folder
      const uploadsRoot = path.join(__dirname, '..', '..', '..', 'uploads');
      const absolute = path.resolve(uploadsRoot, meta.relPath.replace(/^uploads\//, ''));
      if (!absolute.startsWith(uploadsRoot)) {
        return errorResponse(res, 403, 'Forbidden');
      }

      if (!fs.existsSync(absolute)) {
        return errorResponse(res, 404, 'Document not found');
      }

      return res.sendFile(absolute);
    } catch (e) {
      next(e);
    }
  }
}

module.exports = AdminPartnerKycController;
