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
  },
  timeout: 12000, // 12 seconds — prevents indefinite hangs on slow/unavailable backends
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
    // Normalize timeout / network errors so the UI can show meaningful messages.
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        error._isTimeout = true;
      } else {
        error._isNetworkError = true;
      }
    }

    // Only handle 401 on protected routes, not auth endpoints (login/signup)
    const authPaths = ['/auth/login', '/auth/admin-login', '/auth/partner-login', '/auth/signup', '/auth/driver-signup', '/auth/admin/me'];
    const requestUrl = error.config?.url || '';
    const isAuthRequest = authPaths.some(path => requestUrl.includes(path));

    // The enquiry endpoints authorise with a scoped guest token, not the user
    // JWT. A 401 there means "this link expired on this device" — a message the
    // enquiry page renders itself with a recovery path. Redirecting to /login
    // there would throw the customer off a page they never needed an account for.
    const isEnquiryRequest = requestUrl.includes('/enquiries');

    if (error.response?.status === 401 && !isAuthRequest && !isEnquiryRequest) {
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
  partnerLogin: (data) => api.post('/auth/partner-login', data),
  getMe: () => api.get('/auth/me'),
  adminMe: () => api.get('/auth/admin/me'),
  updateProfile: (data) => api.put('/auth/profile', data),
  forgotPassword: (data) => api.post('/auth/forgot-password', data),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  changePassword: (data) => api.post('/auth/change-password', data)
};

// Booking APIs
export const bookingAPI = {
  // Canonical MVP booking endpoint (guest / unauthenticated)
  create: (data) => api.post('/booking', data),
  // Authenticated customer booking — uses JWT user identity
  createAuthenticated: (data) => api.post('/bookings/create', data),
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
  getStats: () => api.get('/drivers/stats'),

  // Trip Financial (Driver view - NO customer fare, NO BT margin)
  getTripFinancial: (bookingId) => api.get(`/trips/${bookingId}/financial`),
  getTripFinancialTimeline: (bookingId) => api.get(`/trips/${bookingId}/financial/timeline`),
  getTripAdvances: (bookingId) => api.get(`/trips/${bookingId}/advances`),
  getTripSettlement: (bookingId) => api.get(`/trips/${bookingId}/settlements`),

  // Transaction Ledger
  getTripTransactions: (bookingId) => api.get(`/trips/${bookingId}/transactions`),
  getTripTransactionLedger: (bookingId) => api.get(`/trips/${bookingId}/transactions/ledger`),
  getTripPartyBalances: (bookingId) => api.get(`/trips/${bookingId}/transactions/balances`),
};

