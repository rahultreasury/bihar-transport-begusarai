/**
 * AdminTripFinance.jsx
 * ============================================================================
 * TRIP FINANCE PAGE — host for the Trip Finance workspace.
 *
 *   /admin/trips/:tripId/finance
 *
 * Finance is a separate workspace/action, NOT an operational lifecycle status.
 * It can be opened regardless of Trip status (DISPATCHED, IN_TRANSIT, etc.).
 */
import React from 'react';
import { useParams } from 'react-router-dom';

import TripFinanceWorkspace from '../components/admin-premium/trips/process/TripFinanceWorkspace';
import AdminShell from '../components/admin-premium/layout/AdminShell';

export default function AdminTripFinance() {
  const { tripId } = useParams();

  return (
    <AdminShell activeKey="trips" onNav={() => {}}>
      <TripFinanceWorkspace tripId={tripId} />
    </AdminShell>
  );
}