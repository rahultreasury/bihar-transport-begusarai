const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const mapsRoutes = require('./routes/maps');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api', mapsRoutes);

app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Database
const db = new sqlite3.Database(':memory:');

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pickup_city TEXT,
    drop_city TEXT,
    vehicle_type TEXT,
    estimated_distance REAL,
    estimated_price INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend ready!', timestamp: new Date().toISOString() });
});

app.post('/api/bookings', (req, res) => {
  const { pickup_city, drop_city, vehicle_type, estimated_distance_km, estimated_price } = req.body;
  
  db.run(
    'INSERT INTO bookings (pickup_city, drop_city, vehicle_type, estimated_distance, estimated_price) VALUES (?, ?, ?, ?, ?)',
    [pickup_city, drop_city, vehicle_type, estimated_distance_km, estimated_price],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
      res.json({ 
        success: true, 
        data: { 
          booking_reference: `BTR${this.lastID.toString().padStart(4, '0')}`,
          booking_id: this.lastID 
        } 
      });
    }
  );
});

app.get('/api/bookings', (req, res) => {
  db.all('SELECT * FROM bookings ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, data: rows });
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Backend ready on http://localhost:${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/api/health`);
});

