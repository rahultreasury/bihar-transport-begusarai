import React from 'react';
import { buildRcDisplayRows } from './rcLookupStatus';

/**
 * "RC DATA FROM VEHICLE REGISTRATION"
 *
 * A compact, read-only summary of exactly what the RC lookup returned.
 * Rendered only after an explicit "Fetch RC" that succeeded with usable data.
 *
 * Rules this component enforces:
 *   - Only fields the API actually populated are rendered. There is no fixed
 *     schema here, so registrationDate / manufacturingYear / chassis / permit /
 *     PUC expiry simply never appear because the backend never sends them.
 *   - Values are shown as the API returned them, even when the form already had
 *     a different manual value, so the admin can compare the two.
 *   - No owner identity, no raw upstream payload, no image, no notices.
 */

const TONE_CLS = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
};

const ROW_BOX =
  'rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-2';

function Row({ row }) {
  return (
    <div className={row.wide ? `${ROW_BOX} sm:col-span-2` : ROW_BOX}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {row.label}
        </span>
        <span
          className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
          title="Retrieved from the RC lookup"
        >
          ✓ RC
        </span>
      </div>
      <div
        className={`mt-1 truncate text-sm font-semibold ${row.mono ? 'font-mono' : ''} ${TONE_CLS[row.tone] || 'text-text'}`}
        title={row.value}
      >
        {row.value}
      </div>
    </div>
  );
}

export default function RcApiDataSection({ data, vehicleNumber }) {
  const rows = buildRcDisplayRows(data, { vehicleNumber });
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/30 dark:bg-emerald-900/10 p-4">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <h4 className="text-sm font-semibold text-text">RC Details</h4>
        <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          Fetched from RC
        </span>
      </header>

      <p className="mb-3 text-xs text-muted">
        Only the fields below were returned by the RC lookup. Empty fields the API does not
        provide are not shown, and nothing here has been invented.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </div>

      {data?.vehicleIdentityVerified === false && (
        <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
          Vehicle identity (name, make, model) could not be verified for this registration and
          was not filled in. Verify those details manually.
        </p>
      )}
    </section>
  );
}
