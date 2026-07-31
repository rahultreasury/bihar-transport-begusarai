import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

const NAV_ITEMS = [
  { key: 'owners', label: 'Transport Owners', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'reports', label: 'Reports', icon: '📊' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const TABS = [
  { key: 'overview', label: 'Owner Details', icon: 'ℹ️' },
  { key: 'drivers', label: 'Assigned Drivers', icon: '👤' },
  { key: 'bookings', label: 'Current Bookings', icon: '📦' },
  { key: 'completed', label: 'Completed Trips', icon: '✅' },
  { key: 'trucks', label: 'Vehicles', icon: '🚚' },
  { key: 'documents', label: 'Documents', icon: '📄' },
];

function OwnerStatusBadge({ status }) {
  const colors = {
    active: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
    inactive: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
    suspended: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  };
  return (
    <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${colors[status] || colors.inactive}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'}
    </span>
  );
}

export default function AdminPartnerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [partner, setPartner] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = useCallback((tab) => {
    setSearchParams(tab === 'overview' ? {} : { tab });
  }, [setSearchParams]);

  const fetchPartner = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileRes, dashboardRes] = await Promise.all([
        adminAPI.getPartner(id),
        adminAPI.getPartnerDashboard(id),
      ]);
      if (profileRes.data?.success) setPartner(profileRes.data.data);
      if (dashboardRes.data?.success) setDashboard(dashboardRes.data.data);
    } catch (err) {
      setError(err.message || 'Failed to load partner profile');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchPartner(); }, [id, fetchPartner]);

  const goBack = () => navigate('/admin/owners');

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="owners" onNav={(k) => {}}>
        <div className="space-y-4"><LoadingSkeleton className="h-12 w-48" /><LoadingSkeleton className="h-64 w-full" /></div>
      </AdminShell>
    );
  }

  if (error || !partner) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="owners" onNav={(k) => {}}>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <div className="text-red-500 font-semibold mb-2">Failed to load owner</div>
          <div className="text-sm text-muted mb-4">{error || 'Owner not found'}</div>
          <button onClick={goBack} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold">Back to Owners</button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="owners" onNav={(k) => {}}>
      <div className="space-y-5">
        <button onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Owners
        </button>

        {/* Header */}
        <div className="rounded-3xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-2xl shrink-0">
              {(partner.company_name || partner.partner_name)?.charAt(0) || 'O'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold">{partner.company_name || partner.partner_name}</h1>
                <OwnerStatusBadge status={partner.status} />
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted flex-wrap">
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{partner.partner_code}</span>
                <span>📞 {partner.mobile}</span>
                {partner.email && <span>✉️ {partner.email}</span>}
                {partner.city && <span>📍 {partner.city}, {partner.state}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard Summary Cards */}
        {dashboard && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <SummaryCard label="Total Bookings" value={dashboard.totalBookings} color="amber" />
            <SummaryCard label="Active" value={dashboard.activeBookings} color="blue" />
            <SummaryCard label="Completed" value={dashboard.completedBookings} color="green" />
            <SummaryCard label="Commission Earned" value={`₹${(dashboard.commissionEarned || 0).toLocaleString('en-IN')}`} color="purple" />
            <SummaryCard label="Outstanding" value={`₹${(dashboard.outstandingBalance || 0).toLocaleString('en-IN')}`} color="red" />
            <SummaryCard label="Vehicles" value={partner._count?.trucks || 0} color="amber" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key ? 'bg-amber-500 text-white shadow-sm' : 'text-muted hover:text-text hover:bg-hover/60 border border-transparent'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'overview' && <OverviewTab partner={partner} dashboard={dashboard} />}
          {activeTab === 'drivers' && <DriversTab partnerId={partner.partner_id} />}
          {activeTab === 'bookings' && <OwnerBookingsTab partnerId={partner.partner_id} status="active" />}
          {activeTab === 'completed' && <OwnerBookingsTab partnerId={partner.partner_id} status="completed" />}
          {activeTab === 'trucks' && <TrucksTab partnerId={partner.partner_id} />}
          {activeTab === 'documents' && <DocumentsTab partnerId={partner.partner_id} />}
        </div>
      </div>
    </AdminShell>
  );
}

