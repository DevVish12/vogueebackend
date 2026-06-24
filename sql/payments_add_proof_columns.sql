-- Adds columns required for service proof upload flow
-- Run this against your MySQL database

ALTER TABLE payments
  ADD COLUMN proof_image TEXT NULL,
  ADD COLUMN partner_notes TEXT NULL;
