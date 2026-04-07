-- Bihar Transport Begusarai - Database Schema
-- MySQL Database for Logistics & Goods Transportation

-- Create Database
CREATE DATABASE IF NOT EXISTS bihar_transport_begusarai;
USE bihar_transport_begusarai;

-- ============================================
-- USERS TABLE (Customers)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50) DEFAULT 'Bihar',
    pincode VARCHAR(10),
    role ENUM('customer', 'driver', 'admin') DEFAULT 'customer',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- DRIVERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS drivers (
    driver_id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    license_number VARCHAR(20) UNIQUE NOT NULL,
    license_expiry DATE NOT NULL,
    aadhar_number VARCHAR(12) UNIQUE,
    date_of_birth DATE,
    gender ENUM('male', 'female', 'other'),
    experience_years INT DEFAULT 0,
    profile_image VARCHAR(255),
    is_available BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    rating DECIMAL(3,2) DEFAULT 0,
    total_deliveries INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- TRANSPORT VEHICLES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS transport_vehicles (
    vehicle_id INT PRIMARY KEY AUTO_INCREMENT,
    driver_id INT,
    vehicle_number VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type ENUM('truck', 'mini_truck', 'pickup', 'tempo', 'lorry') NOT NULL,
    vehicle_name VARCHAR(100),
    capacity_kg DECIMAL(10,2),
    capacity_volume DECIMAL(10,2),
    vehicle_make VARCHAR(50),
    vehicle_model VARCHAR(50),
    manufacturing_year INT,
    registration_date DATE,
    insurance_number VARCHAR(50),
    insurance_expiry DATE,
    permit_number VARCHAR(50),
    permit_expiry DATE,
    pollution_certificate VARCHAR(50),
    pollution_expiry DATE,
    is_available BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    current_status ENUM('available', 'on_trip', 'maintenance') DEFAULT 'available',
    base_location VARCHAR(100),
    hourly_rate DECIMAL(10,2),
    per_km_rate DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL
);

-- ============================================
-- BOOKINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS bookings (
    booking_id INT PRIMARY KEY AUTO_INCREMENT,
    booking_reference VARCHAR(20) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    driver_id INT,
    vehicle_id INT,
    
    -- Pickup Details
    pickup_location VARCHAR(200) NOT NULL,
    pickup_address TEXT,
    pickup_city VARCHAR(100) NOT NULL,
    pickup_state VARCHAR(50) DEFAULT 'Bihar',
    pickup_pincode VARCHAR(10),
    pickup_date DATE NOT NULL,
    pickup_time TIME NOT NULL,
    
    -- Drop Details
    drop_location VARCHAR(200) NOT NULL,
    drop_address TEXT,
    drop_city VARCHAR(100) NOT NULL,
    drop_state VARCHAR(50) DEFAULT 'Bihar',
    drop_pincode VARCHAR(10),
    
    -- Goods Details
    goods_description TEXT NOT NULL,
    goods_type VARCHAR(100),
    goods_weight_kg DECIMAL(10,2),
    goods_volume DECIMAL(10,2),
    number_of_items INT DEFAULT 1,
    fragile BOOLEAN DEFAULT FALSE,
    
    -- Vehicle Type Required
    vehicle_type_required ENUM('truck', 'mini_truck', 'pickup', 'tempo', 'lorry') NOT NULL,
    
    -- Pricing
    estimated_distance_km DECIMAL(10,2),
    estimated_price DECIMAL(10,2),
    final_price DECIMAL(10,2),
    
    -- Status
    status ENUM('pending', 'confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'cancelled', 'completed') DEFAULT 'pending',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP NULL,
    driver_assigned_at TIMESTAMP NULL,
    pickup_completed_at TIMESTAMP NULL,
    delivered_at TIMESTAMP NULL,
    
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL,
    FOREIGN KEY (vehicle_id) REFERENCES transport_vehicles(vehicle_id) ON DELETE SET NULL
);

-- ============================================
-- DELIVERIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS deliveries (
    delivery_id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL UNIQUE,
    driver_id INT,
    vehicle_id INT,
    
    -- Current Status
    current_status ENUM('booking_confirmed', 'driver_assigned', 'pickup_in_progress', 'pickup_completed', 'in_transit', 'out_for_delivery', 'delivered') DEFAULT 'booking_confirmed',
    status_description VARCHAR(255),
    
    -- Driver Location Tracking
    current_latitude DECIMAL(10,8),
    current_longitude DECIMAL(11,8),
    last_location_update TIMESTAMP,
    
    -- Pickup Details
    estimated_pickup_time DATETIME,
    actual_pickup_time DATETIME,
    
    -- Delivery Details
    estimated_delivery_time DATETIME,
    actual_delivery_time DATETIME,
    
    -- OTP for Delivery
    delivery_otp VARCHAR(6),
    otp_verified BOOLEAN DEFAULT FALSE,
    
    -- Proof of Delivery
    delivery_proof_image VARCHAR(255),
    delivery_notes TEXT,
    recipient_name VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL,
    FOREIGN KEY (vehicle_id) REFERENCES transport_vehicles(vehicle_id) ON DELETE SET NULL
);

-- ============================================
-- ADMINS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
    admin_id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(15),
    role ENUM('super_admin', 'admin', 'operator') DEFAULT 'admin',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);

CREATE INDEX idx_drivers_user ON drivers(user_id);
CREATE INDEX idx_drivers_license ON drivers(license_number);
CREATE INDEX idx_drivers_available ON drivers(is_available);

CREATE INDEX idx_vehicles_driver ON transport_vehicles(driver_id);
CREATE INDEX idx_vehicles_number ON transport_vehicles(vehicle_number);
CREATE INDEX idx_vehicles_type ON transport_vehicles(vehicle_type);
CREATE INDEX idx_vehicles_available ON transport_vehicles(is_available);

CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_driver ON bookings(driver_id);
CREATE INDEX idx_bookings_reference ON bookings(booking_reference);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_date ON bookings(pickup_date);

CREATE INDEX idx_deliveries_booking ON deliveries(booking_id);
CREATE INDEX idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX idx_deliveries_status ON deliveries(current_status);

-- ============================================
-- SEED DATA
-- ============================================

-- Insert Admin (password: Admin@123)
INSERT INTO admins (username, email, password_hash, full_name, phone, role) VALUES
('admin', 'admin@bihartransport.com', '$2a$10$xVfYjKn0k5zYvQmPqX5O0eHqYqXGXqXqXqXqXqXqXqXqXqXqXqXqX', 'System Administrator', '9876543210', 'super_admin');

-- Insert Sample Customers (password: User@123)
INSERT INTO users (first_name, last_name, email, phone, password_hash, address, city, state, role) VALUES
('Rahul', 'Kumar', 'rahul.kumar@email.com', '9876543210', '$2a$10$xVfYjKn0k5zYvQmPqX5O0eHqYqXGXqXqXqXqXqXqXqXqXqXqXqXqX', '123 Main Road, Begusarai', 'Begusarai', 'Bihar', 'customer'),
('Priya', 'Singh', 'priya.singh@email.com', '9876543211', '$2a$10$xVfYjKn0k5zYvQmPqX5O0eHqYqXGXqXqXqXqXqXqXqXqXqXqXqXqX', '456 Market Road, Patna', 'Patna', 'Bihar', 'customer'),
('Amit', 'Pandey', 'amit.pandey@email.com', '9876543212', '$2a$10$xVfYjKn0k5zYvQmPqX5O0eHqYqXGXqXqXqXqXqXqXqXqXqXqXqXqX', '789 Gandhi Chowk, Muzaffarpur', 'Muzaffarpur', 'Bihar', 'customer');

-- Insert Sample Drivers (linked to users)
INSERT INTO drivers (user_id, license_number, license_expiry, aadhar_number, date_of_birth, gender, experience_years, is_available, is_verified, rating, total_deliveries) VALUES
(1, 'DL/BR/012345/2020', '2030-06-15', '123456789012', '1990-05-15', 'male', 5, TRUE, TRUE, 4.8, 150),
(2, 'DL/BR/067890/2021', '2031-03-20', '123456789013', '1992-08-22', 'male', 3, TRUE, TRUE, 4.5, 80),
(3, 'DL/BR/023456/2019', '2029-11-10', '123456789014', '1988-12-01', 'male', 8, TRUE, TRUE, 4.9, 250);

-- Insert Sample Transport Vehicles
INSERT INTO transport_vehicles (driver_id, vehicle_number, vehicle_type, vehicle_name, capacity_kg, capacity_volume, vehicle_make, vehicle_model, manufacturing_year, registration_date, insurance_number, insurance_expiry, permit_number, permit_expiry, is_available, is_verified, current_status, base_location, hourly_rate, per_km_rate) VALUES
(1, 'BR09AA0001', 'truck', 'Tata 16 Ton Truck', 16000, 50, 'Tata', 'LPT 1618', 2020, '2020-05-15', 'INS/2020/001', '2025-05-14', 'PERMIT/001', '2025-05-14', TRUE, TRUE, 'available', 'Begusarai', 500, 25),
(1, 'BR09AA0002', 'mini_truck', 'Tata Ace Mini Truck', 3500, 15, 'Tata', 'Ace HT', 2021, '2021-03-10', 'INS/2021/002', '2026-03-09', 'PERMIT/002', '2026-03-09', TRUE, TRUE, 'available', 'Begusarai', 300, 18),
(2, 'BR09BB0003', 'pickup', 'Mahindra Bolero Pickup', 1500, 8, 'Mahindra', 'Bolero Pickup', 2022, '2022-01-05', 'INS/2022/003', '2027-01-04', 'PERMIT/003', '2027-01-04', TRUE, TRUE, 'available', 'Patna', 250, 15),
(3, 'BR09CC0004', 'tempo', 'Ashok Leyland Tempo', 5000, 25, 'Ashok Leyland', 'Dost', 2019, '2019-08-20', 'INS/2019/004', '2024-08-19', 'PERMIT/004', '2024-08-19', TRUE, TRUE, 'available', 'Muzaffarpur', 400, 20),
(3, 'BR09CC0005', 'lorry', 'BharatBenz Lorry', 20000, 65, 'BharatBenz', 'Lorry 2820', 2021, '2021-11-01', 'INS/2021/005', '2026-10-31', 'PERMIT/005', '2026-10-31', TRUE, TRUE, 'available', 'Muzaffarpur', 700, 30);

-- Insert Sample Bookings
INSERT INTO bookings (booking_reference, user_id, driver_id, vehicle_id, pickup_location, pickup_address, pickup_city, drop_location, drop_address, drop_city, goods_description, goods_type, goods_weight_kg, vehicle_type_required, estimated_distance_km, estimated_price, final_price, status) VALUES
('BTB-001', 1, 1, 1, 'Begusarai Railway Station', 'Near Platform 1', 'Begusarai', 'Patna Railway Station', 'Near Platform 2', 'Patna', 'Electronics - Computer Monitors', 'Electronics', 500, 'truck', 180, 4500, 4500, 'completed'),
('BTB-002', 2, 2, 3, 'Patna Airport Cargo', 'Cargo Terminal', 'Patna', 'Gaya Bus Stand', 'Near Ticket Counter', 'Gaya', 'Food Packages - Packaged Rice', 'Food Items', 1000, 'pickup', 120, 2500, 2500, 'delivered'),
('BTB-003', 3, 3, 4, 'Muzaffarpur Warehouse', 'Warehouse No. 5', 'Muzaffarpur', 'Darbhanga Market', 'Shop No. 23', 'Darbhanga', 'Furniture - Office Chairs', 'Furniture', 800, 'tempo', 90, 2000, 2000, 'in_transit');

-- Insert Sample Deliveries
INSERT INTO deliveries (booking_id, driver_id, vehicle_id, current_status, status_description, estimated_pickup_time, estimated_delivery_time) VALUES
(1, 1, 1, 'delivered', 'Package delivered successfully', '2024-01-15 10:00:00', '2024-01-15 14:30:00'),
(2, 2, 3, 'delivered', 'Package delivered to recipient', '2024-01-20 09:00:00', '2024-01-20 12:00:00'),
(3, 3, 4, 'in_transit', 'Vehicle currently in transit', '2024-02-10 08:00:00', '2024-02-10 11:00:00');

