/**
 * Max slippage the whole SDK accepts, in basis points — mirrors the server's 0..50% contract.
 * Single source for both the swap-query guard and the targetForMinOut math guard.
 */
export const MAX_SLIPPAGE_BPS = 5000;

/** Throw on a slippageBps that isn't an integer within 0..MAX_SLIPPAGE_BPS. Shared fail-fast guard. */
export const assertSlippageBps = (bps: number): void => {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_SLIPPAGE_BPS)
    throw new RangeError(`slippageBps must be an integer in 0..${MAX_SLIPPAGE_BPS} (0%..50%), got: ${bps}`);
};

/**
 * Exact-out amount to request so the swap still clears a hard minimum after slippage.
 * The on-chain floor is target × (1−slip), so to keep floor ≥ `minOut` we request ceil(minOut / (1−slip)).
 * E.g. need 4000 mutez at 2% slip → request 4082 (floor ≈ 4000.4 ≥ 4000).
 * Use when the output must cover a fixed cost (e.g. an NFT price).
 */
export const targetForMinOut = (minOut: bigint, slippageBps: number): bigint => {
  assertSlippageBps(slippageBps); // 0..5000 keeps the denominator (1 − slip) positive — no divide-by-zero
  const denom = BigInt(10_000 - slippageBps); // (1 - slip), in bps
  return (minOut * 10_000n + denom - 1n) / denom; // ceil(minOut / (1 - slip))
};
