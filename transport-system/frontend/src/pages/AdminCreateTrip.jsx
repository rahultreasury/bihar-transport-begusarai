import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import TripWizard from '../components/admin-premium/trips/TripWizard';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'trips', label: 'Trips', icon: '🚛' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

function AdminCreateTrip() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const handleComplete = useCallback(() => {
    setSaving(false);
    navigate('/admin/trips');
  }, [navigate]);

  const handleCancel = useCallback(() => {
    navigate('/admin/trips');
  }, [navigate]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="trips" onNav={() => {}}>
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted mb-6">
          <button
            type="button"
            onClick={() => navigate('/admin/trips')}
            className="hover:text-text transition-colors"
          >
            Trips
          </button>
          <span>/</span>
          <span className="text-text font-medium">Create New Trip</span>
        </nav>

        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text">Create New Trip</h1>
            <p className="text-muted mt-1">Add trip details and assign resources</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Main Content Card */}
        <div className="bg-card/40 rounded-2xl border border-border/60 p-6 sm:p-8">
          <TripWizard
            onComplete={handleComplete}
            onCancel={handleCancel}
            editingTrip={null}
          />
        </div>
      </div>
    </AdminShell>
  );
}

export default AdminCreateTrip;
