/**
 * enquiryAPI.js
 * ---------------------------------------------------------------------------
 * Frontend client for the enquiry module.
 *
 * GUEST TOKEN HANDLING
 * A customer who submits without logging in receives a scoped `enquiry_token`
 * from POST /api/enquiries. Every subsequent read and action sends it in the
 * `X-Enquiry-Token` header — NOT the Authorization header — so it can never
 * clobber a real user JWT the customer may also hold.
 *
 * That is what replaces the old "Submit → forced login" wall: the confirmation
 * page is authorised immediately, from the token minted at submit time.
 */

import api from './api';

const TOKEN_STORAGE_PREFIX = 'bt_enquiry_token:';

/**
 * Persist a guest enquiry token, keyed by enquiry number, so a page reload or
 * returning visit keeps access. Keying by number (not a single global slot)
 * means a customer with several enquiries keeps access to all of them.
 */
export function storeEnquiryToken(enquiryNumber, token) {
  if (!enquiryNumber || !token) return;
  try {
    localStorage.setItem(TOKEN_STORAGE_PREFIX + enquiryNumber, token);
  } catch {
    // Private browsing / quota — the in-memory page session still works.
  }
}

export function getStoredEnquiryToken(enquiryNumber) {
  if (!enquiryNumber) return null;
  try {
    return localStorage.getItem(TOKEN_STORAGE_PREFIX + enquiryNumber);
  } catch {
    return null;
  }
}

export function clearEnquiryToken(enquiryNumber) {
  try {
    localStorage.removeItem(TOKEN_STORAGE_PREFIX + enquiryNumber);
  } catch {
    /* ignore */
  }
}

/**
 * A stable, non-secret per-browser identifier used to let a returning guest
 * list their own enquiries. It is not a credential — the server still requires
 * the scoped token to read a specific enquiry.
 */
export function getSessionKey() {
  const KEY = 'bt_session_key';
  try {
    let existing = localStorage.getItem(KEY);
    if (!existing) {
      existing = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(KEY, existing);
    }
    return existing;
  } catch {
    return null;
  }
}

/**
 * Adopt an `enquiry_token` handed over in the URL and persist it.
 *
 * WHY THIS EXISTS
 * The enquiry is shareable. When a customer opens a link such as
 *   /booking/enquiry/BTB-20260926-000123?enquiry_token=<jwt>
 * — from a WhatsApp message, an email, or a support agent — the token must be
 * adopted into storage and the query string scrubbed, otherwise the token
 * lingers in the address bar, in browser history, and in any screenshot the
 * customer takes. The backend already accepts `enquiry_token` as a query
 * parameter (see utils/EnquiryAccessToken.extractEnquiryToken); this adopts
 * it once and then always sends it as a header.
 *
 * Runs at module load, before any request is made.
 */
function adoptTokenFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('enquiry_token');
    if (!token) return;

    // The enquiry number is the PATH segment on /booking/enquiry/<number>, so
    // derive it from there and fall back to an explicit query parameter.
    const pathMatch = window.location.pathname.match(/\/booking\/enquiry\/([^/?#]+)/);
    const number =
      (pathMatch && decodeURIComponent(pathMatch[1])) ||
      params.get('enquiry_number') ||
      params.get('enquiryNumber');

    if (number) storeEnquiryToken(number, token);

    // Scrub the credential from the visible URL so it cannot linger in the
    // address bar, in browser history, or in a screenshot the customer shares.
    params.delete('enquiry_token');
    const qs = params.toString();
    const clean = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', clean);
  } catch {
    /* ignore */
  }
}

adoptTokenFromUrl();

/**
 * Read a successful POST /api/enquiries response and pull out everything the
 * NEXT page needs.
 *
 * The backend owns the identifiers — the frontend never constructs an enquiry
 * id or number. `enquiryId` / `enquiryNumber` / `enquiry` are all taken straight
 * off the create response (which is served AFTER the creating transaction has
 * committed), so the confirmation page can be navigated to and rendered without
 * guessing, re-reading, or re-deriving anything.
 *
 * Returns `null` fields rather than throwing so a caller can treat a malformed
 * response as "enquiry not created" instead of crashing mid-navigation.
 *
 * @param {object} response - the axios response from enquiryAPI.create
 * @returns {{enquiry:object|null, enquiryId:(number|string|null),
 *            enquiryNumber:string|null, bookingId:(number|string|null),
 *            redirectTo:string|null}}
 */
export function extractCreatedEnquiry(response) {
  const data = response?.data?.data || {};
  const enquiry = data.enquiry || null;

  const enquiryNumber =
    data.enquiryNumber || data.enquiry_number || enquiry?.enquiry_number || null;
  const enquiryId = data.enquiryId ?? data.enquiry_id ?? enquiry?.enquiry_id ?? null;
  const bookingId = data.bookingId ?? data.booking_id ?? enquiry?.booking?.booking_id ?? null;

  return {
    enquiry,
    enquiryId,
    enquiryNumber,
    bookingId,
    redirectTo: data.redirect_to || (enquiryNumber ? `/booking/enquiry/${enquiryNumber}` : null),
  };
}

/**
 * Issue a request carrying the guest token for a specific enquiry.
 *
 * `config` is merged rather than discarded, so a caller can pass an axios
 * `signal` and have cancellation work alongside the auth headers.
 *
 * @param {string} idOrNumber
 * @param {object} [config] - extra axios config (e.g. `{ signal }`)
 */
function withEnquiryAuth(idOrNumber, config = {}) {
  const token = getStoredEnquiryToken(idOrNumber);
  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      ...(token ? { 'X-Enquiry-Token': token } : {}),
      ...(getSessionKey() ? { 'X-Session-Key': getSessionKey() } : {}),
    },
  };
}

