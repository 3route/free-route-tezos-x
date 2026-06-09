// objkt v4 marketplace bits — the consumer's OWN operation, appended to the SDK's swap+bridge batch.
// The SDK is marketplace-agnostic; this lives in the example, not in the SDK.
import type { MichelsonV1Expression } from '@taquito/rpc';
import type { TransferParams } from '@taquito/taquito';
import type { Tz1Address } from '../sdk/index.js';

// objkt v4 %fulfill_ask value: pair(ask_id, editions, proxy_for=None, condition_extra=None, referrers={}).
// NFT lands on SENDER (= the buyer tz1 sourcing the op), so no separate delivery step is needed.
export const fulfillAskValue = (askId: number | string, editions = 1): MichelsonV1Expression => ({
  prim: 'Pair',
  args: [{ int: String(askId) }, { int: String(editions) }, { prim: 'None' }, { prim: 'None' }, []],
});

// objkt %fulfill_ask op — paid with the bridged XTZ (amount = priceMutez). Gas pinned (heavy op + previewnet fee floor).
export function buildFulfillAskOperation(params: {
  objkt: string;
  askId: number | string;
  priceMutez: bigint | number;
  editions?: number;
  gasLimit?: number;
  storageLimit?: number;
  fee?: number;
}): TransferParams {
  return {
    to: params.objkt,
    amount: Number(params.priceMutez),
    mutez: true,
    parameter: { entrypoint: 'fulfill_ask', value: fulfillAskValue(params.askId, params.editions ?? 1) },
    gasLimit: params.gasLimit ?? 700_000,
    storageLimit: params.storageLimit ?? 2_000,
    fee: params.fee ?? 100_000,
  };
}

// Human-readable confirmation summary (no EVM addresses, hex, or wei). `payToken` formats the input token.
export interface Intent {
  action: string;
  nft: string;
  price: string;
  pay: string;
  recipient: string;
  note: string;
}
export function buildIntent(params: {
  nft: string;
  priceMutez: bigint | number;
  amountIn: bigint | number;
  payToken: { symbol: string; decimals: number };
  recipientTz1: Tz1Address;
}): Intent {
  return {
    action: `Buy NFT with ${params.payToken.symbol}`,
    nft: params.nft,
    price: `${Number(params.priceMutez) / 1e6} XTZ`,
    pay: `≤ ${Number(params.amountIn) / 10 ** params.payToken.decimals} ${params.payToken.symbol}`,
    recipient: params.recipientTz1,
    note: 'one atomic transaction; change returns to you — excess XTZ to your tz1, any unused input token refunded',
  };
}
