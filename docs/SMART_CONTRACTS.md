# Smart Contracts Documentation

## Overview

Brickt uses three main smart contracts to enable Base-focused real estate crowdfunding:

1. **PropertyToken**: ERC20 token representing fractional property ownership
2. **PropertyCrowdfund**: Manages crowdfunding campaigns with multi-token support
3. **ChainRegistry**: Tracks supported chains and tokens

## Contracts

### PropertyToken.sol

An ERC20 token representing shares in a specific property.

**Features:**
- Standard ERC20 functionality
- Property metadata storage
- Owner-controlled minting
- Property value tracking

**Constructor Parameters:**
```solidity
constructor(
    string memory name,        // Token name (e.g., "Downtown Apartment Shares")
    string memory symbol,      // Token symbol (e.g., "DAS")
    string memory propertyId,  // Unique property identifier
    uint256 totalValue,        // Total property value in USD (18 decimals)
    uint256 initialSupply      // Initial token supply
)
```

**Key Functions:**

#### `propertyId() → string`
Returns the unique identifier of the property.

#### `totalValue() → uint256`
Returns the total value of the property.

#### `updatePropertyInfo(string newPropertyId, uint256 newTotalValue)`
Updates property metadata. Only callable by owner.

**Events:**
```solidity
event PropertyInfoUpdated(string propertyId, uint256 totalValue);
```

---

### PropertyCrowdfund.sol

Manages crowdfunding campaigns for properties with support for multiple payment tokens.

**Features:**
- Multi-token payment support
- Deadline-based campaigns
- Investment tracking
- Campaign finalization

**Key Structures:**

```solidity
struct Campaign {
    address propertyToken;      // Property token contract
    uint256 fundingGoal;        // Target funding amount
    uint256 currentFunding;     // Current funding amount
    uint256 deadline;           // Campaign end timestamp
    bool isActive;              // Campaign active status
    address[] acceptedTokens;   // List of accepted payment tokens
}
```

**Key Functions:**

#### `createCampaign()`
```solidity
function createCampaign(
    address propertyToken,
    uint256 fundingGoal,
    uint256 duration,
    address[] calldata acceptedTokens
) external onlyOwner returns (uint256)
```
Creates a new crowdfunding campaign. Returns campaign ID.

**Requirements:**
- Only owner can call
- Property token must be valid
- Funding goal must be > 0
- At least one accepted token

**Example:**
```javascript
const tx = await crowdfund.createCampaign(
  propertyTokenAddress,
  ethers.parseEther("500000"), // 500k funding goal
  30 * 24 * 60 * 60, // 30 days
  [usdcAddress, usdtAddress, ethAddress]
);
```

#### `invest()`
```solidity
function invest(
    uint256 campaignId,
    address token,
    uint256 amount
) external nonReentrant
```
Make an investment in a campaign.

**Requirements:**
- Campaign must be active
- Before deadline
- Token must be accepted
- Amount must be > 0
- User must approve token transfer first

**Example:**
```javascript
// Approve token first
await usdc.approve(crowdfundAddress, amount);

// Make investment
await crowdfund.invest(campaignId, usdcAddress, amount);
```

#### `finalizeCampaign()`
```solidity
function finalizeCampaign(uint256 campaignId) external onlyOwner
```
Finalizes a campaign after deadline or when goal is reached.

**Requirements:**
- Only owner can call
- Campaign must be active
- Deadline reached OR funding goal met

#### `getCampaignTokens()`
```solidity
function getCampaignTokens(uint256 campaignId) 
    external 
    view 
    returns (address[] memory)
```
Returns list of accepted tokens for a campaign.

**Events:**
```solidity
event CampaignCreated(
    uint256 indexed campaignId,
    address indexed propertyToken,
    uint256 fundingGoal,
    uint256 deadline
);

event InvestmentMade(
    uint256 indexed campaignId,
    address indexed investor,
    address indexed token,
    uint256 amount
);

event CampaignFinalized(
    uint256 indexed campaignId,
    uint256 totalFunding
);
```

---

### ChainRegistry.sol

Registry for tracking supported chains and tokens across the ecosystem.

**Features:**
- Chain registration
- Token registration per chain
- Support status management

**Key Structures:**

```solidity
struct ChainInfo {
    uint256 chainId;
    string name;
    bool isSupported;
}

struct TokenInfo {
    address tokenAddress;
    string symbol;
    uint256 chainId;
    bool isSupported;
}
```

**Key Functions:**

#### `addChain()`
```solidity
function addChain(uint256 chainId, string calldata name) external onlyOwner
```
Adds a new supported chain.

#### `addToken()`
```solidity
function addToken(
    uint256 chainId,
    address tokenAddress,
    string calldata symbol
) external onlyOwner
```
Adds a supported token for a specific chain.

#### `isChainSupported()`
```solidity
function isChainSupported(uint256 chainId) external view returns (bool)
```
Check if a chain is supported.

#### `isTokenSupported()`
```solidity
function isTokenSupported(
    uint256 chainId,
    address tokenAddress
) external view returns (bool)
```
Check if a token is supported on a specific chain.

