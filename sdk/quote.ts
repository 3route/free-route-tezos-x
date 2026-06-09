// Swap quote source: rust-3route exact-out (/swap is_exact_output=true) — computes the required input
// amount + route + ready calldata for a target XTZ output, parsed into the Quote the SDK consumes:
//   Quote = { tokenIn, amountIn, minXtzOut, router, swapCalldata }.
import { PREVIEWNET } from './config.js';
import { mutezToWei } from './translation.js';
import { getSwap, swapResponseToQuote, NATIVE_XTZ } from './threeroute.js';
import type { ThreeRouteClient } from './threeroute.js';
import type { Quote, NetworkConfig, EvmAddress } from './types.js';

// Exact-out quote from rust-3route: ask for a target XTZ output, get back the required input amount +
// ready swap calldata against the real router, parsed into the Quote the SDK consumes. Needs the server
// to serve `client.chainId` with a router deployed.
export async function quoteExactOut(params: {
  cfg?: NetworkConfig;
  client: ThreeRouteClient;
  priceMutez: bigint | number;
  tokenIn: EvmAddress; // pay token (any ERC20 the server can route to native XTZ)
  slippage?: number; // percent, default 1
}): Promise<Quote> {
  const cfg = params.cfg ?? PREVIEWNET;
  const tokenIn = params.tokenIn;
  // exact-out target = desired XTZ in wei; this is also our hard on-contract floor (minXtzOut).
  // NOTE: the server's in-calldata amountOutMin is `target × (1 - slippage)`, while SwapBridge enforces
  // the full `minXtzOut = target`. Expected output ≈ target, so the happy path clears; adverse slippage
  // reverts atomically (correct — can't afford the NFT). For a margin instead of reverts, inflate the
  // target here (target × (1 + ε)).
  const minXtzOut = mutezToWei(params.priceMutez);
  const resp = await getSwap(params.client, {
    src: tokenIn,
    dst: NATIVE_XTZ, // native XTZ output
    amount: minXtzOut, // exact-out: the output we want
    from: cfg.swapBridge, // the SwapBridge calls the router (tx.from)
    receiver: cfg.swapBridge, // native XTZ must land on the SwapBridge to be bridged on
    slippage: params.slippage ?? 1,
    isExactOutput: true,
  });
  return swapResponseToQuote(resp, { tokenIn, minXtzOut });
}
