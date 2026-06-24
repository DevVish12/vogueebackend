const fs = require('fs/promises');
const path = require('path');
const db = require('../../config/db');

const uploadsRoot = path.join(__dirname, '..', '..', '..', 'uploads');

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
  const a1 = toNumber(lat1);
  const o1 = toNumber(lng1);
  const a2 = toNumber(lat2);
  const o2 = toNumber(lng2);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;

  const R = 6371;
  const dLat = ((a2 - a1) * Math.PI) / 180;
  const dLng = ((o2 - o1) * Math.PI) / 180;
  const sLat1 = (a1 * Math.PI) / 180;
  const sLat2 = (a2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const parseJsonArray = (raw) => {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
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

const extToMime = (filePath) => {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.avif') return 'image/avif';
  return 'image/jpeg';
};

const safeResolveUpload = (relPath) => {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const absolute = path.resolve(uploadsRoot, normalized.replace(/^uploads\//, ''));
  if (!absolute.startsWith(uploadsRoot)) return null;
  return absolute;
};

const toDataUrl = async (relPath) => {
  if (!relPath) return '';
  const absolute = safeResolveUpload(relPath);
  if (!absolute) return '';

  try {
    const file = await fs.readFile(absolute);
    const mime = extToMime(absolute);
    return `data:${mime};base64,${file.toString('base64')}`;
  } catch {
    return '';
  }
};

const buildSalonDto = async (row, userLat = null, userLng = null) => {
  const gallery = parseJsonArray(row?.salon_gallery);
  const banner = await toDataUrl(row?.salon_logo);
  const galleryData = await Promise.all(gallery.map((item) => toDataUrl(item)));

  const salonLat = row?.salon_latitude ?? row?.location_lat ?? row?.service_latitude ?? row?.partner_lat ?? null;
  const salonLng = row?.salon_longitude ?? row?.location_lng ?? row?.service_longitude ?? row?.partner_lng ?? null;
  const distanceKm = calculateDistanceKm(userLat, userLng, salonLat, salonLng);
  const skills = parseJsonArray(row?.skills);

  return {
    id: Number(row.id),
    partner_id: Number(row.partner_id),
    partnerId: Number(row.partner_id),
    partner_type: row.partner_type || 'partner_salon_owner',
    business_type: 'salon',
    owner_name: row.full_name || 'Verified Salon Owner',
    salon_name: row.salon_name || 'Verified Salon',
    salon_address: row.salon_address || '',
    salon_latitude: salonLat == null ? null : Number(salonLat),
    salon_longitude: salonLng == null ? null : Number(salonLng),
    salon_logo: row.salon_logo || '',
    salon_banner: banner,
    salon_gallery: galleryData.filter(Boolean),
    opening_time: row.opening_time || '',
    closing_time: row.closing_time || '',
    distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(1)) : null,
    distance: Number.isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : '',
    rating: row.rating == null ? null : Number(row.rating),
    verified: String(row.kyc_status || '').trim().toLowerCase() === 'verified',
    service_count: skills.length,
    services: skills,
    about: row.salon_description || row.service_area || '',
  };
};

class SalonService {
  static async getNearby({ lat, lng }) {
    const userLat = toNumber(lat);
    const userLng = toNumber(lng);

    const [rows] = await db.query(
      `
        SELECT
          pk.id,
          pk.partner_id,
          pk.partner_type,
          pk.full_name,
          pk.service_area,
          pk.service_latitude,
          pk.service_longitude,
          pk.salon_name,
          pk.salon_address,
          pk.salon_latitude,
          pk.salon_longitude,
          pk.salon_logo,
          pk.salon_gallery,
          pk.opening_time,
          pk.closing_time,
          pk.skills,
          pk.kyc_status,
          p.rating,
          pl.lat AS location_lat,
          pl.lng AS location_lng
        FROM partner_kyc pk
        INNER JOIN partners p ON p.id = pk.partner_id
        LEFT JOIN partner_locations pl ON pl.partner_id = pk.partner_id
        WHERE pk.partner_type = 'partner_salon_owner'
          AND pk.kyc_status = 'verified'
      `
    );

    const salons = await Promise.all((Array.isArray(rows) ? rows : []).map((row) => buildSalonDto(row, userLat, userLng)));

    salons.sort((a, b) => {
      const ad = Number.isFinite(a.distance_km) ? a.distance_km : Number.POSITIVE_INFINITY;
      const bd = Number.isFinite(b.distance_km) ? b.distance_km : Number.POSITIVE_INFINITY;
      return ad - bd;
    });

    return salons;
  }

  static async getById(id, { lat = null, lng = null } = {}) {
    const salonId = Number(id);
    if (!Number.isFinite(salonId)) return null;

    const [rows] = await db.query(
      `
        SELECT
          pk.id,
          pk.partner_id,
          pk.partner_type,
          pk.full_name,
          pk.service_area,
          pk.service_latitude,
          pk.service_longitude,
          pk.salon_name,
          pk.salon_address,
          pk.salon_latitude,
          pk.salon_longitude,
          pk.salon_logo,
          pk.salon_gallery,
          pk.opening_time,
          pk.closing_time,
          pk.skills,
          pk.kyc_status,
          p.rating,
          pl.lat AS location_lat,
          pl.lng AS location_lng
        FROM partner_kyc pk
        INNER JOIN partners p ON p.id = pk.partner_id
        LEFT JOIN partner_locations pl ON pl.partner_id = pk.partner_id
        WHERE pk.id = ?
          AND pk.partner_type = 'partner_salon_owner'
          AND pk.kyc_status = 'verified'
        LIMIT 1
      `,
      [salonId]
    );

    if (!rows || !rows.length) return null;
    return buildSalonDto(rows[0], lat, lng);
  }
}

module.exports = SalonService;