// Admin APIs
export const adminAPI = {
  getDashboard: () => api.get('/admin/dashboard'),
  getUsers: (params) => api.get('/admin/users', { params }),
  getDrivers: (params) => api.get('/admin/drivers', { params }),
  getDriver: (id) => api.get(`/admin/drivers/${id}`),
  getVehicles: (params) => api.get('/admin/vehicles', { params }),
  getVehicle: (id) => api.get(`/admin/vehicles/${id}`),
  getVehicleStats: () => api.get('/admin/vehicles/stats'),
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
  // CANONICAL driver assignment. Persists driver_id, the vehicle resolved from
  // the driver's registered vehicle, and the owner/partner on the BOOKING ROW,
  // so the assignment survives a refresh. Pass { clear: true } to unassign —
  // this is the only normal path that removes an assignment.
  assignBookingDriver: (bookingId, data) => api.post(`/admin/bookings/${bookingId}/assign-driver`, data),
  // ---------------------------------------------------------------------------
  // PHASE B — THE CANONICAL QUOTATION / RATE MODULE
  // ---------------------------------------------------------------------------
  // The ENQUIRY owns the quotation:
  //     ENQUIRY → GIVE RATE → RATE QUOTED → CONFIRM ORDER → ORDER CONFIRMED
  //
  // These are the four client document §2 actions. Every one of them is a real
  // backend call; there is no optimistic local state and no client-side money.
  // The server recomputes every total and the response is what gets rendered.
  //
  //   getQuotation      → read the persisted quotation (null when never quoted)
  //   saveQuotation     → "[Save Quotation]"    (creates or updates in place)
  //   sendQuotation     → "[Send Quotation]"   (publishes; enquiry stays OPEN)
  //   downloadQuotation → "[Download Quotation]" (real PDF from the DB)
  //   confirmQuotationOrder → "[Confirm Order]" (exactly one order, idempotent)
  getQuotation: (enquiryId) => api.get(`/admin/enquiries/${enquiryId}/quotation`),
  saveQuotation: (enquiryId, data) => api.post(`/admin/enquiries/${enquiryId}/quotation`, data),
  sendQuotation: (enquiryId) => api.post(`/admin/enquiries/${enquiryId}/quotation/send`),
  confirmQuotationOrder: (enquiryId) => api.post(`/admin/enquiries/${enquiryId}/quotation/confirm-order`),
  // The PDF is a binary download, so it uses the configured axios instance
  // directly with responseType 'blob' rather than the JSON helper.
  downloadQuotation: (enquiryId) =>
    api.get(`/admin/enquiries/${enquiryId}/quotation/download`, { responseType: 'blob' }),

  // Quote workflow — admin reserves driver + vehicle and sends final quote
  // (BOOKING-level path. Retained untouched for existing booking screens; the
  //  quotation workflow above is the enquiry-based canonical one.)
  sendQuote: (bookingId, data) => api.post(`/admin/bookings/${bookingId}/send-quote`, data),
  // Send quote using already-assigned driver (no driver selection needed)
  sendAdminQuote: (bookingId, data) => api.post(`/admin/bookings/${bookingId}/quote`, data),

  // ---------------------------------------------------------------------------
  // ENQUIRY WORKFLOW (the six-stage admin rail)
  // ---------------------------------------------------------------------------
  // These are thin clients for the booking module's own workflow endpoints.
  // The stage the admin sees is always derived from the booking row the
  // backend persists — nothing here invents state.
  //
  // STAGE 1 → 2 : Request Received → Under Review
  startReview: (bookingId) => api.post(`/admin/bookings/${bookingId}/start-review`),
  // STAGE 2 → 3 : Under Review → Quote Prepared (saves a draft, notifies nobody)
  prepareQuote: (bookingId, data) => api.post(`/admin/bookings/${bookingId}/prepare-quote`, data),
  // STAGE 5 → 6 : Customer Accepted → Confirmed (existing confirm path)
  confirmBooking: (bookingId) => api.patch(`/admin/bookings/${bookingId}/status`, { status: 'confirmed' }),
  // The real booking_events audit trail, newest first
  getWorkflowTimeline: (bookingId, params) =>
    api.get(`/admin/bookings/${bookingId}/workflow-timeline`, { params }),
  // Prefills the EXISTING POST /api/trips body from the confirmed booking
  getTripDraft: (bookingId) => api.get(`/admin/bookings/${bookingId}/trip-draft`),

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
  getAvailableVehicles: (driverId) => api.get(`/admin/drivers/${driverId}/vehicles/available`),
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

  // Partner Sourced Vehicles
  getPartnerSourcedVehicles: (id) => api.get(`/admin/partners/${id}/sourced-vehicles`),
  addPartnerSourcedVehicle: (id, data) => api.post(`/admin/partners/${id}/sourced-vehicles`, data),
  updatePartnerSourcedVehicle: (vehicleId, data) => api.put(`/admin/partners/sourced-vehicles/${vehicleId}`, data),
  removePartnerSourcedVehicle: (vehicleId) => api.delete(`/admin/partners/sourced-vehicles/${vehicleId}`),

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

  /**
   * The trip's OPERATIONAL workflow: where it is, where it may go next, its
   * loading facts, its planned vs actual figures, its document checklist, and
   * the canonical lifecycle `stage` (current stage, next action, rail nodes).
   *
   * This is the ONE call the Order / Trip Master uses to decide what to show and
   * what to offer. The server resolves it from `Trip.status` alone, so the rail,
   * the next action and the status cards can never disagree with each other.
   */
  getTripWorkflow: (tripId) => api.get(`/trips/${tripId}/workflow`),

  /**
   * THE OPERATIONAL ACTIONS, one per process workspace.
   *
   * These wrap endpoints that ALREADY EXIST on the backend — nothing here is a
   * new API. They exist as named client methods so each process workspace calls
   * one obvious function instead of hand-writing a URL, which is what let the
   * stepper quietly collapse into a single page in the first place.
   */
  tripOperations: {
    // ── LOADING ───────────────────────────────────────────────────────────
    sendToLoading: (tripId, data) => api.post(`/trips/${tripId}/loading/send`, data),
    arriveAtLoading: (tripId, data) => api.post(`/trips/${tripId}/loading/arrive`, data),
    saveLoadingFacts: (tripId, data) => api.post(`/trips/${tripId}/loading/facts`, data),
    completeLoading: (tripId, data) => api.post(`/trips/${tripId}/loading/complete`, data),

    // ── DISPATCH ──────────────────────────────────────────────────────────
    // `getDispatchWorkspace` is the ONE call the Dispatch page makes on load.
    // It returns the header, the readiness report with every blocker, the
    // shipment facts, the vehicle and its documents, the loading record, the
    // document checklist, LR/GR, the e-way bill, delivery, insurance, billing,
    // additional charges, the dispatch record and the movement history — all
    // read from the database, so the screen can never show a placeholder.
    getDispatchWorkspace: (tripId) => api.get(`/trips/${tripId}/dispatch`),
    getDispatchReadiness: (tripId) => api.get(`/trips/${tripId}/dispatch/readiness`),
    dispatchVehicle: (tripId, data) => api.post(`/trips/${tripId}/dispatch`, data),
    // Save the paperwork WITHOUT dispatching — what makes a blocker fixable.
    saveDispatchDetails: (tripId, data) => api.patch(`/trips/${tripId}/dispatch`, data),

    // LR / GR — the existing document module, not a second LR system.
    getLrGr: (tripId) => api.get(`/trips/${tripId}/dispatch/lr-gr`),
    saveLrGr: (tripId, data) => api.post(`/trips/${tripId}/dispatch/lr-gr`, data),

    // E-Way Bill. `saveEwayBill` records the INTERNAL record only; the server
    // has no government API and its response says so explicitly.
    getEwayBill: (tripId) => api.get(`/trips/${tripId}/dispatch/eway-bill`),
    saveEwayBill: (tripId, data) => api.post(`/trips/${tripId}/dispatch/eway-bill`, data),

    // Transit insurance.
    getInsurance: (tripId) => api.get(`/trips/${tripId}/dispatch/insurance`),
    saveInsurance: (tripId, data) => api.post(`/trips/${tripId}/dispatch/insurance`, data),

    // Delivery information + the POD decision.
    saveDeliveryInfo: (tripId, data) => api.post(`/trips/${tripId}/dispatch/delivery-info`, data),

    // Persistent document files. `uploadDocument` sends base64 bytes that the
    // server writes to disk; `documentFileUrl` streams one back, admin-gated.
    uploadDocument: (tripId, data) => api.post(`/trips/${tripId}/documents/upload`, data),
    documentFileUrl: (tripId, documentId) => `/api/trips/${tripId}/documents/${documentId}/file`,


    // ── DOCUMENTS (loading bills, e-way, LR/GR, POD) ───────────────────────
    getDocuments: (tripId) => api.get(`/trips/${tripId}/documents`),
    addDocument: (tripId, data) => api.post(`/trips/${tripId}/documents`, data),
    verifyDocument: (tripId, documentId) =>
      api.post(`/trips/${tripId}/documents/${documentId}/verify`),

    // ── TRANSIT ───────────────────────────────────────────────────────────
    getTracking: (tripId) => api.get(`/trips/${tripId}/tracking`),
    startTransit: (tripId, data) => api.post(`/trips/${tripId}/transit/start`, data),

    // ── DELIVERY ──────────────────────────────────────────────────────────
    getDeliveryReadiness: (tripId) => api.get(`/trips/${tripId}/delivery/readiness`),
    getDelivery: (tripId) => api.get(`/trips/${tripId}/delivery`),
    arriveAtDestination: (tripId, data) => api.post(`/trips/${tripId}/arrival`, data),
    markDelivered: (tripId, data) => api.post(`/trips/${tripId}/delivered`, data),

    // ── POD ───────────────────────────────────────────────────────────────
    submitPod: (tripId, data) => api.post(`/trips/${tripId}/pod`, data),
    verifyPod: (tripId, documentId) => api.post(`/trips/${tripId}/pod/${documentId}/verify`),

    /**
     * §16 — MOVEMENT HISTORY. The server writes these events inside the SAME
     * request that changes a status, so this only ever READS what already
     * happened. The UI never adds, reorders or invents a row here.
     */
    getTimeline: (tripId) => api.get(`/trips/${tripId}/timeline`),
  },

  // Trip Financial (Admin view - FULL visibility including BT Margin)
  getTripFinancial: (bookingId) => api.get(`/trips/${bookingId}/financial`),
  getTripFinancialTimeline: (bookingId) => api.get(`/trips/${bookingId}/financial/timeline`),
  // Booking-linked advances (legacy)
  getTripAdvances: (bookingId) => api.get(`/trips/${bookingId}/advances`),
  getTripAdvanceSummary: (bookingId) => api.get(`/trips/${bookingId}/advances/summary`),
  createTripAdvance: (bookingId, data) => api.post(`/trips/${bookingId}/advances`, data),
  // Trip-linked advances (Phase 1 - standalone trips)
  getTripAdvancesByTripId: (tripId) => api.get(`/trips/${tripId}/advances`),
  getTripAdvanceSummaryByTripId: (tripId) => api.get(`/trips/${tripId}/advances/summary`),
  createTripAdvanceByTripId: (tripId, data) => api.post(`/trips/${tripId}/advances`, data),
  getTripSettlement: (bookingId) => api.get(`/trips/${bookingId}/settlements`),
  recordDriverSettlement: (bookingId, data) => api.post(`/trips/${bookingId}/settlements/driver`, data),
  recordOwnerSettlement: (bookingId, data) => api.post(`/trips/${bookingId}/settlements/owner`, data),
  getTripCommission: (bookingId) => api.get(`/trips/${bookingId}/commission`),
  applyTripCommission: (bookingId, data) => api.post(`/trips/${bookingId}/commission`, data),
  calculateTripFinancial: (bookingId, data) => api.post(`/trips/${bookingId}/financial/calculate`, data),

  // Transaction Ledger (Admin)
  getTripTransactions: (bookingId) => api.get(`/trips/${bookingId}/transactions`),
  getTripTransactionLedger: (bookingId) => api.get(`/trips/${bookingId}/transactions/ledger`),
  getTripPartyBalances: (bookingId) => api.get(`/trips/${bookingId}/transactions/balances`),
  createTripTransaction: (bookingId, data) => api.post(`/trips/${bookingId}/transactions`, data),
  reverseTripTransaction: (bookingId, transactionId, data) => api.post(`/trips/${bookingId}/transactions/${transactionId}/reverse`, data),

  // Trip Management (CRUD + expenses + payments)
  getTrips: (params) => api.get('/trips', { params }),
  getTripSummary: () => api.get('/trips/summary'),
  getTopClients: (limit) => api.get('/trips/top-clients', { params: { limit } }),
  getTrip: (id) => api.get(`/trips/${id}`),
  createTrip: (data) => api.post('/trips', data),
  updateTrip: (id, data) => api.put(`/trips/${id}`, data),
  deleteTrip: (id) => api.delete(`/trips/${id}`),
  updateTripStatus: (id, status) => api.patch(`/trips/${id}/status`, { status }),

  // Trip Expenses
  getTripExpenses: (tripId) => api.get(`/trips/${tripId}/expenses`),
  addTripExpense: (tripId, data) => api.post(`/trips/${tripId}/expenses`, data),
  
  // Trip Financial Summary (authoritative calculation)
  getTripFinancialSummary: (tripId) => api.get(`/trips/${tripId}/financial-summary`),
  updateTripExpense: (tripId, expenseId, data) => api.put(`/trips/${tripId}/expenses/${expenseId}`, data),
  deleteTripExpense: (tripId, expenseId) => api.delete(`/trips/${tripId}/expenses/${expenseId}`),

  // Trip Payments
  getTripPayments: (tripId) => api.get(`/trips/${tripId}/payments`),
  addTripPayment: (tripId, data) => api.post(`/trips/${tripId}/payments`, data),

  // Lookup data
  getTripClients: (search) => api.get('/trips/lookup/clients', { params: { search } }),
  getTripOfflineClients: (search) => api.get('/trips/lookup/offline-clients', { params: { search } }),
  getTripDrivers: (search) => api.get('/trips/lookup/drivers', { params: { search } }),
  getTripVehicles: (search) => api.get('/trips/lookup/vehicles', { params: { search } }),
  getTripOwners: (search) => api.get('/trips/lookup/owners', { params: { search } }),
  getVehiclesByOwner: (ownerId) => api.get(`/trips/lookup/vehicles-by-owner/${ownerId}`),
  getDriversByOwner: (ownerId, search = '') => api.get(`/trips/lookup/drivers-by-owner/${ownerId}`, { params: { search } }),
  // Resolve the VehicleOwner linked to a Partner (VehicleOwner.partner_link).
  // Used by the Admin trip-creation wizard to select a Partner and then load
  // that Partner's linked transport owner, vehicles, and drivers.
  getOwnerByPartner: (partnerId) => api.get(`/trips/lookup/owner-by-partner/${partnerId}`),

  // Trips by entity
  getTripsByClientId: (clientId, params) => api.get(`/trips/client/${clientId}`, { params }),
  getTripsByDriverId: (driverId, params) => api.get(`/trips/driver/${driverId}`, { params }),
  getTripsByVehicleId: (vehicleId, params) => api.get(`/trips/vehicle/${vehicleId}`, { params }),
  getTripsByOwnerId: (ownerId, params) => api.get(`/trips/owner/${ownerId}`, { params }),

  // Partner Applications
  getPartnerApplications: (params) => api.get('/admin/partner-applications', { params }),
  getPartnerApplication: (id) => api.get(`/admin/partner-applications/${id}`),
  approvePartnerApplication: (id, data) => api.post(`/admin/partner-applications/${id}/approve`, data),
  rejectPartnerApplication: (id, data) => api.post(`/admin/partner-applications/${id}/reject`, data),

  // Vehicle Owner Management
  getVehicleOwnerStats: () => api.get('/admin/vehicle-owners/stats'),
  getVehicleOwners: (params) => api.get('/admin/vehicle-owners', { params }),
  getVehicleOwner: (id) => api.get(`/admin/vehicle-owners/${id}`),
  createVehicleOwner: (data) => api.post('/admin/vehicle-owners', data),
  updateVehicleOwner: (id, data) => api.put(`/admin/vehicle-owners/${id}`, data),
  deleteVehicleOwner: (id) => api.delete(`/admin/vehicle-owners/${id}`),
  toggleVehicleOwnerStatus: (id, status) => api.patch(`/admin/vehicle-owners/${id}/status`, { status }),
  getVehicleOwnerBookings: (id, params) => api.get(`/admin/vehicle-owners/${id}/bookings`, { params }),
  getVehicleOwnerDrivers: (id, params) => api.get(`/admin/vehicle-owners/${id}/drivers`, { params }),
  getVehicleOwnerVehicles: (id, params) => api.get(`/admin/vehicle-owners/${id}/vehicles`, { params }),
  createVehicleOwnerVehicle: (id, data) => api.post(`/admin/vehicle-owners/${id}/vehicles`, data),
  // Vehicle RC lookup — proxied by OUR backend, which holds the Parse CarInfo
  // API key server-side. The browser never talks to Parse and never sees the key.
  // `refresh: true` bypasses the backend's short-lived lookup cache.
  lookupVehicleByNumber: (vehicleNumber, refresh = false) =>
    api.get('/vehicles/lookup', { params: { vehicleNumber, ...(refresh ? { refresh: 'true' } : {}) } }),
  getVehicleLookupStatus: () => api.get('/vehicles/lookup/status'),
  createVehicle: (data) => api.post('/admin/vehicles', data),
  updateVehicle: (id, data) => api.put(`/admin/vehicles/${id}`, data),
  getVehicleTrips: (id, params) => api.get(`/admin/vehicles/${id}/trips`, { params }),
  getAuditLogs: (params) => api.get('/admin/audit-logs', { params }),
  getEntityAuditLogs: (entityType, entityId, params) => api.get(`/admin/audit-logs/entity/${entityType}/${entityId}`, { params }),

  // Connection Workflow (Orphan Records)
  getConnectionStats: () => api.get('/admin/vehicle-owners/connections/stats'),
  getOrphanVehicles: () => api.get('/admin/vehicle-owners/connections/orphan-vehicles'),
  getOrphanDrivers: () => api.get('/admin/vehicle-owners/connections/orphan-drivers'),
  getOrphanOwners: () => api.get('/admin/vehicle-owners/connections/orphan-owners'),
  connectVehicle: (data) => api.post('/admin/vehicle-owners/connections/connect-vehicle', data),
  connectDriver: (data) => api.post('/admin/vehicle-owners/connections/connect-driver', data),

  // Vehicle-Driver Assignment
  assignDriverToVehicle: (vehicleId, driverId) => api.post(`/admin/vehicles/${vehicleId}/assign-driver`, { driver_id: driverId }),
  removeDriverFromVehicle: (vehicleId) => api.post(`/admin/vehicles/${vehicleId}/remove-driver`),
  assignVehicleToDriver: (driverId, vehicleId) => api.post(`/admin/drivers/${driverId}/assign-vehicle`, { vehicle_id: vehicleId }),

  // Partner Vehicles
  getPartnerVehicles: (partnerId, params) => api.get(`/admin/partners/${partnerId}/vehicles`, { params }),
};

