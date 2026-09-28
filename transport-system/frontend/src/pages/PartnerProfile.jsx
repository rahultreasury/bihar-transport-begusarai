import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  Calendar,
  Edit,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Shield,
  User,
  WalletCards,
} from 'lucide-react';
import { partnerAPI } from '../services/api';
import PartnerShell from '../components/partner/PartnerShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PartnerProfile() {
  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);

  const loadProfile = useCallback(async () => {
    setRetrying(true);
    setError('');
    try {
      const response = await partnerAPI.getMe();
      if (response.data?.success) {
        setPartner(response.data.data);
      } else {
        throw new Error(response.data?.message || 'Profile data unavailable');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load partner profile. Please try again.');
      setPartner(null);
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  return (
    <PartnerShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Profile</p>
            <h2 className="mt-1 text-2xl font-bold text-[#15345B]">Partner Profile</h2>
            <p className="mt-1 text-sm text-[#15345B]/60">View and manage your transport business details.</p>
          </div>
          <button
            type="button"
            onClick={loadProfile}
            disabled={retrying}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#F5A000]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/10 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retrying ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button onClick={loadProfile} className="font-semibold underline hover:decoration-red-500">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            <LoadingSkeleton className="h-48" />
            <LoadingSkeleton className="h-32" />
          </div>
        ) : !partner ? (
          <EmptyState
            title="No profile data"
            subtitle="Unable to load partner profile information."
          />
        ) : (
          <>
            {/* Profile Overview */}
            <SectionCard
              title="Business Information"
              right={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#F5A000]/30 bg-white px-3 py-1.5 text-xs font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/10"
                >
                  <Edit className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit
                </button>
              }
            >
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Partner Name</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.partner_name || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <User className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Owner Name</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.owner_name || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Shield className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Partner Code</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.partner_code || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Mail className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Email</p>
                    <p className="mt-1 font-semibold text-[#15345B] break-all">{partner.email || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Phone className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Mobile</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.mobile || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Phone className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Alternate Mobile</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.alternate_mobile || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">City</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.city || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">State</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{partner.state || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Calendar className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Status</p>
                    <div className="mt-1">
                      <StatusBadge status={partner.status || 'unknown'} size="sm" />
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Address */}
            {partner.address && (
              <SectionCard title="Address">
                <p className="text-sm text-[#15345B]/70">{partner.address}</p>
              </SectionCard>
            )}

            {/* Tax Information */}
            {(partner.gst_number || partner.pan_number) && (
              <SectionCard title="Tax Information">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {partner.gst_number && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">GST Number</p>
                      <p className="mt-1 font-semibold text-[#15345B]">{partner.gst_number}</p>
                    </div>
                  )}
                  {partner.pan_number && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">PAN Number</p>
                      <p className="mt-1 font-semibold text-[#15345B]">{partner.pan_number}</p>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Commission Details */}
            <SectionCard title="Commission Details">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Commission Type</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{partner.commission_type || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Commission Rate</p>
                  <p className="mt-1 font-semibold text-[#15345B]">
                    {partner.commission_percentage ? `${partner.commission_percentage}%` : partner.fixed_commission ? `₹${partner.fixed_commission}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Available Capacity</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{partner.available_capacity || '—'}</p>
                </div>
              </div>
            </SectionCard>

            {/* Account Details */}
            <SectionCard title="Account Details">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Partner Capability</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{partner.partner_capability || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Network Locations</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{partner.network_locations || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Account Created</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{formatDate(partner.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Last Updated</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{formatDate(partner.updated_at)}</p>
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </PartnerShell>
  );
}