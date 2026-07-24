import React from 'react';
import { getAllDriverStatuses } from './DriverStatusBadge';

const DriverFilters = React.memo(function DriverFilters({
  search, onSearchChange,
  status, onStatusChange,
  showFilters, onToggleFilters,
  onReset,
  activeFilterCount
}) {
  return (
    <div className="space-y-3 w-full max-w-full">
      {/* Search + Filter Toggle Row */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-full lg:max-w-md">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, driver code, mobile, licence..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all"
            aria-label="Search drivers"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute inset-y-0 right-3 flex items-center text-muted hover:text-text transition"
              aria-label="Clear search"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={onToggleFilters}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl text-sm font-medium hover:bg-hover/60 transition-all"
          aria-label="Toggle filters"
          aria-expanded={showFilters}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button
            onClick={onReset}
            className="px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 transition-all"
            aria-label="Reset all filters"
          >
            Reset
          </button>
        )}
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider">Filter Drivers</div>
            <button
              onClick={onReset}
              className="text-xs font-medium text-red-500 hover:text-red-400 transition"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by status"
              >
                <option value="">All Statuses</option>
                {getAllDriverStatuses().map((s) => (
                  <option key={s} value={s}>
                    {s === 'available' ? 'Available' : s === 'on_trip' ? 'On Trip' : 'Inactive'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default DriverFilters;

