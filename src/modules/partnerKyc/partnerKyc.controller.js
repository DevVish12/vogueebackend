const PartnerKycService = require('./partnerKyc.service');
const { successResponse, errorResponse } = require('../../utils/response');

const parseSkills = (raw) => {
  if (Array.isArray(raw)) return raw;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  return [];
};

const parseGallery = (raw) => {
  if (Array.isArray(raw)) return raw.filter(Boolean);

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }

  return [];
};

class PartnerKycController {
  static async me(req, res, next) {
    try {
      const partnerId = req.partner?.id;
      if (!partnerId) {
        return errorResponse(res, 401, 'Not authorized, token failed');
      }

      const row = await PartnerKycService.getMyKyc({
        partnerId: Number(partnerId),
        jwtMobile: req.partner?.mobile,
      });

      if (!row) {
        return successResponse(res, 200, 'No KYC record', { kyc: null });
      }

      // skills column may be JSON (object/array) or TEXT (string)
      let skills = [];
      try {
        if (Array.isArray(row.skills)) skills = row.skills;
        else if (typeof row.skills === 'string') {
          const parsed = JSON.parse(row.skills);
          skills = Array.isArray(parsed) ? parsed : [];
        }
      } catch {
        skills = [];
      }

      return successResponse(res, 200, 'KYC record', {
        kyc: {
          id: row.id,
          partner_id: row.partner_id,
          partner_type: row.partner_type || 'solo_partner',
          full_name: row.full_name,
          mobile: row.mobile,
          service_area: row.service_area,
          service_latitude: row.service_latitude,
          service_longitude: row.service_longitude,
          experience: row.experience,
          skills,
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
        },
      });
    } catch (err) {
      next(err);
    }
  }

  static async submit(req, res, next) {
    try {
      const partnerId = req.partner?.id;
      if (!partnerId) {
        return errorResponse(res, 401, 'Not authorized, token failed');
      }

      // Optional debug
      console.log('BODY:', req.body);
      console.log('FILES:', req.files);

      // Accept both snake_case and camelCase for backwards compatibility
      const body = {
        full_name: req.body.full_name ?? req.body.fullName,
        mobile: req.body.mobile,
        service_area: req.body.service_area ?? req.body.serviceArea,
        service_latitude: req.body.service_latitude ?? req.body.serviceLatitude,
        service_longitude: req.body.service_longitude ?? req.body.serviceLongitude,
        experience: req.body.experience,
        partner_type: req.body.partner_type ?? req.body.partnerType,
        salon_name: req.body.salon_name ?? req.body.salonName,
        salon_address: req.body.salon_address ?? req.body.salonAddress,
        salon_latitude: req.body.salon_latitude ?? req.body.salonLatitude,
        salon_longitude: req.body.salon_longitude ?? req.body.salonLongitude,
        salon_logo: req.body.salon_logo ?? req.body.salonLogo,
        salon_gallery: parseGallery(req.body.salon_gallery ?? req.body.salonGallery),
        opening_time: req.body.opening_time ?? req.body.openingTime,
        closing_time: req.body.closing_time ?? req.body.closingTime,
        skills: parseSkills(req.body.skills),
      };

      const errors = [];

      const fullNameStr = String(body.full_name || '').trim();
      if (!fullNameStr || fullNameStr.length < 3) errors.push('full_name required (min 3 chars)');

      const serviceAreaStr = String(body.service_area || '').trim();
      if (!serviceAreaStr) errors.push('service_area required');

      if (!body.mobile) errors.push('mobile required');

      const partnerType = String(body.partner_type || 'solo_partner').trim() || 'solo_partner';
      if (!['solo_partner', 'partner_salon_owner'].includes(partnerType)) {
        errors.push('partner_type must be solo_partner or partner_salon_owner');
      }

      if (partnerType === 'partner_salon_owner') {
        if (!String(body.salon_name || '').trim()) errors.push('salon_name required for partner_salon_owner');
        if (!String(body.salon_address || '').trim()) errors.push('salon_address required for partner_salon_owner');
      }

      if (!Array.isArray(body.skills)) body.skills = [];

      if (errors.length) {
        return errorResponse(res, 400, 'Validation Error', errors);
      }

      const files = req.files || {};
      const getFirst = (name) => {
        const arr = files[name];
        return Array.isArray(arr) && arr.length ? arr[0] : null;
      };

      const aadhaar = getFirst('aadhaar');
      const pan = getFirst('pan');
      const selfie = getFirst('selfie');
      const certificate = getFirst('certificate');
      const salonLogo = getFirst('salon_logo');
      const salonGallery = Array.isArray(files.salon_gallery) ? files.salon_gallery : [];

      const filePaths = {
        aadhaar_url: aadhaar ? `uploads/kyc/${aadhaar.filename}` : null,
        pan_url: pan ? `uploads/kyc/${pan.filename}` : null,
        selfie_url: selfie ? `uploads/kyc/${selfie.filename}` : null,
        certificate_url: certificate ? `uploads/kyc/${certificate.filename}` : null,
        salon_logo_url: salonLogo ? `uploads/kyc/salon/${salonLogo.filename}` : null,
        salon_gallery_urls: salonGallery.map((file) => `uploads/kyc/salon/${file.filename}`),
      };

      const saved = await PartnerKycService.submitKyc({
        partnerId: Number(partnerId),
        jwtMobile: req.partner?.mobile,
        body,
        filePaths,
      });

      // Optional: socket event
      const io = req.app.get('io');
      if (io) {
        io.emit('partner:kyc_submitted', {
          id: Number(saved?.id || 0) || undefined,
          partner_id: Number(partnerId),
          full_name: String(body.full_name || ''),
          mobile: String(body.mobile || ''),
          partner_type: partnerType,
          kyc_status: 'pending',
          created_at: saved?.created_at || null,
        });
      }

      return successResponse(res, 200, 'KYC submitted', {
        partnerId: Number(partnerId),
        kycStatus: saved?.kyc_status || 'pending',
        submitCount: Number(saved?.submit_count || 1),
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = PartnerKycController;
