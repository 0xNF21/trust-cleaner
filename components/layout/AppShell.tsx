import type { ReactNode } from 'react';

import { Header } from '@/components/layout/Header';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="trust-cleaner-shell min-h-screen">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
