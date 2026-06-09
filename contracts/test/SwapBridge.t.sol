// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SwapBridge} from "../src/SwapBridge.sol";
import {MockERC20, MockNoReturnERC20, MockFeeOnTransfer, MockReentrantERC20, MockNullTransfer, MockRouter, MockGateway} from "./Mocks.sol";

contract SwapBridgeTest is Test {
    SwapBridge bridge;
    MockRouter router;
    MockGateway gateway;

    address constant GW = 0xfF00000000000000000000000000000000000007; // EVM->Michelson precompile
    address buyer = makeAddr("buyerAlias"); // the caller (a tz1's EVM alias)
    string recipient = "tz1Pnv2eG1HiCRgqwd7ctRChfWRCcPpm68sb";
    uint256 constant PRICE = 1e16; // 0.01 native (wei)

    event Bridged(address indexed tokenIn, uint256 amountIn, uint256 xtzWei, string recipient);

    function setUp() public {
        bridge = new SwapBridge();
        router = new MockRouter();
        vm.deal(address(router), 100 ether); // router pays native on swap
        vm.etch(GW, address(new MockGateway()).code); // mock the precompile at 0xff..07
        gateway = MockGateway(payable(GW));
    }

    // calldata for MockRouter.swap(tokenIn, amountIn, nativeOut, to = bridge)
    function _swap(address tokenIn, uint256 amountIn, uint256 nativeOut) internal view returns (bytes memory) {
        return abi.encodeCall(MockRouter.swap, (tokenIn, amountIn, nativeOut, address(bridge)));
    }

    // ---------- happy path ----------
    function test_HappyPath_standardToken() public {
        MockERC20 t = new MockERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);

        vm.expectEmit(true, false, false, true, address(bridge));
        emit Bridged(address(t), 100e6, PRICE, recipient);

        vm.prank(buyer);
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));

        assertEq(gateway.lastValue(), PRICE, "bridged value");
        assertEq(gateway.lastRecipient(), recipient, "recipient");
        assertEq(gateway.calls(), 1, "one bridge call");
        assertEq(address(bridge).balance, 0, "no native left on bridge");
        assertEq(t.balanceOf(address(bridge)), 0, "no token left on bridge");
        assertEq(t.allowance(address(bridge), address(router)), 0, "router allowance revoked");
        assertEq(t.balanceOf(address(router)), 100e6, "router received tokenIn");
    }

    // ---------- USDT-style: void returns + approve-race guard ----------
    function test_UsdtStyle_voidReturn_and_approveGuard() public {
        MockNoReturnERC20 t = new MockNoReturnERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6); // void return + guard

        vm.prank(buyer);
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));

        assertEq(gateway.lastValue(), PRICE, "USDT-style bridged ok");
        assertEq(t.allowance(address(bridge), address(router)), 0, "revoked on guard token");
        assertEq(t.balanceOf(address(router)), 100e6, "router pulled USDT-style token");
    }

    // ---------- slippage ----------
    function test_Slippage_revertsWhenBelowMin() public {
        MockERC20 t = new MockERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);

        vm.prank(buyer);
        vm.expectRevert(bytes("slippage"));
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE - 1));
    }

    // ---------- input validation ----------
    function test_BadAmountIn_zero() public {
        MockERC20 t = new MockERC20();
        vm.prank(buyer);
        vm.expectRevert(bytes("bad amountIn"));
        bridge.swapAndBridgePull(address(t), 0, PRICE, recipient, address(router), "");
    }

    function test_BadAmountIn_max() public {
        MockERC20 t = new MockERC20();
        vm.prank(buyer);
        vm.expectRevert(bytes("bad amountIn"));
        bridge.swapAndBridgePull(address(t), type(uint256).max, PRICE, recipient, address(router), "");
    }

    // ---------- swap failure bubbles up ----------
    function test_SwapReverts_bubbles() public {
        MockERC20 t = new MockERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);

        vm.prank(buyer);
        vm.expectRevert(bytes("native send")); // router can't pay 1000 ether (has 100) -> its revert bubbles
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, 1000 ether));
    }

    // ---------- bridge failure -> whole tx reverts atomically ----------
    function test_BridgeReverts_atomicRollback() public {
        gateway.setRevert(true);
        MockERC20 t = new MockERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);
        uint256 before = t.balanceOf(buyer);

        vm.prank(buyer);
        vm.expectRevert(bytes("gateway revert"));
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));

        assertEq(t.balanceOf(buyer), before, "atomic: buyer keeps tokens when bridge fails");
    }

    // ---------- balance-delta on native out: ignore pre-existing balance ----------
    function test_NativeDelta_ignoresPreExistingBalance() public {
        vm.deal(address(bridge), 5 ether); // stray native already on the bridge
        MockERC20 t = new MockERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);

        vm.prank(buyer);
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));

        assertEq(gateway.lastValue(), PRICE, "bridges only the swap delta");
        assertEq(address(bridge).balance, 5 ether, "pre-existing native untouched");
    }

    // ---------- fee-on-transfer: fail-safe (no loss) ----------
    function test_FeeOnTransfer_failsSafe() public {
        MockFeeOnTransfer t = new MockFeeOnTransfer();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);
        uint256 before = t.balanceOf(buyer);

        // bridge receives 99e6 (1% fee) -> approves 99e6 -> router tries to pull amountIn 100e6 -> reverts -> atomic
        vm.prank(buyer);
        vm.expectRevert();
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));

        assertEq(t.balanceOf(buyer), before, "FoT fail-safe: buyer keeps tokens");
    }

    // ---------- exact-output / partial fill: unused input refunded to the caller ----------
    function test_ExactOut_refundsLeftoverToken() public {
        MockERC20 t = new MockERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);
        // router pulls only 60e6 (exact-output style) -> 40e6 must be refunded to the buyer, nothing stuck
        bytes memory data = abi.encodeCall(MockRouter.swapPartial, (address(t), 60e6, PRICE, address(bridge)));

        vm.prank(buyer);
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), data);

        assertEq(t.balanceOf(buyer), 940e6, "buyer refunded the 40e6 leftover"); // 1000 - 100 pulled + 40 back
        assertEq(t.balanceOf(address(bridge)), 0, "no token stuck on bridge");
        assertEq(t.balanceOf(address(router)), 60e6, "router pulled only 60e6");
        assertEq(gateway.lastValue(), PRICE, "bridged ok");
    }

    // ---------- token that moves nothing -> "nothing received" guard ----------
    function test_NothingReceived_reverts() public {
        MockNullTransfer t = new MockNullTransfer();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);

        vm.prank(buyer);
        vm.expectRevert(bytes("nothing received"));
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));
    }

    // ---------- reentrancy blocked ----------
    function test_Reentrancy_blocked() public {
        MockReentrantERC20 t = new MockReentrantERC20();
        t.mint(buyer, 1000e6);
        vm.prank(buyer);
        t.approve(address(bridge), 100e6);
        // on transfer, the token re-enters swapAndBridgePull -> nonReentrant must reject it
        bytes memory reentry =
            abi.encodeCall(SwapBridge.swapAndBridgePull, (address(t), 1, PRICE, recipient, address(router), ""));
        t.setReenter(address(bridge), reentry);

        vm.prank(buyer);
        vm.expectRevert(); // re-entry rejected -> mock's require fails -> outer reverts
        bridge.swapAndBridgePull(address(t), 100e6, PRICE, recipient, address(router), _swap(address(t), 100e6, PRICE));
    }

    // ---------- fuzz: happy path across amounts ----------
    function testFuzz_HappyPath(uint96 raw) public {
        uint256 amountIn = bound(uint256(raw), 1, 1e12);
        MockERC20 t = new MockERC20();
        t.mint(buyer, amountIn);
        vm.prank(buyer);
        t.approve(address(bridge), amountIn);

        vm.prank(buyer);
        bridge.swapAndBridgePull(address(t), amountIn, PRICE, recipient, address(router), _swap(address(t), amountIn, PRICE));

        assertEq(gateway.lastValue(), PRICE);
        assertEq(t.balanceOf(address(router)), amountIn, "router pulled exactly amountIn");
        assertEq(t.allowance(address(bridge), address(router)), 0, "allowance revoked");
    }
}
