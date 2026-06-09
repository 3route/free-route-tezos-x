'use client';
import { Header } from '@/components/Header';
import { SellerPanel } from '@/components/SellerPanel';
import { BuyerPanel } from '@/components/BuyerPanel';
import { LogPanel } from '@/components/LogPanel';
import { useUi } from '@/lib/ui';

export default function Page() {
  const mode = useUi((s) => s.mode);
  return (
    <>
      <Header />
      <main className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0">{mode === 'seller' ? <SellerPanel /> : <BuyerPanel />}</section>
        <aside className="h-[70vh] lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
          <LogPanel />
        </aside>
      </main>
    </>
  );
}
