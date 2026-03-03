import assert from 'node:assert/strict';
import { ethers } from 'ethers';

const OWNER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f95f6f2f6ec0c5';
const ownerWallet = new ethers.Wallet(OWNER_PRIVATE_KEY);
const investorWallet = ethers.Wallet.createRandom();
const disallowedOwnerWallet = ethers.Wallet.createRandom();

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-1234567890';
process.env.OWNER_ALLOWLIST = ownerWallet.address.toLowerCase();
process.env.PRIVATE_KEY = OWNER_PRIVATE_KEY;
process.env.PROFIT_OPERATOR_PRIVATE_KEY = OWNER_PRIVATE_KEY;
process.env.BASE_SEPOLIA_RPC_URL = 'http://localhost:8545';
process.env.BASE_MAINNET_RPC_URL = '';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/homeshare';

const { getNonceHandler, loginHandler } = await import('../dist/routes/auth.js');
const { requireRole } = await import('../dist/middleware/auth.js');
const {
  createPropertyIntent,
  createProfitDistributionIntent,
  createPlatformFeeIntent,
  getProfitFlowStatus,
  getProfitPreflight,
} = await import('../dist/controllers/v1/adminController.js');
const { listProperties } = await import('../dist/controllers/v1/propertiesController.js');
const { listCampaigns } = await import('../dist/controllers/v1/campaignsController.js');
const {
  listMyInvestments,
  listMyEquityClaims,
  listMyProfitClaims,
} = await import('../dist/controllers/v1/meController.js');
const { User } = await import('../dist/models/index.js');
const { sequelize } = await import('../dist/db/index.js');

const userStore = new Map();
const originalFindOrCreate = User.findOrCreate.bind(User);
const originalQuery = sequelize.query.bind(sequelize);
const originalProviderCall = ethers.JsonRpcProvider.prototype.call.bind(
  ethers.JsonRpcProvider.prototype
);

const makeRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
};

const stubUserFindOrCreate = () => {
  User.findOrCreate = async ({ where, defaults }) => {
    const address = where.address.toLowerCase();
    const existing = userStore.get(address);
    if (existing) {
      return [existing, false];
    }

    const created = {
      id: `user-${address.slice(2, 8)}`,
      address,
      role: defaults.role,
      async save() {
        userStore.set(address, created);
      },
    };
    userStore.set(address, created);
    return [created, true];
  };
};

