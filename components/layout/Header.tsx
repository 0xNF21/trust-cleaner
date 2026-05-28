import Link from 'next/link';

import { CirclesLogo } from '@/components/brand/CirclesLogo';
import { CurrentPage } from '@/components/layout/CurrentPage';
import { MobileNav } from '@/components/layout/MobileNav';
import { WalletStatus } from '@/components/wallet/WalletStatus';

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-sand/90 px-4 py-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav />
          <Link
            href="/"
            className="inline-flex h-11 min-w-0 items-center gap-2 rounded-lg border border-ink/10 bg-white/75 px-2.5 font-semibold tracking-tight shadow-sm transition hover:border-marine/25 hover:bg-white"
          >
            <CirclesLogo width={28} height={28} />
            <span className="truncate">Trust Cleaner</span>
          </Link>
          <div className="hidden sm:block">
            <CurrentPage />
          </div>
        </div>
        <WalletStatus />
      </div>
    </header>
  );
}
