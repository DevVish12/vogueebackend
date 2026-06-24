const db = require('../../config/db');

class PartnerKycModel {
  static async ensureTable() {
    const createWithJson = `
      CREATE TABLE IF NOT EXISTS partner_kyc (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL UNIQUE,
        partner_type VARCHAR(50) DEFAULT 'solo_partner',
        full_name VARCHAR(120) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        service_area VARCHAR(255) NOT NULL,
        service_latitude DECIMAL(10, 7) DEFAULT NULL,
        service_longitude DECIMAL(10, 7) DEFAULT NULL,
        experience VARCHAR(60) DEFAULT NULL,
        skills JSON NOT NULL,
        salon_name VARCHAR(255) DEFAULT NULL,
        salon_address TEXT DEFAULT NULL,
        salon_latitude DECIMAL(10, 7) DEFAULT NULL,
        salon_longitude DECIMAL(10, 7) DEFAULT NULL,
        salon_logo VARCHAR(255) DEFAULT NULL,
        salon_gallery JSON DEFAULT NULL,
        opening_time VARCHAR(30) DEFAULT NULL,
        closing_time VARCHAR(30) DEFAULT NULL,
        aadhaar_url VARCHAR(255) DEFAULT NULL,
        pan_url VARCHAR(255) DEFAULT NULL,
        certificate_url VARCHAR(255) DEFAULT NULL,
        selfie_url VARCHAR(255) DEFAULT NULL,
        kyc_status ENUM('pending','verified','rejected') DEFAULT 'pending',
        submit_count INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_kyc_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
      )
    `;

    const createWithText = `
      CREATE TABLE IF NOT EXISTS partner_kyc (
        id INT AUTO_INCREMENT PRIMARY KEY,
        partner_id INT NOT NULL UNIQUE,
        partner_type VARCHAR(50) DEFAULT 'solo_partner',
        full_name VARCHAR(120) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        service_area VARCHAR(255) NOT NULL,
        service_latitude DECIMAL(10, 7) DEFAULT NULL,
        service_longitude DECIMAL(10, 7) DEFAULT NULL,
        experience VARCHAR(60) DEFAULT NULL,
        skills TEXT NOT NULL,
        salon_name VARCHAR(255) DEFAULT NULL,
        salon_address TEXT DEFAULT NULL,
        salon_latitude DECIMAL(10, 7) DEFAULT NULL,
        salon_longitude DECIMAL(10, 7) DEFAULT NULL,
        salon_logo VARCHAR(255) DEFAULT NULL,
        salon_gallery TEXT DEFAULT NULL,
        opening_time VARCHAR(30) DEFAULT NULL,
        closing_time VARCHAR(30) DEFAULT NULL,
        aadhaar_url VARCHAR(255) DEFAULT NULL,
        pan_url VARCHAR(255) DEFAULT NULL,
        certificate_url VARCHAR(255) DEFAULT NULL,
        selfie_url VARCHAR(255) DEFAULT NULL,
        kyc_status ENUM('pending','verified','rejected') DEFAULT 'pending',
        submit_count INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_partner_kyc_partner FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
      )
    `;

    try {
      await db.query(createWithJson);
    } catch (e) {
      // Fallback for older MySQL variants without JSON type
      await db.query(createWithText);
    }

    // Migrations (best-effort, ignore if already exists)
    const addColumn = async (sql) => {
      try {
        await db.query(sql);
      } catch (_) {
        // ignore
      }
    };

    await addColumn("ALTER TABLE partner_kyc ADD COLUMN kyc_status ENUM('pending','verified','rejected') DEFAULT 'pending'");
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN submit_count INT DEFAULT 1');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await addColumn("ALTER TABLE partner_kyc ADD COLUMN partner_type VARCHAR(50) DEFAULT 'solo_partner'");
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN salon_name VARCHAR(255) DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN salon_address TEXT DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN salon_latitude DECIMAL(10, 7) DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN salon_longitude DECIMAL(10, 7) DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN salon_logo VARCHAR(255) DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN salon_gallery JSON DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN opening_time VARCHAR(30) DEFAULT NULL');
    await addColumn('ALTER TABLE partner_kyc ADD COLUMN closing_time VARCHAR(30) DEFAULT NULL');
  }

  static async findByPartnerId(partnerId, conn = db) {
    const [rows] = await conn.query('SELECT * FROM partner_kyc WHERE partner_id = ? LIMIT 1', [partnerId]);
    return rows.length ? rows[0] : null;
  }

  static async create(partnerId, payload, conn = db) {
    const {
      partner_type,
      full_name,
      mobile,
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
    } = payload;

    const [result] = await conn.query(
      `
        INSERT INTO partner_kyc (
          partner_id,
          partner_type,
          full_name,
          mobile,
          service_area,
          service_latitude,
          service_longitude,
          experience,
          skills,
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
          kyc_status,
          submit_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)
      `,
      [
        partnerId,
        partner_type,
        full_name,
        mobile,
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
      ]
    );

    return result.insertId;
  }

  static async updateByPartnerId(partnerId, payload, conn = db) {
    const {
      partner_type,
      full_name,
      mobile,
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
      submit_count,
    } = payload;

    await conn.query(
      `
        UPDATE partner_kyc
        SET
          partner_type = ?,
          full_name = ?,
          mobile = ?,
          service_area = ?,
          service_latitude = ?,
          service_longitude = ?,
          experience = ?,
          skills = ?,
          salon_name = ?,
          salon_address = ?,
          salon_latitude = ?,
          salon_longitude = ?,
          salon_logo = ?,
          salon_gallery = ?,
          opening_time = ?,
          closing_time = ?,
          aadhaar_url = ?,
          pan_url = ?,
          certificate_url = ?,
          selfie_url = ?,
          submit_count = ?,
          kyc_status = 'pending'
        WHERE partner_id = ?
      `,
      [
        partner_type,
        full_name,
        mobile,
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
        submit_count,
        partnerId,
      ]
    );
  }
}

module.exports = PartnerKycModel;