// Partner Public APIs
export const partnerAPI = {
  apply: (data) => api.post('/partner/apply', data),
  getApplicationStatus: (id) => api.get(`/partner/apply/${id}/status`),
  getMe: () => api.get('/partner/me'),
  getDashboard: () => api.get('/partner/me/dashboard'),
  // Authenticated partner self-service endpoints (shared backend APIs).
  // These reuse the same /api/partner/me/* routes the Driver App will use.
  getTrips: (params) => api.get('/partner/me/trips', { params }),
  getTrip: (id) => api.get(`/partner/me/trips/${id}`),
  getVehicles: (params) => api.get('/partner/me/vehicles', { params }),
  getDrivers: (params) => api.get('/partner/me/drivers', { params }),
  assignDriverToTrip: (tripId, driverId) => api.patch(`/partner/me/trips/${tripId}/driver`, { driver_id: driverId }),
  getFinancials: () => api.get('/partner/me/financials'),
  getLedger: (params) => api.get('/partner/me/ledger', { params }),
  getPayments: (params) => api.get('/partner/me/payments', { params }),
  getSettlements: (params) => api.get('/partner/me/settlements', { params }),
  getTripTimeline: (id) => api.get(`/trips/${id}/timeline`),
};

// Delivery APIs
export const deliveryAPI = {
  updateLocation: (data) => api.post('/delivery/update-location', data),
  getLocation: (bookingId) => api.get(`/delivery/location/${bookingId}`),
  verifyOTP: (data) => api.post('/delivery/verify-otp', data),
  completeDelivery: (data) => api.post('/delivery/complete', data)
};

