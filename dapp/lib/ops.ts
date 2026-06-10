// Operation builders — the dApp's use of the pure-SDK. Mirrors sdk/index.ts (buy) and scripts/setup.ts
// (mint+list), but signed by the connected Temple wallet (tezos.wallet.batch).
import { MichelsonMap, OpKind } from '@taquito/taquito';
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { AbiCoder } from 'ethers';
import { CFG } from './config';
import { NATIVE_XTZ, SWAP_SIG, buildCallEvm, threeRoute, tzToAlias, wrapOperationParamsWithEvmApprove } from './sdk';
import type { ObjktContract, SwapResponse, ThreeRouteToken } from './sdk';

const abi = AbiCoder.defaultAbiCoder();
const MAX_GAS_PER_BATCH = 2_500_000; // stay safely under the per-op-group ceiling; split if exceeded

const m = {
  string: (s: string): MichelsonV1Expression => ({ string: s }),
  int: (n: number | string): MichelsonV1Expression => ({ int: String(n) }),
  pair: (...a: MichelsonV1Expression[]): MichelsonV1Expression => ({ prim: 'Pair', args: a }),
  right: (x: MichelsonV1Expression): MichelsonV1Expression => ({ prim: 'Right', args: [x] }),
  unit: { prim: 'Unit' } as MichelsonV1Expression,
  none: { prim: 'None' } as MichelsonV1Expression,
};

// objkt v4 `ask` parameter (XTZ currency, 1 edition, seller takes 100%).
const askValue = (fa2: string, tokenId: number, priceMutez: number, seller: string): MichelsonV1Expression =>
  m.pair(
    m.pair(m.string(fa2), m.int(tokenId)),
    m.right(m.right(m.unit)),
    m.int(priceMutez),
    m.int(1),
    [{ prim: 'Elt', args: [m.string(seller), m.int(1000)] }] as unknown as MichelsonV1Expression,
    m.none,
    m.none,
    m.int(0),
    m.none,
  );

// ---------------- SELLER: mint N tokens + list each as an ask ----------------
export interface SellerItem {
  tokenId: number;
  priceMutez: number;
}

// One ordered op list: [mint..., ask...]. All mints precede all asks, so chunked sends stay valid.
export function buildMintListOps(seller: string, items: SellerItem[]): ParamsWithKind[] {
  const mints: ParamsWithKind[] = items.map((it) => ({
    kind: OpKind.TRANSACTION,
    to: CFG.fa2,
    amount: 0,
    parameter: { entrypoint: 'mint', value: m.pair(m.string(seller), m.int(it.tokenId)) },
    gasLimit: 200_000,
    storageLimit: 350,
    fee: 30_000,
  }));
  const asks: ParamsWithKind[] = items.map((it) => ({
    kind: OpKind.TRANSACTION,
    to: CFG.objkt,
    amount: 0,
    parameter: { entrypoint: 'ask', value: askValue(CFG.fa2, it.tokenId, it.priceMutez, seller) },
    gasLimit: 400_000,
    storageLimit: 1_200,
    fee: 40_000,
  }));
  return [...mints, ...asks];
}

// ---------------- BUYER: pay an ERC20 for an XTZ-priced ask ----------------
export interface BuyIntent {
  askId: string;
  tokenId: string;
  priceMutez: number;
  payToken: ThreeRouteToken;
  payAmount: string; // srcAmount, raw units of payToken
  amountOutTargetWei: string;
  slippageBps: number;
  router: string;
  alias: string;
  steps: Array<{ kind: string; detail: string }>;
}

