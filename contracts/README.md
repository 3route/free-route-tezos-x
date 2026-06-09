# SwapBridge contracts

Self-contained Foundry project for the on-chain side of the Tezos-driven swap+bridge SDK.

**SwapBridge** (`src/SwapBridge.sol`): invoked via the Michelson→EVM `call_evm` gateway (msg.sender = the calling
tz1's EVM alias). Pulls an arbitrary ERC20 from the caller → swaps it to native XTZ via an injected 3route route →
bridges the XTZ to a Michelson recipient through the payable EVM→Michelson precompile. Route-agnostic; hardened for
any-ERC20 (OZ SafeERC20, forceApprove+revoke, balance-delta, nonReentrant/CEI, slippage floor, tokenIn refund).
Security = the OUTPUT invariant (≥ minXtzOut native bridged or atomic revert); **ownerless, no rescue**.

## Layout
- `src/SwapBridge.sol` — the contract.
- `test/` — Foundry tests (`SwapBridge.t.sol`, `Mocks.sol`) — 13 tests, SwapBridge 100% coverage.
- `lib/forge-std` — Foundry std (git clone).
- `deploy-swapbridge.ts` — compile (solc + OZ) + deploy to Tezos X previewnet.

## Use
```bash
npm install        # @openzeppelin/contracts + ethers (deploy); forge-std lives in lib/
npm test           # forge test
npm run coverage   # forge coverage --report summary
npm run deploy     # tsx deploy-swapbridge.ts — needs EVM_PK in ../.env + system solc; writes TD_SWAPBRIDGE2
```

Notes: `foundry.toml` pins **system solc** (`/Users/maxima-net/.local/bin/solc`) because forge's 0.8.35 download has
a checksum mismatch; OZ resolved from `node_modules` via remapping. Deployed on previewnet:
`0x26181Fb297472a6a9fdAf9e5Ed9FFd75821d91a4`. Static-audited (Slither + Aderyn) — 0 actionable.
