-- Add dispatch scheduling fields to payments table
-- Safe to run multiple times (will error on duplicate columns if already added).

ALTER TABLE payments ADD COLUMN booking_type VARCHAR(20) DEFAULT NULL;
ALTER TABLE payments ADD COLUMN dispatch_time DATETIME DEFAULT NULL;
ALTER TABLE payments ADD COLUMN dispatched TINYINT DEFAULT 0;
