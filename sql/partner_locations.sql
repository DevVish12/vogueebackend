-- Create partner_locations table for storing partner GPS coordinates
-- Note: partner_id must be UNIQUE for ON DUPLICATE KEY UPDATE upsert to work.

CREATE TABLE IF NOT EXISTS partner_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  partner_id INT NOT NULL UNIQUE,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  address TEXT DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
