'use client';
import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { SellerPanel } from '@/components/SellerPanel';
import { BuyerPanel } from '@/components/BuyerPanel';
import { OwnedPanel } from '@/components/OwnedPanel';
import { LogPanel } from '@/components/LogPanel';
import { useUi } from '@/lib/ui';
import { useWallet } from '@/lib/wallet';

export default function Page() {
  const mode = useUi((s) => s.mode);
  const restore = useWallet((s) => s.restore);
  useEffect(() => {
    void restore(); // rehydrate an existing Temple session after a reload
  }, [restore]);
  return (
    <>
      <Header />
      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0">
          {mode === 'seller' ? <SellerPanel /> : mode === 'owned' ? <OwnedPanel /> : <BuyerPanel />}
        </section>
        <aside className="h-[70vh] lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          <LogPanel />
        </aside>
      </main>
    </>
  );
}
