import type { ParamsWithKind } from '@taquito/taquito';
import { michelsonToEvmAlias } from './address.js';
import type { EvmAddress, MichelsonAddress } from './primitives.js';
import { isXtz, toEvm, fromEvm } from './xtz.js';
import { ThreeRouteClient } from './threeroute.js';
import type { ThreeRouteToken } from './threeroute.js';
import type { FetchLike } from './http.js';
import { buildSwapOperation } from './operations/index.js';
import type { ApprovalMode } from './approval.js';
import { tezosXMainnet } from './networks.js';
import type { TezosXNetwork } from './networks.js';

/**
 * Exact-out amount to request so the swap still clears a hard minimum after slippage.
 * The on-chain floor is target × (1−slip), so to keep floor ≥ `minOut` we request ceil(minOut / (1−slip)).
 * E.g. need 4000 mutez at 2% slip → request 4082 (floor ≈ 4000.4 ≥ 4000).
 * Use when the output must cover a fixed cost (e.g. an NFT price).
 */
export const targetForMinOut = (minOut: bigint, slippageBps: number): bigint => {
  const denom = BigInt(10_000 - slippageBps); // (1 - slip), in bps
  return (minOut * 10_000n + denom - 1n) / denom; // ceil(minOut / (1 - slip))
};

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

export interface ThreeRouteTezosXOptions {
  baseUrl: string; // 3route API location
  network?: TezosXNetwork; // chain constants (chainId + gateway); default tezosXMainnet
  apiKey?: string; // HTTP Basic credential (encoded — see ThreeRouteClientOptions.apiKey); omit for a keyless server
  fetch?: FetchLike; // default globalThis.fetch (inject for older Node, a custom agent, or tests)
}

export class ThreeRouteTezosX {
  readonly client: ThreeRouteClient;
  readonly gateway: string;

  constructor(opts: ThreeRouteTezosXOptions) {
    const network = opts.network ?? tezosXMainnet;
    this.client = new ThreeRouteClient({ 
      baseUrl: opts.baseUrl, 
      chainId: network.chainId, 
      apiKey: opts.apiKey, 
      fetch: opts.fetch 
    });
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

    const ops = buildSwapOperation({ swap, gateway: this.gateway, srcAddress: src.address, approval });

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
