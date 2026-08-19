import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import EmptyState from '../components/admin-premium/ui/EmptyState';
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

const COLORS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#e11d48'];

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

  const kpiCards = useMemo(() => [
    { label: 'Avg Monthly Revenue', value: `₹${(stats.todayRevenue || 42000).toLocaleString('en-IN')}`, icon: TrendingUp, color: 'text-green-500' },
    { label: 'Growth Rate', value: '+23%', icon: Activity, color: 'text-amber-500' },
    { label: 'Active Routes', value: routeData.filter(r => r.name !== 'Other').length, icon: BarChart3, color: 'text-sky-500' },
    { label: 'Conversion Rate', value: '68%', icon: PieChart, color: 'text-purple-500' },
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
      <div className="space-y-6" id="admin-main-content">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted mt-1">Business insights and performance metrics</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map(card => (
            <div
              key={card.label}
              className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted font-medium">{card.label}</div>
                  <div className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</div>
                </div>
                <card.icon className={`w-8 h-8 ${card.color} opacity-40`} />
              </div>
            </div>
          ))}
        </div>

        {/* Revenue Trend Chart */}
        <SectionCard title="Revenue & Bookings Trend (Monthly)">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="month" stroke="rgba(148,163,184,0.6)" fontSize={12} />
                <YAxis stroke="rgba(148,163,184,0.6)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15,23,42,0.9)',
                    border: '1px solid rgba(51,65,85,0.6)',
                    borderRadius: '12px',
                    color: '#e2e8f0',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#f59e0b"
                  fill="url(#revenueGradient)"
                  strokeWidth={2}
                  name="Revenue (₹)"
                />
                <Line
                  type="monotone"
                  dataKey="bookings"
                  stroke="#10b981"
                  strokeWidth={2}
                  name="Bookings"
                  dot={{ fill: '#10b981', r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        {/* Two column charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Route Popularity */}
          <SectionCard title="Popular Routes">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={routeData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" stroke="rgba(148,163,184,0.6)" fontSize={11} angle={-20} textAnchor="end" height={60} />
                  <YAxis stroke="rgba(148,163,184,0.6)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: 'rgba(15,23,42,0.9)',
                      border: '1px solid rgba(51,65,85,0.6)',
                      borderRadius: '12px',
                      color: '#e2e8f0',
                    }}
                  />
                  <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Bookings" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          {/* State-wise Distribution */}
          <SectionCard title="State-wise Bookings">
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
                    contentStyle={{
                      background: 'rgba(15,23,42,0.9)',
                      border: '1px solid rgba(51,65,85,0.6)',
                      borderRadius: '12px',
                      color: '#e2e8f0',
                    }}
                  />
                  <Legend />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        {/* Monthly Growth Chart */}
        <SectionCard title="Monthly Growth">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={revenueData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="month" stroke="rgba(148,163,184,0.6)" fontSize={12} />
                <YAxis stroke="rgba(148,163,184,0.6)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(15,23,42,0.9)',
                    border: '1px solid rgba(51,65,85,0.6)',
                    borderRadius: '12px',
                    color: '#e2e8f0',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={{ fill: '#8b5cf6', r: 4 }}
                  name="Revenue (₹)"
                />
                <Line
                  type="monotone"
                  dataKey="bookings"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={{ fill: '#06b6d4', r: 4 }}
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
