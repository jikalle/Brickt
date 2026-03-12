// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title BricktToken
 * @notice Capped ERC20 token for the Brickt platform.
 * @dev Owner can mint up to the immutable cap. Intended for platform-token experiments on Base.
 */
contract BricktToken is ERC20, Ownable {
    uint8 private immutable _customDecimals;
    uint256 public immutable cap;

    event Minted(address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        uint256 cap_,
        address initialOwner_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        require(initialOwner_ != address(0), "Invalid owner");
        require(cap_ > 0, "Cap must be > 0");
        require(initialSupply_ <= cap_, "Initial supply exceeds cap");

        _customDecimals = decimals_;
        cap = cap_;

        if (initialSupply_ > 0) {
            _mint(initialOwner_, initialSupply_);
            emit Minted(initialOwner_, initialSupply_);
        }
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(totalSupply() + amount <= cap, "Cap exceeded");
        _mint(to, amount);
        emit Minted(to, amount);
    }
}
