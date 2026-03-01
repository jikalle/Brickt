# Development Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **pnpm** 8+ (`npm install -g pnpm`)
- **PostgreSQL** 14+ ([Download](https://www.postgresql.org/download/))
- **Git** ([Download](https://git-scm.com/downloads))

Optional:
- **MetaMask** or another Web3 wallet for testing
- **Docker** for containerized PostgreSQL

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Shehuna2/homeshare-v2.git
cd homeshare-v2
```

### 2. Install Dependencies

```bash
pnpm install
```

This will install dependencies for all packages in the monorepo.

### 3. Setup Environment Variables

You can bootstrap the environment files from the repo root:

```bash
./scripts/phase1-setup.sh
```

#### Frontend

```bash
cd packages/frontend
cp .env.example .env.local
```

Edit `.env.local`:
```env
VITE_APP_NAME=Homeshare
VITE_API_BASE_URL=http://localhost:3000
VITE_DEFAULT_CHAIN=base-sepolia
VITE_SUPPORTED_CHAINS=base-sepolia,base
```

#### Backend

```bash
cd ../backend
cp .env.example .env
```

Edit `.env` and configure (the server logs warnings for missing or placeholder values on boot):
- Database connection string
- Base RPC URLs (`BASE_SEPOLIA_RPC_URL`, optional `BASE_MAINNET_RPC_URL`)
- JWT secret
- `OWNER_ALLOWLIST` for owner auth elevation (comma-separated addresses)
- `PLATFORM_OPERATOR_PRIVATE_KEY` for platform-fee intent execution worker
- `PLATFORM_FEE_INTENT_MAX_ATTEMPTS` to cap automatic retries (default `3`)
- Rate limiting controls (`RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`)

#### Contracts

```bash
cd ../contracts
cp .env.example .env
```

Edit `.env`:
- Add RPC URLs for networks
- Add private key for deployment (NEVER commit this!)
- Add API keys for contract verification

After deploying to testnets, sync the new contract addresses into frontend/backend env files:

```bash
pnpm sync:testnet-addresses
```

### 4. Setup Database

#### Using PostgreSQL directly

```bash
# Create database
createdb homeshare

# Update DATABASE_URL in backend/.env
DATABASE_URL=postgresql://username:password@localhost:5432/homeshare
```

#### Using Docker

```bash
docker run --name homeshare-postgres \
  -e POSTGRES_DB=homeshare \
  -e POSTGRES_USER=homeshare \
  -e POSTGRES_PASSWORD=homeshare \
  -p 5432:5432 \
  -d postgres:14
```

## Development Workflow

### Running All Services

From the root directory:

```bash
# Start all services in development mode
pnpm dev
```

This will start:
- Frontend on `http://localhost:5173`
- Backend on `http://localhost:3000`

### Running Individual Services

#### Frontend Only

```bash
cd packages/frontend
pnpm dev
```

#### Backend Only

```bash
cd packages/backend
pnpm dev
```

#### Contracts

```bash
cd packages/contracts

# Compile contracts
pnpm compile

# Run tests
pnpm test

# Deploy to local network
npx hardhat node
# In another terminal
npx hardhat run deploy/deployEthereum.ts --network localhost
```

## Testing

### Frontend Tests

```bash
cd packages/frontend
pnpm build
```

### Backend Tests

```bash
cd packages/backend
pnpm test
```

### Contract Tests

```bash
cd packages/contracts
pnpm test
```

## Building for Production

```bash
# Build all packages
pnpm build
```

Individual packages:

```bash
# Frontend
cd packages/frontend
pnpm build

# Backend
cd packages/backend
pnpm build

# Contracts
cd packages/contracts
pnpm compile
```

## Common Issues

### Port Already in Use

If port 3000 or 5173 is already in use:

```bash
# Frontend (change in vite.config.ts or use env var)
VITE_PORT=5174 pnpm dev

# Backend (change PORT in .env)
PORT=3001 pnpm dev
```

### Database Connection Issues

1. Ensure PostgreSQL is running
2. Verify `DATABASE_URL` in `packages/backend/.env`
3. Check database exists: `psql -l`

### Contract Compilation Errors

1. Ensure you're using the correct Solidity version (0.8.20)
2. Clear cache: `npx hardhat clean`
3. Reinstall dependencies: `pnpm install`

### Web3 Connection Issues

1. Ensure MetaMask is installed and connected
2. Check you're on the correct network
3. Verify RPC URLs in configuration

## Development Tips

### Hot Reload

All packages support hot reload:
- Frontend: Vite provides instant HMR
- Backend: tsx watch restarts on file changes
- Contracts: Re-compile and re-deploy as needed

### Code Formatting

```bash
# Lint all packages
pnpm lint
```

### Database Migrations

```bash
cd packages/backend
pnpm migrate
```

### Debugging

#### Frontend
- Use React DevTools
- Redux DevTools for state inspection
- Browser console for Web3 interactions

#### Backend
- Use VS Code debugger
- Add `debugger` statements
- Check logs in terminal

#### Contracts
- Use Hardhat console: `npx hardhat console`
- Use console.log in contracts (requires hardhat/console.sol)
- Use Tenderly for transaction debugging

## Next Steps

1. Deploy contracts to testnets
2. Configure contract addresses in backend
3. Start building features
4. Test on testnets before mainnet

## Additional Resources

- [React Documentation](https://react.dev/)
- [Hardhat Documentation](https://hardhat.org/docs)
- [Ethers.js Documentation](https://docs.ethers.org/)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)
