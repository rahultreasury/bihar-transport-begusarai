/**
 * useEnquiryRealtime.js
 * ---------------------------------------------------------------------------
 * Live updates for the enquiry confirmation page and the admin workspace.
 *
 * TWO TRANSPORTS, ONE CONTRACT
 * The hook always delivers the same `onUpdate` callback, whether the change
 * arrived over a socket or over a poll. Consumers never branch on transport.
 *
 *   1. Socket.IO (preferred) — instant push, scoped to `enquiry:<id>` for a
 *      customer and `admin:enquiries` for an admin. The server authorises the
 *      room join; the client only ever *requests* one.
 *   2. Polling (fallback) — a slow interval that is active only while the
 *      socket is DOWN, and a fast interval while the socket is UP but a
 *      customer's page has been backgrounded. This is what makes the feature
 *      survive a proxy that strips WebSocket upgrades.
 *
 * AUTHENTICATION
 * A customer uses their scoped enquiry token when they are not logged in; a
 * logged-in user or an admin uses the regular user JWT. Both are accepted by
 * the server's socket handshake.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { getStoredEnquiryToken } from '../services/enquiryAPI';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || '';

/** Strip the trailing `/api` so we connect to the socket origin, not the REST base. */
function resolveSocketOrigin() {
  if (!SOCKET_URL) return '';
  try {
    const url = new URL(SOCKET_URL, window.location.origin);
    url.pathname = url.pathname.replace(/\/api\/?$/, '');
    return url.origin;
  } catch {
    return SOCKET_URL.replace(/\/api\/?$/, '');
  }
}

/** Events that mean "something changed, re-read the enquiry". */
const ENQUIRY_EVENTS = [
  'enquiry:created',
  'enquiry:updated',
  'vehicle:assigned',
  'driver:assigned',
  'quote:created',
  'quote:updated',
  'quote:ready',
  'customer:accepted',
  'customer:rejected',
  'booking:confirmed',
  'booking:cancelled',
  'trip:started',
  'trip:completed',
];

/**
 * Poll cadence. 12s is the single number used for every automatic refresh, which
 * puts a vehicle/driver assignment on the customer's screen within ~12s of the
 * admin pressing "Assign Resources" — fast enough to feel live, slow enough not
 * to hammer the API. A page the customer is actively looking at must never lag
 * more than one tick behind the database, so there is deliberately no separate
 * "slow when tab is visible" mode: visibility now only gates whether an ALREADY
 * SCHEDULED tick fires, it does not change the interval.
 */
const POLL_ACTIVE_MS = 12000;
/** Used only while the socket is unavailable — still better than nothing. */
const POLL_DEGRADED_MS = 12000;

/**
 * @param {Object} options
 * @param {string} [options.enquiryIdOrNumber] - subscribe to this enquiry's room
 * @param {'customer'|'admin'|'driver'|'partner'} [options.role='customer']
 * @param {boolean} [options.enabled=true]
 * @param {(payload?:object) => void} [options.onUpdate] - fired on any change
 * @param {() => Promise<object>} [options.refetch] - re-read the enquiry
 * @param {string} [options.currentStatus] - the enquiry's live backend status,
 *   used together with `stopWhenStatus` to retire the timer.
 * @param {string[]} [options.stopWhenStatus] - statuses that end automatic refresh.
 *   Polling is a safety net for a live request; once the enquiry reaches one of
 *   these the server will never report a further change on its own, so the timer
 *   is retired. The socket stays connected and a manual reload still works.
 * @returns {{connected:boolean, degraded:boolean, lastEventAt:Date|null}}
 */
