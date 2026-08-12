# Bihar Transport Begusarai

A complete full-stack logistics and goods transportation web application built with React, Node.js, Express, and SQLite.

![Bihar Transport Begusarai](https://img.shields.io/badge/Bihar%20Transport-Begusarai-green)

## 🚚 About

Bihar Transport Begusarai is a professional logistics and goods transportation company established in 1998 in Begusarai, Bihar. The company provides transport services for moving goods from one place to another using trucks and delivery vehicles. Customers can book vehicles to transport goods between cities or local areas.

This platform works similar to ride-hailing apps like Uber/Ola but specifically for goods transport.

## 🛠️ Tech Stack

### Frontend
- React.js 18
- Tailwind CSS
- React Router v6
- Axios for API requests
- @react-google-maps/api for Maps integration
- Vite for build tooling

### Backend
- Node.js
- Express.js
- JWT Authentication
- SQLite Database
- bcryptjs for password hashing
- express-validator for input validation

### Database
- SQLite (development)
- MySQL (production ready)

### Maps Integration
- Google Maps JavaScript API
- Google Maps Directions API
- Google Maps Places API

## 📋 Features

### For Customers
- ✅ User Registration & Login (JWT authenticated)
- ✅ Book Transport Services with vehicle selection
- ✅ Interactive map for route visualization
- ✅ Real-time price estimation based on distance & vehicle type
- ✅ Track Delivery Status with live driver tracking
- ✅ View Booking History and details
- ✅ Cancel pending bookings

### For Drivers
- ✅ Driver Registration with license verification
- ✅ View Available Transport Jobs
- ✅ Accept/Reject transport jobs
- ✅ Update Delivery Status (Pickup → In Transit → Delivered)
- ✅ Register and manage multiple vehicles
- ✅ View earnings and statistics

### For Admin
- ✅ Dashboard Overview with statistics
- ✅ Manage Users (activate/deactivate)
- ✅ Manage Drivers (verify drivers)
- ✅ Manage Vehicles (verify vehicles)
- ✅ Monitor all Bookings
- ✅ View revenue reports

### Google Maps Integration
- ✅ Interactive map on booking page
- ✅ Route visualization between pickup and drop
- ✅ Automatic distance calculation
- ✅ Live driver tracking map
- ✅ Location markers for pickup/drop points

## 📁 Project Structure

```
bihar-transport-begusarai/
├── backend/
│   ├── config/
│   │   └── database.js          # SQLite database configuration
│   ├── middleware/
│   │   └── auth.js              # JWT authentication middleware
│   ├── routes/
│   │   ├── adminRoutes.js       # Admin API endpoints
│   │   ├── authRoutes.js        # Authentication endpoints
│   │   ├── bookingRoutes.js      # Booking management endpoints
│   │   ├── driverRoutes.js      # Driver management endpoints
│   │   └── deliveryRoutes.js    # Delivery tracking endpoints
│   ├── .env                     # Environment variables
│   ├── package.json
│   └── server.js                # Express server entry point
├── database/
│   ├── schema.sql               # MySQL schema (for reference)
│   └── transport.db             # SQLite database
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Footer.jsx       # Footer component
│   │   │   ├── MapComponents.jsx # Google Maps components
│   │   │   └── Navbar.jsx       # Navigation component
│   │   ├── pages/
│   │   │   ├── About.jsx        # About company page
│   │   │   ├── AdminDashboard.jsx # Admin dashboard
│   │   │   ├── BookTransport.jsx # Booking page with maps
│   │   │   ├── Contact.jsx      # Contact page
│   │   │   ├── Dashboard.jsx    # Customer dashboard
│   │   │   ├── DeliveryTracking.jsx # Live tracking page
│   │   │   ├── DriverDashboard.jsx # Driver dashboard
│   │   │   ├── Home.jsx        # Landing page
│   │   │   ├── Login.jsx       # Login page
│   │   │   └── Signup.jsx      # Signup page
│   │   ├── services/
│   │   │   └── api.js           # API service functions
│   │   ├── App.jsx              # Main app component
│   │   ├── index.css            # Global styles
│   │   └── main.jsx             # React entry point
│   ├── .env                     # Frontend environment variables
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.js
├── README.md
└── TODO.md
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Start the server
npm start
```

The backend will run on http://localhost:3000

### Frontend Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend will run on http://localhost:5173

## 🔧 Configuration

### Backend Environment Variables (.env)

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=btb_secret_key_2024_change_in_production
JWT_EXPIRE=7d
FRONTEND_URL=http://localhost:5173
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

### Frontend Environment Variables (.env)

```env
VITE_API_URL=http://localhost:3000/api
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
VITE_APP_NAME=Bihar Transport Begusarai
VITE_APP_URL=http://localhost:5173
```

### Getting Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable the following APIs:
   - Maps JavaScript API
   - Directions API
   - Places API
4. Create API credentials (API Key)
5. Add the key to your `.env` files

> **Note:** The app works without Google Maps API key but will use fallback calculations.

## 🔐 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register new customer |
| POST | `/api/auth/driver-signup` | Register new driver |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/admin-login` | Admin login |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update user profile |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/bookings/create` | Create new booking |
| GET | `/api/bookings/user/:id` | Get user's bookings |
| GET | `/api/bookings/my-bookings` | Get current user's bookings |
| GET | `/api/bookings/:id` | Get booking details |
| PUT | `/api/bookings/:id/cancel` | Cancel booking |
| GET | `/api/bookings/track/:ref` | Track booking |

### Drivers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/drivers/available-jobs` | Get available jobs |
| POST | `/api/drivers/accept-job/:id` | Accept a job |
| GET | `/api/drivers/my-jobs` | Get driver's jobs |
| PUT | `/api/drivers/update-status/:id` | Update delivery status |
| GET | `/api/drivers/my-vehicles` | Get driver's vehicles |
| POST | `/api/drivers/register-vehicle` | Register a vehicle |
| GET | `/api/drivers/stats` | Get driver statistics |

### Delivery
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/delivery/update-location` | Update driver location |
| GET | `/api/delivery/location/:id` | Get delivery location |
| POST | `/api/delivery/verify-otp` | Verify delivery OTP |
| POST | `/api/delivery/complete` | Complete delivery |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Get dashboard stats |
| GET | `/api/admin/users` | Get all users |
| GET | `/api/admin/drivers` | Get all drivers |
| GET | `/api/admin/vehicles` | Get all vehicles |
| GET | `/api/admin/bookings` | Get all bookings |
| PUT | `/api/admin/drivers/:id/verify` | Verify driver |
| PUT | `/api/admin/vehicles/:id/verify` | Verify vehicle |
| PUT | `/api/admin/users/:id/status` | Toggle user status |

## 👤 Test Accounts

### Customer
- Email: rahul.kumar@email.com
- Password: password123

### Driver
- Email: Contact admin to add driver account
- Use Driver Signup to create new driver

### Admin
- Email: admin@bihartransport.com
- Password: password123

## 💰 Pricing Structure

| Vehicle Type | Base Fare | Per Km Rate |
|--------------|-----------|-------------|
| Truck | ₹500 | ₹25/km |
| Mini Truck | ₹300 | ₹18/km |
| Pickup | ₹250 | ₹15/km |
| Tempo | ₹400 | ₹20/km |
| Lorry | ₹700 | ₹30/km |

## 📱 Available Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Landing page with services |
| Login | `/login` | User login |
| Signup | `/signup` | User registration |
| Book Transport | `/book-transport` | Book a transport with map |
| Dashboard | `/dashboard` | Customer dashboard |
| Driver Dashboard | `/driver-dashboard` | Driver dashboard |
| Delivery Tracking | `/track` | Track delivery with live map |
| Admin Dashboard | `/admin` | Admin dashboard |
| About | `/about` | Company information |
| Contact | `/contact` | Contact form |

## 🏗️ Database Schema

### Users Table
```sql
user_id, first_name, last_name, email, phone, password_hash, 
address, city, state, pincode, role, is_active, created_at
```

### Drivers Table
```sql
driver_id, user_id, license_number, license_expiry, aadhar_number,
date_of_birth, gender, experience_years, is_available, 
is_verified, rating, total_deliveries
```

### Transport Vehicles Table
```sql
vehicle_id, driver_id, vehicle_number, vehicle_type, vehicle_name,
capacity_kg, vehicle_make, vehicle_model, is_available, 
is_verified, current_status, base_location, per_km_rate
```

### Bookings Table
```sql
booking_id, booking_reference, user_id, driver_id, vehicle_id,
pickup_location, pickup_city, drop_location, drop_city,
goods_description, goods_weight_kg, vehicle_type_required,
estimated_distance_km, estimated_price, final_price, status
```

### Deliveries Table
```sql
delivery_id, booking_id, driver_id, vehicle_id, current_status,
current_latitude, current_longitude, last_location_update,
estimated_delivery_time, delivery_otp, otp_verified
```

## 📄 License

This project is for demonstration purposes.

## 👨‍💻 Developed By

Bihar Transport Begusarai Team

---

<p align="center">Made with ❤️ in Bihar</p>

