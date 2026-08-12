import axios from 'axios';

import { clearStoredAuth } from './authStorage';

// In development, use relative URLs so the Vite proxy forwards requests
// to the backend (avoids CORS issues when frontend and backend are on
// different ports). In production, VITE_API_URL must be set explicitly.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '/api' : 'http://localhost:3000/api');

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only handle 401 on protected routes, not auth endpoints (login/signup)
    const authPaths = ['/auth/login', '/auth/admin-login', '/auth/signup', '/auth/driver-signup', '/auth/admin/me'];
    const requestUrl = error.config?.url || '';
    const isAuthRequest = authPaths.some(path => requestUrl.includes(path));

    if (error.response?.status === 401 && !isAuthRequest) {
      // Clear persisted auth + dispatch auth:changed so AuthContext clears
      // runtime state, then let ProtectedRoute redirect to /login.
      clearStoredAuth();
      // guard against a hard reload loop: only hard-navigate if we are not
      // already on an auth-related page.
      const currentPath = window.location.pathname || '';
      if (!currentPath.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  driverSignup: (data) => api.post('/auth/driver-signup', data),
  login: (data) => api.post('/auth/login', data),
adminLogin: (data) => api.post('/auth/admin-login', data),
  getMe: () => api.get('/auth/me'),
  adminMe: () => api.get('/auth/admin/me'),
  updateProfile: (data) => api.put('/auth/profile', data)
};

// Booking APIs
export const bookingAPI = {
  // Canonical MVP booking endpoint
  create: (data) => api.post('/booking', data),
  getMyBookings: () => api.get('/bookings/my-bookings'),
  getUserBookings: (userId) => api.get(`/bookings/user/${userId}`),
  getBooking: (id) => api.get(`/bookings/${id}`),
  cancelBooking: (id) => api.put(`/bookings/${id}/cancel`),
  trackBooking: (reference) => api.get(`/bookings/track/${reference}`),
  // Quote-based booking workflow — customer responses
  acceptQuote: (id) => api.post(`/bookings/${id}/quote/accept`),
  rejectQuote: (id) => api.post(`/bookings/${id}/quote/reject`),
  // Public quote responses keyed by booking reference — no authentication
  // required so guest customers (public tracking page) can accept/reject.
  acceptQuoteByReference: (reference) => api.post(`/bookings/track/${reference}/quote/accept`),
  rejectQuoteByReference: (reference) => api.post(`/bookings/track/${reference}/quote/reject`)
};

// Driver APIs
export const driverAPI = {
  getAvailableJobs: () => api.get('/drivers/available-jobs'),
  acceptJob: (bookingId, vehicleId) => api.post(`/drivers/accept-job/${bookingId}`, { vehicle_id: vehicleId }),
  getMyJobs: () => api.get('/drivers/my-jobs'),
  updateJobStatus: (bookingId, status, notes) => api.put(`/drivers/update-status/${bookingId}`, { status, notes }),
  getMyVehicles: () => api.get('/drivers/my-vehicles'),
  registerVehicle: (data) => api.post('/drivers/register-vehicle', data),
  getStats: () => api.get('/drivers/stats')
};

// Admin APIs
export const adminAPI = {
  getDashboard: () => api.get('/admin/dashboard'),
  getUsers: (params) => api.get('/admin/users', { params }),
  getDrivers: (params) => api.get('/admin/drivers', { params }),
  getVehicles: (params) => api.get('/admin/vehicles', { params }),
  getBookings: (params) => api.get('/admin/bookings', { params }),
  getBooking: (id) => api.get(`/admin/bookings/${id}`),
  // Read a booking by its CANONICAL booking_number (BTB-YYYY-NNNNN) or legacy
  // reference. Used by the read-only detail page and dedicated assign pages,
  // all of which are navigated by booking number.
  getBookingByNumber: (bookingNumber) => api.get(`/admin/bookings/by-number/${encodeURIComponent(bookingNumber)}`),
  updateBooking: (id, data) => api.put(`/admin/bookings/${id}`, data),
  deleteBooking: (id) => api.delete(`/admin/bookings/${id}`),
  getDeletionSummary: (id) => api.get(`/admin/bookings/${id}/deletion-summary`),
  deletionAction: (id, action, confirmationCode) => api.post(`/admin/bookings/${id}/deletion-action`, { action, confirmation_code: confirmationCode }),
updateBookingStatus: (id, status) => api.patch(`/admin/bookings/${id}/status`, { status }),
  bulkConfirm: (bookingIds) => api.post('/admin/bookings/bulk-confirm', { bookingIds }),
  bulkCancel: (bookingIds) => api.post('/admin/bookings/bulk-cancel', { bookingIds }),
  bulkUpdateStatus: (bookingIds, status) => api.post('/admin/bookings/bulk-status', { bookingIds, status }),
  verifyDriver: (id) => api.put(`/admin/drivers/${id}/verify`),
  verifyVehicle: (id) => api.put(`/admin/vehicles/${id}/verify`),
toggleUserStatus: (id, isActive) => api.put(`/admin/users/${id}/status`, { is_active: isActive }),
  assignDriver: (bookingId, driverId) => api.post(`/admin/bookings/${bookingId}/assign-driver`, { driver_id: driverId }),
getAvailableDrivers: () => api.get('/admin/drivers', { params: { status: 'available', limit: 100 } }),
  // Returns available drivers WITH their associated vehicles in one call
  // (used by the Booking Details "Send Quote" driver/vehicle selection).
getDriversWithVehicles: (params) => api.get('/admin/drivers/drivers-with-vehicles', { params }),
  // Scalable driver lookup for the Booking Assignment picker (10k+ drivers).
  // Server-side pagination + search + filters + trip stats in ONE call.
  // Each driver carries its assigned vehicle (one-driver-one-vehicle).
  getAssignableDrivers: (params) => api.get('/admin/booking-drivers', { params }),
  assignVehicle: (bookingId, vehicleId) => api.post(`/admin/bookings/${bookingId}/assign-vehicle`, { vehicle_id: vehicleId }),
  // Quote workflow — admin reserves driver + vehicle and sends final quote
  sendQuote: (bookingId, data) => api.post(`/admin/bookings/${bookingId}/send-quote`, data),
  // Send quote using already-assigned driver (no driver selection needed)
  sendAdminQuote: (bookingId, data) => api.post(`/admin/bookings/${bookingId}/quote`, data),

  // Driver Management Module (Market Drivers - full CRUD + actions)
  getDriverStats: () => api.get('/admin/drivers/stats'),
  getDriver: (id) => api.get(`/admin/drivers/${id}`),
  createDriver: (data) => api.post('/admin/drivers', data),
updateDriver: (id, data) => api.put(`/admin/drivers/${id}`, data),
  deleteDriver: (id) => api.delete(`/admin/drivers/${id}`),
  bulkDeleteDrivers: (ids) => api.post('/admin/drivers/bulk-delete', { ids }),
  toggleDriverStatus: (id, status) => api.patch(`/admin/drivers/${id}/status`, { status }),
  getDriverTrips: (id, params) => api.get(`/admin/drivers/${id}/trips`, { params }),
  getDriverTimeline: (id) => api.get(`/admin/drivers/${id}/timeline`),
  
  // Driver Transactions
  recordDriverTransaction: (id, data) => api.post(`/admin/drivers/${id}/transactions`, data),
  getDriverTransactions: (id, params) => api.get(`/admin/drivers/${id}/transactions`, { params }),
  
// Driver Vehicle Assignment
  getAvailableVehicles: () => api.get('/admin/drivers/vehicles/available'),
  assignVehicleToDriver: (driverId, vehicleId) => api.post(`/admin/drivers/${driverId}/assign-vehicle`, { vehicle_id: vehicleId }),

  // Partner Management (Transport Partners/Owners)
  getPartnerStats: (enhanced) => api.get('/admin/partners/stats', { params: { enhanced: enhanced ? 'true' : 'false' } }),
  getPartners: (params) => api.get('/admin/partners', { params }),
  getPartner: (id) => api.get(`/admin/partners/${id}`),
  createPartner: (data) => api.post('/admin/partners', data),
  updatePartner: (id, data) => api.put(`/admin/partners/${id}`, data),
  deletePartner: (id) => api.delete(`/admin/partners/${id}`),
  togglePartnerStatus: (id, status) => api.patch(`/admin/partners/${id}/status`, { status }),

  // Partner Dashboard
  getPartnerDashboard: (id) => api.get(`/admin/partners/${id}/dashboard`),

  // Partner Trucks
  getPartnerTrucks: (id) => api.get(`/admin/partners/${id}/trucks`),
  addPartnerTruck: (id, data) => api.post(`/admin/partners/${id}/trucks`, data),
  updatePartnerTruck: (truckId, data) => api.put(`/admin/partners/trucks/${truckId}`, data),
  removePartnerTruck: (truckId) => api.delete(`/admin/partners/trucks/${truckId}`),

  // Partner Ledger
  getPartnerLedger: (id, params) => api.get(`/admin/partners/${id}/ledger`, { params }),
  recordPartnerTransaction: (id, data) => api.post(`/admin/partners/${id}/ledger`, data),
  recordPartnerReversal: (id, data) => api.post(`/admin/partners/${id}/ledger/reversal`, data),

  // Partner Payments
  getPartnerPayments: (id, params) => api.get(`/admin/partners/${id}/payments`, { params }),
  recordPartnerPayment: (id, data) => api.post(`/admin/partners/${id}/payments`, data),

  // Partner Settlements
  getPartnerSettlements: (id, params) => api.get(`/admin/partners/${id}/settlements`, { params }),
  generateSettlement: (data) => api.post('/admin/settlements/generate', data),
  getAllSettlements: (params) => api.get('/admin/settlements', { params }),
  getSettlement: (id) => api.get(`/admin/settlements/${id}`),
  updateSettlementStatus: (id, status) => api.patch(`/admin/settlements/${id}/status`, { status }),
  lockSettlement: (id) => api.post(`/admin/settlements/${id}/lock`),

  // Partner Documents
  getPartnerDocuments: (id) => api.get(`/admin/partners/${id}/documents`),
  uploadPartnerDocument: (id, data) => api.post(`/admin/partners/${id}/documents`, data),
  deletePartnerDocument: (id, docId) => api.delete(`/admin/partners/${id}/documents/${docId}`),

  // Partner Driver Assignment
  getPartnerDrivers: (id) => api.get(`/admin/partners/${id}/drivers`),
  assignDriverToPartner: (id, driverId) => api.post(`/admin/partners/${id}/assign-driver`, { driver_id: driverId }),
  unassignDriverFromPartner: (id, driverId) => api.post(`/admin/partners/${id}/unassign-driver`, { driver_id: driverId }),

  // Owner Module Enhancements
  getOwnerStats: () => api.get('/admin/partners/stats', { params: { enhanced: 'true' } }),
  getTodayAssignedTrips: (partnerId) => api.get('/admin/partners/today-trips', { params: partnerId ? { partner_id: partnerId } : {} }),
  getOwnerBookings: (id, params) => api.get(`/admin/partners/${id}/bookings`, { params }),
  getCommissionSummary: (id) => api.get(`/admin/partners/${id}/commission`),
};

// Delivery APIs
export const deliveryAPI = {
  updateLocation: (data) => api.post('/delivery/update-location', data),
  getLocation: (bookingId) => api.get(`/delivery/location/${bookingId}`),
  verifyOTP: (data) => api.post('/delivery/verify-otp', data),
  completeDelivery: (data) => api.post('/delivery/complete', data)
};

// Vehicle Search APIs
export const vehicleAPI = {
  search: (registrationNumber) => api.get(`/vehicles/search/${registrationNumber}`)
};

// License Search APIs
export const licenseAPI = {
  search: (licenseNumber) => api.get(`/licenses/search/${licenseNumber}`)
};

// Challan Search APIs
export const challanAPI = {
  search: (vehicleNumber) => api.get(`/challans/search/${vehicleNumber}`),
  pay: (challanId, data) => api.put(`/challans/${challanId}/pay`, data)
};

// Appointment APIs
export const appointmentAPI = {
  create: (data) => api.post('/appointments/create', data),
  getAll: (params) => api.get('/appointments', { params }),
  getSlots: (params) => api.get('/appointments/slots', { params }),
  cancel: (id) => api.put(`/appointments/${id}/cancel`)
};

export default api;