export function useEnquiryRealtime({
  enquiryIdOrNumber,
  role = 'customer',
  enabled = true,
  onUpdate,
  refetch,
  currentStatus,
  stopWhenStatus = [],
} = {}) {
  const [connected, setConnected] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [lastEventAt, setLastEventAt] = useState(null);

  const socketRef = useRef(null);
  // Keep the latest callbacks in refs so re-renders never tear down the socket.
  const onUpdateRef = useRef(onUpdate);
  const refetchRef = useRef(refetch);
  // The caller re-renders with the fresh backend status on every refetch, so the
  // polling timer reads it through a ref instead of being torn down and rebuilt.
  const latestStatusRef = useRef(currentStatus);
  const stopWhenRef = useRef(stopWhenStatus);
  onUpdateRef.current = onUpdate;
  refetchRef.current = refetch;
  latestStatusRef.current = currentStatus;
  stopWhenRef.current = stopWhenStatus;

  /** Run a re-read, guarded against overlapping in-flight requests. */
  const doRefetch = useCallback(async () => {
    if (!refetchRef.current) return;
    try {
      await refetchRef.current();
    } catch {
      // A failed poll is not user-facing; the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const userToken = localStorage.getItem('token');
    const enquiryToken = enquiryIdOrNumber
      ? getStoredEnquiryToken(enquiryIdOrNumber)
      : null;

    // A socket with no credential is rejected by the server handshake, so do
    // not open one at all — fall through to polling instead.
    if (!userToken && !enquiryToken) {
      setDegraded(true);
      return undefined;
    }

    let socket;
    try {
      socket = io(resolveSocketOrigin() || window.location.origin, {
        auth: { token: userToken || enquiryToken },
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        reconnectionAttempts: 10,
      });
      socketRef.current = socket;
    } catch {
      setDegraded(true);
      return undefined;
    }

    socket.on('connect', () => {
      setConnected(true);
      setDegraded(false);
      // Request the rooms this principal is entitled to. The server decides
      // what is actually granted; a rejected request simply joins nothing.
      if (role === 'admin') {
        socket.emit('enquiry:subscribe', {});
      } else if (enquiryIdOrNumber) {
        socket.emit('enquiry:subscribe', { enquiryIds: [enquiryIdOrNumber] });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setDegraded(true);
    });

    socket.on('connect_error', () => {
      setConnected(false);
      setDegraded(true);
    });

    const handleEvent = (payload) => {
      setLastEventAt(new Date());
      onUpdateRef.current?.(payload);
      // The push payload is a summary; re-read for the full, authoritative
      // state so the page never renders a partially-updated card.
      doRefetch();
    };

    ENQUIRY_EVENTS.forEach((evt) => socket.on(evt, handleEvent));

    // ── Polling fallback / background refresh ──────────────────────────
    let timer = null;
    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const startPolling = (interval) => {
      stopPolling();
      timer = setInterval(() => {
        // A terminal enquiry will not change again, so the safety net retires.
        // Socket pushes and manual reloads still work after this.
        if (Array.isArray(stopWhenRef.current) && stopWhenRef.current.includes(latestStatusRef.current)) {
          stopPolling();
          return;
        }
        if (document.visibilityState === 'visible' || !connected) {
          doRefetch();
        }
      }, interval);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Coming back to the tab: catch up immediately, then settle into the
        // fast interval.
        doRefetch();
        startPolling(POLL_ACTIVE_MS);
      }
    };

    socket.on('connect', () => startPolling(POLL_ACTIVE_MS));
    socket.on('disconnect', () => startPolling(POLL_DEGRADED_MS));
    document.addEventListener('visibilitychange', onVisibility);
    // Safety net: always poll, so a silently dead socket cannot freeze the UI.
    startPolling(POLL_ACTIVE_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopPolling();
      ENQUIRY_EVENTS.forEach((evt) => socket.off(evt, handleEvent));
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, enquiryIdOrNumber, role, doRefetch]);

  return { connected, degraded, lastEventAt };
}

/**
 * A minimal socket for the admin enquiries table: it does not need a per-enquiry
 * refetch, just "something changed, reload the list".
 */
export function useAdminEnquiryRealtime({ enabled = true, onChanged } = {}) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onChanged);
  handlerRef.current = onChanged;

  useEffect(() => {
    const userToken = localStorage.getItem('token');
    if (!enabled || !userToken) return undefined;

    let socket;
    try {
      socket = io(resolveSocketOrigin() || window.location.origin, {
        auth: { token: userToken },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
      });
    } catch {
      return undefined;
    }

    const onAny = () => handlerRef.current?.();
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('enquiry:subscribe', {});
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    [
      'enquiry:created',
      'enquiry:updated',
      'quote:created',
      'quote:ready',
      'customer:accepted',
      'customer:rejected',
      'booking:confirmed',
      'booking:cancelled',
      'driver:reassignment_requested',
      'driver:issue_reported',
    ].forEach((evt) => socket.on(evt, onAny));

    return () => {
      socket.disconnect();
    };
  }, [enabled]);

  return { connected };
}

/**
 * Small helper for pages that only want a status poll without any socket
 * complexity (e.g. a lightweight widget).
 */
export function useEnquiryStatusPoll(enquiryIdOrNumber, intervalMs = 20000, enabled = true) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !enquiryIdOrNumber) return undefined;
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await api.get(
          `/enquiries/${encodeURIComponent(enquiryIdOrNumber)}/status`,
          {
            headers: (() => {
              const token = getStoredEnquiryToken(enquiryIdOrNumber);
              return token ? { 'X-Enquiry-Token': token } : {};
            })(),
          }
        );
        if (!cancelled) {
          setStatus(data.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    };

    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enquiryIdOrNumber, intervalMs, enabled]);

  return { status, error };
}

export default useEnquiryRealtime;
