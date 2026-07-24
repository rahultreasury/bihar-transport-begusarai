import React, { useMemo, useCallback, useRef } from 'react';
import EmptyState from './EmptyState';

const SORT_ARROW_UP = '↑';
const SORT_ARROW_DOWN = '↓';

/**
 * PremiumTable — Enterprise data table with sorting, row selection, keyboard nav.
 *
 * @param {Object[]} columns - Column definitions
 * @param {string} columns[].key - Field key
 * @param {string} columns[].header - Display header
 * @param {boolean} [columns[].sortable] - Whether column is sortable
 * @param {number} [columns[].width] - Fixed width in px
 * @param {Function} [columns[].render] - Custom render function (row) => JSX
 * @param {Object[]} rows - Data rows
 * @param {boolean} loading - Loading state
 * @param {string} sortField - Currently sorted field
 * @param {string} sortDirection - 'asc' or 'desc'
 * @param {Function} onSort - (field) => void
 * @param {Set} selectedIds - Set of selected row IDs
 * @param {Function} onSelect - (id, index) => void
 * @param {Function} onSelectAll - () => void
 * @param {boolean} isAllSelected - Whether all rows are selected
 * @param {boolean} isIndeterminate - Whether selection is partial
 * @param {Function} onKeyDown - Keyboard handler
 * @param {number} focusedIndex - Currently focused row index
 */
function PremiumTable({
  columns = [],
  rows = [],
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
  focusedIndex
}) {
  const resolvedColumns = useMemo(() => columns || [], [columns]);
  const tableRef = useRef(null);

  const hasSelection = !!onSelect;

  const handleHeaderClick = useCallback((col) => {
    if (col.sortable && onSort) {
      onSort(col.key);
    }
  }, [onSort]);

  const getSortIndicator = useCallback((colKey) => {
    if (!sortField || sortField !== colKey) return null;
    return sortDirection === 'asc' ? SORT_ARROW_UP : SORT_ARROW_DOWN;
  }, [sortField, sortDirection]);

  return (
    <div
      ref={tableRef}
      className="rounded-2xl border border-border/60 overflow-hidden w-full max-w-full"
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="grid"
      aria-label="Data table"
      aria-multiselectable={!!hasSelection}
    >
      <div className="overflow-x-auto w-full max-w-full">
        <table className="w-full text-sm min-w-0" style={{ tableLayout: 'auto' }}>
          {/* Sticky Header */}
          <thead className="bg-tableHead sticky top-0 z-10">
            <tr>
              {hasSelection && (
                <th className="w-10 px-2 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
                    onChange={onSelectAll}
                    className="w-4 h-4 rounded border-border/60 text-amber-500 focus:ring-amber-500/30"
                    aria-label={isAllSelected ? 'Deselect all rows' : 'Select all rows'}
                  />
                </th>
              )}
              {resolvedColumns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left px-4 py-3 font-semibold text-muted text-[11px] uppercase tracking-wider ${
                    col.sortable ? 'cursor-pointer hover:text-text select-none transition' : ''
                  }`}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                  onClick={() => handleHeaderClick(col)}
                  aria-sort={
                    sortField === col.key
                      ? (sortDirection === 'asc' ? 'ascending' : 'descending')
                      : undefined
                  }
                  role="columnheader"
                  tabIndex={col.sortable ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleHeaderClick(col);
                    }
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.header}</span>
                    {col.sortable && (
                      <span className={`text-[10px] ${sortField === col.key ? 'text-amber-500' : 'text-muted/50'}`}>
                        {getSortIndicator(col.key) || '↕'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={resolvedColumns.length + (hasSelection ? 1 : 0)} className="px-4 py-8">
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-10 rounded-xl bg-skeleton animate-pulse" />
                    ))}
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={resolvedColumns.length + (hasSelection ? 1 : 0)} className="px-4 py-8">
                  <EmptyState title="No data" subtitle="No records match your current criteria." />
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const rowId = r.id || r.booking_id || idx;
                const isSelected = selectedIds?.has(rowId);
                const isFocused = focusedIndex === idx;

                return (
                  <tr
                    key={rowId}
                    className={`border-b border-border/40 transition-all duration-150 ${
                      isSelected
                        ? 'bg-amber-500/5 hover:bg-amber-500/10'
                        : 'hover:bg-hover/40'
                    } ${isFocused ? 'ring-2 ring-inset ring-amber-500/30' : ''}`}
                    onClick={() => onSelect?.(rowId, idx)}
                    role="row"
                    aria-selected={isSelected}
                    tabIndex={-1}
                  >
                    {hasSelection && (
                      <td className="w-10 px-2 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onSelect?.(rowId, idx)}
                          className="w-4 h-4 rounded border-border/60 text-amber-500 focus:ring-amber-500/30"
                          aria-label={`Select row ${idx + 1}`}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                    )}
                    {resolvedColumns.map((col) => (
                      <td
                        key={col.key}
                        className="px-4 py-3 text-text"
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