**Events:**
```solidity
event ChainAdded(uint256 indexed chainId, string name);
event ChainRemoved(uint256 indexed chainId);
event TokenAdded(uint256 indexed chainId, address indexed tokenAddress, string symbol);
event TokenRemoved(uint256 indexed chainId, address indexed tokenAddress);
```

---

## Deployment

### Network Addresses

After deployment, contract addresses are:

**Ethereum Mainnet:**
- PropertyToken: `0x...` (deployed per property)
- PropertyCrowdfund: `0x...`
- ChainRegistry: `0x...`

**Base Network:**
- PropertyToken: `0x...` (deployed per property)
- PropertyCrowdfund: `0x...`
- ChainRegistry: `0x...`

**Canton Network:**
- PropertyToken: `0x...` (deployed per property)
- PropertyCrowdfund: `0x...`
- ChainRegistry: `0x...`

### Deploy Scripts

```bash
# Deploy to Ethereum
cd packages/contracts
pnpm deploy:ethereum

# Deploy to Base
pnpm deploy:base

# Deploy to Canton
pnpm deploy:canton
```

---

## Usage Examples

### Creating a Property Campaign

```javascript
import { ethers } from 'ethers';

// Deploy PropertyToken
const PropertyToken = await ethers.getContractFactory('PropertyToken');
const propertyToken = await PropertyToken.deploy(
  'Luxury Apartment Tokens',
  'LAT',
  'property-123',
  ethers.parseEther('1000000'), // $1M value
  ethers.parseEther('100000')   // 100k tokens
);

// Create campaign
const PropertyCrowdfund = await ethers.getContractAt(
  'PropertyCrowdfund',
  crowdfundAddress
);

const tx = await PropertyCrowdfund.createCampaign(
  await propertyToken.getAddress(),
  ethers.parseEther('500000'), // $500k goal
  30 * 24 * 60 * 60,          // 30 days
  [usdcAddress, usdtAddress]  // Accept USDC and USDT
);

const receipt = await tx.wait();
const campaignId = receipt.events[0].args.campaignId;
```

### Making an Investment

```javascript
// User approves USDC
const USDC = await ethers.getContractAt('IERC20', usdcAddress);
await USDC.approve(crowdfundAddress, investmentAmount);

// User invests
await PropertyCrowdfund.invest(
  campaignId,
  usdcAddress,
  investmentAmount
);
```

### Listening to Events

```javascript
// Listen for new investments
PropertyCrowdfund.on('InvestmentMade', (campaignId, investor, token, amount) => {
  console.log(`New investment in campaign ${campaignId}`);
  console.log(`Investor: ${investor}`);
  console.log(`Amount: ${ethers.formatEther(amount)}`);
});

// Listen for campaign finalization
PropertyCrowdfund.on('CampaignFinalized', (campaignId, totalFunding) => {
  console.log(`Campaign ${campaignId} finalized`);
  console.log(`Total funding: ${ethers.formatEther(totalFunding)}`);
});
```

---

## Security Considerations

### Access Control
- Uses OpenZeppelin's `Ownable` for owner-only functions
- Owner should be a multisig wallet in production

### Reentrancy Protection
- Uses OpenZeppelin's `ReentrancyGuard` on `invest()` function
- Prevents reentrancy attacks during token transfers

### Token Approvals
- Users must approve tokens before investing
- Only approved amounts can be transferred

### Input Validation
- All inputs are validated
- Checks for zero addresses, zero amounts, etc.

### Deadline Enforcement
- Campaigns have strict deadlines
- Cannot invest after deadline

---

## Testing

Run contract tests:

```bash
cd packages/contracts
pnpm test
```

### Test Coverage

```bash
npx hardhat coverage
```

### Gas Reports

```bash
REPORT_GAS=true pnpm test
```

---

## Verification

Verify contracts on block explorers:

```bash
# Ethereum
npx hardhat verify --network ethereum CONTRACT_ADDRESS "Constructor" "Args"

# Base
npx hardhat verify --network base CONTRACT_ADDRESS "Constructor" "Args"
```

---

## Upgrades

**Important:** These contracts are NOT upgradeable. Once deployed, they cannot be changed.

To update functionality:
1. Deploy new version of contract
2. Migrate data if necessary
3. Update frontend/backend to use new address
4. Communicate changes to users

---

## Gas Optimization

Current gas estimates:

- PropertyToken deployment: ~1.2M gas
- PropertyCrowdfund deployment: ~2.5M gas
- ChainRegistry deployment: ~800k gas
- Create campaign: ~200k gas
- Invest: ~150k gas
- Finalize campaign: ~100k gas

---

## Audit Status

⚠️ **Contracts have not been audited yet**

Before mainnet deployment:
- Complete professional security audit
- Fix any identified issues
- Implement recommended improvements
- Document all changes

Recommended auditors:
- OpenZeppelin
- ConsenSys Diligence
- Trail of Bits
- Certik

---

## License

All contracts are licensed under MIT License.

---

## Support

For contract-related questions:
- Open an issue on GitHub
- Check existing documentation
- Review test files for examples
