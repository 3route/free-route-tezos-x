// swap.ts — the high-level facade. `prepareSwap` turns a swap request (any of ERC20/XTZ -> ERC20/XTZ, exact-in
// or exact-out) into ready-to-sign Tezos ops + a human-readable SwapDetails, all called from the Michelson side.
// It is THIN: it does not size exact-out targets (that policy lives in the consumer — see targetForMinOut) and
// it does not send. The only cleverness is the unit boundary (XTZ is mutez to the consumer, wei to the EVM API)
// and choosing approve-vs-native-value by the input token.
import type { ParamsWithKind } from '@taquito/taquito';
import { michelsonToAlias } from './address.js';
import type { EvmAddress, Hex, MichelsonAddress } from './address.js';
import { xtzMutezToWei, xtzWeiToMutez } from './units.js';
import { ThreeRouteClient } from './threeroute.js';
import type { Swap, ThreeRouteToken } from './threeroute.js';
import { SWAP_SIG, buildCallEvm, buildErc20Approve } from './operations.js';
import type { ApprovalMode } from './approval.js';
import { tezosXMainnet } from './networks.js';
import type { TezosXNetwork } from './networks.js';

// The native-XTZ marker, as it appears in the 3route token registry (getTokens). One source of truth: XTZ is
// recognised by this address everywhere. decimals = 6 is the Michelson/mutez view the consumer works in; the
// EVM side is 18-dec wei, bridged internally — so the registry's 18 is irrelevant here.
export const XTZ_ADDRESS: EvmAddress = '0x0000000000000000000000000000000000000000';
export const XTZ: ThreeRouteToken = { address: XTZ_ADDRESS, symbol: 'XTZ', name: 'Tez', decimals: 6 };

export const isXtz = (address: EvmAddress): boolean => address.toLowerCase() === XTZ_ADDRESS;

// Unit boundary. XTZ amounts are mutez (Michelson, consumer-facing) but the EVM API speaks wei; ERC20 amounts
// are identical on both sides. toEvm: consumer -> API; fromEvm: API -> consumer.
export const toEvm = (amount: bigint, address: EvmAddress): bigint => (isXtz(address) ? xtzMutezToWei(amount) : amount);
export const fromEvm = (amount: bigint, address: EvmAddress): bigint => (isXtz(address) ? xtzWeiToMutez(amount) : amount);

// Optional consumer helper: size an exact-out target so the server's floor (target × (1−slip)) covers `minOut`.
// NOT used inside prepareSwap — sizing is the consumer's policy (e.g. "the swap floor must cover the NFT price").
export const targetForMinOut = (minOut: bigint, slippageBps: number): bigint =>
  (minOut * 10000n + BigInt(9999 - slippageBps)) / BigInt(10000 - slippageBps); // ceil(minOut / (1 - slip))

export interface SwapDetails {
  src: { token: ThreeRouteToken; amount: bigint }; // amount paid (strict input when exact-in)
  dst: { token: ThreeRouteToken; expected: bigint; min: bigint }; // expected output and guaranteed floor
  exactOut: boolean;
  slippageBps: number;
  router: EvmAddress;
  recipient: EvmAddress; // the alias — where the output is received
  forwardsToMichelsonAddress: boolean; // true ⇔ dst is XTZ (output auto-forwards alias -> Michelson address)
}

export interface PrepareSwapParams {
  account: MichelsonAddress; // signer's Michelson address; the alias is derived from it
  src: ThreeRouteToken; // input token (XTZ for native)
  dst: ThreeRouteToken; // output token (XTZ for native)
  amount: bigint; // natural units of the exact side (mutez for XTZ, base units for ERC20) — final, not re-sized
  exactOut?: boolean; // false = exact-input (default); true = exact-output (amount is the target output)
  slippageBps: number; // forwarded to the server, which sets the on-chain minimum output
  approval?: ApprovalMode; // ERC20 allowance handling; default 'resetThenApprove' (safest). See selectApproval.
}

export interface BuildSwapOperationOptions {
  gateway: MichelsonAddress; // Michelson->EVM gateway (call_evm)
  srcAddress: EvmAddress; // input token address — decides native-value (XTZ) vs approve (ERC20)
  approval?: ApprovalMode; // default 'resetThenApprove'
}

// Pure: turn a 3route /swap response into ready-to-sign Tezos ops, no network. ERC20 input -> approve(s) + swap
// per `approval`; native-XTZ input -> a single swap op carrying the XTZ as msg.value. Quoting/sizing upstream.
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
}

export class ThreeRouteTezosX {
  readonly client: ThreeRouteClient;
  readonly gateway: string;

  constructor(opts: ThreeRouteTezosXOptions = {}) {
    const network = opts.network ?? tezosXMainnet;
    const baseUrl = opts.baseUrl ?? network.apiBaseUrl;
    if (baseUrl === undefined) throw new Error(`${network.name} has no apiBaseUrl — pass baseUrl explicitly`);
    this.client = new ThreeRouteClient({ baseUrl, chainId: network.chainId, apiKey: opts.apiKey });
    this.gateway = network.gateway;
  }

  getTokens(): Promise<ThreeRouteToken[]> {
    return this.client.getTokens();
  }

  async prepareSwap(p: PrepareSwapParams): Promise<{ ops: ParamsWithKind[]; details: SwapDetails }> {
    const { account, src, dst, amount, exactOut = false, slippageBps, approval } = p;
    const alias = michelsonToAlias(account);

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

    // build the ops from the swap response (pure) — native value vs approve(s) is decided by the input token.
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
