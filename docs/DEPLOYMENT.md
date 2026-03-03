# Deployment Guide

## Overview

This guide covers deploying the current Homeshare v2 stack with:
- Base Sepolia for staging/test operations.
- Base mainnet for production rollout.

The live architecture includes three backend processes:
- API server (`dist/server.js`)
- Indexer (`dist/indexer/run.js`)
- Platform-fee intent worker (`scripts/process-platform-fee-intents.mjs`)
- Property intent worker (`scripts/process-property-intents.mjs`)
- Profit intent worker (`scripts/process-profit-intents.mjs`)

## Pre-Deployment Checklist

- [ ] All tests passing
- [ ] Security audit completed
- [ ] Threat model reviewed and accepted (`docs/THREAT_MODEL.md`)
- [ ] Compliance readiness checklist signed (`docs/COMPLIANCE_READINESS.md`)
- [ ] CI/CD environment protections configured (`docs/CI_CD.md`)
- [ ] Observability dashboards and alert thresholds configured (`docs/OBSERVABILITY.md`)
- [ ] Environment variables configured
- [ ] Database backup strategy in place
- [ ] Monitoring and alerting configured
- [ ] Domain and SSL certificates ready
- [ ] Base RPC endpoints configured

## Smart Contract Deployment

### 1. Prepare for Deployment

```bash
cd packages/contracts

# Install dependencies
pnpm install

# Compile contracts
pnpm compile

# Run tests
pnpm test
```

### 2. Configure Networks

Update `hardhat.config.ts` and ensure contract env file contains required Base endpoints and keys:

```env
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
BASE_ETHERSCAN_API_KEY=YOUR_BASESCAN_KEY
```

⚠️ **Security Warning**: Never commit private keys. Use hardware wallets or secure key management for production.

### 3. Deploy to Networks

#### Base Sepolia

```bash
pnpm deploy:base-sepolia
```

#### Base Mainnet

```bash
pnpm deploy:base
```

### 4. Verify Contracts

```bash
# Base Sepolia
npx hardhat verify --network base-sepolia CONTRACT_ADDRESS "Constructor" "Args"

# Base mainnet
npx hardhat verify --network base CONTRACT_ADDRESS "Constructor" "Args"
```

### 5. Save Contract Addresses

Record all deployed addresses and update backend/frontend env values used by the running stack.

## Backend Deployment

### 1. Prepare Backend

```bash
cd packages/backend

# Build TypeScript
pnpm build

# Test build
node dist/server.js
```

### 2. Database Setup

```bash
# Production database
createdb homeshare_production

# Run migrations
pnpm migrate
```

### 3. Configure Environment

Create `.env.production`:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:password@db-host:5432/homeshare_production

# Base RPC URLs (used by auth, fee reads, and worker)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org

# Indexer config
RPC_URL=https://mainnet.base.org
START_BLOCK=0
BATCH_SIZE=1000

# Owner auth + ops
OWNER_ALLOWLIST=0xowner1,0xowner2
PLATFORM_OPERATOR_PRIVATE_KEY=0x...
PLATFORM_FEE_INTENT_MAX_ATTEMPTS=3

# Security
JWT_SECRET=SECURE_RANDOM_STRING_HERE
JWT_EXPIRY=7d
```

### 4. Deploy Backend

#### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start dist/server.js --name homeshare-backend
pm2 start dist/indexer/run.js --name homeshare-indexer
pm2 start "pnpm process:platform-fees" --name homeshare-fee-worker
pm2 start "pnpm process:properties:watch" --name homeshare-property-worker
pm2 start "pnpm process:profits:watch" --name homeshare-profit-worker

# Or run property + profit workers under one supervisor process:
pm2 start "pnpm process:intents:watch" --name homeshare-intent-workers

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

#### Using Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

```bash
# Build and run
docker build -t homeshare-backend .
docker run -d -p 3000:3000 --env-file .env.production homeshare-backend
```

## Frontend Deployment

### 1. Build Frontend

```bash
cd packages/frontend

# Build for production
pnpm build
```

This creates optimized files in `dist/` directory.

### 2. Configure Environment

Create `.env.production`:

```env
VITE_APP_NAME=Homeshare
VITE_API_BASE_URL=https://api.yourdomain.com/api
VITE_DEFAULT_CHAIN=ethereum
VITE_SUPPORTED_CHAINS=ethereum,base,canton
```

### 3. Deploy Frontend

#### Using Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

#### Using Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod --dir=dist
```

