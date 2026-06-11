// Beacon (Temple) wallet connection + a TezosToolkit bound to it. Client-side only.
import { create } from 'zustand';
import { TezosToolkit } from '@taquito/taquito';
import { BeaconWallet } from '@taquito/beacon-wallet';
import { BeaconEvent } from '@airgap/beacon-dapp';
import { CFG, NETWORK_NAME } from './config';
import { michelsonToAlias } from './sdk';
import { log } from './log';

interface WalletState {
  connected: boolean;
  michelsonAddress: string | null; // buyer/seller Michelson address (tz...)
  aliasAddress: string | null; // its derived EVM alias address (where ERC20s live)
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

const bind = (wallet: BeaconWallet, michelsonAddress: string) => {
  const tezos = new TezosToolkit(CFG.tezRpc);
  tezos.setWalletProvider(wallet);
  return { connected: true, michelsonAddress, aliasAddress: michelsonToAlias(michelsonAddress), tezos, wallet, connecting: false };
};

export const useWallet = create<WalletState>((set, get) => {
  // Beacon >=4.2 requires a subscription to ACTIVE_ACCOUNT_SET; without it `getActiveAccount()` warns.
  // The handler also keeps our state in sync if the active account changes/clears outside our own flow.
  const subscribeActiveAccount = (wallet: BeaconWallet) =>
    wallet.client.subscribeToEvent(BeaconEvent.ACTIVE_ACCOUNT_SET, (account) => {
      const address = account?.address ?? null;
      if (address === get().michelsonAddress) return; // already in sync (our connect/restore handled it)
      if (address) set(bind(wallet, address));
      else set({ connected: false, michelsonAddress: null, aliasAddress: null, tezos: null, wallet: null });
    });

  return {
    connected: false,
    michelsonAddress: null,
    aliasAddress: null,
    tezos: null,
    wallet: null,
    connecting: false,

    // Beacon persists the active account in localStorage; restore it without prompting on reload.
    restore: async () => {
      if (get().connected || get().connecting) return;
      try {
        const wallet = makeWallet();
        subscribeActiveAccount(wallet);
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
        subscribeActiveAccount(wallet);
        await wallet.requestPermissions();
        const michelsonAddress = await wallet.getPKH();
        set(bind(wallet, michelsonAddress));
        log.ok(`Wallet connected: ${michelsonAddress}`, `alias ${michelsonToAlias(michelsonAddress)}`);
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
        set({ connected: false, michelsonAddress: null, aliasAddress: null, tezos: null, wallet: null });
        log.info('Wallet disconnected');
      }
    },
  };
});
