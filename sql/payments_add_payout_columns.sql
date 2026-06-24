-- Adds Razorpay payout tracking columns to `payments`
-- Safe to run once; if columns exist already, remove the failing statements or use IF NOT EXISTS on MySQL 8+

ALTER TABLE payments
  ADD COLUMN payout_id VARCHAR(100) DEFAULT NULL,
  ADD COLUMN payout_status VARCHAR(50) DEFAULT NULL;
