// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PropertyCrowdfund
 * @notice Escrow-based crowdfunding for real-estate equity with USDC.
 */
contract PropertyCrowdfund is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint16 public constant MAX_PLATFORM_FEE_BPS = 2_000;

    enum CampaignState {
        ACTIVE,
        SUCCESS,
        FAILED,
        WITHDRAWN
    }

    IERC20 public immutable usdcToken;
    address public equityToken;
    uint256 public immutable targetAmountUSDC;
    uint256 public immutable startTime;
    uint256 public immutable endTime;
    uint256 public immutable totalEquityTokensForSale;
    uint16 public platformFeeBps;
    address public platformFeeRecipient;
    string public propertyId;

    uint256 private _raisedAmountUSDC;
    CampaignState private _state;

    mapping(address => uint256) private _contributions;
    mapping(address => uint256) private _claimedTokens;

    event Invested(address indexed investor, uint256 amountUSDC);
    event Finalized(CampaignState state, uint256 raisedAmountUSDC);
    event Withdrawn(address indexed to, uint256 amountUSDC);
    event Refunded(address indexed investor, uint256 amountUSDC);
    event TokensClaimed(address indexed investor, uint256 amountEquityTokens);
    event EquityTokenSet(address indexed equityToken);
    event PlatformFeeUpdated(uint16 feeBps, address indexed recipient);
    event PlatformFeePaid(address indexed recipient, uint256 amountUSDC);

    /**
     * @param admin Campaign owner with withdrawal rights.
     * @param usdcTokenAddress Address of USDC token contract.
     * @param targetAmountUSDCAmount Target raise in USDC smallest units (6 decimals).
     * @param startTimestamp Campaign start timestamp.
     * @param endTimestamp Campaign end timestamp.
     * @param totalEquityTokens Total equity tokens allocated for sale (18 decimals).
     * @param propertyIdValue Off-chain identifier for the property.
     */
    constructor(
        address admin,
        address usdcTokenAddress,
        uint256 targetAmountUSDCAmount,
        uint256 startTimestamp,
        uint256 endTimestamp,
        uint256 totalEquityTokens,
        string memory propertyIdValue
    ) Ownable(admin) {
        require(admin != address(0), "Admin required");
        require(usdcTokenAddress != address(0), "USDC required");
        require(targetAmountUSDCAmount > 0, "Target must be > 0");
        require(totalEquityTokens > 0, "Equity tokens required");
        require(startTimestamp < endTimestamp, "Invalid time range");

        usdcToken = IERC20(usdcTokenAddress);
        targetAmountUSDC = targetAmountUSDCAmount;
        startTime = startTimestamp;
        endTime = endTimestamp;
        totalEquityTokensForSale = totalEquityTokens;
        propertyId = propertyIdValue;
        platformFeeRecipient = admin;
        _state = CampaignState.ACTIVE;
    }

    /// @notice Current campaign state.
    function state() external view returns (CampaignState) {
        return _state;
    }

    /// @notice Total USDC raised.
    function raisedAmountUSDC() external view returns (uint256) {
        return _raisedAmountUSDC;
    }

    /// @notice Contribution amount for an investor.
    function contributionOf(address investor) external view returns (uint256) {
        return _contributions[investor];
    }

    /// @notice Claimable equity tokens for an investor.
    function claimableTokens(address investor) public view returns (uint256) {
        if (
            _state != CampaignState.SUCCESS && _state != CampaignState.WITHDRAWN
        ) {
            return 0;
        }
        if (equityToken == address(0) || _raisedAmountUSDC == 0) {
            return 0;
        }
        uint256 entitlement =
            (_contributions[investor] * totalEquityTokensForSale) /
                _raisedAmountUSDC;
        uint256 alreadyClaimed = _claimedTokens[investor];
        if (entitlement <= alreadyClaimed) {
            return 0;
        }
        return entitlement - alreadyClaimed;
    }

    /// @notice Claimable refund for an investor.
    function claimableRefund(address investor) external view returns (uint256) {
        if (_state != CampaignState.FAILED) {
            return 0;
        }
        return _contributions[investor];
    }

    /**
     * @notice Invest USDC into the campaign.
     * @param amountUSDC Amount of USDC in smallest units (6 decimals).
     */
    function invest(uint256 amountUSDC) external nonReentrant {
        require(_state == CampaignState.ACTIVE, "Campaign not active");
        require(block.timestamp >= startTime, "NOT_STARTED");
        require(block.timestamp < endTime, "Campaign ended");
        require(amountUSDC > 0, "Amount must be > 0");

        usdcToken.safeTransferFrom(msg.sender, address(this), amountUSDC);

        _contributions[msg.sender] += amountUSDC;
        _raisedAmountUSDC += amountUSDC;

        emit Invested(msg.sender, amountUSDC);
    }

    /**
     * @notice Finalize campaign after end time or upon reaching target.
     */
    function finalizeCampaign() external {
        require(_state == CampaignState.ACTIVE, "Campaign not active");
        require(
            block.timestamp >= endTime ||
                _raisedAmountUSDC >= targetAmountUSDC,
            "Cannot finalize yet"
        );

        if (_raisedAmountUSDC >= targetAmountUSDC) {
            _state = CampaignState.SUCCESS;
        } else {
            _state = CampaignState.FAILED;
        }

        emit Finalized(_state, _raisedAmountUSDC);
    }

    /**
     * @notice Configure platform fee paid during successful withdraw.
     * @param feeBps Fee in basis points, where 10000 = 100%.
     * @param recipient Address that receives platform fees.
     */
    function setPlatformFee(
        uint16 feeBps,
        address recipient
    ) external onlyOwner {
        require(feeBps <= MAX_PLATFORM_FEE_BPS, "Fee too high");
        if (feeBps > 0) {
            require(recipient != address(0), "Invalid fee recipient");
        }

        platformFeeBps = feeBps;
        platformFeeRecipient = recipient;
        emit PlatformFeeUpdated(feeBps, recipient);
    }

    /**
     * @notice Withdraw raised USDC after success.
     * @param to Recipient of funds.
     */
    function withdrawFunds(address to) external onlyOwner nonReentrant {
        require(_state == CampaignState.SUCCESS, "Campaign not successful");
        require(to != address(0), "Invalid recipient");

        _state = CampaignState.WITHDRAWN;

        uint256 balance = usdcToken.balanceOf(address(this));
        uint256 feeAmount = 0;
        if (platformFeeBps > 0) {
            require(
                platformFeeRecipient != address(0),
                "Platform fee recipient not set"
            );
            feeAmount = (balance * platformFeeBps) / 10_000;
            if (feeAmount > 0) {
                usdcToken.safeTransfer(platformFeeRecipient, feeAmount);
                emit PlatformFeePaid(platformFeeRecipient, feeAmount);
            }
        }

        uint256 ownerAmount = balance - feeAmount;
        usdcToken.safeTransfer(to, ownerAmount);

        emit Withdrawn(to, ownerAmount);
    }

    /**
     * @notice Claim refund after campaign failure.
     */
    function claimRefund() external nonReentrant {
        require(_state == CampaignState.FAILED, "Campaign not failed");
        uint256 amount = _contributions[msg.sender];
        require(amount > 0, "No refund available");

        _contributions[msg.sender] = 0;
        usdcToken.safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, amount);
    }

    /**
     * @notice Set equity token once; tokens must be transferred to this contract separately.
     * @param equityTokenAddress Address of the equity ERC20 token.
     */
    function setEquityToken(address equityTokenAddress) external onlyOwner {
        require(equityTokenAddress != address(0), "Invalid equity token");
        require(equityToken == address(0), "Equity token already set");
        require(
            _state == CampaignState.SUCCESS || _state == CampaignState.WITHDRAWN,
            "Campaign not successful"
        );
        require(
            IERC20(equityTokenAddress).balanceOf(address(this)) >=
                totalEquityTokensForSale,
            "INSUFFICIENT_EQUITY_BALANCE"
        );

        equityToken = equityTokenAddress;
        emit EquityTokenSet(equityTokenAddress);
    }

    /**
     * @notice Claim equity tokens after success.
     */
    function claimTokens() external nonReentrant {
        require(
            _state == CampaignState.SUCCESS ||
                _state == CampaignState.WITHDRAWN,
            "Campaign not successful"
        );
        require(equityToken != address(0), "Equity token not set");

        uint256 amount = claimableTokens(msg.sender);
        require(amount > 0, "No tokens claimable");
        require(
            IERC20(equityToken).balanceOf(address(this)) >= amount,
            "INSUFFICIENT_EQUITY_BALANCE"
        );

        _claimedTokens[msg.sender] += amount;
        IERC20(equityToken).safeTransfer(msg.sender, amount);

        emit TokensClaimed(msg.sender, amount);
    }
}
