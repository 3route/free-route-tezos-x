// Beacon (Temple) wallet connection + a TezosToolkit bound to it. Client-side only.
import { create } from 'zustand';
import { TezosToolkit } from '@taquito/taquito';
import { BeaconWallet } from '@taquito/beacon-wallet';
import { CFG, NETWORK_NAME } from './config';
import { tzToAlias } from './sdk';
import { log } from './log';

interface WalletState {
  connected: boolean;
  address: string | null; // buyer/seller tz1
  alias: string | null; // its derived EVM alias (where ERC20s live)
  tezos: TezosToolkit | null;
  wallet: BeaconWallet | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  restore: () => Promise<void>; // rehydrate an existing Beacon session on page load
}

const makeWallet = (): BeaconWallet =>
  new BeaconWallet({
    name: 'objkt EVM-pay',
    // previewnet is a custom network for the wallet.
    network: { type: 'custom' as never, name: NETWORK_NAME, rpcUrl: CFG.tezRpc },
  });

const bind = (wallet: BeaconWallet, address: string) => {
  const tezos = new TezosToolkit(CFG.tezRpc);
  tezos.setWalletProvider(wallet);
  return { connected: true, address, alias: tzToAlias(address), tezos, wallet, connecting: false };
};

export const useWallet = create<WalletState>((set, get) => ({
  connected: false,
  address: null,
  alias: null,
  tezos: null,
  wallet: null,
  connecting: false,

  // Beacon persists the active account in localStorage; restore it without prompting on reload.
  restore: async () => {
    if (get().connected || get().connecting) return;
    try {
      const wallet = makeWallet();
      const account = await wallet.client.getActiveAccount();
      if (!account) return;
      set(bind(wallet, account.address));
      log.info(`Wallet session restored: ${account.address}`);
    } catch {
      /* no persisted session — stay disconnected */
    }
  },

  connect: async () => {
    if (get().connecting || get().connected) return;
    set({ connecting: true });
    try {
      const wallet = makeWallet();
      await wallet.requestPermissions();
      const address = await wallet.getPKH();
      set(bind(wallet, address));
      log.ok(`Wallet connected: ${address}`, `alias ${tzToAlias(address)}`);
    } catch (e) {
      set({ connecting: false });
      log.err('Wallet connection failed', (e as Error).message);
      throw e;
    }
  },

  disconnect: async () => {
    const w = get().wallet;
    try {
      if (w) await w.clearActiveAccount();
    } finally {
      set({ connected: false, address: null, alias: null, tezos: null, wallet: null });
      log.info('Wallet disconnected');
    }
  },
}));
