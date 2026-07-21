const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Determine the correct database path
// For local development: uses the local database folder
// For production (Render): uses /tmp which is writable
const isProduction = process.env.NODE_ENV === 'production';
const dbDir = isProduction ? '/tmp' : path.join(__dirname, '../../database');
const dbPath = path.join(dbDir, 'transport.db');

// Ensure database directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('✅ SQLite database connected');
    initializeDatabase();
  }
});

const initializeDatabase = () => {
  db.serialize(() => {
    // Users table (Customers)
    db.run(`CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      address TEXT,
      city TEXT,
      state TEXT DEFAULT 'Bihar',
      pincode TEXT,
      role TEXT DEFAULT 'customer',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Drivers table
    db.run(`CREATE TABLE IF NOT EXISTS drivers (
      driver_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      license_number TEXT UNIQUE NOT NULL,
      license_expiry TEXT NOT NULL,
      aadhar_number TEXT,
      date_of_birth TEXT,
      gender TEXT,
      experience_years INTEGER DEFAULT 0,
      profile_image TEXT,
      is_available INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      total_deliveries INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )`);

    // Transport Vehicles table
    db.run(`CREATE TABLE IF NOT EXISTS transport_vehicles (
      vehicle_id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_id INTEGER,
      vehicle_number TEXT UNIQUE NOT NULL,
      vehicle_type TEXT NOT NULL,
      vehicle_name TEXT,
      capacity_kg REAL,
      capacity_volume REAL,
      vehicle_make TEXT,
      vehicle_model TEXT,
      manufacturing_year INTEGER,
      registration_date TEXT,
      insurance_number TEXT,
      insurance_expiry TEXT,
      permit_number TEXT,
      permit_expiry TEXT,
      pollution_certificate TEXT,
      pollution_expiry TEXT,
      is_available INTEGER DEFAULT 1,
      is_verified INTEGER DEFAULT 0,
      current_status TEXT DEFAULT 'available',
      base_location TEXT,
      hourly_rate REAL,
      per_km_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id)
    )`);

    // Bookings table
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
      booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_reference TEXT UNIQUE NOT NULL,
      booking_number TEXT,
      user_id INTEGER NOT NULL,
      driver_id INTEGER,
      vehicle_id INTEGER,
      pickup_location TEXT NOT NULL,
      pickup_address TEXT,
      pickup_city TEXT NOT NULL,
      pickup_state TEXT DEFAULT 'Bihar',
      pickup_pincode TEXT,
      pickup_date TEXT NOT NULL,
      pickup_time TEXT NOT NULL,
      drop_location TEXT NOT NULL,
      drop_address TEXT,
      drop_city TEXT NOT NULL,
      drop_state TEXT DEFAULT 'Bihar',
      drop_pincode TEXT,
      goods_description TEXT NOT NULL,
      goods_type TEXT,
      goods_weight_kg REAL,
      goods_volume REAL,
      number_of_items INTEGER DEFAULT 1,
      fragile INTEGER DEFAULT 0,
      vehicle_type_required TEXT NOT NULL,
      estimated_distance_km REAL,
      estimated_price REAL,
      final_price REAL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      driver_assigned_at DATETIME,
      pickup_completed_at DATETIME,
      delivered_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
      FOREIGN KEY (vehicle_id) REFERENCES transport_vehicles(vehicle_id)
    )`);

    // Backward compatible migration for booking_number (idempotent)
    db.run(`PRAGMA table_info(bookings)`, [], function(err, cols) {
      if (err) {
        console.error('PRAGMA table_info(bookings) failed:', err);
        return;
      }
      const hasBookingNumber = (cols || []).some(c => c.name === 'booking_number');

      if (!hasBookingNumber) {
        db.run(`ALTER TABLE bookings ADD COLUMN booking_number TEXT`, (err2) => {
          if (err2) {
            // If already added by the CREATE TABLE path above, ignore duplicate column errors.
            if (String(err2.message || err2).includes('duplicate column name')) {
              console.log('ℹ️ booking_number already exists (duplicate ignored)');
              return;
            }
            console.error('ALTER TABLE bookings ADD COLUMN booking_number failed:', err2);
          } else {
            console.log('✅ booking_number column added to bookings');
          }
        });
      }
    });


    // booking_events table
    db.run(`CREATE TABLE IF NOT EXISTS booking_events (
      booking_event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE
    )`);

    // booking_assignments table
    db.run(`CREATE TABLE IF NOT EXISTS booking_assignments (
      booking_assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      assigned_driver_id INTEGER,
      assigned_vehicle_id INTEGER,
      assigned_by_admin_id INTEGER,
      assignment_status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_vehicle_id) REFERENCES transport_vehicles(vehicle_id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_by_admin_id) REFERENCES admins(admin_id) ON DELETE SET NULL
    )`);

    // Indexes (additive/idempotent)
    // NOTE: booking_number may have been added via ALTER TABLE above; index creation is safe to keep idempotent.
    db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_booking_number ON bookings(booking_number)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(booking_reference)`);


    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_events_booking_id ON booking_events(booking_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_events_event_type ON booking_events(event_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_events_created_at ON booking_events(created_at)`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_assignments_booking_id ON booking_assignments(booking_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_assignments_driver_id ON booking_assignments(assigned_driver_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_assignments_vehicle_id ON booking_assignments(assigned_vehicle_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_booking_assignments_created_at ON booking_assignments(created_at)`);

    // Deliveries table
    db.run(`CREATE TABLE IF NOT EXISTS deliveries (
      delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE,
      driver_id INTEGER,
      vehicle_id INTEGER,
      current_status TEXT DEFAULT 'booking_confirmed',
      status_description TEXT,
      current_latitude REAL,
      current_longitude REAL,
      last_location_update DATETIME,
      estimated_pickup_time DATETIME,
      actual_pickup_time DATETIME,
      estimated_delivery_time DATETIME,
      actual_delivery_time DATETIME,
      delivery_otp TEXT,
      otp_verified INTEGER DEFAULT 0,
      delivery_proof_image TEXT,
      delivery_notes TEXT,
      recipient_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
      FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
      FOREIGN KEY (vehicle_id) REFERENCES transport_vehicles(vehicle_id)
    )`);

    // Admins table
    db.run(`CREATE TABLE IF NOT EXISTS admins (
      admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'admin',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert seed data
    insertSeedData();
  });
};

const insertSeedData = () => {
  // Check if data already exists
  db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
    if (row.count > 0) {
      console.log('📊 Database already has data');
      return;
    }

    console.log('📊 Inserting seed data...');

    // Insert Admin
    db.run(`INSERT INTO admins (username, email, password_hash, full_name, phone, role) VALUES 
      ('admin', 'admin@bihartransport.com', '$2a$10$ogvUKBvIavNZgGa9vJPNt.PqUcSkJEC5mwblr48mHkSGy58YJg5au', 'System Administrator', '9876543210', 'super_admin')`);

    // Insert Users (Customers)
    db.run(`INSERT INTO users (first_name, last_name, email, phone, password_hash, address, city, state, role) VALUES 
      ('Rahul', 'Kumar', 'rahul.kumar@email.com', '9876543210', '$2a$10$ogvUKBvIavNZgGa9vJPNt.PqUcSkJEC5mwblr48mHkSGy58YJg5au', '123 Main Road, Begusarai', 'Begusarai', 'Bihar', 'customer'),
      ('Priya', 'Singh', 'priya.singh@email.com', '9876543211', '$2a$10$ogvUKBvIavNZgGa9vJPNt.PqUcSkJEC5mwblr48mHkSGy58YJg5au', '456 Market Road, Patna', 'Patna', 'Bihar', 'customer'),
      ('Amit', 'Pandey', 'amit.pandey@email.com', '9876543212', '$2a$10$ogvUKBvIavNZgGa9vJPNt.PqUcSkJEC5mwblr48mHkSGy58YJg5au', '789 Gandhi Chowk, Muzaffarpur', 'Muzaffarpur', 'Bihar', 'customer')`);

    // Insert Drivers
    db.run(`INSERT INTO drivers (user_id, license_number, license_expiry, aadhar_number, date_of_birth, gender, experience_years, is_available, is_verified, rating, total_deliveries) VALUES
      (1, 'DL/BR/012345/2020', '2030-06-15', '123456789012', '1990-05-15', 'male', 5, 1, 1, 4.8, 150),
      (2, 'DL/BR/067890/2021', '2031-03-20', '123456789013', '1992-08-22', 'male', 3, 1, 1, 4.5, 80),
      (3, 'DL/BR/023456/2019', '2029-11-10', '123456789014', '1988-12-01', 'male', 8, 1, 1, 4.9, 250)`);

    // Insert Transport Vehicles
    db.run(`INSERT INTO transport_vehicles (driver_id, vehicle_number, vehicle_type, vehicle_name, capacity_kg, capacity_volume, vehicle_make, vehicle_model, manufacturing_year, registration_date, insurance_number, insurance_expiry, permit_number, permit_expiry, is_available, is_verified, current_status, base_location, hourly_rate, per_km_rate) VALUES 
      (1, 'BR09AA0001', 'truck', 'Tata 16 Ton Truck', 16000, 50, 'Tata', 'LPT 1618', 2020, '2020-05-15', 'INS/2020/001', '2025-05-14', 'PERMIT/001', '2025-05-14', 1, 1, 'available', 'Begusarai', 500, 25),
      (1, 'BR09AA0002', 'mini_truck', 'Tata Ace Mini Truck', 3500, 15, 'Tata', 'Ace HT', 2021, '2021-03-10', 'INS/2021/002', '2026-03-09', 'PERMIT/002', '2026-03-09', 1, 1, 'available', 'Begusarai', 300, 18),
      (2, 'BR09BB0003', 'pickup', 'Mahindra Bolero Pickup', 1500, 8, 'Mahindra', 'Bolero Pickup', 2022, '2022-01-05', 'INS/2022/003', '2027-01-04', 'PERMIT/003', '2027-01-04', 1, 1, 'available', 'Patna', 250, 15),
      (3, 'BR09CC0004', 'tempo', 'Ashok Leyland Tempo', 5000, 25, 'Ashok Leyland', 'Dost', 2019, '2019-08-20', 'INS/2019/004', '2024-08-19', 'PERMIT/004', '2024-08-19', 1, 1, 'available', 'Muzaffarpur', 400, 20),
      (3, 'BR09CC0005', 'lorry', 'BharatBenz Lorry', 20000, 65, 'BharatBenz', 'Lorry 2820', 2021, '2021-11-01', 'INS/2021/005', '2026-10-31', 'PERMIT/005', '2026-10-31', 1, 1, 'available', 'Muzaffarpur', 700, 30)`);

    // Insert Bookings
    db.run(`INSERT INTO bookings (booking_reference, user_id, driver_id, vehicle_id, pickup_location, pickup_address, pickup_city, pickup_date, pickup_time, drop_location, drop_address, drop_city, goods_description, goods_type, goods_weight_kg, vehicle_type_required, estimated_distance_km, estimated_price, final_price, status) VALUES 
      ('BTB-001', 1, 1, 1, 'Begusarai Railway Station', 'Near Platform 1', 'Begusarai', '2024-01-15', '10:00:00', 'Patna Railway Station', 'Near Platform 2', 'Patna', 'Electronics - Computer Monitors', 'Electronics', 500, 'truck', 180, 4500, 4500, 'completed'),
      ('BTB-002', 2, 2, 3, 'Patna Airport Cargo', 'Cargo Terminal', 'Patna', '2024-01-20', '09:00:00', 'Gaya Bus Stand', 'Near Ticket Counter', 'Gaya', 'Food Packages - Packaged Rice', 'Food Items', 1000, 'pickup', 120, 2500, 2500, 'delivered'),
      ('BTB-003', 3, 3, 4, 'Muzaffarpur Warehouse', 'Warehouse No. 5', 'Muzaffarpur', '2024-02-10', '08:00:00', 'Darbhanga Market', 'Shop No. 23', 'Darbhanga', 'Furniture - Office Chairs', 'Furniture', 800, 'tempo', 90, 2000, 2000, 'in_transit')`);

    // Insert Deliveries
    db.run(`INSERT INTO deliveries (booking_id, driver_id, vehicle_id, current_status, status_description, estimated_pickup_time, estimated_delivery_time) VALUES 
      (1, 1, 1, 'delivered', 'Package delivered successfully', '2024-01-15 10:00:00', '2024-01-15 14:30:00'),
      (2, 2, 3, 'delivered', 'Package delivered to recipient', '2024-01-20 09:00:00', '2024-01-20 12:00:00'),
      (3, 3, 4, 'in_transit', 'Vehicle currently in transit', '2024-02-10 08:00:00', '2024-02-10 11:00:00')`);

    console.log('✅ Seed data inserted successfully');
  });
};

// Helper functions for SQLite
const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

class TransactionError extends Error {
  constructor(message = 'Transaction failed') {
    super(message);
    this.name = 'TransactionError';
  }
}

/**
 * Execute operations in a single SQLite transaction.
 *
 * Usage:
 *   const result = await db.transaction(async (tx) => {
 *     await tx.run('INSERT ...', [..]);
 *     const row = await tx.get('SELECT ...', [..]);
 *     return row;
 *   });
 */
const transaction = async (work) => {
  if (typeof work !== 'function') {
    throw new TypeError('db.transaction(work) requires a function');
  }

  // Serialize ensures we don't interleave statements across concurrent transactions.
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        db.run('BEGIN TRANSACTION');

        const tx = {
          run: (sql, params = []) => runTx(sql, params),
          query: (sql, params = []) => queryTx(sql, params),
          get: (sql, params = []) => getTx(sql, params),
        };

        const result = await work(tx);

        db.run('COMMIT', (err) => {
          if (err) return reject(err);
          resolve(result);
        });
      } catch (err) {
        db.run('ROLLBACK', () => {
          reject(err instanceof TransactionError ? err : err);
        });
      }
    });
  });
};

function runTx(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function queryTx(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getTx(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

module.exports = {
  db,
  query,
  run,
  get,
  transaction,
  testConnection: () => Promise.resolve(true),
  TransactionError
};


