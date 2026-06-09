import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'objkt · pay with any ERC20',
  description: 'Buy an XTZ-priced objkt NFT paying with any EVM ERC20 — one atomic Tezos op-group (pure-SDK).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
