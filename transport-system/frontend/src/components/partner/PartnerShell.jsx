import { useState } from 'react';
import PartnerSidebar from './PartnerSidebar';
import PartnerHeader from './PartnerHeader';

export default function PartnerShell({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface text-text" role="application" aria-label="Partner dashboard">
      <div className="flex min-h-screen w-full max-w-full">
        <PartnerSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col w-full max-w-full">
          <PartnerHeader onMenu={() => setMobileOpen(true)} />
          <main
            id="partner-main-content"
            className="min-w-0 flex-1 w-full max-w-full overflow-y-auto px-4 pb-10 pt-6 sm:px-6 lg:px-8"
            role="main"
            tabIndex={-1}
          >
            <div className="mx-auto w-full max-w-7xl min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
