/**
 * AdminTripProcess.jsx
 * ---------------------------------------------------------------------------
 * THE PROCESS ROUTER PAGE. One Trip, addressed by TWO segments.
 *
 *   /admin/trips/:tripId            → the Trip OVERVIEW (AdminTripWorkspace)
 *   /admin/trips/:tripId/vehicle    → Vehicle Workspace
 *   /admin/trips/:tripId/loading    → Loading Workspace
 *   /admin/trips/:tripId/dispatch   → Dispatch Workspace
 *   /admin/trips/:tripId/transit    → Transit & Tracking
 *   /admin/trips/:tripId/delivery   → Delivery Workspace
 *   /admin/trips/:tripId/pod        → POD Workspace
 *   /admin/trips/:tripId/completed  → Completion Summary
 *
 * WHY THIS PAGE EXISTS
 *   The process stepper used to write `?tab=loading` into the URL while
 *   `AdminTripWorkspace` never read it — so every stage rendered the identical
 *   overview. Changing the URL alone was never going to fix that; the URL has to
 *   select a DIFFERENT COMPONENT. That is what this file is: it reads the
 *   process segment and renders that process's workspace, sharing ONE data load
 *   and ONE trip id across all of them.
 *
 * IT DUPLICATES NOTHING
 *   Every fact comes from the endpoints that already existed. Every action calls
 *   the existing operational endpoints. No new trip, no new API, and no second
 *   financial model: the money shown is the canonical hire read back.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

// Both the trip reads and the operational ACTIONS live on `adminAPI`, which is
// where they already were; `tripOperations` is the named group added for the
// process workspaces so each one calls an obvious function, not a hand-written URL.
import { adminAPI } from '../services/api';

const { tripOperations } = adminAPI;
import AdminShell from '../components/admin-premium/layout/AdminShell';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import TripProcessShell from '../components/admin-premium/trips/process/TripProcessShell';
import LoadingWorkspace from '../components/admin-premium/trips/process/LoadingWorkspace';
import DispatchWorkspace from '../components/admin-premium/trips/process/DispatchWorkspace';
import { LOADING_AND_DISPATCH_ONLY, isKnownProcess, normalizeProcess } from '../components/admin-premium/trips/process/tripProcessModel';

const NAV_ITEMS = [
  { key: 'trips', label: 'Trips', icon: '🚛', path: '/admin/trips' },
  { key: 'bookings', label: 'Bookings', icon: '⟐', path: '/admin/bookings' },
  { key: 'clients', label: 'Clients', icon: '☍', path: '/admin/clients' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉', path: '/admin/owners' },
  { key: 'financials', label: 'Financials', icon: '◷', path: '/admin/financials' },
];

export default function AdminTripProcess() {
  const { tripId, process } = useParams();
  const navigate = useNavigate();
  const key = normalizeProcess(process);

  const [trip, setTrip] = useState(null);
  const [workflow, setWorkflow] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [readiness, setReadiness] = useState(null);
  // Phase 9 — the Dispatch workspace is served by its own endpoint. It is a
  // separate state, not merged into `trip`, because it carries facts the plain
  // trip row does not have (blockers, the e-way bill, the LR/GR record).
  const [dispatchWorkspace, setDispatchWorkspace] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(null);

  /** ONE load for the whole page. Every process sees the same trip. */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tripRes, workflowRes, docsRes, timelineRes] = await Promise.all([
        adminAPI.getTrip(tripId),
        adminAPI.getTripWorkflow(tripId).catch(() => null),
        tripOperations.getDocuments(tripId).catch(() => null),
        tripOperations.getTimeline(tripId).catch(() => null),
      ]);

      setTrip(tripRes?.data?.data || tripRes?.data || null);
      setWorkflow(workflowRes?.data?.data || null);
      setDocuments(docsRes?.data?.documents || docsRes?.data?.data?.documents || []);
      setTimeline(timelineRes?.data?.data || timelineRes?.data || []);

      // Process-specific reads, fetched only for the process on screen.
      if (key === 'dispatch') {
        // ONE call returns the whole workspace. A failure is NOT swallowed into
        // an empty object: the screen must be able to say it could not verify
        // readiness, which is a different statement from "not ready".
        try {
          const r = await tripOperations.getDispatchWorkspace(tripId);
          setDispatchWorkspace(r?.data?.data || null);
          setDispatchError(null);
        } catch (err) {
          setDispatchWorkspace(null);
          setDispatchError(err?.response?.data?.message || 'The dispatch workspace could not be loaded.');
        }
        const ready = await tripOperations.getDispatchReadiness(tripId).catch(() => null);
        setReadiness(ready?.data || null);
      } else {
        setDispatchWorkspace(null);
        setDispatchError(null);
        setReadiness(null);
      }

    } catch (err) {
      setError(err?.response?.data?.message || 'Trip not found.');
    } finally {
      setLoading(false);
    }
  }, [tripId, key]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Run an operational action, then RE-READ everything.
   *
   * §16 — the movement-history event is written by the SERVER as part of the
   * same request that changes the status, so the operator never records it and
   * it can never drift from the status it describes.
   *
   * Returns TRUE on success and FALSE on refusal, so a workspace can decide
   * whether to close a confirmation modal. A refused action must not close the
   * modal, because the operator has not finished what they were trying to do.
   */
  const onRun = useCallback(
    async (name, fn) => {
      setBusy(name);
      setActionError(null);
      try {
        await fn();
        await load();
        return true;
      } catch (err) {
        setActionError(err?.response?.data?.message || 'That action could not be completed.');
        // The blockers come back with the refusal, so the aside can list exactly
        // what is still missing instead of a bare error sentence.
        const blockers = err?.response?.data?.blockers;
        if (Array.isArray(blockers) && blockers.length) {
          setActionError(
            `${err.response.data.message} (${blockers.map((b) => b.label || b.message || b.code).join(', ')})`,
          );
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const stages = useMemo(() => workflow?.stages || [], [workflow]);

  /**
   * Which movement history the aside shows.
   *
   * Dispatch carries its own inside its workspace payload, where "what happened
   * to this load?" is genuinely the question being asked, and its entries carry
   * the richer metadata (vehicle, driver, LR number, who recorded it).
   * Everything else uses the plain trip timeline.
   */
  const asideHistory = useMemo(() => {
    if (key === 'dispatch' && Array.isArray(dispatchWorkspace?.movement_history)) {
      return dispatchWorkspace.movement_history;
    }
    return timeline;
  }, [key, dispatchWorkspace, timeline]);

  /* ══ §25 — an unknown process is an error, never a silent redirect ═══════ */
  if (!isKnownProcess(key) || !LOADING_AND_DISPATCH_ONLY.has(key)) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={() => navigate('/admin/trips')}>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
          <p className="text-[15px] font-bold text-amber-800">Unknown process</p>
          <p className="mt-1 text-[13px] text-amber-900">
            “{process}” is not a trip process. The trip itself is still available.
          </p>
          <Link
            to={`/admin/trips/${tripId}`}
            className="mt-3 inline-flex rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-semibold text-white"
          >
            Back to Trip
          </Link>
        </div>
      </AdminShell>
    );
  }

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={() => navigate('/admin/trips')}>
        <LoadingSkeleton />
      </AdminShell>
    );
  }

  if (error || !trip) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={() => navigate('/admin/trips')}>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="flex items-center gap-2 text-[15px] font-bold text-red-800">
            <AlertTriangle size={16} aria-hidden="true" /> Trip not found
          </p>
          <p className="mt-1 text-[13px] text-red-900">{error || `No trip with id ${tripId}.`}</p>
          <Link
            to="/admin/trips"
            className="mt-3 inline-flex rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text"
          >
            Back to Trips
          </Link>
        </div>
      </AdminShell>
    );
  }

  // §23 — the selected process decides which component renders.
  const workspace = {
    loading: () => (
      <LoadingWorkspace
        tripId={tripId}
        trip={trip}
        stages={stages}
        ops={tripOperations}
        documents={documents}
        busy={busy}
        onRun={onRun}
      />
    ),
    dispatch: () => (
      <DispatchWorkspace
        tripId={tripId}
        trip={trip}
        stages={stages}
        ops={tripOperations}
        workspace={dispatchWorkspace}
        workspaceError={dispatchError}
        readiness={readiness}
        documents={documents}
        busy={busy}
        onRun={onRun}
        onRefresh={load}
      />
    ),
  }[key];

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={() => navigate('/admin/trips')}>
      <TripProcessShell
        tripId={tripId}
        trip={trip}
        stages={stages}
        process={key}
        workflow={workflow}
        aside={
          <>
            {actionError ? (
              <section className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-[12.5px] font-semibold text-red-800">{actionError}</p>
              </section>
            ) : null}
            {/*
              §16 — MOVEMENT HISTORY on every process, not just at the end.
              These rows are written by the SERVER inside the same request that
              changes a status, so this list can never drift from the status it
              describes, and it is read-only here.

              The Dispatch and Transit workspaces carry their OWN movement
              history inside their payload, because those are the two processes
              where the question "what happened to this load?" is actually
              asked. The plain timeline is used everywhere else.
            */}
            <section className="rounded-xl border border-border bg-white p-4">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
                Movement History
              </p>
              {asideHistory.length === 0 ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  No movement recorded yet. Events appear here automatically as the trip advances.
                </p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {asideHistory.slice(0, 14).map((e, i) => (
                    <li key={e.timeline_id || e.id || e.event_id || i} className="flex gap-2 text-[12.5px]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                      <div className="min-w-0">
                        <p className="font-semibold text-text">
                          {e.description || e.notes || e.event_type || e.status}
                        </p>
                        {e.status && e.description ? (
                          <p className="text-[11.5px] text-muted">{e.status}</p>
                        ) : null}
                        {e.created_at || e.occurred_at ? (
                          <p className="text-[11.5px] text-muted">
                            {new Date(e.created_at || e.occurred_at).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* §19 / O — the workspaces for this trip, reachable from every process. */}
            <section className="rounded-xl border border-border bg-white p-4">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
                Related Workspaces
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                <Link
                  to={`/admin/trips/${tripId}`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  Trip Overview
                </Link>
                <Link
                  to={`/admin/trips/${tripId}/hire`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  Vehicle Hire
                </Link>
                <Link
                  to={`/admin/trips/${tripId}/loading`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  Loading
                </Link>
                <Link
                  to={`/admin/trips/${tripId}/transit`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  Transit
                </Link>
                <Link
                  to={`/admin/trips/${tripId}/delivery`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  Delivery
                </Link>
                <Link
                  to={`/admin/trips/${tripId}/pod`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  POD
                </Link>
                <Link
                  to={`/admin/trips/${tripId}/finance`}
                  className="text-[12.5px] font-semibold text-amber-700 hover:underline"
                >
                  Finance
                </Link>
              </div>
            </section>
          </>
        }
      >
        {workspace ? workspace() : null}
      </TripProcessShell>
    </AdminShell>
  );
}