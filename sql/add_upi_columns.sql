-- UPI Verification Setup
-- Add UPI columns to partners table

ALTER TABLE partners ADD COLUMN upi_id VARCHAR(100) DEFAULT NULL;
ALTER TABLE partners ADD COLUMN upi_verified BOOLEAN DEFAULT false;
ALTER TABLE partners ADD COLUMN upi_verified_at DATETIME DEFAULT NULL;

-- Create index for faster lookups
ALTER TABLE partners ADD INDEX idx_upi_verified (upi_verified);
