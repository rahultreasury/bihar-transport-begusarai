import React, { useState, useEffect, useCallback, useRef } from 'react';
import { adminAPI } from '../../../services/api';

function TripFilters({ onFilterChange }) {
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const searchTimeoutRef = useRef(null);

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'ASSIGNED', label: 'Assigned' },
    { value: 'IN_TRANSIT', label: 'In Transit' },
    { value: 'DELIVERED', label: 'Delivered' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'CANCELLED', label: 'Cancelled' },
  ];

  // Fetch clients for dropdown
  useEffect(() => {
    const fetchClients = async () => {
      setLoadingClients(true);
      try {
        const response = await adminAPI.getTripClients('');
        if (response.data?.success) {
          setClients(response.data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch clients:', err);
      } finally {
        setLoadingClients(false);
      }
    };

    fetchClients();
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      onFilterChange?.();
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search, onFilterChange]);

  const handleSearchChange = (e) => {
    setSearch(e.target.value);
  };

  const handleStatusChange = (e) => {
    setStatusFilter(e.target.value);
    onFilterChange?.();
  };

  const handleClientChange = (e) => {
    setClientFilter(e.target.value);
    onFilterChange?.();
  };

  const handleDateFromChange = (e) => {
    setDateFrom(e.target.value);
    onFilterChange?.();
  };

  const handleDateToChange = (e) => {
    setDateTo(e.target.value);
    onFilterChange?.();
  };

  const handleClearFilters = () => {
    setSearch('');
    setClientFilter('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    onFilterChange?.();
  };

  const hasActiveFilters = search || clientFilter || statusFilter || dateFrom || dateTo;

  return (
    <div className="bg-card/40 rounded-2xl border border-border/60 p-4 mb-4">
      <div className="flex items-center gap-3">
        {/* Search Input */}
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search trips by number, client, route..."
            value={search}
            onChange={handleSearchChange}
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
          />
        </div>

        {/* Filter Toggle Button */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center gap-2 px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium transition-colors ${
            showFilters || hasActiveFilters
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'hover:bg-hover/60'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          Filters
          {hasActiveFilters && (
            <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
          )}
        </button>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="text-sm text-muted hover:text-text transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Expanded Filters */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border/60">
          {/* Client Filter */}
          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Client</label>
            <select
              value={clientFilter}
              onChange={handleClientChange}
              className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
            >
              <option value="">All Clients</option>
              {clients.map((client) => (
                <option key={client.user_id} value={client.user_id}>
                  {client.first_name} {client.last_name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Status</label>
            <select
              value={statusFilter}
              onChange={handleStatusChange}
              className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={handleDateFromChange}
              className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-sm font-medium text-muted mb-1.5">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={handleDateToChange}
              className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default TripFilters;
