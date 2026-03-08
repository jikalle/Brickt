# Development Setup Guide

## 1) Prerequisites

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+
- Git
- Browser wallet (MetaMask, Coinbase Wallet, or compatible Base wallet)

## 2) Clone and Install

```bash
git clone <your-repo-url>
cd <your-repo-dir>
pnpm install
```

## 3) Environment Files

### Frontend

```bash
cp packages/frontend/.env.example packages/frontend/.env.local
```

Set at least:

```env
VITE_APP_NAME=Brickt
VITE_API_BASE_URL=http://localhost:3000
VITE_OWNER_ALLOWLIST=0x...
```

### Backend

```bash
cp packages/backend/.env.example packages/backend/.env
```

Set at least:

```env
PORT=3000
DATABASE_URL=postgresql://brickt:brickt@localhost:5432/brickt
JWT_SECRET=change-me

BASE_SEPOLIA_RPC_URL=https://base-sepolia-rpc.publicnode.com
BASE_SEPOLIA_RPC_FALLBACK_URLS=https://base-sepolia.blockpi.network/v1/rpc/public

OWNER_ALLOWLIST=0x...
NO_WORKER_MODE=true
PROCESSING_CRON_TOKEN=change-me

# One of these must be present for processing
PRIVATE_KEY=0x...
PROPERTY_OPERATOR_PRIVATE_KEY=0x...
PLATFORM_OPERATOR_PRIVATE_KEY=0x...
PROFIT_OPERATOR_PRIVATE_KEY=0x...
```

### Contracts

```bash
cp packages/contracts/.env.example packages/contracts/.env
```

## 4) Database

Create local DB and run migrations:

```bash
createdb brickt
pnpm --filter @homeshare/backend migrate
```

## 5) Compile Contracts (Required)

Property intent processing expects artifacts under `packages/contracts/artifacts`.

```bash
pnpm --filter @homeshare/contracts compile
```

## 6) Run Locally

Start frontend and backend:

```bash
pnpm dev
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## 7) Run One Processing Cycle (No-Worker Mode)

Manual local trigger:

```bash
curl -X POST "http://localhost:3000/v1/admin/processing/cron?indexerSync=false" \
  -H "x-cron-token: $PROCESSING_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## 8) Useful Commands

```bash
pnpm --filter @homeshare/backend build
pnpm --filter @homeshare/frontend build
pnpm --filter @homeshare/contracts compile
pnpm --filter @homeshare/backend process:properties
pnpm --filter @homeshare/backend process:profits
pnpm --filter @homeshare/backend process:platform-fees
pnpm --filter @homeshare/backend process:campaign-lifecycle
pnpm --filter @homeshare/backend indexer:sync
```

## 9) Common Issues

### `Invalid database connection URL format`

Your `DATABASE_URL` is not loaded or malformed. Confirm `.env` and shell env are clean.

### `ENOENT ... packages/contracts/artifacts/...json`

Run:

```bash
pnpm --filter @homeshare/contracts compile
```

### `JsonRpcProvider failed to detect network`

RPC endpoint is unstable/unreachable. Switch to a healthy Base Sepolia RPC.

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
