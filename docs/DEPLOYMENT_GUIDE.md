# Testnet Deployment Guide

> Note: This guide is legacy/extended reference. For current `v1` deployment flow, use `docs/DEPLOYMENT.md` first.

## Overview

This guide provides step-by-step instructions for deploying Homeshare v2 smart contracts to testnet environments. Testing on testnets is essential before mainnet deployment to ensure contracts work correctly and to estimate gas costs.

## Supported Testnets

### Ethereum Sepolia
- **Chain ID**: 11155111
- **Native Token**: SepoliaETH
- **Block Explorer**: https://sepolia.etherscan.io
- **Faucets**: 
  - https://sepoliafaucet.com
  - https://www.alchemy.com/faucets/ethereum-sepolia
  - https://faucet.quicknode.com/ethereum/sepolia

### Base Sepolia
- **Chain ID**: 84532
- **Native Token**: SepoliaETH
- **RPC URL**: https://sepolia.base.org
- **Block Explorer**: https://sepolia.basescan.org
- **Faucets**:
  - https://www.alchemy.com/faucets/base-sepolia
  - https://docs.base.org/tools/network-faucets

### Canton Testnet
- **Chain ID**: (to be specified)
- **Native Token**: (to be specified)
- **RPC URL**: (to be specified)
- **Block Explorer**: (to be specified)
- **Faucet**: (to be specified)

## Prerequisites

### 1. Get Testnet Funds

Before deploying, you need testnet ETH for gas fees.

#### For Ethereum Sepolia:
1. Visit https://sepoliafaucet.com
2. Connect your wallet or enter your address
3. Request testnet ETH (usually 0.5 ETH per request)
4. Wait for confirmation (usually 1-2 minutes)

#### For Base Sepolia:
1. Visit https://www.alchemy.com/faucets/base-sepolia
2. Connect your wallet
3. Request testnet ETH
4. Alternatively, bridge Sepolia ETH from Ethereum Sepolia using https://bridge.base.org/deposit

#### For Canton Testnet:
Follow Canton network documentation for testnet token acquisition.

### 2. Setup Environment Variables

1. Copy the example environment file:
```bash
cd packages/contracts
cp .env.example .env.local
```

2. Edit `.env.local` with your values:
```env
# Testnet RPC URLs
ETHEREUM_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
CANTON_TESTNET_RPC_URL=https://canton-testnet-rpc.example.com
CANTON_TESTNET_CHAIN_ID=

# Deployment Account - IMPORTANT: Use a testnet-only wallet!
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Etherscan API Keys (for verification)
ETHEREUM_ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY
BASE_ETHERSCAN_API_KEY=YOUR_BASESCAN_KEY
```

