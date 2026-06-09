// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// Standard, well-behaved ERC20.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// USDT-style: approve/transfer/transferFrom return NOTHING (void) AND the approve-race guard
/// (cannot set a non-zero allowance over an existing non-zero one). SafeERC20/forceApprove must handle both.
contract MockNoReturnERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }

    function approve(address s, uint256 a) external {
        require(a == 0 || allowance[msg.sender][s] == 0, "approve-race");
        allowance[msg.sender][s] = a; // no return value
    }
    function transfer(address to, uint256 a) external {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; // no return value
    }
    function transferFrom(address f, address t, uint256 a) external {
        uint256 al = allowance[f][msg.sender];
        require(al >= a, "allowance");
        if (al != type(uint256).max) allowance[f][msg.sender] = al - a;
        balanceOf[f] -= a; balanceOf[t] += a; // no return value
    }
}

/// Deflationary: skims 1% on every transfer (received < sent).
contract MockFeeOnTransfer is ERC20 {
    constructor() ERC20("Fee", "FEE") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// Reentrant: calls back into a target on transfer (ERC777-style hook). Used to prove nonReentrant blocks it.
contract MockReentrantERC20 is ERC20 {
    address public reenterTarget;
    bytes public reenterData;
    bool private fired;
    constructor() ERC20("Re", "RE") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function setReenter(address t, bytes calldata d) external { reenterTarget = t; reenterData = d; }
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (reenterTarget != address(0) && !fired) {
            fired = true;
            (bool ok, ) = reenterTarget.call(reenterData);
            require(ok, "reentry blocked"); // if nonReentrant rejects the re-entry, ok=false -> revert -> outer reverts
        }
    }
}

/// transferFrom returns true but moves nothing -> received == 0 (exercises the "nothing received" guard).
contract MockNullTransfer is ERC20 {
    constructor() ERC20("Null", "NUL") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function transferFrom(address, address, uint256) public pure override returns (bool) { return true; }
}

/// Minimal swap router: pulls `amountIn` of tokenIn from the caller, pays `nativeOut` to `to`.
/// Uses SafeERC20 so it tolerates non-bool tokens (like a real router would). Pre-fund with native.
contract MockRouter {
    using SafeERC20 for IERC20;
    function swap(address tokenIn, uint256 amountIn, uint256 nativeOut, address to) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        (bool ok, ) = payable(to).call{value: nativeOut}("");
        require(ok, "native send");
    }
    // exact-output style: pulls only `pullAmount` (< the approved amount) -> leftover stays on the caller.
    function swapPartial(address tokenIn, uint256 pullAmount, uint256 nativeOut, address to) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), pullAmount);
        (bool ok, ) = payable(to).call{value: nativeOut}("");
        require(ok, "native send");
    }
    receive() external payable {}
}

/// Stand-in for the EVM->Michelson gateway precompile: records the bridged value + recipient; can be made to revert.
contract MockGateway {
    string public lastRecipient;
    uint256 public lastValue;
    uint256 public calls;
    bool public shouldRevert;
    function setRevert(bool v) external { shouldRevert = v; }
    function callMichelson(string calldata dest, string calldata, bytes calldata) external payable {
        require(!shouldRevert, "gateway revert");
        lastRecipient = dest;
        lastValue = msg.value;
        calls += 1;
    }
    receive() external payable {}
}