function SummaryCard({ label, value, color }) {
  const colors = { amber: 'text-amber-500', blue: 'text-blue-500', green: 'text-green-500', purple: 'text-purple-500', red: 'text-red-500' };
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-lg font-bold ${colors[color] || 'text-text'}`}>{value ?? '—'}</div>
    </div>
  );
}

function OverviewTab({ partner, dashboard }) {
  const infoRows = [
    { label: 'Partner Code', value: partner.partner_code, mono: true },
    { label: 'Partner Name', value: partner.partner_name },
    { label: 'Owner Name', value: partner.owner_name || '—' },
    { label: 'Company Name', value: partner.company_name || '—' },
    { label: 'Mobile', value: partner.mobile },
    { label: 'Alternate Mobile', value: partner.alternate_mobile || '—' },
    { label: 'City', value: partner.city || '—' },
    { label: 'State', value: partner.state || 'Bihar' },
    { label: 'GST Number', value: partner.gst_number || '—' },
    { label: 'PAN', value: partner.pan_number || '—' },
    { label: 'Bank Account', value: partner.bank_account || '—' },
    { label: 'IFSC', value: partner.bank_ifsc || '—' },
    { label: 'Bank Name', value: partner.bank_name || '—' },
    { label: 'UPI ID', value: partner.upi_id || '—' },
    { label: 'Address', value: partner.address || '—' },
    { label: 'Commission Type', value: partner.commission_type === 'percentage' ? `${partner.commission_percentage}%` : partner.commission_type === 'fixed' ? `₹${partner.fixed_commission}` : '—' },
    { label: 'Registered On', value: partner.created_at ? new Date(partner.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' },
    { label: 'Notes', value: partner.notes || '—' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <SectionCard title="Partner Information">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {infoRows.map(row => (
              <div key={row.label} className="flex flex-col">
                <span className="text-[11px] font-medium text-muted uppercase tracking-wider">{row.label}</span>
                <span className={`text-sm mt-0.5 ${row.mono ? 'font-mono font-semibold text-amber-600 dark:text-amber-400' : 'font-medium'}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="space-y-4">
        <SectionCard title="Commission Info">
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted">Commission Type</div>
              <div className="text-sm font-semibold">{partner.commission_type === 'percentage' ? 'Percentage' : partner.commission_type === 'fixed' ? 'Fixed Amount' : '—'}</div>
            </div>
            {partner.commission_type === 'percentage' && (
              <div>
                <div className="text-xs text-muted">Commission Rate</div>
                <div className="text-sm font-semibold text-amber-500">{partner.commission_percentage}%</div>
              </div>
            )}
            {partner.commission_type === 'fixed' && (
              <div>
                <div className="text-xs text-muted">Fixed Commission</div>
                <div className="text-sm font-semibold text-amber-500">₹{partner.fixed_commission}</div>
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function TrucksTab({ partnerId }) {
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrucks = async () => {
      try {
        const res = await adminAPI.getPartnerTrucks(partnerId);
        if (res.data?.success) setTrucks(res.data.data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchTrucks();
  }, [partnerId]);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title="Partner Trucks">
      {trucks.length === 0 ? (
        <EmptyState title="No trucks assigned" subtitle="Add trucks to this partner." />
      ) : (
        <PremiumTable
          columns={[
            { key: 'vehicle_number', header: 'Truck Number', render: (r) => <span className="font-mono font-semibold">{r.vehicle_number}</span> },
            { key: 'vehicle_type', header: 'Type', render: (r) => <span className="text-sm">{r.vehicle_type || '—'}</span> },
            { key: 'vehicle_name', header: 'Name', render: (r) => <span className="text-sm">{r.vehicle_name || '—'}</span> },
            { key: 'capacity_kg', header: 'Capacity', render: (r) => <span className="text-sm">{r.capacity_kg ? `${r.capacity_kg} kg` : '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => <span className="text-sm">{r.current_status || 'available'}</span> },
          ]}
          rows={trucks.map(t => ({ ...t, id: t.vehicle_id }))}
          loading={false}
        />
      )}
    </SectionCard>
  );
}

function DriversTab({ partnerId }) {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDrivers = async () => {
      try {
        const res = await adminAPI.getPartnerDrivers(partnerId);
        if (res.data?.success) setDrivers(res.data.data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchDrivers();
  }, [partnerId]);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title="Assigned Drivers">
      {drivers.length === 0 ? (
        <EmptyState title="No drivers assigned" subtitle="Assign drivers to this partner from the Drivers page." />
      ) : (
        <PremiumTable
          columns={[
            { key: 'driver_code', header: 'Code', render: (r) => <span className="font-mono font-semibold">{r.driver_code}</span> },
            { key: 'driver_name', header: 'Name', render: (r) => <span className="font-medium">{r.driver_name}</span> },
            { key: 'mobile', header: 'Mobile', render: (r) => <span className="text-sm">{r.mobile}</span> },
            { key: 'status', header: 'Status', render: (r) => <span className="text-sm">{r.status || 'available'}</span> },
            { key: 'trips', header: 'Trips', render: (r) => <span className="font-semibold">{r.total_deliveries || 0}</span> },
          ]}
          rows={drivers.map(d => ({ ...d, id: d.driver_id }))}
          loading={false}
        />
      )}
    </SectionCard>
  );
}

function LedgerTab({ partnerId }) {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchLedger = async () => {
      setLoading(true);
      try {
        const res = await adminAPI.getPartnerLedger(partnerId, { page, limit: 50 });
        if (res.data?.success) {
          setEntries(res.data.data || []);
          setSummary(res.data.summary);
          if (res.data.pagination) setPagination(res.data.pagination);
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetchLedger();
  }, [partnerId, page]);

  const columns = useMemo(() => [
    { key: 'transaction_id', header: 'TX ID', render: (r) => <span className="font-mono text-xs">{r.transaction_id}</span> },
    { key: 'date', header: 'Date', render: (r) => <span className="text-sm text-muted">{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}</span> },
    { key: 'transaction_type', header: 'Type', render: (r) => <span className="text-xs font-medium px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">{r.transaction_type?.replace(/_/g, ' ')}</span> },
    { key: 'description', header: 'Description', render: (r) => <span className="text-sm">{r.description || '—'}</span> },
    { key: 'debit', header: 'Debit', render: (r) => <span className="text-sm font-medium text-red-500">{r.debit ? `₹${r.debit.toLocaleString('en-IN')}` : '—'}</span> },
    { key: 'credit', header: 'Credit', render: (r) => <span className="text-sm font-medium text-green-500">{r.credit ? `₹${r.credit.toLocaleString('en-IN')}` : '—'}</span> },
    { key: 'running_balance', header: 'Balance', render: (r) => <span className="text-sm font-semibold">₹{(r.running_balance || 0).toLocaleString('en-IN')}</span> },
    { key: 'payment_mode', header: 'Mode', render: (r) => <span className="text-xs">{r.payment_mode || '—'}</span> },
  ], []);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title="Partner Ledger">
      {summary && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded-xl border border-border/60 bg-card/40">
            <div className="text-xs text-muted">Total Debit</div>
            <div className="text-lg font-bold text-red-500">₹{(summary.totalDebit || 0).toLocaleString('en-IN')}</div>
          </div>
          <div className="p-3 rounded-xl border border-border/60 bg-card/40">
            <div className="text-xs text-muted">Total Credit</div>
            <div className="text-lg font-bold text-green-500">₹{(summary.totalCredit || 0).toLocaleString('en-IN')}</div>
          </div>
          <div className="p-3 rounded-xl border border-border/60 bg-card/40">
            <div className="text-xs text-muted">Balance</div>
            <div className="text-lg font-bold">₹{(summary.balance || 0).toLocaleString('en-IN')}</div>
          </div>
        </div>
      )}
      {entries.length === 0 ? (
        <EmptyState title="No ledger entries" subtitle="Transactions will appear here." />
      ) : (
        <PremiumTable columns={columns} rows={entries.map(e => ({ ...e, id: e.ledger_id }))} loading={false} />
      )}
      {pagination.pages > 1 && (
        <div className="flex justify-center mt-4 gap-2">
          {Array.from({ length: Math.min(pagination.pages, 5) }, (_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`w-8 h-8 rounded-lg text-xs font-medium transition ${page === i + 1 ? 'bg-amber-500 text-white' : 'border border-border/60 hover:bg-hover/60'}`}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PaymentsTab({ partnerId }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await adminAPI.getPartnerPayments(partnerId, {});
        if (res.data?.success) setPayments(res.data.data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetch();
  }, [partnerId]);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title="Payment History">
      {payments.length === 0 ? (
        <EmptyState title="No payments recorded" subtitle="Payments will appear here once recorded." />
      ) : (
        <PremiumTable
          columns={[
            { key: 'payment_number', header: 'Payment #', render: (r) => <span className="font-mono font-semibold">{r.payment_number}</span> },
            { key: 'amount', header: 'Amount', render: (r) => <span className="font-semibold">₹{r.amount?.toLocaleString('en-IN')}</span> },
            { key: 'payment_method', header: 'Method', render: (r) => <span className="text-sm">{r.payment_method?.replace(/_/g, ' ')}</span> },
            { key: 'reference_number', header: 'Reference', render: (r) => <span className="text-sm">{r.reference_number || '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => <span className="text-sm">{r.status}</span> },
            { key: 'date', header: 'Date', render: (r) => <span className="text-sm text-muted">{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}</span> },
          ]}
          rows={payments.map(p => ({ ...p, id: p.payment_id }))}
          loading={false}
        />
      )}
    </SectionCard>
  );
}

function SettlementsTab({ partnerId }) {
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await adminAPI.getPartnerSettlements(partnerId, {});
        if (res.data?.success) setSettlements(res.data.data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetch();
  }, [partnerId]);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title="Monthly Settlements">
      {settlements.length === 0 ? (
        <EmptyState title="No settlements" subtitle="Generate monthly settlements for this partner." />
      ) : (
        <PremiumTable
          columns={[
            { key: 'settlement_number', header: 'Settlement #', render: (r) => <span className="font-mono font-semibold">{r.settlement_number}</span> },
            { key: 'period', header: 'Period', render: (r) => <span className="text-sm">{r.month}/{r.year}</span> },
            { key: 'bookings', header: 'Bookings', render: (r) => <span className="font-semibold">{r.total_bookings}</span> },
            { key: 'gross_revenue', header: 'Gross Revenue', render: (r) => <span>₹{(r.gross_revenue || 0).toLocaleString('en-IN')}</span> },
            { key: 'commission', header: 'Commission', render: (r) => <span className="text-purple-500">₹{(r.commission || 0).toLocaleString('en-IN')}</span> },
            { key: 'net_payable', header: 'Net Payable', render: (r) => <span className="font-bold text-green-500">₹{(r.net_payable || 0).toLocaleString('en-IN')}</span> },
            { key: 'status', header: 'Status', render: (r) => (
              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                r.status === 'paid' ? 'bg-green-100 text-green-700' :
                r.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                r.status === 'locked' ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>{r.status}</span>
            )},
          ]}
          rows={settlements.map(s => ({ ...s, id: s.settlement_id }))}
          loading={false}
        />
      )}
    </SectionCard>
  );
}

function OwnerBookingsTab({ partnerId, status }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const { adminAPI } = await import('../services/api');
        const res = await adminAPI.getOwnerBookings(partnerId, { status });
        if (res.data?.success) setBookings(res.data.data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    if (partnerId) fetch();
  }, [partnerId, status]);

  const isActive = status !== 'completed';

  const columns = useMemo(() => [
    { key: 'booking_reference', header: 'Booking #', render: (r) => <span className="font-mono font-semibold text-amber-600">{r.booking_reference}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <span className="text-sm">{r.first_name ? `${r.first_name} ${r.last_name || ''}` : '—'}</span> },
    { key: 'route', header: 'Route', render: (r) => <span className="text-sm">{r.pickup_city} → {r.drop_city}</span> },
    { key: 'goods', header: 'Goods', render: (r) => <span className="text-sm text-muted">{r.goods_description || r.goods_type || '—'}</span> },
    { key: 'price', header: 'Price', render: (r) => <span className="font-semibold">₹{(r.final_price || 0).toLocaleString('en-IN')}</span> },
    { key: 'status', header: 'Status', render: (r) => (
      <span className={`text-xs font-medium px-2 py-1 rounded ${
        r.status === 'delivered' || r.status === 'completed' ? 'bg-green-100 text-green-700' :
        r.status === 'in_transit' ? 'bg-blue-100 text-blue-700' :
        r.status === 'cancelled' ? 'bg-red-100 text-red-700' :
        'bg-amber-100 text-amber-700'
      }`}>{r.status?.replace(/_/g, ' ')}</span>
    )},
    { key: 'date', header: 'Date', render: (r) => <span className="text-sm text-muted">{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}</span> },
    { key: 'commission', header: 'Commission', render: (r) => <span className="text-sm text-purple-500 font-medium">₹{(r.commission_amount || 0).toLocaleString('en-IN')}</span> },
  ], []);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title={isActive ? 'Current Bookings' : 'Completed Trips'}>
      {bookings.length === 0 ? (
        <EmptyState title={isActive ? 'No active bookings' : 'No completed trips'} subtitle={isActive ? 'This owner has no active bookings.' : 'Completed trips will appear here.'} />
      ) : (
        <PremiumTable columns={columns} rows={bookings.map(b => ({ ...b, id: b.booking_id }))} loading={false} />
      )}
    </SectionCard>
  );
}

function DocumentsTab({ partnerId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await adminAPI.getPartnerDocuments(partnerId);
        if (res.data?.success) setDocs(res.data.data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    fetch();
  }, [partnerId]);

  if (loading) return <LoadingSkeleton className="h-48 w-full" />;

  return (
    <SectionCard title="Documents">
      {docs.length === 0 ? (
        <EmptyState title="No documents uploaded" subtitle="Upload GST, PAN, Aadhaar, RC, Insurance, Bank details, etc." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map(doc => (
            <div key={doc.document_id} className="rounded-xl border border-border/60 bg-card/40 p-4">
              <div className="text-xs font-semibold text-muted uppercase">{doc.document_type}</div>
              <div className="text-sm font-medium mt-1">{doc.document_name}</div>
              <div className="text-xs text-muted mt-1">{doc.expiry_date ? `Expires: ${new Date(doc.expiry_date).toLocaleDateString('en-IN')}` : 'No expiry'}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${doc.is_verified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {doc.is_verified ? 'Verified' : 'Pending'}
                </span>
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-500 hover:underline">View</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
