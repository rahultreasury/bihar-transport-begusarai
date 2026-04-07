import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

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
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
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
  updateProfile: (data) => api.put('/auth/profile', data)
};

// Booking APIs
export const bookingAPI = {
  create: (data) => api.post('/bookings/create', data),
  getMyBookings: () => api.get('/bookings/my-bookings'),
  getUserBookings: (userId) => api.get(`/bookings/user/${userId}`),
  getBooking: (id) => api.get(`/bookings/${id}`),
  cancelBooking: (id) => api.put(`/bookings/${id}/cancel`),
  trackBooking: (reference) => api.get(`/bookings/track/${reference}`)
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
  verifyDriver: (id) => api.put(`/admin/drivers/${id}/verify`),
  verifyVehicle: (id) => api.put(`/admin/vehicles/${id}/verify`),
  toggleUserStatus: (id, isActive) => api.put(`/admin/users/${id}/status`, { is_active: isActive })
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