const stubSequelizeQuery = () => {
  sequelize.query = async (sql, options) => {
    if (
      sql.includes('FROM properties') &&
      sql.includes('profit_distributor_address') &&
      sql.includes('WHERE chain_id = :chainId') &&
      sql.includes('AND property_id = :propertyId')
    ) {
      return [
        {
          propertyId: 'prop-001',
          profitDistributorAddress: ownerWallet.address.toLowerCase(),
        },
      ];
    }
    if (sql.includes('FROM properties') && sql.includes('WHERE chain_id')) {
      return [
        [
          {
            propertyId: 'prop-001',
            name: 'Demo Property',
            location: 'Austin, TX',
            description: 'Seeded property',
            crowdfundAddress: ownerWallet.address.toLowerCase(),
            equityTokenAddress: ownerWallet.address.toLowerCase(),
            profitDistributorAddress: ownerWallet.address.toLowerCase(),
            targetUsdcBaseUnits: '100000000',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      ];
    }
    if (sql.includes('FROM campaigns c') && sql.includes('JOIN properties p ON p.id = c.property_id')) {
      return [
        [
          {
            propertyId: 'prop-001',
            campaignAddress: ownerWallet.address.toLowerCase(),
            startTime: new Date(Date.now() - 60_000).toISOString(),
            endTime: new Date(Date.now() + 86_400_000).toISOString(),
            state: 'ACTIVE',
            targetUsdcBaseUnits: '100000000',
            raisedUsdcBaseUnits: '25000000',
            finalizedTxHash: null,
            finalizedLogIndex: null,
            finalizedBlockNumber: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      ];
    }
    if (sql.includes('FROM campaign_investments ci') && sql.includes('ci.investor_address = :investorAddress')) {
      return [
        [
          {
            propertyId: 'prop-001',
            campaignAddress: ownerWallet.address.toLowerCase(),
            investorAddress: investorWallet.address.toLowerCase(),
            usdcAmountBaseUnits: '5000000',
            txHash: '0xabc',
            logIndex: 1,
            blockNumber: '123',
            createdAt: new Date().toISOString(),
          },
        ],
      ];
    }
    if (sql.includes('FROM equity_claims ec') && sql.includes('ec.claimant_address = :claimantAddress')) {
      return [
        [
          {
            propertyId: 'prop-001',
            equityTokenAddress: ownerWallet.address.toLowerCase(),
            campaignAddress: ownerWallet.address.toLowerCase(),
            claimantAddress: investorWallet.address.toLowerCase(),
            equityAmountBaseUnits: '1000000000000000000',
            txHash: '0xdef',
            logIndex: 2,
            blockNumber: '124',
            createdAt: new Date().toISOString(),
          },
        ],
      ];
    }
    if (sql.includes('FROM profit_claims pc') && sql.includes('pc.claimer_address = :claimerAddress')) {
      return [
        [
          {
            propertyId: 'prop-001',
            profitDistributorAddress: ownerWallet.address.toLowerCase(),
            claimerAddress: investorWallet.address.toLowerCase(),
            usdcAmountBaseUnits: '250000',
            txHash: '0xghi',
            logIndex: 3,
            blockNumber: '125',
            createdAt: new Date().toISOString(),
          },
        ],
      ];
    }
    if (sql.includes('FROM indexer_state') && sql.includes('WHERE chain_id = :chainId')) {
      return [{ last_block: '38390000' }];
    }
    if (sql.includes('FROM (') && sql.includes('SELECT id, submitted_at FROM property_intents')) {
      return [{ count: '0' }];
    }
    if (sql.includes('FROM profit_distribution_intents') && sql.includes('WHERE property_id = :propertyId')) {
      return [
        {
          id: 'intent-1',
          status: 'confirmed',
          submittedAt: new Date(Date.now() - 30_000).toISOString(),
          confirmedAt: new Date().toISOString(),
          txHash: '0xintent',
        },
      ];
    }
    if (
      sql.includes('FROM profit_deposits pd') &&
      sql.includes('JOIN properties p ON p.id = pd.property_id') &&
      sql.includes('AS "txHash"')
    ) {
      return [
        {
          txHash: '0xdeposit',
          createdAt: new Date().toISOString(),
          amountBaseUnits: '1000000',
        },
      ];
    }
    if (sql.includes('AS "unclaimedBaseUnits"')) {
      return [{ unclaimedBaseUnits: '750000' }];
    }
    if (sql.includes('INSERT INTO property_intents')) {
      const createdAt = new Date().toISOString();
      return [
        [
          {
            propertyId: String(options?.replacements?.propertyId ?? 'prop-1'),
            name: String(options?.replacements?.name ?? 'Property'),
            location: String(options?.replacements?.location ?? 'Location'),
            description: String(options?.replacements?.description ?? 'Description'),
            targetUsdcBaseUnits: String(options?.replacements?.targetUsdcBaseUnits ?? '0'),
            startTime: options?.replacements?.startTime ?? null,
            endTime: options?.replacements?.endTime ?? null,
            crowdfundAddress: options?.replacements?.crowdfundContractAddress ?? null,
            status: 'pending',
            txHash: null,
            errorMessage: null,
            submittedAt: null,
            confirmedAt: null,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      ];
    }
    if (sql.includes('INSERT INTO profit_distribution_intents')) {
      const createdAt = new Date().toISOString();
      return [
        [
          {
            propertyId: String(options?.replacements?.propertyId ?? 'prop-1'),
            profitDistributorAddress: String(
              options?.replacements?.profitDistributorAddress ?? ownerWallet.address
            ).toLowerCase(),
            usdcAmountBaseUnits: String(options?.replacements?.usdcAmountBaseUnits ?? '0'),
            status: 'pending',
            txHash: null,
            errorMessage: null,
            submittedAt: null,
            confirmedAt: null,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      ];
    }
    if (sql.includes('INSERT INTO platform_fee_intents')) {
      const createdAt = new Date().toISOString();
      return [
        [
          {
            campaignAddress: String(options?.replacements?.campaignAddress ?? ethers.ZeroAddress),
            platformFeeBps: Number(options?.replacements?.platformFeeBps ?? 0),
            platformFeeRecipient: options?.replacements?.platformFeeRecipient ?? null,
            status: 'pending',
            txHash: null,
            errorMessage: null,
            submittedAt: null,
            confirmedAt: null,
            createdAt,
            updatedAt: createdAt,
          },
        ],
      ];
    }
    return [[]];
  };
};

const stubProviderCall = () => {
  const iface = new ethers.Interface([
    'function owner() view returns (address)',
    'function usdcToken() view returns (address)',
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
  ]);

  ethers.JsonRpcProvider.prototype.call = async function call(transaction) {
    const data = String(transaction?.data || '').toLowerCase();
    const selector = data.slice(0, 10);

    if (selector === iface.getFunction('owner').selector.toLowerCase()) {
      return iface.encodeFunctionResult('owner', [ownerWallet.address.toLowerCase()]);
    }
    if (selector === iface.getFunction('usdcToken').selector.toLowerCase()) {
      return iface.encodeFunctionResult('usdcToken', ['0x036cbd53842c5426634e7929541ec2318f3dcf7e']);
    }
    if (selector === iface.getFunction('balanceOf').selector.toLowerCase()) {
      return iface.encodeFunctionResult('balanceOf', [1_500_000n]);
    }
    if (selector === iface.getFunction('allowance').selector.toLowerCase()) {
      return iface.encodeFunctionResult('allowance', [1_200_000n]);
    }

    throw new Error(`Unexpected provider.call selector in test stub: ${selector}`);
  };
};

const restoreStubs = () => {
  User.findOrCreate = originalFindOrCreate;
  sequelize.query = originalQuery;
  ethers.JsonRpcProvider.prototype.call = originalProviderCall;
};

const buildMessage = (address, nonce) =>
  [
    'Homeshare wants you to sign in with your wallet.',
    `Address: ${address}`,
    'Chain ID: 84532',
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

const buildMessageWithChain = (address, nonce, chainId) =>
  [
    'Homeshare wants you to sign in with your wallet.',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

const getNonce = async () => {
  const res = makeRes();
  await getNonceHandler({}, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body?.nonce);
  return String(res.body.nonce);
};

const runRoleMiddleware = async (role, req) =>
  new Promise((resolve) => {
    const middleware = requireRole(role);
    const res = makeRes();
    middleware(req, res, () => resolve({ nextCalled: true, statusCode: res.statusCode, body: res.body }));
    if (res.statusCode !== 200 || res.body) {
      resolve({ nextCalled: false, statusCode: res.statusCode, body: res.body });
    }
  });

const run = async () => {
  stubUserFindOrCreate();
  stubSequelizeQuery();
  stubProviderCall();

  try {
    {
      const nonce = await getNonce();
      const message = buildMessage(investorWallet.address, nonce);
      const signature = await investorWallet.signMessage(message);
      const res = makeRes();

      await loginHandler(
        {
          body: {
            address: investorWallet.address,
            signature,
            message,
            role: 'investor',
          },
        },
        res
      );

      assert.equal(res.statusCode, 200, 'investor login should succeed');
      assert.equal(res.body.user.role, 'investor');
      assert.ok(res.body.token);
    }

    {
      const nonce = await getNonce();
      const message = buildMessage(ownerWallet.address, nonce);
      const signature = await ownerWallet.signMessage(message);
      const res = makeRes();

      await loginHandler(
        {
          body: {
            address: ownerWallet.address,
            signature,
            message,
            role: 'owner',
          },
        },
        res
      );

      assert.equal(res.statusCode, 200, 'allowlisted owner login should succeed');
      assert.equal(res.body.user.role, 'owner');
    }

    {
      const nonce = await getNonce();
      const message = buildMessage(disallowedOwnerWallet.address, nonce);
      const signature = await disallowedOwnerWallet.signMessage(message);
      const res = makeRes();

      await loginHandler(
        {
          body: {
            address: disallowedOwnerWallet.address,
            signature,
            message,
            role: 'owner',
          },
        },
        res
      );

      assert.equal(res.statusCode, 403, 'non-allowlisted owner should be rejected');
    }

    {
      const staleOwnerAddress = disallowedOwnerWallet.address.toLowerCase();
      userStore.set(staleOwnerAddress, {
        id: 'stale-owner',
        address: staleOwnerAddress,
        role: 'owner',
        async save() {
          userStore.set(staleOwnerAddress, this);
        },
      });

      const nonce = await getNonce();
      const message = buildMessage(disallowedOwnerWallet.address, nonce);
      const signature = await disallowedOwnerWallet.signMessage(message);
      const res = makeRes();

      await loginHandler(
        {
          body: {
            address: disallowedOwnerWallet.address,
            signature,
            message,
            role: 'investor',
          },
        },
        res
      );

      assert.equal(res.statusCode, 200, 'stale owner should still login');
      assert.equal(res.body.user.role, 'investor', 'stale owner must be downgraded');
    }

    {
      const nonce = await getNonce();
      const message = buildMessageWithChain(investorWallet.address, nonce, 1);
      const signature = await investorWallet.signMessage(message);
      const res = makeRes();

      await loginHandler(
        {
          body: {
            address: investorWallet.address,
            signature,
            message,
            role: 'investor',
          },
        },
        res
      );

      assert.equal(res.statusCode, 401, 'unsupported chain in message should be rejected');
    }

    {
      const roleCheck = await runRoleMiddleware('owner', {
        user: { id: 'u1', address: investorWallet.address, role: 'investor' },
      });
      assert.equal(roleCheck.nextCalled, false, 'investor should not pass owner middleware');
      assert.equal(roleCheck.statusCode, 403);
    }

    {
      const res = makeRes();
      await createPropertyIntent(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          body: {
            chainId: 84532,
            propertyId: 'prop-001',
            name: 'Demo Property',
            location: 'Austin, TX',
            description: 'Test listing',
            targetUsdcBaseUnits: '1000000',
          },
        },
        res
      );
      assert.equal(res.statusCode, 201, 'owner should create property intent');
      assert.equal(res.body.intent.propertyId, 'prop-001');
      assert.equal(res.body.intent.status, 'pending');
    }

    {
      const res = makeRes();
      await createPropertyIntent(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          body: {
            chainId: 84532,
            propertyId: 'prop-002',
            name: 'Scheduled Property',
            location: 'Lagos',
            description: 'Start/end validation',
            targetUsdcBaseUnits: '1000000',
            startTime: new Date(Date.now() + 60_000).toISOString(),
          },
        },
        res
      );
      assert.equal(
        res.statusCode,
        400,
        'property intent should reject when only startTime is provided'
      );
      assert.equal(res.body.error, 'Provide both startTime and endTime together');
    }

    {
      const now = Date.now();
      const startTime = new Date(now + 120_000).toISOString();
      const endTime = new Date(now + 60_000).toISOString();
      const res = makeRes();
      await createPropertyIntent(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          body: {
            chainId: 84532,
            propertyId: 'prop-003',
            name: 'Invalid Schedule Property',
            location: 'Abuja',
            description: 'End before start',
            targetUsdcBaseUnits: '1000000',
            startTime,
            endTime,
          },
        },
        res
      );
      assert.equal(res.statusCode, 400, 'property intent should reject invalid schedule ordering');
      assert.equal(res.body.error, 'endTime must be after startTime');
    }

    {
      const now = Date.now();
      const startTime = new Date(now + 60_000).toISOString();
      const endTime = new Date(now + 120_000).toISOString();
      const res = makeRes();
      await createPropertyIntent(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          body: {
            chainId: 84532,
            propertyId: 'prop-004',
            name: 'Valid Scheduled Property',
            location: 'Port Harcourt',
            description: 'Valid schedule',
            targetUsdcBaseUnits: '1000000',
            startTime,
            endTime,
          },
        },
        res
      );
      assert.equal(res.statusCode, 201, 'property intent should allow valid start/end schedule');
      assert.equal(res.body.intent.propertyId, 'prop-004');
      assert.equal(res.body.intent.startTime, startTime);
      assert.equal(res.body.intent.endTime, endTime);
    }

    {
      const res = makeRes();
      await createProfitDistributionIntent(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          body: {
            chainId: 84532,
            propertyId: 'prop-001',
            profitDistributorAddress: ownerWallet.address,
            usdcAmountBaseUnits: '1000000',
          },
        },
        res
      );
      assert.equal(res.statusCode, 201, 'owner should create profit distribution intent');
      assert.equal(res.body.intent.propertyId, 'prop-001');
      assert.equal(res.body.intent.status, 'pending');
    }

    {
      const res = makeRes();
      await createPlatformFeeIntent(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          body: {
            chainId: 84532,
            campaignAddress: ownerWallet.address,
            platformFeeBps: 250,
            platformFeeRecipient: ownerWallet.address,
          },
        },
        res
      );
      assert.equal(res.statusCode, 201, 'owner should create platform fee intent');
      assert.equal(res.body.intent.platformFeeBps, 250);
      assert.equal(res.body.intent.status, 'pending');
    }

    {
      const res = makeRes();
      await listProperties({ query: {} }, res);
      assert.equal(res.statusCode, 200, 'list properties should succeed');
      assert.ok(Array.isArray(res.body.properties));
      assert.equal(res.body.properties.length, 1);
    }

    {
      const res = makeRes();
      await listCampaigns({ query: {} }, res);
      assert.equal(res.statusCode, 200, 'list campaigns should succeed');
      assert.ok(Array.isArray(res.body.campaigns));
      assert.equal(res.body.campaigns.length, 1);
    }

    {
      const req = {
        user: { id: 'u1', address: investorWallet.address, role: 'investor' },
        query: {},
      };

      const investmentsRes = makeRes();
      await listMyInvestments(req, investmentsRes);
      assert.equal(investmentsRes.statusCode, 200, 'list my investments should succeed');
      assert.ok(Array.isArray(investmentsRes.body.investments));

      const equityRes = makeRes();
      await listMyEquityClaims(req, equityRes);
      assert.equal(equityRes.statusCode, 200, 'list my equity claims should succeed');
      assert.ok(Array.isArray(equityRes.body.equityClaims));

      const profitRes = makeRes();
      await listMyProfitClaims(req, profitRes);
      assert.equal(profitRes.statusCode, 200, 'list my profit claims should succeed');
      assert.ok(Array.isArray(profitRes.body.profitClaims));
    }

    {
      const res = makeRes();
      await getProfitPreflight(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          query: {
            propertyId: 'prop-001',
            usdcAmountBaseUnits: '1000000',
          },
        },
        res
      );
      assert.equal(res.statusCode, 200, 'profit preflight should succeed');
      assert.equal(res.body.propertyId, 'prop-001');
      assert.equal(res.body.checks.operatorConfigured, true);
      assert.equal(res.body.checks.ownerMatchesOperator, true);
      assert.equal(res.body.checks.hasSufficientBalance, true);
      assert.equal(res.body.checks.hasSufficientAllowance, true);
      assert.equal(res.body.checks.indexerHealthy, true);
      assert.equal(res.body.checks.workersHealthy, true);
    }

    {
      const res = makeRes();
      await getProfitFlowStatus(
        {
          user: { id: 'o1', address: ownerWallet.address, role: 'owner' },
          query: {
            propertyId: 'prop-001',
          },
        },
        res
      );
      assert.equal(res.statusCode, 200, 'profit flow status should succeed');
      assert.equal(res.body.propertyId, 'prop-001');
      assert.equal(res.body.flags.intentSubmitted, true);
      assert.equal(res.body.flags.intentConfirmed, true);
      assert.equal(res.body.flags.depositIndexed, true);
      assert.equal(res.body.flags.claimablePoolPositive, true);
      assert.equal(res.body.unclaimedPoolBaseUnits, '750000');
    }

    console.log('v1 auth/admin/query tests passed');
  } finally {
    restoreStubs();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