**⚠️ Security Warnings:**
- NEVER use your mainnet wallet private key for testnet deployments
- Create a separate wallet specifically for testnet development
- NEVER commit `.env.local` to version control (it's in `.gitignore`)
- Export your private key from MetaMask: Account Details → Export Private Key

### 3. Get API Keys for Contract Verification

#### Etherscan (for Sepolia):
1. Visit https://etherscan.io
2. Sign up for a free account
3. Go to https://etherscan.io/myapikey
4. Create a new API key
5. Add to `.env.local` as `ETHEREUM_ETHERSCAN_API_KEY`

#### Basescan (for Base Sepolia):
1. Visit https://basescan.org
2. Sign up for a free account
3. Go to https://basescan.org/myapikey
4. Create a new API key
5. Add to `.env.local` as `BASE_ETHERSCAN_API_KEY`

### 4. Install Dependencies

```bash
cd packages/contracts
pnpm install
```

### 5. Compile Contracts

```bash
pnpm compile
```

This will compile all Solidity contracts and generate TypeScript types.

## Deployment Process

### Deploy to Ethereum Sepolia

1. Ensure you have Sepolia ETH in your deployer account (check on https://sepolia.etherscan.io)

2. Run the deployment script:
```bash
pnpm deploy:sepolia
```

3. The script will:
   - Deploy PropertyToken contract
   - Deploy PropertyCrowdfund contract
   - Deploy ChainRegistry contract
   - Save addresses to `deployments/testnet-addresses.json`
   - Display verification commands

4. Example output:
```
Deploying contracts to Ethereum Sepolia Testnet...
Deploying contracts with account: 0x1234...
Account balance: 0.5 ETH

Deploying PropertyToken...
PropertyToken deployed to: 0xABC123...

Deploying PropertyCrowdfund...
PropertyCrowdfund deployed to: 0xDEF456...

Deploying ChainRegistry...
ChainRegistry deployed to: 0xGHI789...

==================================================
Deployment Successful!
==================================================
{
  "propertyToken": "0xABC123...",
  "propertyCrowdfund": "0xDEF456...",
  "chainRegistry": "0xGHI789...",
  "deploymentBlock": 1234567,
  "deploymentTx": "0x...",
  "deployedAt": "2025-01-04T12:00:00Z"
}
```

### Deploy to Base Sepolia

1. Ensure you have Sepolia ETH on Base network

2. Run the deployment script:
```bash
pnpm deploy:base-sepolia
```

3. Process is the same as Sepolia deployment

### Deploy to Canton Testnet

1. Ensure you have Canton testnet tokens

2. Run the deployment script:
```bash
pnpm deploy:canton-testnet
```

## Contract Verification

Verifying contracts on block explorers allows users to read the contract source code and interact with it directly.

### Verify on Ethereum Sepolia

After deployment, use the verification command provided in the deployment output:

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

Example:
```bash
npx hardhat verify --network sepolia 0xABC123... "Sepolia Property Token" "SPT" "property-sepolia-1" "1000000000000000000000000" "100000000000000000000000"
```

### Verify on Base Sepolia

```bash
npx hardhat verify --network base-sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### Common Verification Issues

**"Already Verified"**: Contract is already verified, nothing to do!

**"Invalid API Key"**: Check your API key in `.env.local`

**"Constructor arguments mismatch"**: Ensure you're passing the exact same arguments used during deployment

**"Could not find a compiler version"**: Run `pnpm compile` first to ensure the compiler version is installed

## Post-Deployment Steps

### 1. Update Frontend Configuration

Edit `packages/frontend/src/config/contracts.config.ts`:

```typescript
export const TESTNET_CONTRACTS = {
  sepolia: {
    propertyToken: "0xABC123...",
    propertyCrowdfund: "0xDEF456...",
    chainRegistry: "0xGHI789...",
  },
  "base-sepolia": {
    propertyToken: "0x...",
    propertyCrowdfund: "0x...",
    chainRegistry: "0x...",
  },
};
```

### 2. Update Backend Configuration

Edit `packages/backend/.env.testnet`:

```env
ETHEREUM_SEPOLIA_PROPERTY_TOKEN=0xABC123...
ETHEREUM_SEPOLIA_PROPERTY_CROWDFUND=0xDEF456...
ETHEREUM_SEPOLIA_CHAIN_REGISTRY=0xGHI789...

BASE_SEPOLIA_PROPERTY_TOKEN=0x...
BASE_SEPOLIA_PROPERTY_CROWDFUND=0x...
BASE_SEPOLIA_CHAIN_REGISTRY=0x...
```

### 3. Test Contract Interactions

#### Using Hardhat Console

```bash
npx hardhat console --network sepolia
```

```javascript
const PropertyToken = await ethers.getContractAt("PropertyToken", "0xABC123...");
const name = await PropertyToken.name();
console.log("Token name:", name);
```

#### Using Block Explorer

1. Visit the contract on the block explorer
2. Go to "Contract" → "Write Contract"
3. Connect your wallet
4. Try calling functions directly

### 4. Create a Test Campaign

Here's a complete example of creating a test crowdfunding campaign:

```javascript
// Get contract instances
const propertyToken = await ethers.getContractAt("PropertyToken", "0xABC123...");
const crowdfund = await ethers.getContractAt("PropertyCrowdfund", "0xDEF456...");

// Create a campaign
// Note: You need accepted payment token addresses (e.g., testnet USDC)
const acceptedTokens = ["0xTestUSDC..."];
const fundingGoal = ethers.parseEther("10"); // 10 ETH equivalent
const duration = 30 * 24 * 60 * 60; // 30 days

const tx = await crowdfund.createCampaign(
  await propertyToken.getAddress(),
  fundingGoal,
  duration,
  acceptedTokens
);

const receipt = await tx.wait();
console.log("Campaign created! Tx:", receipt.hash);
```

## Troubleshooting

### Deployment Fails with "Insufficient Funds"

**Solution**: Get more testnet ETH from faucets listed above.

### Deployment Fails with "Nonce Too High"

**Solution**: Reset your account nonce:
```bash
# Using MetaMask: Settings → Advanced → Reset Account
```

Or use Hardhat's reset feature:
```bash
npx hardhat clean
```

### "Cannot connect to network"

**Solution**: 
- Check your RPC URL in `.env.local`
- Try an alternative RPC provider
- Check if the testnet is experiencing issues

### Transaction Stuck/Pending

**Solution**:
- Wait longer (testnets can be slow)
- Check the transaction on block explorer
- If truly stuck, try resetting your account nonce

### Contract Size Too Large

**Solution**:
- Enable optimizer in `hardhat.config.ts` (already enabled)
- Split large contracts into smaller ones
- Remove unused code

## Gas Cost Estimates

Approximate gas costs on testnets (actual costs may vary):

| Operation | Estimated Gas | Estimated Cost (@ 20 gwei) |
|-----------|---------------|----------------------------|
| Deploy PropertyToken | 1,200,000 | 0.024 ETH |
| Deploy PropertyCrowdfund | 2,500,000 | 0.050 ETH |
| Deploy ChainRegistry | 800,000 | 0.016 ETH |
| Create Campaign | 200,000 | 0.004 ETH |
| Make Investment | 150,000 | 0.003 ETH |
| **Total for Full Deployment** | ~4,500,000 | ~0.09 ETH |

## Mainnet Deployment Checklist

Before deploying to mainnet, ensure:

- [ ] All tests passing (`pnpm test`)
- [ ] Contracts tested thoroughly on testnets
- [ ] Security audit completed
- [ ] Gas optimization reviewed
- [ ] All edge cases tested
- [ ] Contract upgrade strategy defined
- [ ] Emergency pause mechanism tested
- [ ] Owner/admin keys secured (use multisig)
- [ ] Deployment script tested on testnet
- [ ] Budget for gas costs prepared
- [ ] Verification commands ready
- [ ] Post-deployment monitoring plan in place
- [ ] Rollback plan documented
- [ ] Team members briefed
- [ ] User communication prepared

## Next Steps

1. **Test Thoroughly**: Create campaigns, make investments, test all functions
2. **Monitor Gas Costs**: Track actual gas usage to optimize
3. **Document Issues**: Keep notes on any problems encountered
4. **Prepare for Mainnet**: Use testnet experience to refine mainnet deployment
5. **Security Review**: Consider a professional audit before mainnet

## Useful Resources

### Documentation
- [Hardhat Documentation](https://hardhat.org/)
- [Ethers.js Documentation](https://docs.ethers.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)

### Block Explorers
- [Sepolia Etherscan](https://sepolia.etherscan.io)
- [Base Sepolia Basescan](https://sepolia.basescan.org)

### Testnets
- [Ethereum Sepolia Info](https://sepolia.dev/)
- [Base Sepolia Docs](https://docs.base.org/network-information)

### Faucets
- [Sepolia Faucet](https://sepoliafaucet.com)
- [Alchemy Faucets](https://www.alchemy.com/faucets)
- [QuickNode Faucet](https://faucet.quicknode.com/)

### Tools
- [Hardhat](https://hardhat.org/)
- [Remix IDE](https://remix.ethereum.org/)
- [Tenderly](https://tenderly.co/)

## Support

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review Hardhat documentation
3. Check block explorer for transaction details
4. Open an issue on GitHub with:
   - Network you're deploying to
   - Error message
   - Transaction hash (if available)
   - Steps to reproduce

## License

This project is licensed under MIT License.
