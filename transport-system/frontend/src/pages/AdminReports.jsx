import React, { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { FileText, Download, Calendar, TrendingUp, Users, Truck, DollarSign, MapPin } from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
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

function AdminReports() {
  const [activeKey, setActiveKey] = useState('reports');
  const [period, setPeriod] = useState('monthly');

  // Fetch dashboard data for reports
  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => adminAPI.getDashboard().then(r => r.data?.data),
    staleTime: 60 * 1000,
    retry: 2,
  });

  const stats = useMemo(() => dashboardData?.stats || {}, [dashboardData]);

  const reportCards = useMemo(() => [
    {
      title: 'Revenue Report',
      icon: DollarSign,
      description: `Total revenue: ₹${(stats.todayRevenue || 0).toLocaleString('en-IN')}`,
      color: 'from-green-500/20 to-green-500',
      accent: 'text-green-500',
    },
    {
      title: 'Booking Report',
      icon: FileText,
      description: `${stats.todayBookings || 0} bookings today, ${stats.totalBookings || 0} total`,
      color: 'from-amber-500/20 to-amber-500',
      accent: 'text-amber-500',
    },
    {
      title: 'Driver Report',
      icon: Users,
      description: `${stats.activeTrips || 0} active drivers, ${stats.completedDeliveries || 0} completed trips`,
      color: 'from-sky-500/20 to-sky-500',
      accent: 'text-sky-500',
    },
    {
      title: 'Vehicle Report',
      icon: Truck,
      description: 'Vehicle utilization and fleet performance',
      color: 'from-purple-500/20 to-purple-500',
      accent: 'text-purple-500',
    },
    {
      title: 'Top Routes',
      icon: MapPin,
      description: 'Most popular transport routes this period',
      color: 'from-orange-500/20 to-orange-500',
      accent: 'text-orange-500',
    },
    {
      title: 'Customer Report',
      icon: Users,
      description: `${stats.totalUsers || 0} registered customers`,
      color: 'from-indigo-500/20 to-indigo-500',
      accent: 'text-indigo-500',
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
      <div className="space-y-6" id="admin-main-content">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <p className="text-sm text-muted mt-1">Export and analyze business performance</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Period Selector */}
            <div className="flex items-center rounded-xl border border-border/60 bg-card/40 p-1">
              {PERIOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    period === opt.value
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                  aria-pressed={period === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Export buttons */}
            <button
              onClick={() => handleExport('csv')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
              aria-label="Export report as CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">Failed to load report data</div>
            <div className="text-sm text-muted">{error.message}</div>
          </div>
        )}

        {/* Report Cards */}
        {!isLoading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reportCards.map(card => (
              <div
                key={card.title}
                className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{card.title}</div>
                    <div className="text-xs text-muted mt-2">{card.description}</div>
                  </div>
                  <div className={`h-10 w-10 rounded-2xl bg-gradient-to-br ${card.color} flex items-center justify-center shrink-0 ml-3`}>
                    <card.icon className="w-5 h-5 text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary Table */}
        {!isLoading && !error && (
          <SectionCard title={`${period.charAt(0).toUpperCase() + period.slice(1)} Summary`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="text-left py-3 px-4 font-semibold text-muted text-xs uppercase tracking-wider">Metric</th>
                    <th className="text-right py-3 px-4 font-semibold text-muted text-xs uppercase tracking-wider">Value</th>
                    <th className="text-right py-3 px-4 font-semibold text-muted text-xs uppercase tracking-wider">Trend</th>
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
                    <tr key={row.label} className="border-b border-border/40 hover:bg-hover/30 transition">
                      <td className="py-3 px-4 font-medium">{row.label}</td>
                      <td className="py-3 px-4 text-right font-semibold">{row.value}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                          row.trend === 'up' ? 'text-green-500' : row.trend === 'down' ? 'text-red-500' : 'text-muted'
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
