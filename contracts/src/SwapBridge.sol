// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SwapBridge — Tezos-driven swap + bridge helper
/// @notice Invoked via the Michelson->EVM gateway `call_evm` (msg.sender = the calling tz1's EVM alias).
///         Pulls an arbitrary ERC20 from the caller, swaps it -> native XTZ via an injected route, then
///         BRIDGES the XTZ back to a Michelson recipient through the payable EVM->Michelson precompile.
///         Route-agnostic: the swap is whatever `swapCalldata` encodes for `router`.
/// @dev Hardened for arbitrary ERC20s: SafeERC20 (non-bool tokens), forceApprove (USDT approve-race),
///      balance-delta accounting (fee-on-transfer fail-safe), nonReentrant + checks-effects-interactions
///      (native bridge is the last external call), exact approval revoked after the swap (no standing allowance).
///      Holds no balance/allowance between transactions. NOT supported: rebasing / ERC777-hook tokens
///      (gate those via the SDK token registry).
/// @dev SECURITY MODEL — `router` and `swapCalldata` are UNTRUSTED and intentionally NOT validated. Safety comes
///      from the OUTPUT invariant, not the input: the tx only succeeds if >= `minXtzOut` NATIVE lands here and is
///      bridged to `michelsonRecipient`; otherwise it reverts atomically. So any calldata is either a fair swap
///      (caller gets their XTZ) or a no-op revert (funds intact) — a wrong `tokenOut`, a redirect, or a hostile
///      router cannot steal (the input pull rolls back). Unused input is refunded to the caller.
///      OWNERLESS & no rescue: tokens/native sent here OUTSIDE this flow (a direct transfer, or a stray secondary
///      swap output) are UNRECOVERABLE — by design, to avoid a privileged sweep. The normal flow strands nothing.
contract SwapBridge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant GW = 0xfF00000000000000000000000000000000000007; // EVM->Michelson precompile (payable)

    event Bridged(address indexed tokenIn, uint256 amountIn, uint256 xtzWei, string recipient);

    /// @param tokenIn            ERC20 to pull from the caller (its EVM alias).
    /// @param amountIn           amount to pull (the alias must have approved this contract for >= amountIn).
    /// @param minXtzOut          minimum native XTZ (wei) the swap must yield — slippage floor.
    /// @param michelsonRecipient Michelson address (tz1/KT1) to receive the bridged XTZ.
    /// @param router             swap router to call.
    /// @param swapCalldata       route-agnostic calldata producing native XTZ to this contract.
    function swapAndBridgePull(
        address tokenIn,
        uint256 amountIn,
        uint256 minXtzOut,
        string calldata michelsonRecipient,
        address router,
        bytes calldata swapCalldata
    ) external nonReentrant {
        require(amountIn > 0 && amountIn != type(uint256).max, "bad amountIn");
        require(router != address(0), "bad router");

        // Pull with balance-delta: trust what actually arrived, not the requested amount (fee-on-transfer fail-safe).
        uint256 balBefore = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn); // SafeERC20: non-bool tokens (USDT)
        uint256 received = IERC20(tokenIn).balanceOf(address(this)) - balBefore;
        require(received > 0, "nothing received");

        // Approve the router for exactly what we hold (USDT-safe), run the swap, then revoke the allowance.
        IERC20(tokenIn).forceApprove(router, received);
        uint256 xtzBefore = address(this).balance;
        // run the (untrusted, route-agnostic) swap; NO native is sent here (value 0).
        {
            (bool ok, bytes memory ret) = router.call(swapCalldata);
            _bubble(ok, ret);
        }
        IERC20(tokenIn).forceApprove(router, 0); // no standing allowance left to the router

        // Refund any UNUSED input token to the caller (exact-output / partial-fill change; no-op for exact-in,
        // where the swap consumes all of `received`). `balBefore` excludes stray pre-existing balances.
        uint256 leftover = IERC20(tokenIn).balanceOf(address(this)) - balBefore;
        if (leftover > 0) IERC20(tokenIn).safeTransfer(msg.sender, leftover);

        uint256 xtz = address(this).balance - xtzBefore; // native delta produced by the swap, not the full balance
        require(xtz >= minXtzOut, "slippage");

        // evm-xtz -> tez-xtz: push the native XTZ to the Michelson recipient via the FIXED gateway precompile
        // (value-bearing call, CONSTANT destination). LAST external interaction (CEI).
        {
            (bool ok, bytes memory ret) =
                GW.call{value: xtz}(abi.encodeWithSignature("callMichelson(string,string,bytes)", michelsonRecipient, "default", hex"030b"));
            _bubble(ok, ret);
        }
        emit Bridged(tokenIn, amountIn, xtz, michelsonRecipient);
    }

    /// @dev Revert with the failed call's reason verbatim.
    function _bubble(bool ok, bytes memory ret) private pure {
        if (!ok) {
            assembly ("memory-safe") { revert(add(ret, 0x20), mload(ret)) }
        }
    }

    receive() external payable {}
}