export async function buildBuyBatch(
  tezos: TezosToolkit,
  buyerTz1: string,
  ask: { askId: string; tokenId: string; priceMutez: number },
  payToken: ThreeRouteToken,
  slippageBps: number,
): Promise<{ ops: ParamsWithKind[]; intent: BuyIntent; quote: SwapResponse }> {
  const alias = tzToAlias(buyerTz1);
  // The server sets the on-chain floor minOut = target × (1 − slippage). We need minOut ≥ the NFT price
  // (else fulfill_ask reverts), so target = price / (1 − slippage), rounded UP (ceil) so minOut never lands
  // a wei below price (the wei→mutez bridge floors, and 1 wei short would drop a whole mutez). Guard slip < 100%.
  const bps = Math.min(slippageBps, 9900);
  const priceWei = BigInt(ask.priceMutez) * 10n ** 12n;
  const denom = BigInt(10000 - bps);
  const targetWei = ((priceWei * 10000n + denom - 1n) / denom).toString();
  const quote = await threeRoute.getSwap(payToken.address, NATIVE_XTZ, targetWei, alias, alias, bps / 100);

  // swap: call_evm(router, swap, calldata-minus-selector) — output native XTZ to the alias (auto-forwards to tz1)
  const swapOp = buildCallEvm(CFG.gateway, quote.tx.to, SWAP_SIG, quote.tx.data.slice(10));

  // fulfill_ask (typed objkt contract) — paid by the bridged XTZ
  const objkt = await tezos.contract.at<ObjktContract>(CFG.objkt);
  const fulfillOp = objkt.methodsObject
    .fulfill_ask({ ask_id: ask.askId, amount: '1', proxy_for: null, condition_extra: null, referrers: new MichelsonMap<string, string>() })
    .toTransferParams({ amount: ask.priceMutez, mutez: true, gasLimit: 700_000, storageLimit: 2_000, fee: 150_000 });

  // [swap, fulfill] then prepend the in-batch ERC20 approve (the SDK's wrap)
  let ops: ParamsWithKind[] = [
    { kind: OpKind.TRANSACTION, ...swapOp },
    { kind: OpKind.TRANSACTION, ...fulfillOp },
  ];
  ops = wrapOperationParamsWithEvmApprove({
    operationParams: ops,
    gateway: CFG.gateway,
    token: payToken.address,
    spender: quote.tx.to,
    amount: quote.srcAmount,
  });

  const intent: BuyIntent = {
    askId: ask.askId,
    tokenId: ask.tokenId,
    priceMutez: ask.priceMutez,
    payToken,
    payAmount: quote.srcAmount,
    amountOutTargetWei: targetWei,
    slippageBps,
    router: quote.tx.to,
    alias,
    steps: [
      { kind: 'approve', detail: `approve ${payToken.symbol} -> 3route router` },
      { kind: 'swap (call_evm)', detail: `${payToken.symbol} -> native XTZ, output to alias (auto-forwards to tz1)` },
      { kind: 'fulfill_ask', detail: `buy ask#${ask.askId} for ${ask.priceMutez / 1e6} XTZ` },
    ],
  };
  return { ops, intent, quote };
}

// ---------------- send (chunked under the gas ceiling), via the wallet ----------------
export async function sendChunked(tezos: TezosToolkit, ops: ParamsWithKind[], onHash?: (hash: string, idx: number, total: number) => void): Promise<string[]> {
  // greedy pack preserving order
  const batches: ParamsWithKind[][] = [];
  let cur: ParamsWithKind[] = [];
  let gas = 0;
  for (const op of ops) {
    const g = (op as { gasLimit?: number }).gasLimit ?? 0;
    if (cur.length && gas + g > MAX_GAS_PER_BATCH) {
      batches.push(cur);
      cur = [];
      gas = 0;
    }
    cur.push(op);
    gas += g;
  }
  if (cur.length) batches.push(cur);

  const hashes: string[] = [];
  for (let i = 0; i < batches.length; i++) {
    const op = await tezos.wallet.batch().with(batches[i] as never).send();
    hashes.push(op.opHash);
    onHash?.(op.opHash, i + 1, batches.length);
    await op.confirmation();
  }
  return hashes;
}

// Fresh, collision-free token ids for a mint batch (timestamp-based).
export function freshTokenIds(count: number): number[] {
  const base = Date.now();
  return Array.from({ length: count }, (_, i) => base + i);
}