#### Using Traditional Web Server (Nginx)

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    root /var/www/homeshare/dist;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Post-Deployment

### 1. Verify Deployment

- [ ] Frontend loads correctly
- [ ] Backend health check responds: `https://api.yourdomain.com/health`
- [ ] Can connect wallet
- [ ] `/v1/health` responds from backend
- [ ] Indexer is advancing block checkpoints
- [ ] Platform-fee worker can process pending intents
- [ ] Property worker can process pending intents
  - `PROPERTY_OPERATOR_PRIVATE_KEY` and chain USDC env configured
- [ ] Profit worker can process pending intents

### 2. Initialize Data

```bash
# Seed initial property/campaign records through deployment + indexer sync.
# Validate owner intent creation and execution loop.
```

### 3. Monitoring

Setup monitoring for:
- Backend uptime and response times
- Database performance
- Base RPC connectivity and latency
- Error rates and exceptions
- Transaction success rates
- Indexer lag (`latest - indexed` block distance)
- Intent queue depth and failure rate

Operational schedulers (recommended):
- `pnpm --filter @homeshare/backend intents:alert` every 2 minutes
- `pnpm --filter @homeshare/backend reconcile:intents` every 5 minutes

Use helper:

```bash
./scripts/install-ops-cron.sh --apply
```

### 4. Backup Strategy

```bash
# Database backups
pg_dump homeshare_production > backup_$(date +%Y%m%d).sql

# Setup automated backups
crontab -e
# Add: 0 2 * * * pg_dump homeshare_production > /backups/backup_$(date +\%Y\%m\%d).sql
```

## Maintenance

### Updating Smart Contracts

Smart contracts are immutable once deployed. To update:
1. Deploy new version
2. Migrate data if needed
3. Update contract addresses in backend/frontend
4. Communicate changes to users

### Updating Backend

```bash
cd packages/backend
git pull
pnpm install
pnpm build
pm2 restart homeshare-backend
```

### Updating Frontend

```bash
cd packages/frontend
git pull
pnpm install
pnpm build
# Upload new dist/ to hosting provider
```

## Rollback Procedures

### Backend Rollback

```bash
# Using PM2
pm2 stop homeshare-backend
pm2 stop homeshare-indexer
pm2 stop homeshare-fee-worker
# Deploy previous version
pm2 start dist/server.js --name homeshare-backend
pm2 start dist/indexer/run.js --name homeshare-indexer
pm2 start "pnpm process:platform-fees" --name homeshare-fee-worker
pm2 start "pnpm process:properties:watch" --name homeshare-property-worker
pm2 start "pnpm process:profits:watch" --name homeshare-profit-worker

# Or run property + profit workers under one supervisor process:
pm2 start "pnpm process:intents:watch" --name homeshare-intent-workers
```

### Frontend Rollback

- Vercel/Netlify: Use their dashboard to rollback
- Nginx: Replace dist/ with previous version

### Database Rollback

```bash
# Restore from backup
psql homeshare_production < backup_YYYYMMDD.sql
```

## Security Checklist

- [ ] Private keys stored securely (never in code)
- [ ] Environment variables not exposed to frontend
- [ ] HTTPS enabled everywhere
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Database credentials rotated
- [ ] Smart contracts audited
- [ ] Dependencies updated and scanned
- [ ] Operator private keys managed via secrets manager

## Support & Troubleshooting

### Common Issues

**Contract deployment fails:**
- Check gas price and limits
- Verify RPC endpoint is working
- Ensure sufficient funds in deployer account

**Backend won't start:**
- Check database connection
- Verify all environment variables set
- Check logs for specific errors

**Frontend can't connect to contracts:**
- Verify contract addresses in config
- Check user is on correct network
- Ensure RPC endpoints accessible

## Cost Estimates

### Initial Deployment
- Contract deployment (per chain): ~$50-200 in gas fees
- Domain name: ~$10-20/year
- SSL certificate: Free (Let's Encrypt)

### Monthly Operating Costs
- Backend hosting: ~$20-50/month
- Frontend hosting: ~$0-20/month (depends on traffic)
- RPC services: ~$0-100/month (depends on usage)
- Database: ~$10-30/month
