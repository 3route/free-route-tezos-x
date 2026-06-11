// marketplaces/objkt.ts — objkt v4 marketplace adapter. Hand-encodes the `fulfill_ask` Michelson parameter
// so the op is built fully offline (no TezosToolkit, no contract fetch) — symmetric with prepareSwap. The
// caller drops the returned op into the same atomic OperationGroup as the swap.
// fulfill_ask param schema (captured from the live contract):
//   pair %ask_id nat (pair %amount nat (pair %proxy_for (option address) (pair %condition_extra (option bytes) (map %referrers address nat))))
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind } from '@taquito/taquito';
import type { Hex, MichelsonAddress } from '../address.js';

// Per-network objkt v4 addresses. Kept here (NOT in the swap network presets) so the swap SDK stays
// marketplace-agnostic and objkt can version independently. Parallel to networks.ts — match by network name.
export interface ObjktNetwork {
  name: string;
  marketplace: MichelsonAddress; // objkt v4 marketplace contract
}

export const previewnet: ObjktNetwork = {
  name: 'Tezos X Previewnet',
  marketplace: 'KT1DzhZkEN8UZ6NkhGMDbgHh2W5zLqHDq4G7', // re-originated objkt v4
};

// TODO(mainnet): objkt v4 on Tezos X mainnet isn't deployed yet — placeholder is the L1 mainnet objkt v4.
export const mainnet: ObjktNetwork = {
  name: 'Tezos X Mainnet',
  marketplace: 'KT1SwbTqhSKF6Pdokiu1K4Fpi17ahPPzmt1X', // TODO: real Tezos X mainnet deploy
};

export interface FulfillAskParams {
  marketplace: MichelsonAddress; // objkt contract (KT1…)
  askId: string | number;
  amountMutez: bigint; // XTZ to pay = the ask price (sent as the op value)
  editions?: bigint | number; // %amount — token editions to buy (default 1)
  proxyFor?: MichelsonAddress | null; // buy on behalf of another address
  conditionExtra?: Hex | null; // %condition_extra bytes
  referrers?: ReadonlyArray<{ address: MichelsonAddress; share: bigint | number }>; // address -> nat
}

const some = (inner: object) => ({ prim: 'Some' as const, args: [inner] });
const none = { prim: 'None' as const };

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
