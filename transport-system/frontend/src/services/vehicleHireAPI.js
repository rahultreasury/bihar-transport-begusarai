/**
 * services/vehicleHireAPI.js
 * ---------------------------------------------------------------------------
 * THE UNIVERSAL VEHICLE HIRE API CLIENT.
 *
 * One module, one set of endpoints. There is deliberately no
 * `contractHireAPI` and no `commissionHireAPI`: both models are the same screen
 * and the same record. "Billing To" decides which one a hire is, and the backend
 * derives the business model from it.
 *
 * NOTHING HERE SENDS MONEY
 *   `previewHire` and `hireVehicle` send only the operator's rate INPUTS. The
 *   gross, the commission and the net vendor payable are computed by the server
 *   and never round-tripped through the browser, so a tampered request cannot
 *   change what the vendor is owed.
 *
 * The client is the existing shared axios instance from services/api.js, so the
 * admin token, the base URL and the 401 handling are exactly the ones every
 * other admin module already uses.
 */

import api from './api';

const BASE = '/vehicle-hire';

export const vehicleHireAPI = {
  /**
   * The Vehicle Hire operational list: real trips joined to real `vehicle_hires`
   * rows, with hire eligibility and the three money figures (gross hire,
   * commission, net vendor payable) read from their own stored columns.
   *
   * `view` is 'waiting' (the operational queue), 'hired', or 'all'.
   */
  listTrips: (params = {}) => api.get(`${BASE}/trips`, { params }),

  /**
   * The option catalogue: billing parties, rate bases, commission types, the
   * document list and the warning window. Read from the backend's single policy
   * module, so the page cannot offer a choice the server would reject.
   */
  getCatalogue: () => api.get(`${BASE}/catalogue`),

  /**
   * Everything the page needs to open for a trip: the trip, the customer, the
   * route, the current status, the assigned vehicle/vendor/driver, that
   * vehicle's real document expiries, the catalogue, and any existing hire.
   */
  getContext: (tripId) => api.get(`${BASE}/trips/${tripId}/context`),

  /** The existing hire for this trip, or null. */
  getHire: (tripId) => api.get(`${BASE}/trips/${tripId}`),

  /**
   * THE CURRENT ASSIGNMENT — vehicle, driver, vendor and the derived
   * vehicle-hire status (WAITING_FOR_VEHICLE | VEHICLE_ASSIGNED | VEHICLE_HIRED).
   *
   * The Enquiry page and the Vehicle Hire page BOTH read the current assignment
   * from this endpoint, which is why they can never show different vehicles for
   * the same consignment. The status is computed by the server from stored data
   * — no client-side inference.
   */
  getAssignment: (tripId) => api.get(`${BASE}/trips/${tripId}/assignment`),

  /**
   * The SAME canonical assignment, addressed by order or enquiry.
   *
   * The Enquiry page knows its `booking_id` / `enquiry_id`, not the trip id, so
   * it reads through here rather than re-deriving the trip itself. It resolves
   * to the same Trip row the Vehicle Hire page reads, which is why the two
   * screens cannot show different vehicles for one consignment.
   *
   * Resolves to `null` when the order has no operational trip yet.
   */
  getAssignmentByBooking: (params) => api.get(`${BASE}/assignment`, { params }),

  /**
   * Assign / re-assign the vehicle, driver or vendor on a consignment.
   *
   * This is the SAME backend operation the Enquiry page performs — one service,
   * one Trip row, one current assignment. It UPDATES the existing assignment
   * and never creates a second one, and it never touches hire money: agreeing
   * what the vendor is owed is the separate `hireVehicle` call below.
   */
  assignTripResources: (tripId, payload) => api.post(`${BASE}/trips/${tripId}/assign`, payload),

  /**
   * Create the one operational Trip for a confirmed order that has none yet.
   *
   * Idempotent, and safe to call on a page load: it never modifies an existing
   * trip or assignment. Used so a consignment confirmed before trip
   * provisioning existed still appears here instead of being invisible.
   */
  provision: (payload = {}) => api.post(`${BASE}/provision`, payload),

  /**
   * Searchable vehicle / vendor / driver lists from the EXISTING masters, with
   * each vehicle's real document statuses and its owner's details attached so
   * selecting a vehicle auto-populates the vendor block in one call.
   */
  getLookups: (params = {}) => api.get(`${BASE}/lookups`, { params }),

  /** One vehicle: its documents, its vendor and whether it can be hired. */
  getVehicle: (id) => api.get(`${BASE}/vehicles/${id}`),

  /** One vendor: their vehicles and drivers. */
  getVendor: (id) => api.get(`${BASE}/vendors/${id}`),

  /** One driver: their vendor and whether they can be assigned. */
  getDriver: (id) => api.get(`${BASE}/drivers/${id}`),

  /**
   * Server-side calculation of the whole hire — gross, commission, net — that
   * writes NOTHING. The page's summary card and the saved record are produced
   * by the identical code path, so what the operator verifies is what is stored.
   */
  previewHire: (tripId, payload) => api.post(`${BASE}/trips/${tripId}/preview`, payload),

  /**
   * "Hire Vehicle". Validates, calculates, saves the hire, links it to the
   * existing Trip, moves the trip to VEHICLE HIRED and records the event on the
   * existing trip timeline and audit log — all in one transaction.
   */
  hireVehicle: (tripId, payload) => api.post(`${BASE}/trips/${tripId}`, payload),

  /**
   * "Edit Vehicle Hire" — UPDATES the existing hire; it can never create a
   * second one. Takes the SAME operator inputs as `hireVehicle`; the backend
   * recalculates gross / commission / net with the identical calculator, so
   * nothing about the money is computed in the browser.
   *
   * The challan number is preserved server-side, so a challan already given to
   * a driver keeps identifying the same hire after an edit.
   */
  updateVehicleHire: (tripId, payload) => api.put(`${BASE}/trips/${tripId}`, payload),

  /**
   * The challan PDF as a Blob, for download or for the Web Share API.
   * Returns `{ blob, filename }` so the caller can both save it and hand the
   * same bytes to a share sheet.
   */
  downloadChallan: async (tripId, challanNumber) => {
    const response = await api.get(`${BASE}/trips/${tripId}/challan.pdf`, {
      responseType: 'blob',
    });

    const safe = String(challanNumber || `hire-${tripId}`).replace(/[^\w.-]+/g, '-');
    return {
      blob: response.data,
      filename: `${safe}.pdf`,
      type: response.data?.type || 'application/pdf',
    };
  },

  /** The authorised URL for the challan, for a plain `href` download. */
  challanUrl: (tripId) => `${api.defaults.baseURL}${BASE}/trips/${tripId}/challan.pdf`,
};

export default vehicleHireAPI;