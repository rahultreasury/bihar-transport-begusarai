import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import VehicleOwnerRegisterModal from '../components/admin-premium/owners/VehicleOwnerRegisterModal';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'vehicle-owners', label: 'Vehicle Owners', icon: '👤' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' },
];

export default function AdminVehicleOwnerEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadOwner = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const response = await adminAPI.getVehicleOwner(id);
      if (response.data?.success && response.data.data) {
        setOwner(response.data.data);
      } else {
        setError(response.data?.message || 'Vehicle owner not found');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load vehicle owner');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadOwner();
  }, [loadOwner]);

  const goBack = useCallback(() => {
    navigate(`/admin/vehicle-owners/${id}`);
  }, [id, navigate]);

  const handleSaveSuccess = useCallback(() => {
    navigate(`/admin/vehicle-owners/${id}`);
  }, [id, navigate]);

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
        </div>
      </AdminShell>
    );
  }

  if (error || !owner) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
        <div className="text-center py-12">
          <p className="text-red-500">{error || 'Vehicle owner not found'}</p>
          <button
            type="button"
            onClick={goBack}
            className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-xl"
          >
            Back to Vehicle Owner
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
      <VehicleOwnerRegisterModal
        isOpen
        onClose={goBack}
        onSuccess={handleSaveSuccess}
        owner={owner}
        fullPage
      />
    </AdminShell>
  );
}
