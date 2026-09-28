/**
 * PremiumTable.jsx
 * ---------------------------------------------------------------------------
 * THE data table for the entire console — used by Bookings, Trips, Drivers,
 * Vehicles, Clients, Financials, Settlements, Vehicle Owners, Partners and
 * every partner page.
 *
 * THE RULES IT ENFORCES
 *   · one white rounded-16 container with a hairline border
 *   · muted uppercase column headings on a soft surface
 *   · generous row height (16px vertical padding) so rows are scannable
 *   · quiet separators, a soft hover, an orange focus ring
 *   · horizontal scroll INSIDE the table, so the page itself never overflows
 *   · a real loading state and a real empty state, never a blank white void
 *
 * PROPS (unchanged — every existing call site keeps working)
 *   columns[], rows, loading, sortField, sortDirection, onSort,
 *   selectedIds, onSelect, onSelectAll, isAllSelected, isIndeterminate,
 *   onKeyDown, focusedIndex, onRowClick
 */

import React, { useMemo, useCallback, useRef } from 'react';
import EmptyState from './EmptyState';

const SORT_ARROW_UP = '↑';
const SORT_ARROW_DOWN = '↓';

function PremiumTable({
  columns = [],
  rows,
  loading = false,
  sortField,
  sortDirection,
  onSort,
  selectedIds,
  onSelect,
  onSelectAll,
  isAllSelected,
  isIndeterminate,
  onKeyDown,
  focusedIndex,
  onRowClick,
}) {
  const resolvedColumns = useMemo(() => columns || [], [columns]);
  const resolvedRows = Array.isArray(rows) ? rows : [];
  const tableRef = useRef(null);

  const hasSelection = !!onSelect;
  const colSpan = resolvedColumns.length + (hasSelection ? 1 : 0);

  const handleHeaderClick = useCallback(
    (col) => {
      if (col.sortable && onSort) onSort(col.key);
    },
    [onSort]
  );

  const getSortIndicator = useCallback(
    (colKey) => {
      if (!sortField || sortField !== colKey) return null;
      return sortDirection === 'asc' ? SORT_ARROW_UP : SORT_ARROW_DOWN;
    },
    [sortField, sortDirection]
  );

  return (
    <div
      ref={tableRef}
      className="bt-table-wrap relative w-full max-w-full"
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="grid"
      aria-label="Data table"
      aria-multiselectable={!!hasSelection}
      aria-busy={loading || undefined}
    >
      <div className="w-full max-w-full overflow-x-auto">
        <table className="bt-table" style={{ tableLayout: 'auto' }}>
          <thead>
            <tr>
              {hasSelection && (
                <th className="w-10 px-4 py-3.5 text-left">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={onSelectAll}
                    className="h-4 w-4 cursor-pointer rounded border-bt-border-strong accent-bt-orange focus:ring-2 focus:ring-amber-500/25"
                    aria-label={isAllSelected ? 'Deselect all rows' : 'Select all rows'}
                  />
                </th>
              )}

              {resolvedColumns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                  onClick={() => handleHeaderClick(col)}
                  aria-sort={
                    sortField === col.key
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  role="columnheader"
                  tabIndex={col.sortable ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (col.sortable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleHeaderClick(col);
                    }
                  }}
                  className={col.sortable ? 'cursor-pointer select-none transition-colors hover:text-bt-navy' : ''}
                >
                  <span className="flex items-center gap-1.5">
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span
                        className={`text-[10px] ${sortField === col.key ? 'text-bt-orange' : 'text-bt-ink-3/60'}`}
                        aria-hidden="true"
                      >
                        {getSortIndicator(col.key) || '↕'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="px-5 py-6">
                  <div className="space-y-3" role="status" aria-label="Loading records">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-11 bt-skeleton rounded-xl" />
                    ))}
                  </div>
                </td>
              </tr>
            ) : resolvedRows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-5 py-8">
                  <EmptyState
                    title="No records"
                    subtitle="Nothing matches your current filters. Try widening the search."
                  />
                </td>
              </tr>
            ) : (
              resolvedRows.map((r, idx) => {
                const rowId = r.id || r.booking_id || idx;
                const isSelected = selectedIds?.has(rowId);
                const isFocused = focusedIndex === idx;
                const isClickable = !!onRowClick;

                return (
                  <tr
                    key={rowId}
                    onClick={() => (onRowClick ? onRowClick(r, idx) : onSelect?.(rowId, idx))}
                    role="row"
                    aria-selected={isSelected}
                    tabIndex={isClickable ? 0 : -1}
                    className={[
                      'transition-colors duration-150',
                      isSelected
                        ? 'bg-amber-500/[0.07]'
                        : isFocused
                          ? 'bg-amber-500/[0.04]'
                          : '',
                      isFocused ? 'shadow-[inset_3px_0_0_var(--bt-orange)]' : '',
                      isClickable ? 'cursor-pointer' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {hasSelection && (
                      <td className="w-10 px-4 py-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onSelect?.(rowId, idx)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 cursor-pointer rounded border-bt-border-strong accent-bt-orange focus:ring-2 focus:ring-amber-500/25"
                          aria-label={`Select row ${idx + 1}`}
                        />
                      </td>
                    )}

                    {resolvedColumns.map((col) => (
                      <td
                        key={col.key}
                        style={col.width ? { maxWidth: col.width } : undefined}
                        role="gridcell"
                      >
                        {col.render ? col.render(r) : r[col.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default React.memo(PremiumTable);
