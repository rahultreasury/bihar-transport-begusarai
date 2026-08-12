/**
 * authStorage.js
 * SINGLE source of truth for authentication persistence.
 *
 * Responsibilities (ONLY persistence):
 *   - getStoredAuth()   → read persisted token + user
 *   - setStoredAuth()   → persist token + user
 *   - clearStoredAuth() → remove all auth-related persisted values
 *
 * It also dispatches a global `auth:changed` event so that the runtime
 * AuthContext (REACT state) can stay in sync when auth is set/cleared —
 * including when the api.js interceptor clears auth on a 401.
 *
 * NOTE: This module does NOT hold React state. AuthContext is the single
 * runtime source of truth. localStorage is only the persistence layer.
 */

const AUTH_KEYS = ['token', 'user'];
const AUTH_EVENT = 'auth:changed';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function safeRemoveSession(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function parseUser(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read the persisted auth state.
 * @returns {{ token: string|null, user: Object|null }}
 */
export function getStoredAuth() {
  const token = safeGet('token');
  const user = parseUser(safeGet('user'));
  return { token, user };
}

/**
 * Persist auth state and broadcast the change.
 * @param {string} token
 * @param {Object} user
 */
export function setStoredAuth(token, user) {
  safeSet('token', token || '');
  safeSet('user', JSON.stringify(user || {}));
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { authenticated: true } }));
}

/**
 * Remove ALL auth-related persisted values (localStorage + sessionStorage)
 * and broadcast the change. Only clears auth keys — never unrelated app data.
 */
export function clearStoredAuth() {
  AUTH_KEYS.forEach((key) => {
    safeRemove(key);
    safeRemoveSession(key);
  });
  window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: { authenticated: false } }));
}

/**
 * Subscribe to auth-change events.
 * @param {(authenticated: boolean) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(handler) {
  const listener = (e) => {
    handler(!!e?.detail?.authenticated);
  };
  window.addEventListener(AUTH_EVENT, listener);
  return () => window.removeEventListener(AUTH_EVENT, listener);
}

export const AUTH_EVENT_NAME = AUTH_EVENT;
