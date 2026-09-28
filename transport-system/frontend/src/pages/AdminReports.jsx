import React, { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import { SkeletonKpis } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import {
  PageHeader,
  Button,
  ErrorState,
  IconTile,
} from '../components/admin-premium/ui/AdminUI';
import { FileText, Download, Calendar, TrendingUp, Users, Truck, DollarSign, MapPin } from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'reports', label: 'Reports', icon: '▤' },
  { key: 'ai', label: 'AI Insights', icon: '✦' },
];

const PERIOD_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

/**
 * Icon tile tone per report card.
 *
 * The tiles are all the same size and shape; only the icon's semantic tint
 * varies. That keeps the grid calm and readable while still letting an
 * operator tell revenue from fleet at a glance.
 */
const CARD_TONE = {
  'Revenue Report': 'success',
  'Booking Report': 'orange',
  'Driver Report': 'info',
  'Vehicle Report': 'navy',
  'Top Routes': 'orange',
  'Customer Report': 'navy',
};

function AdminReports() {
  const [activeKey, setActiveKey] = useState('reports');
  const [period, setPeriod] = useState('monthly');

  // Fetch dashboard data for reports
  const { data: reportsData, isLoading, error } = useQuery({
    queryKey: ['admin-reports'],
    queryFn: () => adminAPI.getDashboard().then(r => r.data?.data),
    staleTime: 60 * 1000,
    retry: 2,
  });

  const stats = useMemo(() => reportsData?.stats || {}, [reportsData]);

  const reportCards = useMemo(() => [
    {
      title: 'Revenue Report',
      icon: DollarSign,
      description: `Total revenue: ₹${(stats.todayRevenue || 0).toLocaleString('en-IN')}`,
    },
    {
      title: 'Booking Report',
      icon: FileText,
      description: `${stats.todayBookings || 0} bookings today, ${stats.totalBookings || 0} total`,
    },
    {
      title: 'Driver Report',
      icon: Users,
      description: `${stats.activeTrips || 0} active drivers, ${stats.completedDeliveries || 0} completed trips`,
    },
    {
      title: 'Vehicle Report',
      icon: Truck,
      description: 'Vehicle utilization and fleet performance',
    },
    {
      title: 'Top Routes',
      icon: MapPin,
      description: 'Most popular transport routes this period',
    },
    {
      title: 'Customer Report',
      icon: Users,
      description: `${stats.totalUsers || 0} registered customers`,
    },
  ], [stats]);

  const handleExport = useCallback((format) => {
    // Build CSV content
    const headers = ['Metric', 'Value', 'Period'];
    const rows = [
      ['Revenue', stats.todayRevenue || 0, period],
      ['Bookings', stats.todayBookings || 0, period],
      ['Active Trips', stats.activeTrips || 0, period],
      ['Completed Trips', stats.completedDeliveries || 0, period],
      ['Pending Bookings', stats.pendingBookings || 0, period],
      ['Cancelled Trips', stats.cancelledTrips || 0, period],
      ['Total Bookings', stats.totalBookings || 0, period],
      ['Total Users', stats.totalUsers || 0, period],
    ];

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `report_${period}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [stats, period]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey={activeKey} onNav={(k) => setActiveKey(k)}>
      <div className="space-y-5 lg:space-y-6" id="admin-main-content">
        {/* HEADER — shared hierarchy, with the period control and export
            promoted into the actions slot. */}
        <PageHeader
          eyebrow="Insights"
          title="Reports"
          description="Export and analyse business performance for any period."
          actions={
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Period selector — the active segment is the brand accent. */}
              <div
                className="flex items-center rounded-[12px] border border-bt-border bg-white p-1"
                role="group"
                aria-label="Reporting period"
              >
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPeriod(opt.value)}
                    aria-pressed={period === opt.value}
                    className={`rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-150 ${
                      period === opt.value
                        ? 'bg-bt-orange text-bt-navy-dark shadow-[0_1px_2px_rgba(217,137,0,0.28)]'
                        : 'text-bt-ink-2 hover:bg-bt-orange-light hover:text-bt-navy'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <Button variant="primary" icon={Download} onClick={() => handleExport('csv')}>
                Export CSV
              </Button>
            </div>
          }
        />

        {/* Loading */}
        {isLoading && <SkeletonKpis count={6} />}

        {/* Error */}
        {error && !isLoading && (
          <ErrorState
            title="Failed to load report data"
            message={error.message}
            onRetry={() => window.location.reload()}
          />
        )}

        {/* Report Cards — a single card treatment with a semantic icon tile.
            The per-card gradients are gone: six different colour washes is
            exactly the colourful-template look the console should not have. */}
        {!isLoading && !error && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reportCards.map((card) => (
              <div key={card.title} className="bt-card bt-card-hover p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-bold text-bt-navy">{card.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-bt-ink-2">{card.description}</p>
                  </div>
                  <IconTile icon={card.icon} tone={CARD_TONE[card.title] || 'navy'} size="lg" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary Table */}
        {!isLoading && !error && (
          <SectionCard
            title={`${period.charAt(0).toUpperCase() + period.slice(1)} Summary`}
            subtitle="Headline business metrics for the selected period."
            padded={false}
            bodyClass="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-bt-border">
                    <th className="text-left py-3.5 px-5 font-bold text-bt-ink-3 text-[11px] uppercase tracking-[0.1em]">Metric</th>
                    <th className="text-right py-3.5 px-5 font-bold text-bt-ink-3 text-[11px] uppercase tracking-[0.1em]">Value</th>
                    <th className="text-right py-3.5 px-5 font-bold text-bt-ink-3 text-[11px] uppercase tracking-[0.1em]">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Revenue', value: `₹${(stats.todayRevenue || 0).toLocaleString('en-IN')}`, trend: 'up' },
                    { label: 'Bookings', value: stats.todayBookings || 0, trend: 'up' },
                    { label: 'Active Trips', value: stats.activeTrips || 0, trend: 'up' },
                    { label: 'Completed Trips', value: stats.completedDeliveries || 0, trend: 'up' },
                    { label: 'Pending', value: stats.pendingBookings || 0, trend: 'neutral' },
                    { label: 'Cancelled', value: stats.cancelledTrips || 0, trend: 'down' },
                    { label: 'Total Bookings (All Time)', value: stats.totalBookings || 0, trend: 'up' },
                    { label: 'Registered Customers', value: stats.totalUsers || 0, trend: 'up' },
                  ].map(row => (
                    <tr key={row.label} className="border-b border-[#EFF2F7] transition-colors hover:bg-bt-surface-soft">
                      <td className="py-4 px-5 text-[14px] font-medium text-bt-navy">{row.label}</td>
                      <td className="py-4 px-5 text-right text-[14px] font-semibold text-bt-navy tabular-nums">{row.value}</td>
                      <td className="py-4 px-5 text-right">
                        <span className={`inline-flex items-center gap-1 text-[12.5px] font-semibold ${
                          row.trend === 'up' ? 'text-emerald-600' : row.trend === 'down' ? 'text-bt-danger' : 'text-bt-ink-3'
                        }`}>
                          {row.trend === 'up' ? '↑' : row.trend === 'down' ? '↓' : '→'}
                          {row.trend === 'up' ? ' +12%' : row.trend === 'down' ? ' -5%' : ' 0%'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </AdminShell>
  );
}

export default React.memo(AdminReports);
