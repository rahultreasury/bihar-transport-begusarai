/**
 * AdminTripWorkspace.jsx
 * ---------------------------------------------------------------------------
 * /admin/trips/:tripId — the CENTRAL Trip Detail Workspace.
 *
 * This page is now a thin wrapper around TripDetailWorkspace, the single
 * complete operational workspace for one trip (Overview · Vehicle ·
 * Loading · Documents · Billing · Payments · POD · History). It is reached
 * from Vehicle Hire (View), the Trips list and Bookings, and it is the
 * ONLY trip detail surface — there is no second, disconnected trip
 * detail page. The route and lazy-loading contract are unchanged.
 */
import React from 'react';
import TripDetailWorkspace from '../components/admin-premium/trips/process/TripDetailWorkspace';

export default function AdminTripWorkspace() {
  return <TripDetailWorkspace />;
}
