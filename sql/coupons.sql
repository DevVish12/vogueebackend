CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coupon_code VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT DEFAULT NULL,
  discount_type ENUM('flat','percentage') NOT NULL,
  discount_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
  max_discount DECIMAL(10, 2) DEFAULT NULL,
  min_booking_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  service_mode ENUM('all','home','salon') NOT NULL DEFAULT 'all',
  service_ids JSON DEFAULT NULL,
  category_ids JSON DEFAULT NULL,
  total_usage_limit INT DEFAULT NULL,
  used_count INT NOT NULL DEFAULT 0,
  per_user_limit INT NOT NULL DEFAULT 1,
  is_first_booking_only TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  expiry_date DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupon_usages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coupon_id INT NOT NULL,
  user_id INT NOT NULL,
  booking_id VARCHAR(80) DEFAULT NULL,
  coupon_code VARCHAR(80) NOT NULL,
  original_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  final_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_coupon_booking (booking_id)
);

ALTER TABLE payments
  ADD COLUMN coupon_id INT DEFAULT NULL,
  ADD COLUMN coupon_code VARCHAR(80) DEFAULT NULL,
  ADD COLUMN coupon_discount DECIMAL(10, 2) DEFAULT NULL,
  ADD COLUMN original_amount DECIMAL(10, 2) DEFAULT NULL,
  ADD COLUMN final_amount_after_discount DECIMAL(10, 2) DEFAULT NULL;