/** Encode an enquiry id/number for use in a path segment. */
const enc = (v) => encodeURIComponent(String(v));

export const enquiryAPI = {
  /**
   * Create an enquiry. Works with or without a login.
   *
   * Awaits the full HTTP response — the server only answers after the enquiry
   * row, its canonical number and its audit event have all been committed — and
   * stores the returned guest token so the confirmation page is authorised
   * immediately, with no login and no follow-up round trip.
   */
  create: async (payload) => {
    const sessionKey = getSessionKey();
    const response = await api.post(
      '/enquiries',
      payload,
      sessionKey ? { headers: { 'X-Session-Key': sessionKey } } : {}
    );

    const created = extractCreatedEnquiry(response);
    if (response.data?.data?.enquiry_token && created.enquiryNumber) {
      storeEnquiryToken(created.enquiryNumber, response.data.data.enquiry_token);
    }
    return response;
  },

  /**
   * Full customer-facing enquiry (route, shipment, assignment, timeline).
   * @param {string} idOrNumber
   * @param {object} [config] - extra axios config, e.g. `{ signal }` so an
   *   unmount or a superseded request can cancel the in-flight read.
   */
  get: (idOrNumber, config = {}) =>
    api.get(`/enquiries/${enc(idOrNumber)}`, withEnquiryAuth(idOrNumber, config)),

  /** Compact status — the polling fallback. */
  getStatus: (idOrNumber) =>
    api.get(`/enquiries/${enc(idOrNumber)}/status`, withEnquiryAuth(idOrNumber)),

  /** The quote card. */
  getQuote: (idOrNumber) =>
    api.get(`/enquiries/${enc(idOrNumber)}/quote`, withEnquiryAuth(idOrNumber)),

  /** Accept the final quote → server creates the canonical Booking. */
  accept: (idOrNumber) =>
    api.post(`/enquiries/${enc(idOrNumber)}/accept`, {}, withEnquiryAuth(idOrNumber)),

  /** Decline the final quote. */
  reject: (idOrNumber, reason) =>
    api.post(`/enquiries/${enc(idOrNumber)}/reject`, { reason }, withEnquiryAuth(idOrNumber)),

  /** Cancel the request (pre-confirmation only). */
  cancel: (idOrNumber, reason) =>
    api.post(`/enquiries/${enc(idOrNumber)}/cancel`, { reason }, withEnquiryAuth(idOrNumber)),

  /** The caller's own enquiries. */
  getMy: (params = {}) => {
    const sessionKey = getSessionKey();
    return api.get('/enquiries/my', {
      params,
      headers: sessionKey ? { 'X-Session-Key': sessionKey } : {},
    });
  },

  /**
   * The published customer-care profile, plus a WhatsApp link pre-filled with
   * this enquiry's real details. Fetched from the backend so the number is
   * never hardcoded in a React component.
   */
  getCustomerCare: (enquiryNumber) =>
    api.get('/enquiries/config/customer-care', {
      params: enquiryNumber ? { enquiry_number: enquiryNumber } : {},
    }),
};

export const adminEnquiryAPI = {
  /** List + search + filter + paginate. */
  list: (params = {}) => api.get('/admin/enquiries', { params }),

  /** Filter chip counts. */
  getStats: () => api.get('/admin/enquiries/stats'),

  /** Assignable vehicles / drivers / partners / owners. */
  getOptions: () => api.get('/admin/enquiries/options'),

  /** Full workspace payload + audit history. */
  get: (id) => api.get(`/admin/enquiries/${enc(id)}`),

  /** Review state / internal note. */
  update: (id, payload) => api.patch(`/admin/enquiries/${enc(id)}`, payload),

  /** Assign vehicle + driver + partner + owner. */
  assign: (id, payload) => api.post(`/admin/enquiries/${enc(id)}/assign`, payload),

  /** Save the final quote (draft — the customer is not notified). */
  saveQuote: (id, payload) => api.post(`/admin/enquiries/${enc(id)}/quote`, payload),

  /** Publish the quote to the customer. */
  sendQuote: (id) => api.post(`/admin/enquiries/${enc(id)}/send-quote`),

  /** Change resources on a live enquiry. */
  reassign: (id, payload) => api.post(`/admin/enquiries/${enc(id)}/reassign`, payload),

  /** Admin cancellation. */
  cancel: (id, reason) => api.post(`/admin/enquiries/${enc(id)}/cancel`, { reason }),
};

export const driverEnquiryAPI = {
  /** Jobs assigned to the authenticated driver. */
  getMy: (params = {}) => api.get('/driver/enquiries', { params }),

  /** One assigned job. */
  get: (id) => api.get(`/driver/enquiries/${enc(id)}`),

  /** Report a problem with an assigned job. */
  reportIssue: (id, payload) => api.post(`/driver/enquiries/${enc(id)}/report-issue`, payload),

  /**
   * Ask an admin to replace you. This is the ONLY way a driver can step away
   * from a customer booking — there is no driver cancel endpoint by design.
   */
  requestReassignment: (id, payload) =>
    api.post(`/driver/enquiries/${enc(id)}/request-reassignment`, payload),
};

export default enquiryAPI;
