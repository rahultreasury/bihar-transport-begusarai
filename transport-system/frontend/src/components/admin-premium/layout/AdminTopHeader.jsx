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
    <header className="h-14 lg:h-16 border-b border-border/60 bg-header/30 backdrop-blur-xl sticky top-0 z-10">
      <div className="h-full px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] lg:text-xs text-muted truncate">Today</div>
          <div className="text-sm lg:text-lg font-semibold tracking-tight truncate">Live Logistics Console</div>
        </div>

        <div className="flex items-center gap-1.5 lg:gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-2 xl:gap-3 rounded-2xl border border-border/60 bg-card/40 px-3 xl:px-4 py-1.5 xl:py-2">
            {quickItems.map((it) => (
              <div key={it.label} className="text-[10px] xl:text-xs whitespace-nowrap">
                <div className="text-muted">{it.label}</div>
                <div className="font-semibold">{it.value}</div>
              </div>
            ))}
          </div>

          <button
            onClick={toggleTheme}
            className="rounded-xl lg:rounded-2xl border border-border/60 bg-card/40 px-2.5 lg:px-4 py-1.5 lg:py-2 text-xs lg:text-sm font-medium hover:bg-hover/60 transition whitespace-nowrap"
            aria-label="Toggle theme"
          >
            <span className="hidden sm:inline">{themeLabel}</span>
            <span className="sm:hidden">{themeLabel === 'Dark' ? '🌙' : '☀️'}</span>
          </button>

          <div className="h-8 w-8 lg:h-10 lg:w-10 rounded-xl lg:rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shrink-0" />
        </div>
      </div>
    </header>
  );
}

