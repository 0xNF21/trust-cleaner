'use client';

import { Badge } from '@/components/ui/badge';
import { useWallet } from '@/components/wallet/WalletProvider';
import { shortenAddress } from '@/lib/utils';

export function WalletStatus() {
  const { address, isConnected } = useWallet();

  return (
    <Badge
      variant={isConnected ? 'default' : 'secondary'}
      className={
        'border border-ink/10 px-2.5 py-1 font-medium shadow-sm ' +
        (isConnected
          ? 'bg-marine text-white hover:bg-marine'
          : 'bg-white/70 text-ink/70 hover:bg-white/70')
      }
    >
      <span
        className={
          'mr-1.5 inline-block size-1.5 rounded-full ' +
          (isConnected ? 'bg-citrus' : 'bg-ink/35')
        }
        aria-hidden
      />
      {address ? shortenAddress(address) : 'Not connected'}
    </Badge>
  );
}
