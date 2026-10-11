/**
 * AdminVehicleHire.jsx
 * ---------------------------------------------------------------------------
 * THE VEHICLE HIRE PAGE — a host for the workspace, not a second copy of it.
 *
 *   /admin/trips/:tripId/vehicle-hire
 *
 * WHY THIS FILE IS NOW JUST A FRAME
 *   The hire workspace itself lives in
 *   `components/admin-premium/trips/process/VehicleHireWorkspace.jsx`, because it
 *   has TWO hosts:
 *
 *     • here — the standalone route, which draws its own console shell;
 *     • `VehicleWorkspace.jsx` — the `vehicle` stage of the Trip process, i.e.
 *       /admin/trips/:tripId/vehicle, inside `TripProcessShell`.
 *
 *   That second host is the point. The trip's canonical Vehicle page used to
 *   render only a read-only summary with a link elsewhere, so opening the Vehicle
 *   stage of a trip showed a shell with the operational work missing. Both hosts
 *   now render the SAME workspace against the SAME endpoints, which is the only
 *   way they can be guaranteed to agree about a hire.
 *
 *   Splitting the form here would mean two implementations of the same money
 *   arithmetic drifting apart.
 *
 * NOTHING IS DUPLICATED
 *   Vehicle selection, driver selection, document status, billing model, rate
 *   basis, commission, gross / net payable, the hire action and the challan are
 *   all in the workspace. This page only supplies the frame and reads the route.
 *
 * LOCAL ONLY — no behaviour was changed by the move.
 */

import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import VehicleHireWorkspace from '../components/admin-premium/trips/process/VehicleHireWorkspace';

export default function AdminVehicleHire() {
  const { tripId } = useParams();
  const [searchParams] = useSearchParams();

  /**
   * EDIT MODE
   *   `?edit=1` opens the SAME form pre-filled with the existing hire, and saving
   *   UPDATEs that hire instead of creating a second one. The only difference is
   *   the HTTP verb the workspace chooses, which is what makes a duplicate
   *   `vehicle_hires` row impossible.
   */
  const editMode = ['1', 'true', 'yes'].includes(
    String(searchParams.get('edit') || '').toLowerCase()
  );

  return (
    <AdminShell activeKey="trips" onNav={() => {}}>
      <VehicleHireWorkspace tripId={tripId} editMode={editMode} />
    </AdminShell>
  );
}
