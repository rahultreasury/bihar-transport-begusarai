/**
 * AdminCreateOrder.jsx
 * ---------------------------------------------------------------------------
 * Route: /admin/orders/create
 *
 * The admin manual-booking page. It renders EXACTLY the same booking form
 * component that customers use at /book-transport (BookTransport, with
 * `mode="admin"`), so there is ONE form implementation, not two.
 *
 * The only admin-specific differences are:
 *   • a small "Admin Manual Booking" indicator badge
 *   • the booking source is sent as MANUAL
 *   • an optional intake channel (PHONE | WHATSAPP | WALK_IN | REFERRAL) that
 *     is recorded internally as audit metadata and never shown to the customer
 *   • the authenticated admin is recorded as the ENQUIRY_CREATED actor by the
 *     backend (existing audit/creator attribution architecture)
 *
 * Submission enters the SAME lifecycle as an online customer submission:
 * POST /api/enquiries → enquiry at ENQUIRY_SUBMITTED → quote → customer/admin
 * acceptance → Booking → Trip. No separate manual_orders table, no parallel
 * Vehicle Hire workflow, no separate finance system.
 */

import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';
import { enquiryAPI } from '../services/enquiryAPI';
import BookTransport from './BookTransport';

const ADMIN_ROLES = ['admin', 'super_admin', 'operator'];
const INTAKE_CHANNELS = ['PHONE', 'WHATSAPP', 'WALK_IN', 'REFERRAL'];

export default function AdminCreateOrder() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [intakeChannel, setIntakeChannel] = useState('PHONE');

  const admin = user
    ? {
        adminId: user.user_id,
        adminName: user.first_name || 'Administrator',
        role: user.role,
      }
    : null;

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    if (!ADMIN_ROLES.includes(user.role)) {
      navigate('/admin/orders', { replace: true });
    }
  }, [user, navigate]);

  const handleAdminSubmit = async (enquiryPayload) => {
    // Reuse the public enquiry intake contract. source=MANUAL and the intake
    // channel are recorded on the ENQUIRY_CREATED audit event by the backend;
    // they are not customer-facing form fields.
    const response = await enquiryAPI.create({
      ...enquiryPayload,
      source: 'MANUAL',
      intake_channel: intakeChannel,
    });
    return response;
  };

  const handleAdminSubmitSuccess = (data) => {
    // BookTransport renders the success confirmation and auto-navigates to the
    // enquiry workspace (/admin/enquiries/:enquiryId) where the same quote →
    // confirm lifecycle continues. No further client navigation is needed here.
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 mb-2">
          <svg className="shrink-0 w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Create Order</h1>
            <p className="text-sm text-slate-500">
              Create a transport booking on behalf of a customer using the same
              booking form as the public website.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Intake channel</label>
          <select
            value={intakeChannel}
            onChange={(e) => setIntakeChannel(e.target.value)}
            className="input-field w-44"
          >
            {INTAKE_CHANNELS.map((ch) => (
              <option key={ch} value={ch}>
                {ch.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400">
            Recorded internally as intake metadata — not shown to the customer.
          </p>
        </div>

        <BookTransport
          mode="admin"
          admin={admin}
          showAdminIndicator
          submitLabel="Submit Booking Request"
          source="manual"
          intakeChannel={intakeChannel}
          onSubmit={handleAdminSubmit}
          onSubmitSuccess={handleAdminSubmitSuccess}
        />
      </div>
    </div>
  );
}
