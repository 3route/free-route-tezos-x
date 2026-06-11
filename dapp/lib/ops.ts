// Operation builders — the dApp's use of the pure-SDK. Mirrors sdk/index.ts (buy) and scripts/setup.ts
// (mint+list), but signed by the connected Temple wallet (tezos.wallet.batch).
import { OpKind } from '@taquito/taquito';
import type { ParamsWithKind, TezosToolkit } from '@taquito/taquito';
import type { MichelsonV1Expression } from '@taquito/rpc';
import { CFG } from './config';
import { XTZ, buildBatchTransaction, objkt, swapper, targetForMinOut } from './sdk';
import type { ThreeRouteToken } from './sdk';
import { fmtSig } from './format';

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
export interface BuyDetails {
  askId: string;
  tokenId: string;
  priceMutez: number;
  payToken: ThreeRouteToken;
  payAmount: string; // swap.src.amount, base units of payToken — STRICT (calldata is exact-input)
  expectedOutMutez: number; // swap.dst.expected (mutez) — expected XTZ out
  minOutMutez: number; // swap.dst.min (mutez) — guaranteed XTZ floor (== price after our sizing)
  changeMutez: number; // expectedOut - price, returned to the buyer's Michelson address (>= 0)
  slippageBps: number;
  router: string;
  steps: Array<{ kind: string; detail: string }>;
}

export async function buildBuyBatch(
  buyerMichelsonAddress: string,
  ask: { askId: string; tokenId: string; priceMutez: number },
  payToken: ThreeRouteToken,
  slippageBps: number,
): Promise<{ ops: ParamsWithKind[]; details: BuyDetails }> {
  // The server sets the on-chain floor minOut = target × (1 − slippage). We need minOut ≥ the NFT price
  // (else fulfill_ask reverts), so size the exact-out target = ceil(price / (1 − slippage)). This sizing is
  // the consumer's policy — the SDK just takes the final target. Guard slip < 100%.
  const bps = Math.min(slippageBps, 9900);
  const target = targetForMinOut(BigInt(ask.priceMutez), bps);

  // exact-out payToken -> XTZ: ops = [approve, swap(call_evm)]; output native XTZ auto-forwards to the
  // Michelson address. prepareSwap is offline (no toolkit, no contract fetch).
  const { ops: swapOps, details: swap } = await swapper.prepareSwap({
    account: buyerMichelsonAddress,
    src: payToken,
    dst: XTZ,
    amount: target,
    exactOut: true,
    slippageBps: bps,
  });

  // fulfill_ask (hand-encoded objkt op) — paid by the bridged XTZ. Composed into the same atomic group.
  const fulfillOp = objkt.buildFulfillAsk({ marketplace: CFG.objkt, askId: ask.askId, amountMutez: BigInt(ask.priceMutez) });
  const ops = buildBatchTransaction(swapOps, fulfillOp);

  const expectedOutMutez = Number(swap.dst.expected); // already mutez
  const minOutMutez = Number(swap.dst.min); // == price after our sizing
  const changeMutez = Math.max(0, expectedOutMutez - ask.priceMutez);

  const details: BuyDetails = {
    askId: ask.askId,
    tokenId: ask.tokenId,
    priceMutez: ask.priceMutez,
    payToken,
    payAmount: swap.src.amount.toString(),
    expectedOutMutez,
    minOutMutez,
    changeMutez,
    slippageBps: bps,
    router: swap.router,
    steps: [
      { kind: 'approve (call_evm)', detail: `approve exactly ${fmtSig(swap.src.amount, payToken.decimals, 6)} ${payToken.symbol} to the 3route router` },
      { kind: 'swap (call_evm)', detail: `${payToken.symbol} → native XTZ to your alias → auto-forwards to your Michelson address` },
      { kind: 'fulfill_ask', detail: `buy ask#${ask.askId}, pay ${ask.priceMutez / 1e6} XTZ` },
    ],
  };
  return { ops, details };
}

// Send a prepared op group as ONE atomic wallet batch (the buy must stay atomic — never chunked).
export async function sendWalletGroup(tezos: TezosToolkit, ops: ParamsWithKind[]): Promise<string> {
  const op = await tezos.wallet.batch().with(ops as never).send();
  await op.confirmation();
  return op.opHash;
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
