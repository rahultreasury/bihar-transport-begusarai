import React from 'react';

// Statuses the backend actually emits for drivers: available, on_trip, inactive
const DRIVER_STATUSES = ['available', 'on_trip', 'inactive'];

const DriverFilters = React.memo(function DriverFilters({
  status, onStatusChange,
  availability, onAvailabilityChange,
  balanceFilter, onBalanceFilterChange,
  tripsFilter, onTripsFilterChange,
  recentlyActive, onRecentlyActiveChange,
  showFilters, onToggleFilters,
  onReset,
  activeFilterCount
}) {
  return (
    <div className="space-y-3 w-full max-w-full">
      {/* Filter Toggle Row */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Status */}
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => onStatusChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by status"
              >
                <option value="">All Statuses</option>
                {DRIVER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'available' ? 'Available' : s === 'on_trip' ? 'On Trip' : 'Inactive'}
                  </option>
                ))}
              </select>
            </div>

            {/* Availability */}
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Availability</label>
              <select
                value={availability}
                onChange={(e) => onAvailabilityChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by availability"
              >
                <option value="">All</option>
                <option value="available">Available</option>
                <option value="busy">Busy / On Trip</option>
              </select>
            </div>

            {/* Balance Pending */}
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Balance</label>
              <select
                value={balanceFilter}
                onChange={(e) => onBalanceFilterChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by balance"
              >
                <option value="">All</option>
                <option value="receive">Company to Receive</option>
                <option value="pay">Company to Pay</option>
                <option value="settled">Settled</option>
              </select>
            </div>

            {/* Trips Completed */}
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Trips Completed</label>
              <select
                value={tripsFilter}
                onChange={(e) => onTripsFilterChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by trips completed"
              >
                <option value="">All</option>
                <option value="high">50+ Trips</option>
                <option value="medium">10-50 Trips</option>
                <option value="low">1-10 Trips</option>
                <option value="none">No Trips</option>
              </select>
            </div>

            {/* Recently Active */}
            <div>
              <label className="block text-[11px] font-medium text-muted mb-1">Recently Active</label>
              <select
                value={recentlyActive}
                onChange={(e) => onRecentlyActiveChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-card/40 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition"
                aria-label="Filter by last active"
              >
                <option value="">All Time</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="older">30+ Days Ago</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default DriverFilters;