// Maps / Route APIs — proxied through the backend so Google API keys are
// never exposed in frontend code.
export const mapsAPI = {
  // Calculate route distance + estimated price range for a pickup/drop pair.
  // Backend (mapsController.calculatePriceHandler) calls Google Distance Matrix
  // and falls back to city-pair distances when the API is unavailable.
  calculatePrice: (data) => api.post('/calculate-price', data),
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

// Financial APIs (canonical financial control center)
//
// Every figure here comes from the SAME backend service the dashboard totals
// use, so a card and the page it opens can never disagree. The list endpoints
// accept `page` / `limit` for pagination; omitting them returns the full set,
// which is what the summary-only callers expect.
export const financialAPI = {
  getSummary: () => api.get('/financials/summary'),
  // ?status=ALL|DUE|UNPAID|PARTIALLY_PAID|OVERDUE|DUE_SOON
  // ?search= &sort=OUTSTANDING_DESC|OUTSTANDING_ASC|OLDEST_DUE|NEWEST
  getReceivables: (params) => api.get('/financials/receivables', { params }),
  getPayables: () => api.get('/financials/payables'),
  getTransactions: (params) => api.get('/financials/transactions', { params }),
  getLedger: (params) => api.get('/financials/transactions/ledger', { params }),
  getAdvances: (params) => api.get('/financials/advances', { params }),
  getSettlements: (params) => api.get('/financials/settlements', { params }),

  /** Commission earned, per trip — gross / commission / net kept distinct. */
  getCommission: (params) => api.get('/financials/commission', { params }),

  /**
   * THE DRILL-DOWNS: "who exactly", behind a total.
   * Both come from the same aggregation as the list they were opened from.
   */
  getClientLedger: (clientId, params) =>
    api.get(`/financials/client-ledger/${encodeURIComponent(clientId)}`, { params }),
  getVendorLedger: (ownerId, params) =>
    api.get(`/financials/vendor-ledger/${encodeURIComponent(ownerId)}`, { params }),
};

// Client APIs (with financial summary)
export const clientAPI = {
  getAll: (params) => api.get('/admin/clients', { params }),
  getById: (id) => api.get(`/admin/clients/${id}`),
  create: (data) => api.post('/admin/clients', data),
  update: (id, data) => api.put(`/admin/clients/${id}`, data),
  deactivate: (id) => api.patch(`/admin/clients/${id}/deactivate`),
  reactivate: (id) => api.patch(`/admin/clients/${id}/reactivate`),
  getStatement: (id) => api.get(`/admin/clients/${id}/statement`),
  getTrips: (id) => api.get(`/admin/clients/${id}/trips`),
  search: (query) => api.get('/admin/clients/lookup/search', { params: { search: query } }),
};

// Standalone Trip Financial APIs (for trips without booking)
export const tripFinancialAPI = {
  getTripFinancials: (tripId) => api.get(`/trips/${tripId}/financials`),
};

export default api;

