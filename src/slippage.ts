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
