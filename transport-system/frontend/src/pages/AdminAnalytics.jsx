import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import {
  PageHeader,
  CHART_COLORS,
  CHART_SERIES,
  CHART_GRID,
  CHART_TOOLTIP,
  CHART_AXIS,
} from '../components/admin-premium/ui/AdminUI';
import { BarChart3, TrendingUp, PieChart, Activity } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

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

// Categorical series come from the shared chart theme, so this page and every
// other chart in the console draw from one palette.
const COLORS = CHART_SERIES;


// Mock chart data — in production, these would come from the API
const revenueData = [
  { month: 'Jan', revenue: 42000, bookings: 45 },
  { month: 'Feb', revenue: 48000, bookings: 52 },
  { month: 'Mar', revenue: 55000, bookings: 58 },
  { month: 'Apr', revenue: 51000, bookings: 55 },
  { month: 'May', revenue: 62000, bookings: 68 },
  { month: 'Jun', revenue: 58000, bookings: 62 },
  { month: 'Jul', revenue: 64000, bookings: 70 },
  { month: 'Aug', revenue: 72000, bookings: 78 },
  { month: 'Sep', revenue: 68000, bookings: 72 },
  { month: 'Oct', revenue: 75000, bookings: 80 },
  { month: 'Nov', revenue: 82000, bookings: 88 },
  { month: 'Dec', revenue: 78000, bookings: 85 },
];

const routeData = [
  { name: 'Patna → Delhi', value: 320 },
  { name: 'Begusarai → Patna', value: 280 },
  { name: 'Patna → Kolkata', value: 210 },
  { name: 'Begusarai → Delhi', value: 180 },
  { name: 'Muzaffarpur → Patna', value: 150 },
  { name: 'Other', value: 400 },
];

const stateData = [
  { state: 'Bihar', bookings: 850 },
  { state: 'Delhi', bookings: 420 },
  { state: 'West Bengal', bookings: 380 },
  { state: 'Uttar Pradesh', bookings: 310 },
  { state: 'Jharkhand', bookings: 250 },
  { state: 'Maharashtra', bookings: 180 },
];

function AdminAnalytics() {
  const [activeKey, setActiveKey] = useState('analytics');

  // Fetch analytics data
  const { data: analyticsData, isLoading, error } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminAPI.getDashboard().then(r => r.data?.data),
    staleTime: 60 * 1000,
    retry: 2,
  });

  const stats = useMemo(() => analyticsData?.stats || {}, [analyticsData]);

  // The `color` field these cards used to carry — four arbitrary Tailwind
  // colours that made the row look like four different products — is gone.
  // Each tile now declares a semantic `accent` and renders through KpiCard.
  const kpiCards = useMemo(() => [
    { label: 'Avg Monthly Revenue', value: `₹${(stats.todayRevenue || 42000).toLocaleString('en-IN')}`, icon: TrendingUp, accent: 'orange' },
    { label: 'Growth Rate', value: '+23%', icon: Activity, accent: 'success' },
    { label: 'Active Routes', value: routeData.filter((r) => r.name !== 'Other').length, icon: BarChart3, accent: 'navy' },
    { label: 'Conversion Rate', value: '68%', icon: PieChart, accent: 'info' },
  ], [stats]);

  if (isLoading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey={activeKey} onNav={(k) => setActiveKey(k)}>
        <div className="space-y-6">
          <LoadingSkeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <LoadingSkeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <LoadingSkeleton className="h-80 w-full" />
          <LoadingSkeleton className="h-80 w-full" />
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey={activeKey} onNav={(k) => setActiveKey(k)}>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <div className="text-red-500 font-semibold mb-2">Unable to load analytics data</div>
          <div className="text-sm text-muted mb-4">{error.message}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey={activeKey} onNav={(k) => setActiveKey(k)}>
      <div className="space-y-5 lg:space-y-6" id="admin-main-content">
        {/* HEADER — the same hierarchy every module uses */}
        <PageHeader
          eyebrow="Insights"
          title="Analytics"
          description="Business insights and performance metrics across bookings, revenue and routes."
        />

        {/* KPI Cards — the shared tile, so a number here looks like a number
            anywhere else in the console. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpiCards.map((card) => (
            <KpiCard
              key={card.label}
              title={card.label}
              value={card.value}
              icon={card.icon}
              accent={card.accent}
              ariaLabel={`${card.label}: ${card.value}`}
            />
          ))}
        </div>

        {/* Revenue Trend Chart */}
        <SectionCard
          title="Revenue & Bookings Trend"
          subtitle="Month-by-month freight revenue against booking volume."
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.orange} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={CHART_COLORS.orange} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_GRID.stroke} strokeDasharray={CHART_GRID.strokeDasharray} />
                <XAxis dataKey="month" stroke={CHART_AXIS.stroke} fontSize={CHART_AXIS.fontSize} />
                <YAxis stroke={CHART_AXIS.stroke} fontSize={CHART_AXIS.fontSize} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={CHART_COLORS.orange}
                  fill="url(#revenueGradient)"
                  strokeWidth={2}
                  name="Revenue (₹)"
                />
                <Line
                  type="monotone"
                  dataKey="bookings"
                  stroke={CHART_COLORS.success}
                  strokeWidth={2}
                  name="Bookings"
                  dot={{ fill: CHART_COLORS.success, r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Two column charts */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
          {/* Route Popularity */}
          <SectionCard title="Popular Routes" subtitle="The lanes carrying the most bookings.">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={routeData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_GRID.stroke} strokeDasharray={CHART_GRID.strokeDasharray} />
                  <XAxis dataKey="name" stroke={CHART_AXIS.stroke} fontSize={11} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke={CHART_AXIS.stroke} fontSize={CHART_AXIS.fontSize} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                  />
                  <Bar dataKey="value" fill={CHART_COLORS.navy} radius={[4, 4, 0, 0]} name="Bookings" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          {/* State-wise Distribution */}
          <SectionCard title="State-wise Bookings" subtitle="How bookings are distributed across states.">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={stateData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="bookings"
                    nameKey="state"
                    label={({ state, percent }) => `${state} (${(percent * 100).toFixed(0)}%)`}
                    labelLine={{ stroke: 'rgba(148,163,184,0.4)' }}
                  >
                    {stateData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_TOOLTIP}
                  />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        {/* Monthly Growth Chart */}
        <SectionCard title="Monthly Growth" subtitle="Revenue and bookings tracked month over month.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART_GRID.stroke} strokeDasharray={CHART_GRID.strokeDasharray} />
                <XAxis dataKey="month" stroke={CHART_AXIS.stroke} fontSize={CHART_AXIS.fontSize} />
                <YAxis stroke={CHART_AXIS.stroke} fontSize={CHART_AXIS.fontSize} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={CHART_COLORS.navy}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLORS.navy, r: 4 }}
                  name="Revenue (₹)"
                />
                <Line
                  type="monotone"
                  dataKey="bookings"
                  stroke={CHART_COLORS.info}
                  strokeWidth={2}
                  dot={{ fill: CHART_COLORS.info, r: 4 }}
                  name="Bookings"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}

export default React.memo(AdminAnalytics);
