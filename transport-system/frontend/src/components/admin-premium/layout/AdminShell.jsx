import { useMemo } from 'react';
import AdminTopHeader from './AdminTopHeader';
import AdminSidebar from './AdminSidebar';
import { useAdminTheme } from '../theme/useAdminTheme';

export default function AdminShell({ navItems, activeKey, onNav, children }) {
  const { themeClass } = useAdminTheme();

  const resolvedNavItems = useMemo(() => navItems || [], [navItems]);

  return (
    <div className={`min-h-screen ${themeClass} bg-surface text-text`}> 
      <div className="flex min-h-screen w-full max-w-full">
        <AdminSidebar navItems={resolvedNavItems} activeKey={activeKey} onNav={onNav} />
        <div className="flex-1 flex flex-col min-w-0 w-full max-w-full">
          <AdminTopHeader />
          <main className="flex-1 px-4 sm:px-6 pb-10 pt-6 xl:pt-6 overflow-y-auto w-full max-w-full min-w-0">
            <div className="w-full max-w-full min-w-0">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

