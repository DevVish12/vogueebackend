-- Payments History Required Columns
--
-- Purpose:
-- Ensure `payments` table has the columns required by the mobile apps' payment history
-- screen(s) and proof-image flow.
--
-- Notes:
-- - This script is additive only (no deletes, no data loss).
-- - Some MySQL versions do not support `IF NOT EXISTS` for columns.
--   If you see "Duplicate column name" errors, you can safely ignore/remove
--   the failing statement(s).
--
-- Recommended to run during deployment/migration.

ALTER TABLE payments ADD COLUMN booking_id VARCHAR(80) NULL;
ALTER TABLE payments ADD COLUMN transaction_id VARCHAR(120) NULL;
ALTER TABLE payments ADD COLUMN order_id VARCHAR(120) NULL;
ALTER TABLE payments ADD COLUMN signature VARCHAR(255) NULL;

ALTER TABLE payments ADD COLUMN service_name VARCHAR(255) NULL;
ALTER TABLE payments ADD COLUMN amount DECIMAL(10,2) NULL;

ALTER TABLE payments ADD COLUMN status VARCHAR(30) NULL;
ALTER TABLE payments ADD COLUMN payment_status VARCHAR(20) NULL;

ALTER TABLE payments ADD COLUMN slot_date VARCHAR(40) NULL;
ALTER TABLE payments ADD COLUMN slot_time VARCHAR(40) NULL;
ALTER TABLE payments ADD COLUMN address TEXT NULL;

ALTER TABLE payments ADD COLUMN proof_image TEXT NULL;
ALTER TABLE payments ADD COLUMN partner_notes TEXT NULL;
ALTER TABLE payments ADD COLUMN service_otp VARCHAR(10) NULL;
ALTER TABLE payments ADD COLUMN proof_uploaded TINYINT DEFAULT 0;

ALTER TABLE payments ADD COLUMN booking_status VARCHAR(30) NULL;
ALTER TABLE payments ADD COLUMN booking_type VARCHAR(20) NULL;
ALTER TABLE payments ADD COLUMN dispatch_time DATETIME NULL;
ALTER TABLE payments ADD COLUMN dispatched TINYINT DEFAULT 0;

ALTER TABLE payments ADD COLUMN partner_id INT NULL;
ALTER TABLE payments ADD COLUMN partner_payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending';
ALTER TABLE payments ADD COLUMN paid_at DATETIME NULL;
ALTER TABLE payments ADD COLUMN utr_number VARCHAR(100) NULL;

ALTER TABLE payments ADD COLUMN payout_id VARCHAR(100) NULL;
ALTER TABLE payments ADD COLUMN payout_status VARCHAR(50) NULL;

-- Helpful indexes (optional)
-- Create only if missing; if they already exist, MySQL will error and you can ignore.
CREATE INDEX idx_payments_user_id ON payments (user_id);
CREATE UNIQUE INDEX uniq_payments_transaction_id ON payments (transaction_id);
