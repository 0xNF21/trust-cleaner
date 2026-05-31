'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useWallet } from '@/components/wallet/WalletProvider';
import { shortenAddress } from '@/lib/utils';

export function ConnectionCard() {
  const { address, isConnected, isMiniappHost } = useWallet();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Wallet
          <Badge variant={isConnected ? 'default' : 'secondary'}>
            {isConnected ? 'connected' : 'disconnected'}
          </Badge>
        </CardTitle>
        <CardDescription>
          The Circles host injects the wallet via{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">onWalletChange</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-[120px_1fr] gap-y-2">
          <span className="text-muted-foreground">Address</span>
          <span className="font-mono break-all">
            {address ?? <span className="text-muted-foreground">—</span>}
          </span>

          <span className="text-muted-foreground">Short</span>
          <span className="font-mono">
            {address ? shortenAddress(address) : <span className="text-muted-foreground">—</span>}
          </span>

          <span className="text-muted-foreground">Environment</span>
          <span>{isMiniappHost ? 'inside Circles app' : 'web app'}</span>
        </div>

        {!isConnected && (
          <>
            <Separator />
            <p className="text-muted-foreground">
              {isMiniappHost
                ? 'Waiting for the host to push a wallet address…'
                : 'Open this miniapp inside the Circles host to receive a wallet address.'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
