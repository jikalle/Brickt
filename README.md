# Brickt 🏠

> Base-Native Real Estate Crowdfunding Platform

Brickt is a decentralized real estate crowdfunding platform focused on Base. Investors fund properties with USDC, receive tokenized equity, and claim onchain profit distributions.

## 🌐 Supported Networks

- **Base Sepolia**: USDC, ETH (active development/testing)
- **Base Mainnet**: USDC, USDT, ETH (launch target)

## 🏗️ Project Structure

This is a monorepo managed with pnpm workspaces:

```
homeshare-v2/
├── packages/
│   ├── frontend/      # React 18 + TypeScript + Vite
│   ├── backend/       # Node.js/Express + TypeScript
│   └── contracts/     # Solidity + Hardhat
├── docs/              # Project documentation
└── scripts/           # Utility scripts
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/Shehuna2/homeshare-v2.git
cd homeshare-v2

# Install dependencies
pnpm install

# Setup environment files
cp packages/frontend/.env.example packages/frontend/.env.local
cp packages/backend/.env.example packages/backend/.env.local
cp packages/contracts/.env.example packages/contracts/.env.local

# Start development servers
pnpm dev
```

## 📦 Packages

### Frontend
- React 18 with TypeScript
- Vite for fast development
- TailwindCSS for styling
- Wagmi for Base wallet integration
- Redux Toolkit for state management

### Backend
- Express.js with TypeScript
- PostgreSQL for data persistence
- Base event indexing service
- JWT-based authentication

### Contracts
- Solidity smart contracts
- Hardhat development environment
- Base-focused deployment scripts
- OpenZeppelin contracts

## 📚 Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Execution Board](./docs/EXECUTION_BOARD.md)
- [Setup Guide](./docs/SETUP.md)
- [Deployment](./docs/DEPLOYMENT.md)
- [MVP Go-Live Checklist](./docs/MVP_GO_LIVE_CHECKLIST.md)
- [Launch-Day Runbook](./docs/LAUNCH_DAY_RUNBOOK.md)
- [CI/CD Guide](./docs/CI_CD.md)
- [Observability Guide](./docs/OBSERVABILITY.md)
- [Intent Operations](./docs/OPERATIONS_INTENTS.md)
- [Threat Model](./docs/THREAT_MODEL.md)
- [Compliance Readiness](./docs/COMPLIANCE_READINESS.md)
- [Investor Disclosures](./docs/INVESTOR_DISCLOSURES.md)
- [API Documentation](./docs/API.md)
- [Smart Contracts](./docs/SMART_CONTRACTS.md)
- [Contributing](./docs/CONTRIBUTING.md)

## 🔑 Key Features

✅ **Base-Only Focus** - Built for Base Sepolia and Base Mainnet  
✅ **USDC Investment Rails** - USDC-first fundraising and payouts  
✅ **Real Estate Tokenization** - Fractional ownership through ERC20 tokens  
✅ **Investor Dashboard** - Track investments and claims from indexed onchain data  
✅ **Owner Console** - Manage properties and distribute profits  
✅ **Type Safety** - Full TypeScript across all packages  

## 🛠️ Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Clean all
pnpm clean
```

## 📄 License

MIT

## 🤝 Contributing

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for details on how to contribute to this project.
