'use client';
import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { SellerPanel } from '@/components/SellerPanel';
import { BuyerPanel } from '@/components/BuyerPanel';
import { OwnedPanel } from '@/components/OwnedPanel';
import { BridgePanel } from '@/components/BridgePanel';
import { LogPanel } from '@/components/LogPanel';
import { useUi } from '@/lib/ui';
import { useWallet } from '@/lib/wallet';
import { useBalancesSync, useTokens } from '@/lib/hooks';

export default function Page() {
  const mode = useUi((s) => s.mode);
  const restore = useWallet((s) => s.restore);
  const { michelsonAddress, aliasAddress } = useWallet();
  const { payTokens } = useTokens();
  useBalancesSync(aliasAddress, michelsonAddress, payTokens); // single mount → polls + writes the shared store
  useEffect(() => {
    void restore(); // rehydrate an existing Temple session after a reload
  }, [restore]);
  return (
    <>
      <Header />
      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0">
          {mode === 'seller' ? <SellerPanel /> : mode === 'owned' ? <OwnedPanel /> : mode === 'bridge' ? <BridgePanel /> : <BuyerPanel />}
        </section>
        <aside className="h-[70vh] lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          <LogPanel />
        </aside>
      </main>
    </>
  );
}
