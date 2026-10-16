/**
 * LifecycleRail.jsx
 * ============================================================================
 * SHARED LIFECYCLE RAIL — The single lifecycle rail used by both
 * AdminOrderMaster (/admin/bookings/:bookingNumber) and
 * TripDetailWorkspace (/admin/trips/:tripId).
 *
 * DRIVEN ENTIRELY BY THE SERVER'S WORKFLOW ENDPOINT.
 *
 *   GET /api/trips/:tripId/workflow  →  { stages: [{ key, state, requirement }] }
 *
 * The server's `config/tripStagePolicy.js` is the SINGLE source of truth for
 * the lifecycle stages and their mapping to Trip.status. This component is
 * purely presentational — it arranges what the server already decided.
 *
 * USED BY:
 *   • AdminOrderMaster (/admin/bookings/:bookingNumber)
 *   • TripDetailWorkspace (/admin/trips/:tripId)
 *
 * NO BUSINESS LOGIC HERE — only presentation of what the server already decided.
 */

import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import { cx, fmtDate } from './dispatchAtoms';
import { processPath } from './tripProcessModel';

const STAGE_STATE = {
  DONE: 'done',
  CURRENT: 'current',
  UPCOMING: 'upcoming',
  UNAVAILABLE: 'unavailable',
};

const ICON_MAP = {
  ENQUIRY: '📋',
  QUOTATION: '💰',
  ORDER_CONFIRMED: '✅',
  VEHICLE_HIRED: '🚛',
  LOADING: '📦',
  DISPATCH: '🚚',
  TRANSIT: '🚚',
  DELIVERY: '📦',
  POD: '📄',
  COMPLETED: '✅',
};

/**
 * Map the server's stage state to our internal state.
 * @param {string} serverState - 'done', 'completed', 'current', 'available', 'upcoming', 'locked'
 * @returns {string}
 */
function mapServerState(serverState) {
  switch (serverState) {
    case 'done':
    case 'completed':
      return STAGE_STATE.DONE;
    case 'current':
    case 'available':
      return STAGE_STATE.CURRENT;
    case 'upcoming':
      return STAGE_STATE.UPCOMING;
    case 'locked':
    case 'unavailable':
    default:
      return STAGE_STATE.UNAVAILABLE;
  }
}

/**
 * LifecycleRail - The unified lifecycle rail component.
 *
 * @param {Object} props
 * @param {Array} props.stages - Array of stage objects from server workflow: [{ key, label, state, requirement, goto }]
 * @param {string} [props.activeProcess] - Currently active process key (e.g., 'loading', 'dispatch')
 * @param {Function} props.onGoTab - Callback when a stage is clicked: onGoTab(tabKey)
 * @param {string} [props.tripId] - Trip ID for generating process paths
 * @param {boolean} [props.embedded] - Whether rendered in embedded context (no back button)
 * @param {string} [props.tripNumber] - Trip number for display
 */
