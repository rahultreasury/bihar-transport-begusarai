import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard,
  Receipt,
  Clock,
  Truck,
  Banknote,
  Layers,
  Percent,
  Handshake,
  Fuel,
} from 'lucide-react';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import FinanceFilters, { presetRange } from '../components/admin-premium/financials/FinanceFilters';
import OverviewTab from '../components/admin-premium/financials/OverviewTab';
import ReceivablesTab from '../components/admin-premium/financials/ReceivablesTab';
import PayablesTab from '../components/admin-premium/financials/PayablesTab';
import PaymentsTab from '../components/admin-premium/financials/PaymentsTab';
import AdvancesTab from '../components/admin-premium/financials/AdvancesTab';
import CommissionTab from '../components/admin-premium/financials/CommissionTab';
import SettlementsTab from '../components/admin-premium/financials/SettlementsTab';
import PetrolPumpTab from '../components/admin-premium/financials/PetrolPumpTab';
import FinancePostingModal from '../components/admin-premium/financials/FinancePostingModal';
import TransactionDetailModal from '../components/admin-premium/financials/TransactionDetailModal';
import { useApiData } from '../components/admin-premium/financials/useApiData';
import { financeAPI } from '../services/api';
import { Button } from '../components/admin-premium/ui/AdminUI';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦', path: '/admin' },
  { key: 'financials', label: 'Financials', icon: '◷', path: '/admin/financials' },
  { key: 'bookings', label: 'Bookings', icon: '⟐', path: '/admin/bookings' },
  { key: 'clients', label: 'Clients', icon: '☍', path: '/admin/clients' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉', path: '/admin/owners' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛', path: '/admin/vehicles' },
  { key: 'drivers', label: 'Drivers', icon: '⌁', path: '/admin/drivers' },
  { key: 'analytics', label: 'Analytics', icon: '◷', path: '/admin/analytics' },
  { key: 'reports', label: 'Reports', icon: '☰', path: '/admin/reports' },
];

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'receivables', label: 'Receivables', icon: Receipt },
  { key: 'due', label: 'Client Due', icon: Clock },
  { key: 'payables', label: 'Payables', icon: Truck },
  { key: 'payments', label: 'Payments', icon: Banknote },
  { key: 'advances', label: 'Advances', icon: Layers },
  { key: 'commission', label: 'Commission', icon: Percent },
  { key: 'settlements', label: 'Settlements', icon: Handshake },
  { key: 'petrol-pump', label: 'Petrol Pump', icon: Fuel },
];

const mapSection = (section) => {
  if (!section) return 'overview';
  if (section === 'client-receivables' || section === 'receivables') return 'receivables';
  if (section === 'client-due' || section === 'due') return 'due';
  if (section === 'provider-payables' || section === 'payables') return 'payables';
  if (section === 'payments' || section === 'transactions') return 'payments';
  if (section === 'advances') return 'advances';
  if (section === 'commission') return 'commission';
  if (section === 'settlements') return 'settlements';
  if (section === 'petrol-pump') return 'petrol-pump';
  return 'overview';
};

