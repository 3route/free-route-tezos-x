// objkt v4 marketplace adapter. Hand-encodes the `fulfill_ask` Michelson parameter fully offline (no
// TezosToolkit / contract fetch); the caller drops the returned op into the same atomic group as the swap.
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import type { Hex, MichelsonAddress } from '../address.js';

// Per-network objkt v4 addresses — kept out of the swap presets so the swap SDK stays marketplace-agnostic.
export interface ObjktNetwork {
  name: string;
  marketplace: MichelsonAddress;
}

export const previewnet: ObjktNetwork = { name: 'Tezos X Previewnet', marketplace: 'KT1AyJ5P4qRJZuHqXiR9QkKRuCy49yNyLVzo' };

// TODO(mainnet): placeholder is the L1 mainnet objkt v4 until the Tezos X deploy exists.
export const mainnet: ObjktNetwork = { name: 'Tezos X Mainnet', marketplace: 'KT1SwbTqhSKF6Pdokiu1K4Fpi17ahPPzmt1X' };

export interface FulfillAskParams {
  marketplace: MichelsonAddress;
  askId: string | number;
  amountMutez: bigint; // XTZ to pay (the ask price) — sent as the op value
  editions?: bigint | number; // token editions to buy (default 1)
  proxyFor?: MichelsonAddress | null; // buy on behalf of another address
  conditionExtra?: Hex | null;
  referrers?: ReadonlyArray<{ address: MichelsonAddress; share: bigint | number }>; // address → nat share
}

const some = (inner: object) => ({ prim: 'Some' as const, args: [inner] });
const none = { prim: 'None' as const };

/**
 * Build an objkt v4 `fulfill_ask` operation (buy a listed ask), fully offline. The XTZ price is the op value.
 * Param schema: `pair %ask_id nat (pair %amount nat (pair %proxy_for (option address)
 * (pair %condition_extra (option bytes) (map %referrers address nat))))`.
 */
export const buildFulfillAsk = (p: FulfillAskParams): ParamsWithKind => {
  const proxyFor = p.proxyFor ? some({ string: p.proxyFor }) : none;
  const conditionExtra = p.conditionExtra ? some({ bytes: p.conditionExtra.replace(/^0x/, '') }) : none;
  // Michelson maps are key-ordered — sort referrers by address so the encoding is canonical.
  const referrers = [...(p.referrers ?? [])]
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
    .map((r) => ({ prim: 'Elt' as const, args: [{ string: r.address }, { int: r.share.toString() }] }));

  return {
    kind: OpKind.TRANSACTION,
    to: p.marketplace,
    amount: Number(p.amountMutez),
    mutez: true,
    parameter: {
      entrypoint: 'fulfill_ask',
      value: {
        prim: 'Pair',
        args: [
          { int: p.askId.toString() },
          {
            prim: 'Pair',
            args: [
              { int: (p.editions ?? 1).toString() },
              { prim: 'Pair', args: [proxyFor, { prim: 'Pair', args: [conditionExtra, referrers] }] },
            ],
          },
        ],
      },
    },
    gasLimit: 700_000,
    storageLimit: 2_000,
    fee: 150_000,
  };
};
