/**
 * TripProcessShell.jsx
 * ---------------------------------------------------------------------------
 * The frame EVERY process workspace renders inside.
 *
 * WHY A SHELL
 *   The operator's context has to be identical whichever process they are in —
 *   same trip, same header, same rail — so that switching process changes the
 *   WORK, never the sense of where they are. Each workspace then contributes only
 *   its own facts and its own actions.
 *
 * IT DELIBERATELY DOES NOT DECIDE ANYTHING
 *   Stage states come from the server's lifecycle projection. This component only
 *   arranges and navigates. A workspace that needs a different fact asks for it.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Circle, Loader2, Lock } from 'lucide-react';

import { buildRail, processMeta, STAGE_STATE } from './tripProcessModel';

const cx = (...parts) => parts.filter(Boolean).join(' ');

const RING = {
  [STAGE_STATE.DONE]: 'border-emerald-500 bg-emerald-50 text-emerald-700',
  [STAGE_STATE.CURRENT]: 'border-amber-500 bg-amber-50 text-amber-700',
  [STAGE_STATE.UPCOMING]: 'border-border bg-white text-muted',
};

/**
 * @param {object} props
 * @param {number|string} props.tripId
 * @param {object} props.trip          the trip row (master record)
 * @param {object[]} props.stages     the server rail from workflow.stages
 * @param {string} props.process       the selected process segment
 * @param {object} [props.workflow]    the whole workflow payload (blockers etc.)
 * @param {React.ReactNode} props.children  the process workspace
 * @param {React.ReactNode} [props.aside]
 */
export default function TripProcessShell({
  tripId,
  trip,
  stages = [],
  process,
  workflow,
  children,
  aside,
}) {
  const meta = processMeta(process);
  const rail = buildRail(stages, process);

  const customer = trip?.booking?.customer_name || trip?.customer_name || '—';
  const route = [trip?.pickup_location, trip?.drop_location].filter(Boolean).join(' → ') || '—';
  const vehicle = trip?.vehicle?.vehicle_number || trip?.vehicle_number || 'Not assigned';
  const driver = trip?.driver?.driver_name || trip?.driver_name || 'Not assigned';
  const status = String(trip?.status || '').replace(/_/g, ' ') || '—';

  return (
    <div className="space-y-4">
      {/* ══ BREADCRUMB ═══════════════════════════════════════════════════ */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[12px]">
        <Link
          to={`/admin/trips/${tripId}`}
          className="inline-flex items-center gap-1 font-semibold text-muted transition hover:text-amber-600"
        >
          <ArrowLeft size={13} aria-hidden="true" />
          Back to Trip
        </Link>
        <span className="text-muted/60" aria-hidden="true">/</span>
        <span className="font-mono font-semibold text-text">{trip?.trip_number || `Trip ${tripId}`}</span>
        <span className="text-muted/60" aria-hidden="true">/</span>
        <span className="font-semibold text-amber-700">{meta?.label || 'Process'}</span>
      </nav>

      {/* ══ HEADER — which trip, which process ════════════════════════════ */}
      <header className="rounded-xl border border-border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[17px] font-bold leading-tight text-[#1e3a5f]">
              {trip?.trip_number || `Trip ${tripId}`}
            </p>
            {/* The PROCESS, named. A generic "Trips" heading here is what made
                it look as though no process had been selected at all. */}
            <p className="mt-1 text-[12px] font-bold uppercase tracking-[0.16em] text-amber-700">
              {meta?.title || meta?.label || 'Process'}
            </p>
            <p className="mt-1 text-[13px] text-text">{route}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Customer</dt>
              <dd className="font-semibold text-text">{customer}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Current Vehicle</dt>
              <dd className="font-mono font-semibold text-text">{vehicle}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Current Driver</dt>
              <dd className="font-semibold text-text">{driver}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Current Status</dt>
              <dd className="font-semibold uppercase text-text">{status}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* ══ THE PROCESS RAIL ═════════════════════════════════════════════
          Every node is a link to ITS OWN workspace. Nothing here points at a
          generic trip page, and a future stage opens its own (not started)
          view rather than bouncing the operator back. */}
      <nav aria-label="Trip process" className="overflow-x-auto">
        <ol className="flex min-w-max items-center gap-1 rounded-xl border border-border bg-white p-3">
          {rail.map((node, i) => {
            const isLast = i === rail.length - 1;
            const Icon = node.state === STAGE_STATE.DONE
              ? Check
              : node.isCurrent
                ? Circle
                : Lock;
            return (
              <li key={node.key} className="flex items-center gap-1">
                <Link
                  to={`/admin/trips/${tripId}/${node.key}`}
                  aria-current={node.isSelected ? 'page' : undefined}
                  title={node.requirement || node.title}
                  className={cx(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition',
                    node.isSelected
                      ? 'bg-amber-600 text-white'
                      : node.state === STAGE_STATE.DONE
                        ? 'text-emerald-700 hover:bg-emerald-50'
                        : 'text-muted hover:bg-slate-50',
                  )}
                >
                  <Icon size={12} aria-hidden="true" />
                  <span>{node.short}</span>
                </Link>
                {!isLast ? <span className="text-muted/50" aria-hidden="true">›</span> : null}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ══ THE WORKSPACE ═════════════════════════════════════════════════ */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">{children}</div>
        <aside className="space-y-4">{aside}</aside>
      </div>

      {workflow?.blockers?.length ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {workflow.blockers.map((b) => b.message || b.code).join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

/* ── Shared atoms used by every workspace ──────────────────────────────── */

export function Panel({ title, subtitle, children, action }) {
  return (
    <section className="rounded-xl border border-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-[14px] font-bold text-text">{title}</h3>
          {subtitle ? <p className="text-[12px] text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function FactGrid({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {items.filter(Boolean).map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{f.label}</dt>
          <dd className="truncate text-[13px] font-semibold text-text">{f.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The banner shown when a process has NOT started.
 * §12: show the process, say it has not begun, and list what it waits on —
 * never redirect the operator somewhere else.
 */
export function NotStarted({ headline, waitingFor, prerequisites = [] }) {
  return (
    <section className="rounded-xl border border-slate-300 bg-slate-50 p-4" aria-live="polite">
      <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-slate-600">{headline}</p>
      <p className="mt-1.5 text-[13px] text-text">
        {waitingFor
          ? `Waiting for ${waitingFor.toLowerCase()} before this step can begin.`
          : 'This step has not been recorded yet.'}
      </p>
      {prerequisites.length ? (
        <ul className="mt-3 space-y-1 text-[12.5px]">
          {prerequisites.map((p) => (
            <li key={p.label} className="flex items-start gap-2">
              <span aria-hidden="true" className={p.done ? 'text-emerald-600' : 'text-slate-400'}>
                {p.done ? '✓' : '✗'}
              </span>
              <span className={p.done ? 'text-text' : 'text-muted'}>{p.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The green "this process is done" record. §13 — inspectable, not just a tick. */
export function CompletedRecord({ children }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Check size={15} className="text-emerald-700" aria-hidden="true" />
        <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-emerald-800">
          Recorded
        </p>
      </div>
      {children}
    </section>
  );
}

export function Action({ onClick, disabled, busy, children, tone = 'primary' }) {
  const tones = {
    primary: 'bg-amber-600 text-white hover:bg-amber-700',
    ghost: 'border border-border bg-white text-text hover:bg-slate-50',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cx(
        'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45',
        tones[tone],
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** A block that cannot run yet, with the server's own reason. §5 / §19. */
export function Blocked({ reason }) {
  if (!reason) return null;
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">
      {reason}
    </p>
  );
}