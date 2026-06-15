import type { ParamsWithKind } from '@taquito/taquito';
import { michelsonToEvmAlias } from './address.js';
import type { EvmAddress, Hex, MichelsonAddress } from './primitives.js';
import { xtzWeiToMutez } from './units.js';
import { isXtz, toEvm, fromEvm } from './xtz.js';
import { ThreeRouteClient } from './threeroute.js';
import type { Swap, ThreeRouteToken } from './threeroute.js';
import type { FetchLike } from './http.js';
import { SWAP_SIG, buildCallEvm, buildErc20Approve } from './operations.js';
import type { ApprovalMode } from './approval.js';
import { tezosXMainnet } from './networks.js';
import type { TezosXNetwork } from './networks.js';

/**
 * Size an exact-out target so the server's floor (target × (1−slip)) still covers `minOut`. A consumer helper —
 * NOT used inside {@link ThreeRouteTezosX.prepareSwap}, since sizing is the consumer's policy (e.g. "the swap
 * floor must cover the NFT price").
 */
export const targetForMinOut = (minOut: bigint, slippageBps: number): bigint =>
  (minOut * 10000n + BigInt(9999 - slippageBps)) / BigInt(10000 - slippageBps); // ceil(minOut / (1 - slip))

export interface SwapDetails {
  src: { token: ThreeRouteToken; amount: bigint }; // amount paid (strict input when exact-in)
  dst: { token: ThreeRouteToken; expected: bigint; min: bigint }; // expected output and guaranteed floor
  exactOut: boolean;
  slippageBps: number;
  router: EvmAddress;
  recipient: EvmAddress; // the alias — where the output is received
  forwardsToMichelsonAddress: boolean; // true ⇔ dst is XTZ (output auto-forwards alias → Michelson address)
}

export interface PrepareSwapParams {
  account: MichelsonAddress; // signer's Michelson address; the alias is derived from it
  src: ThreeRouteToken; // input token (XTZ for native)
  dst: ThreeRouteToken; // output token (XTZ for native)
  amount: bigint; // natural units of the exact side (mutez for XTZ, base units for ERC20) — final, not re-sized
  exactOut?: boolean; // false = exact-input (default); true = exact-output (amount is the target output)
  slippageBps: number; // forwarded to the server, which sets the on-chain minimum output
  approval?: ApprovalMode; // ERC20 allowance handling; default 'resetThenApprove'
}

export interface BuildSwapOperationOptions {
  gateway: MichelsonAddress; // Michelson→EVM gateway (call_evm)
  srcAddress: EvmAddress; // input token — decides native-value (XTZ) vs approve (ERC20)
  approval?: ApprovalMode; // default 'resetThenApprove'
}

/**
 * Turn a 3route /swap response into ready-to-sign Tezos ops, no network. ERC20 input → approve(s) + swap per
 * {@link ApprovalMode}; native-XTZ input → a single swap op carrying the XTZ as msg.value.
 */
export function buildSwapOperation(swap: Swap, opts: BuildSwapOperationOptions): ParamsWithKind[] {
  const native = isXtz(opts.srcAddress);
  const swapOp = buildCallEvm(opts.gateway, swap.tx.to, SWAP_SIG, swap.tx.data.slice(10) as Hex, native ? xtzWeiToMutez(swap.tx.value) : 0n);
  const approval = opts.approval ?? 'resetThenApprove';
  if (native || approval === 'none') return [swapOp]; // native XTZ needs no approve; 'none' = caller manages it
  const approve = buildErc20Approve(opts.gateway, opts.srcAddress, swap.tx.to, swap.srcAmount);
  return approval === 'resetThenApprove'
    ? [buildErc20Approve(opts.gateway, opts.srcAddress, swap.tx.to, 0n), approve, swapOp]
    : [approve, swapOp];
}

export interface ThreeRouteTezosXOptions {
  network?: TezosXNetwork; // chain constants (chainId + gateway); default tezosXMainnet
  baseUrl?: string; // 3route API location; defaults to network.apiBaseUrl (override for proxy/hosted)
  apiKey?: string; // HTTP Basic credential (encoded — see ThreeRouteClientOptions.apiKey); omit for a keyless server
  fetch?: FetchLike; // default globalThis.fetch (inject for older Node, a custom agent, or tests)
}

/** Tezos X entry point: holds a configured {@link ThreeRouteClient} + the gateway, and prepares swaps end to end. */
export class ThreeRouteTezosX {
  readonly client: ThreeRouteClient;
  readonly gateway: string;

  constructor(opts: ThreeRouteTezosXOptions = {}) {
    const network = opts.network ?? tezosXMainnet;
    const baseUrl = opts.baseUrl ?? network.apiBaseUrl;
    if (baseUrl === undefined) throw new Error(`${network.name} has no apiBaseUrl — pass baseUrl explicitly`);
    this.client = new ThreeRouteClient({ baseUrl, chainId: network.chainId, apiKey: opts.apiKey, fetch: opts.fetch });
    this.gateway = network.gateway;
  }

  /** The 3route token registry. */
  getTokens(): Promise<ThreeRouteToken[]> {
    return this.client.getTokens();
  }

  /** Quote via 3route and build the signable ops + a {@link SwapDetails} summary. Does not send. */
  async prepareSwap(p: PrepareSwapParams): Promise<{ ops: ParamsWithKind[]; details: SwapDetails }> {
    const { account, src, dst, amount, exactOut = false, slippageBps, approval } = p;
    const alias = michelsonToEvmAlias(account);

    const exactSide = exactOut ? dst : src; // amount is denominated in the exact side
    const swap = await this.client.getSwap({
      src: src.address,
      dst: dst.address,
      amount: toEvm(amount, exactSide.address),
      exactOut,
      from: alias,
      receiver: alias,
      slippagePercent: slippageBps / 100,
    });

    const ops = buildSwapOperation(swap, { gateway: this.gateway, srcAddress: src.address, approval });

    return {
      ops,
      details: {
        src: { token: src, amount: fromEvm(swap.srcAmount, src.address) },
        dst: {
          token: dst,
          expected: fromEvm(swap.dstAmount, dst.address),
          min: fromEvm(swap.dstAmountMin, dst.address),
        },
        exactOut,
        slippageBps,
        router: swap.tx.to,
        recipient: alias,
        forwardsToMichelsonAddress: isXtz(dst.address),
      },
    };
  }
}