export default function AdminFinancials() {
  const navigate = useNavigate();
  const { section: sectionParam } = useParams();

  const [activeTab, setActiveTab] = useState(mapSection(sectionParam));
  useEffect(() => {
    setActiveTab(mapSection(sectionParam));
  }, [sectionParam]);

  const [filters, setFilters] = useState(() => {
    const r = presetRange('THIS_MONTH');
    return { from: r.from, to: r.to, branch: '' };
  });

  const [branches, setBranches] = useState([]);
  useEffect(() => {
    let alive = true;
    financeAPI
      .getBranches()
      .then((res) => {
        if (!alive) return;
        const data = res?.data?.data || res?.data;
        setBranches(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (alive) setBranches([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const [refreshKey, setRefreshKey] = useState(0);

  const [posting, setPosting] = useState({ open: false, mode: 'receipt', preset: {} });
  const openPosting = useCallback((mode, preset = {}) => {
    setPosting({ open: true, mode, preset });
  }, []);
  const closePosting = useCallback(() => {
    setPosting((p) => ({ ...p, open: false }));
  }, []);

  const [txDetail, setTxDetail] = useState(null);

  const { data: overviewData, loading: overviewLoading, error: overviewError } = useApiData(async () => {
    const res = await financeAPI.getOverview({
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
    });
    return res?.data?.data || res?.data || null;
  }, [filters.from, filters.to, filters.branch, refreshKey]);

  const onGoTab = useCallback(
    (key) => {
      const mapped = mapSection(key);
      setActiveTab(mapped);
      navigate(mapped === 'overview' ? '/admin/financials' : `/admin/financials/${mapped}`);
    },
    [navigate],
  );

  const handleTabClick = useCallback(
    (key) => {
      setActiveTab(key);
      navigate(key === 'overview' ? '/admin/financials' : `/admin/financials/${key}`);
    },
    [navigate],
  );

  const handleExport = useCallback(async () => {
    try {
      const res = await financeAPI.exportSection(activeTab, {
        date_from: filters.from,
        date_to: filters.to,
      });
      const blob = new Blob([JSON.stringify(res?.data?.data || res?.data || {}, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financials-${activeTab}-${filters.from}-${filters.to}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Export failed', e);
    }
  }, [activeTab, filters.from, filters.to]);

  const handleReset = useCallback(() => {
    const r = presetRange('THIS_MONTH');
    setFilters({ from: r.from, to: r.to, branch: '' });
  }, []);

  return (
    <AdminShell
      navItems={NAV_ITEMS}
      activeKey="financials"
      onNav={(key) => {
        if (key === 'clients') navigate('/admin/clients');
        else if (key === 'dashboard') navigate('/admin');
      }}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-bt-navy">Financials Overview</h1>
            <p className="text-[12.5px] text-bt-ink-2">
              Complete financial position, collections, obligations and transport business cash movement.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={handleExport}>Export</Button>
            <Button variant="primary" onClick={() => openPosting('receipt')}>Record Receipt</Button>
          </div>
        </div>

        <FinanceFilters
          filters={filters}
          branches={branches}
          onApply={setFilters}
          onReset={handleReset}
          onRefresh={() => setRefreshKey((k) => k + 1)}
          refreshing={overviewLoading}
          search={undefined}
          onSearch={undefined}
        />

        <div className="flex flex-wrap gap-2 border-b border-bt-border pb-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabClick(tab.key)}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-bt-orange text-white'
                    : 'text-bt-navy hover:bg-slate-100'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={2.2} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'overview' ? (
          <OverviewTab
            data={overviewData}
            loading={overviewLoading}
            error={overviewError}
            onRetry={() => setRefreshKey((k) => k + 1)}
            onOpenPosting={openPosting}
            onGoTab={onGoTab}
            onOpenTransaction={setTxDetail}
          />
        ) : null}

        {activeTab === 'receivables' ? (
          <ReceivablesTab
            mode="receivables"
            filters={filters}
            refreshKey={refreshKey}
            onPostReceipt={() => openPosting('receipt')}
          />
        ) : null}

        {activeTab === 'due' ? (
          <ReceivablesTab
            mode="due"
            filters={filters}
            refreshKey={refreshKey}
            onPostReceipt={() => openPosting('receipt')}
          />
        ) : null}

        {activeTab === 'payables' ? (
          <PayablesTab
            filters={filters}
            refreshKey={refreshKey}
            onPostVendorPayment={() => openPosting('vendor-payment')}
            onPostSettlement={() => openPosting('settlement')}
          />
        ) : null}

        {activeTab === 'payments' ? (
          <PaymentsTab
            filters={filters}
            refreshKey={refreshKey}
            onPostReceipt={() => openPosting('receipt')}
          />
        ) : null}

        {activeTab === 'advances' ? (
          <AdvancesTab
            filters={filters}
            refreshKey={refreshKey}
            onPostAdvance={() => openPosting('advance')}
            onAdjustAdvance={() => openPosting('advance-adjust')}
          />
        ) : null}

        {activeTab === 'commission' ? (
          <CommissionTab filters={filters} refreshKey={refreshKey} />
        ) : null}

        {activeTab === 'settlements' ? (
          <SettlementsTab
            filters={filters}
            refreshKey={refreshKey}
            onPostSettlement={() => openPosting('settlement')}
          />
        ) : null}

        {activeTab === 'petrol-pump' ? (
          <PetrolPumpTab
            filters={filters}
            refreshKey={refreshKey}
            onOpenPosting={openPosting}
          />
        ) : null}
      </div>

      <FinancePostingModal
        open={posting.open}
        mode={posting.mode}
        preset={posting.preset}
        onClose={closePosting}
        onSuccess={() => {
          setRefreshKey((k) => k + 1);
          closePosting();
        }}
      />

      <TransactionDetailModal
        open={!!txDetail}
        transaction={txDetail}
        onClose={() => setTxDetail(null)}
        onReverse={(tx) => {
          setTxDetail(null);
          openPosting('reverse', { transaction_id: tx?.transaction_id || tx?.id });
        }}
      />
    </AdminShell>
  );
}
