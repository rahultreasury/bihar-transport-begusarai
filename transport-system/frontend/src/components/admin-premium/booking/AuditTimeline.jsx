import React, { useEffect, useState } from 'react';
import { adminAPI } from '../../services/api';

const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const ACTION_COLORS = {
  CREATE: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  UPDATE: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  DELETE: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  PAYMENT: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  SETTLEMENT: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  STATUS_CHANGE: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
  ASSIGNMENT: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
  COMMISSION: 'bg-pink-50 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400',
};

function AuditTimeline({ entityType, entityId, limit = 50 }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!entityType || !entityId) return;
    fetchLogs();
  }, [entityType, entityId]);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminAPI.getEntityAuditLogs(entityType, entityId, { limit });
      if (res.data?.success) {
        setLogs(res.data.data || []);
      }
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500 text-sm">{error}</div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted text-sm">No audit records found for this entity.</div>
    );
  }

  return (
    <div className="space-y-0">
      {logs.map((log, index) => (
        <div key={log.audit_id} className="relative flex gap-4 pb-6 last:pb-0">
          {/* Timeline line */}
          {index < logs.length - 1 && (
            <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border/60" />
          )}
          
          {/* Dot */}
          <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
            ACTION_COLORS[log.action] || ACTION_COLORS.UPDATE
          }`}>
            <span className="text-[10px] font-bold">
              {log.action?.charAt(0) || '?'}
            </span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${
                  ACTION_COLORS[log.action] || ACTION_COLORS.UPDATE
                }`}>
                  {log.action?.replace(/_/g, ' ') || 'UNKNOWN'}
                </span>
                <div className="text-sm font-medium text-text mt-1">
                  {log.entity_type?.replace(/_/g, ' ')} #{log.entity_id}
                </div>
              </div>
              <div className="text-xs text-muted whitespace-nowrap">
                {formatDateTime(log.created_at)}
              </div>
            </div>

            {/* User info */}
            {log.user && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                By: {log.user.name} ({log.user.role})
              </div>
            )}

            {/* Changes */}
            {(log.previous_value || log.new_value) && (
              <div className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-border/40">
                {log.previous_value && (
                  <div className="text-xs">
                    <span className="text-muted">Previous: </span>
                    <span className="font-mono text-red-600 dark:text-red-400">
                      {typeof log.previous_value === 'object' ? JSON.stringify(log.previous_value) : log.previous_value}
                    </span>
                  </div>
                )}
                {log.new_value && (
                  <div className="text-xs mt-1">
                    <span className="text-muted">New: </span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      {typeof log.new_value === 'object' ? JSON.stringify(log.new_value) : log.new_value}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Reason */}
            {log.reason && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                Reason: {log.reason}
              </div>
            )}

            {/* IP */}
            {log.ip_address && (
              <div className="text-[10px] text-slate-400 mt-1">
                IP: {log.ip_address}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AuditTimeline;
