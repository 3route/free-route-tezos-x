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
}

export const useWallet = create<WalletState>((set, get) => ({
  connected: false,
  address: null,
  alias: null,
  tezos: null,
  wallet: null,
  connecting: false,

  connect: async () => {
    if (get().connecting || get().connected) return;
    set({ connecting: true });
    try {
      const wallet = new BeaconWallet({
        name: 'objkt EVM-pay',
        // previewnet is a custom network for the wallet.
        network: { type: 'custom' as never, name: NETWORK_NAME, rpcUrl: CFG.tezRpc },
      });
      await wallet.requestPermissions();
      const address = await wallet.getPKH();
      const tezos = new TezosToolkit(CFG.tezRpc);
      tezos.setWalletProvider(wallet);
      const alias = tzToAlias(address);
      set({ connected: true, address, alias, tezos, wallet, connecting: false });
      log.ok(`Wallet connected: ${address}`, `alias ${alias}`);
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
