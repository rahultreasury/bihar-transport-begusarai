import { useMemo } from 'react';
import { useAdminTheme } from '../theme/useAdminTheme';

export default function AdminTopHeader() {
  const { toggleTheme, themeLabel } = useAdminTheme();

  const quickItems = useMemo(
    () => [
      { label: 'Search', value: '⌘K' },
      { label: 'Notifications', value: '3' },
      { label: 'Support', value: '24/7' }
    ],
    []
  );

  return (
    <header className="h-16 border-b border-border/60 bg-header/30 backdrop-blur-xl sticky top-0 z-10">
      <div className="h-full px-6 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted">Today</div>
          <div className="text-lg font-semibold tracking-tight">Live Logistics Console</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-2">
            {quickItems.map((it) => (
              <div key={it.label} className="text-xs">
                <div className="text-muted">{it.label}</div>
                <div className="font-semibold">{it.value}</div>
              </div>
            ))}
          </div>

          <button
            onClick={toggleTheme}
            className="rounded-2xl border border-border/60 bg-card/40 px-4 py-2 text-sm font-medium hover:bg-hover/60 transition"
            aria-label="Toggle theme"
          >
            {themeLabel}
          </button>

          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600" />
        </div>
      </div>
    </header>
  );
}