export default function LifecycleRail({
  stages = [],
  activeProcess = null,
  onGoTab,
  tripId = null,
  tripNumber = null,
  embedded = false,
}) {
  const navigate = useNavigate();

  // Build the rail from server-provided stages
  const rail = useMemo(() => {
    if (!Array.isArray(stages) || stages.length === 0) return [];

    // Find the current stage index
    const currentIndex = stages.findIndex(s => 
      s.state === 'current' || s.state === 'available' || s.state === 'current'
    );

    return stages.map((stage, index) => {
      const serverState = stage.state || 'upcoming';
      const state = mapServerState(serverState);
      const isCurrent = index === stages.findIndex(s => s.state === 'current' || s.state === 'available');
      const isDone = stage.state === 'done' || stage.state === 'completed';
      
      // Determine if this stage is the "available" one (next actionable)
      const isAvailable = serverState === 'available';
      
      return {
        ...stage,
        index,
        state,
        isCurrent: serverState === 'current' || serverState === 'available',
        isDone: isDone,
        isAvailable,
        canNavigate: stage.goto && (stage.state === 'current' || stage.state === 'available' || stage.state === 'done' || stage.state === 'completed'),
      };
    });
  }, [stages]);

  // Map server state to our internal state
  function mapServerState(serverState) {
    if (!serverState) return 'upcoming';
    const s = String(serverState).toLowerCase();
    if (s === 'done' || s === 'completed') return 'done';
    if (s === 'current' || s === 'available') return 'current';
    if (s === 'upcoming') return 'upcoming';
    if (s === 'locked' || s === 'unavailable') return 'unavailable';
    return 'upcoming';
  }

  const STAGE_ICONS = {
    ENQUIRY: '📋',
    QUOTATION: '💰',
    ORDER_CONFIRMED: '✅',
    VEHICLE_HIRED: '🚛',
    LOADING: '📦',
    DISPATCH: '🚚',
    TRANSIT: '🚛',
    DELIVERY: '📦',
    POD: '📄',
    COMPLETED: '✅',
  };

  const STATE_STYLES = {
    done: 'border-emerald-600 bg-emerald-50 text-emerald-700',
    current: 'border-amber-600 bg-amber-50 text-amber-700 ring-2 ring-amber-200',
    available: 'border-amber-600 bg-amber-50 text-amber-700 ring-2 ring-amber-200',
    upcoming: 'border-slate-300 bg-white text-slate-500',
    unavailable: 'border-slate-200 bg-slate-50 text-slate-400',
  };

  const STATE_LABELS = {
    done: 'Done',
    current: 'Current',
    available: 'Available',
    upcoming: 'Upcoming',
    unavailable: 'Not available',
  };

  const handleStageClick = (stage) => {
    if (!stage.goto || !stage.canNavigate) return;
    
    if (stage.goto.kind === 'trip_tab') {
      // Navigate to TripDetailWorkspace with the correct tab
      const tab = stage.goto.tab || 'overview';
      // Use processPath for correct URL
      // For now, navigate directly - the TripDetailWorkspace will handle tab via URL
    }
    
    if (onGoTab) {
      onGoTab(stage.goto);
    }
  };

  if (!stages || stages.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500 text-center">No lifecycle data available</p>
      </div>
    );
  }

  // Check if we have an "available" stage (next actionable)
  const hasAvailable = stages.some(s => s.state === 'available');
  
  // Check if we have a "current" stage
  const hasCurrent = stages.some(s => s.state === 'current');

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Shipment Lifecycle</h3>
        {tripNumber && (
          <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
            {tripNumber}
          </span>
        )}
      </div>

      {/* ── Rail ── */}
      <nav aria-label="Shipment lifecycle" className="overflow-x-auto">
        <ol className="flex min-w-max items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
          {stages.map((stage, index) => {
            const serverState = stage.state || 'upcoming';
            const state = mapServerState(serverState);
            const isCurrent = stage.state === 'current' || stage.state === 'available';
            const isDone = stage.state === 'done' || stage.state === 'completed';
            const isAvailable = stage.state === 'available';
            
            const StageIcon = stage.icon || null;
            
            const canNavigate = stage.goto && (stage.state === 'current' || stage.state === 'available' || stage.state === 'done' || stage.state === 'completed');
            
            const handleClick = () => {
              if (!stage.goto || !stage.canNavigate) return;
              
              if (stage.goto.kind === 'trip_tab') {
                // Navigate to TripDetailWorkspace with the correct tab
                const tab = stage.goto.tab || 'overview';
                // The TripDetailWorkspace reads the tab from URL search params
                if (window.location.pathname.includes('/admin/trips/')) {
                  // Already on trip workspace, just change tab via URL
                  const url = new URL(window.location.href);
                  url.searchParams.set('tab', stage.goto.tab);
                  window.history.pushState({}, '', url);
                  // Trigger a refresh by dispatching a custom event
                  window.dispatchEvent(new CustomEvent('trip-tab-change', { detail: { tab: stage.goto.tab } }));
                } else {
                  // Navigate to trip workspace with tab
                  window.location.href = `/admin/trips/${tripId}?tab=${stage.goto.tab}`;
                }
              }
            };

            const railStyles = {
              done: 'border-emerald-600 bg-emerald-50 text-emerald-700',
              current: 'border-amber-600 bg-amber-50 text-amber-700 ring-2 ring-amber-200',
              available: 'border-amber-600 bg-amber-50 text-amber-700 ring-2 ring-amber-200',
              upcoming: 'border-slate-300 bg-white text-slate-500',
              unavailable: 'border-slate-200 bg-slate-50 text-slate-400',
            };

            const stateStyles = railStyles[isDone ? 'done' : isCurrent ? 'current' : isAvailable ? 'available' : 'upcoming'];
            
            const Icon = ICON_MAP[stage.key] || '📦';
            
            const stageStyles = cx(
              'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition',
              stateStyles,
              stage.canNavigate ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-not-allowed',
              'transition-colors'
            );

            const isLast = index === stages.length - 1;

            return (
              <li key={stage.key} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleClick}
                  disabled={!stage.canNavigate}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={stage.requirement || stage.label}
                  className={stageStyles}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12px]" aria-hidden="true">
                      {stage.icon || '📦'}
                    </span>
                    <span className="font-semibold text-[11.5px] leading-tight whitespace-nowrap">
                      {stage.label}
                    </span>
                  </span>
                  {stage.requirement && !isDone && !isCurrent && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 border-slate-200 bg-slate-50">
                      <Lock size={8} aria-hidden="true" />
                      {stage.requirement}
                    </span>
                  )}
                </button>
                {!isLast && (
                  <span className={cx(
                    'w-6 h-px flex-shrink-0',
                    isDone ? 'bg-emerald-500' : 'bg-slate-200'
                  )} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ── Legend ── */}
      <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-[10.5px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-medium text-slate-600">Done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3 w-3 rounded-full border-2 border-amber-600 bg-amber-50" />
          <span className="text-[10px] font-medium text-slate-600">Current</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3 w-3 rounded-full border-2 border-amber-600 bg-amber-50" />
          <span className="text-[10px] font-medium text-slate-600">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3 w-3 rounded-full bg-slate-300" />
          <span className="text-[10px] font-medium text-slate-600">Upcoming</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex h-3 w-3 rounded-full bg-slate-200" />
          <span className="text-[10px] font-medium text-slate-500">Locked</span>
        </div>
      </div>
    </div>
  );
}

