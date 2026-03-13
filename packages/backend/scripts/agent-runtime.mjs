/**
 * Brickt AI Agent Runtime
 *
 * Autonomous user-facing agent that:
 * - monitors active campaigns
 * - finalizes campaigns when eligible
 * - links equity tokens when the campaign owner/operator can do so
 * - stores readable reasoning in agent_activities
 * - exposes local /status, /activities, /chat endpoints for the backend proxy
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { Contract, JsonRpcProvider, NonceManager, Wallet } from 'ethers';
import { createServer } from 'http';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const OPENAI = process.env.OPENAI_API_KEY || '';
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY || '';
const OPERATOR_KEY = process.env.PLATFORM_OPERATOR_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
const PORT = Number(process.env.AGENT_PORT || 3001);
const POLL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS || 20000);
const IS_TESTNET = RPC_URL.includes('sepolia');
const CHAIN_ID = Number(process.env.BASE_SEPOLIA_CHAIN_ID || 84532);
const LLM_PROVIDER = OPENAI ? 'openai' : ANTHROPIC ? 'anthropic' : '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

if (!RPC_URL) throw new Error('Missing BASE_SEPOLIA_RPC_URL or BASE_MAINNET_RPC_URL');
if (!DB_URL) throw new Error('Missing DATABASE_URL');
if (!AGENT_KEY && !OPERATOR_KEY) {
  throw new Error('Missing AGENT_PRIVATE_KEY or PLATFORM_OPERATOR_PRIVATE_KEY');
}

const pool = new pg.Pool({ connectionString: DB_URL });
const provider = new JsonRpcProvider(RPC_URL);
const activeAgentKey = AGENT_KEY || OPERATOR_KEY;
const baseSigner = new Wallet(activeAgentKey, provider);
const signer = new NonceManager(baseSigner);
const agentAddress = baseSigner.address.toLowerCase();
const operatorAddress = OPERATOR_KEY ? new Wallet(OPERATOR_KEY).address.toLowerCase() : null;
const hasDedicatedAgentKey = Boolean(AGENT_KEY);

const crowdfundReadAbi = [
  'function owner() view returns (address)',
  'function state() view returns (uint8)',
  'function targetAmountUSDC() view returns (uint256)',
  'function raisedAmountUSDC() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function equityToken() view returns (address)',
];

const crowdfundWriteAbi = [
  'function finalizeCampaign()',
  'function setEquityToken(address)',
];

const STATES = { 0: 'ACTIVE', 1: 'SUCCESS', 2: 'FAILED', 3: 'WITHDRAWN' };
const ZERO = '0x0000000000000000000000000000000000000000';

async function logActivity({
  campaignAddress = null,
  propertyId = null,
  eventType,
  raisedUsdc = null,
  targetUsdc = null,
  campaignState = null,
  reasoning,
  txHash = null,
  executed = false,
  userMessage = null,
  severity = 'info',
}) {
  try {
    await pool.query(
      `INSERT INTO agent_activities
        (campaign_address, property_id, event_type, raised_usdc, target_usdc,
         campaign_state, reasoning, tx_hash, executed, user_message, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        campaignAddress,
        propertyId,
        eventType,
        raisedUsdc,
        targetUsdc,
        campaignState,
        reasoning,
        txHash,
        executed,
        userMessage,
        severity,
      ]
    );
  } catch (error) {
    console.error('[agent] failed to log activity:', error instanceof Error ? error.message : error);
  }
}

async function askAnthropic(systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text?.trim() || '(no response)';
}

async function askOpenAI(systemPrompt, userPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 512,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '(no response)';
}

async function askModel(systemPrompt, userPrompt) {
  if (LLM_PROVIDER === 'openai') {
    return askOpenAI(systemPrompt, userPrompt);
  }
  if (LLM_PROVIDER === 'anthropic') {
    return askAnthropic(systemPrompt, userPrompt);
  }
  throw new Error('No LLM provider configured');
}

function isRetryableLlmError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('429') ||
    message.includes('insufficient_quota') ||
    message.includes('rate limit') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('network')
  );
}

function buildFallbackReasoning(kind, payload = {}) {
  const propertyLabel = payload.propertyTitle || payload.propertyId || 'this property';
  const raised = typeof payload.raisedUsdc === 'number' ? payload.raisedUsdc.toFixed(2) : null;
  const target = typeof payload.targetUsdc === 'number' ? payload.targetUsdc.toFixed(2) : null;

  switch (kind) {
    case 'finalize_success':
      return `${propertyLabel} reached its funding conditions, so the campaign has been finalized successfully. Investors can now expect the post-funding steps to continue, including withdrawal processing and equity setup where applicable.`;
    case 'finalize_failed':
      return `${propertyLabel} did not meet the required funding conditions before the campaign ended, so it has been finalized as unsuccessful. Investors should expect refund availability rather than equity issuance or profit distribution.`;
    case 'monitor':
      if (raised && target) {
        return `${propertyLabel} is still active with ${raised} USDC raised against a ${target} USDC target. Investors can continue funding while the agent keeps monitoring the campaign for completion or expiry.`;
      }
      return `${propertyLabel} is still active and under monitoring. Investors can continue funding while the agent watches for campaign completion or expiry.`;
    case 'equity_set':
      return `${propertyLabel} has had its equity token linked to the funded campaign. Investors are now positioned for equity claim flows once the downstream setup and indexing complete.`;
    case 'chat':
      return `The autonomous agent is online, but live LLM reasoning is temporarily unavailable. Core monitoring and on-chain execution continue, and you can still rely on the activity feed for recent campaign actions.`;
    case 'error':
      return `The agent hit a temporary reasoning-provider issue and switched to deterministic fallback messaging. Monitoring and eligible on-chain actions will continue on the next cycle.`;
    default:
      return `The agent completed this step using deterministic fallback reasoning because the LLM provider was unavailable. Monitoring and on-chain execution continue normally.`;
  }
}

async function explain(kind, userPrompt, payload = {}) {
  try {
    return await askModel(AGENT_SYSTEM_PROMPT, userPrompt);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    console.error('[agent] reasoning fallback:', message);
    return buildFallbackReasoning(kind, payload);
  }
}

const AGENT_SYSTEM_PROMPT = `You are the Brickt Investment Agent — a user-facing autonomous AI managing real estate crowdfunding pools on Base blockchain for African markets.

Your job is to explain your on-chain decisions in 2-3 plain English sentences, as if briefing an investor. Be specific, concise, and factual. Reference actual numbers when available. Always end with what happens next for investors.`;

async function loadCampaigns() {
  const { rows } = await pool.query(
    `
    SELECT
      LOWER(c.contract_address) AS campaign_address,
      p.property_id,
      p.name AS property_title,
      LOWER(p.equity_token_address) AS equity_token_address
    FROM campaigns c
    JOIN properties p ON p.id = c.property_id
    WHERE c.chain_id = $1
      AND c.state = 'ACTIVE'
      AND p.archived_at IS NULL
    ORDER BY c.created_at ASC
    LIMIT 20
    `,
    [CHAIN_ID]
  );
  return rows;
}

async function loadEquityCandidates() {
  const { rows } = await pool.query(
    `
    SELECT
      LOWER(c.contract_address) AS campaign_address,
      p.property_id,
      LOWER(p.equity_token_address) AS equity_token_address
    FROM campaigns c
    JOIN properties p ON p.id = c.property_id
    WHERE c.chain_id = $1
      AND c.state IN ('SUCCESS', 'WITHDRAWN')
      AND p.equity_token_address IS NOT NULL
      AND p.archived_at IS NULL
    ORDER BY c.updated_at ASC
    LIMIT 20
    `,
    [CHAIN_ID]
  );
  return rows;
}

async function getCampaignSnapshot(address) {
  const contract = new Contract(address, crowdfundReadAbi, provider);
  const [owner, stateIdx, target, raised, endTime, equityToken] = await Promise.all([
    contract.owner(),
    contract.state(),
    contract.targetAmountUSDC(),
    contract.raisedAmountUSDC(),
    contract.endTime(),
    contract.equityToken(),
  ]);

  const now = Math.floor(Date.now() / 1000);
  const state = STATES[Number(stateIdx)] || 'UNKNOWN';
  const isTargetReached = raised >= target;
  const isEnded = now >= Number(endTime);
  const canFinalize = state === 'ACTIVE' && (isTargetReached || isEnded);
  const canSetEquity =
    (state === 'SUCCESS' || state === 'WITHDRAWN') &&
    equityToken.toLowerCase() === ZERO;

  return {
    owner: owner.toLowerCase(),
    state,
    target: target.toString(),
    raised: raised.toString(),
    endTime: Number(endTime),
    equityToken: equityToken.toLowerCase(),
    isTargetReached,
    isEnded,
    canFinalize,
    canSetEquity,
  };
}

async function runCycle() {
  const campaigns = await loadCampaigns();
  if (campaigns.length === 0) {
    return;
  }

  for (const row of campaigns) {
    const addr = row.campaign_address;
    if (!addr) continue;

    try {
      const snap = await getCampaignSnapshot(addr);
      const label = row.property_title || row.property_id || `${addr.slice(0, 10)}...`;
      const pct = snap.target !== '0'
        ? Math.round((Number(snap.raised) / Number(snap.target)) * 100)
        : 0;

      const context = `Campaign: ${label}
Address: ${addr}
State: ${snap.state}
Raised: ${(Number(snap.raised) / 1e6).toFixed(2)} USDC (${pct}% of target)
Target: ${(Number(snap.target) / 1e6).toFixed(2)} USDC
Deadline passed: ${snap.isEnded ? 'Yes' : 'No'}
Target reached: ${snap.isTargetReached ? 'Yes' : 'No'}
Action to take: ${snap.canFinalize ? (snap.isTargetReached ? 'FINALIZE_SUCCESS' : 'FINALIZE_FAILED') : 'MONITOR'}`;

      if (snap.canFinalize && snap.owner === agentAddress) {
        const outcome = snap.isTargetReached ? 'SUCCESS' : 'FAILED';
        const raisedUsdc = Number(snap.raised) / 1e6;
        const targetUsdc = Number(snap.target) / 1e6;
        const reasoning = await explain(
          snap.isTargetReached ? 'finalize_success' : 'finalize_failed',
          `I am about to finalize this campaign as ${outcome}. Explain this decision to investors:\n\n${context}`,
          {
            propertyTitle: label,
            propertyId: row.property_id,
            raisedUsdc,
            targetUsdc,
          }
        );

        let txHash = null;
        let executed = false;
        try {
          const contract = new Contract(addr, crowdfundWriteAbi, signer);
          const tx = await contract.finalizeCampaign();
          const receipt = await tx.wait();
          txHash = tx.hash;
          executed = receipt?.status === 1;
        } catch (error) {
          console.error('[agent] finalize tx failed:', error instanceof Error ? error.message : error);
        }

        await logActivity({
          campaignAddress: addr,
          propertyId: row.property_id,
          eventType: `CAMPAIGN_FINALIZED_${outcome}`,
          raisedUsdc,
          targetUsdc,
          campaignState: outcome,
          reasoning,
          txHash,
          executed,
          severity: outcome === 'SUCCESS' ? 'success' : 'warning',
        });
      } else if (!snap.canFinalize && snap.state === 'ACTIVE' && Math.random() < 0.2) {
        const reasoning = await explain(
          'monitor',
          `Give a brief status update for this active campaign:\n\n${context}`,
          {
            propertyTitle: label,
            propertyId: row.property_id,
            raisedUsdc: Number(snap.raised) / 1e6,
            targetUsdc: Number(snap.target) / 1e6,
          }
        );
        await logActivity({
          campaignAddress: addr,
          propertyId: row.property_id,
          eventType: 'POOL_MONITORING',
          raisedUsdc: Number(snap.raised) / 1e6,
          targetUsdc: Number(snap.target) / 1e6,
          campaignState: snap.state,
          reasoning,
          severity: 'info',
        });
      }
    } catch (error) {
      console.error(`[agent] error processing ${addr}:`, error instanceof Error ? error.message : error);
    }
  }

  const equityCandidates = await loadEquityCandidates();
  for (const row of equityCandidates) {
    const addr = row.campaign_address;
    const equityAddr = row.equity_token_address;
    if (!addr || !equityAddr) continue;

    try {
      const snap = await getCampaignSnapshot(addr);
      if (!snap.canSetEquity || snap.owner !== agentAddress) continue;

      const reasoning = await explain(
        'equity_set',
        `I am linking the equity token (${equityAddr}) to the successfully funded campaign at ${addr}. Explain this to investors in 2-3 sentences.`,
        {
          propertyId: row.property_id,
        }
      );

      let txHash = null;
      let executed = false;
      try {
        const contract = new Contract(addr, crowdfundWriteAbi, signer);
        const tx = await contract.setEquityToken(equityAddr);
        const receipt = await tx.wait();
        txHash = tx.hash;
        executed = receipt?.status === 1;
      } catch (error) {
        console.error('[agent] setEquityToken failed:', error instanceof Error ? error.message : error);
      }

      await logActivity({
        campaignAddress: addr,
        propertyId: row.property_id,
        eventType: 'EQUITY_TOKEN_SET',
        campaignState: snap.state,
        reasoning,
        txHash,
        executed,
        severity: 'success',
      });
    } catch (error) {
      console.error(`[agent] equity setup error ${addr}:`, error instanceof Error ? error.message : error);
    }
  }
}

const CHAT_SYSTEM = `You are the Brickt Investment Agent — a user-facing autonomous AI managing real estate crowdfunding pools on Base blockchain for African markets. You can explain campaign status, recent autonomous actions, and what happens next for investors. Be concise and factual.`;

async function handleChat(message) {
  let recentActivity = '';
  try {
    const { rows } = await pool.query(`
      SELECT event_type, campaign_address, reasoning, severity, created_at
      FROM agent_activities
      ORDER BY created_at DESC
      LIMIT 5
    `);
    if (rows.length > 0) {
      recentActivity =
        '\n\nRecent activity:\n' +
        rows
          .map(
            (row) =>
              `- [${row.event_type}] ${row.campaign_address || 'global'}: ${String(row.reasoning).slice(0, 100)}...`
          )
          .join('\n');
    }
  } catch {}

  const response = await explain('chat', message, {});
  await logActivity({
    eventType: 'CHAT_RESPONSE',
    reasoning: response,
    userMessage: message,
    severity: 'info',
  });
  return response;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/activities') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100);
    const campaign = url.searchParams.get('campaign');
    const params = campaign ? [limit, campaign.toLowerCase()] : [limit];
    const where = campaign ? 'WHERE LOWER(campaign_address) = $2' : '';
    try {
      const { rows } = await pool.query(
        `SELECT * FROM agent_activities ${where} ORDER BY created_at DESC LIMIT $1`,
        params
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ activities: rows }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to fetch activities' }));
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'running',
        agentAddress,
        operatorAddress,
        hasDedicatedAgentKey,
        network: IS_TESTNET ? 'base-sepolia' : 'base-mainnet',
        pollIntervalMs: POLL_MS,
      })
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/chat') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const message = String(parsed.message || '').trim();
        if (!message) {
          throw new Error('message required');
        }
        const response = await handleChat(message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid request' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, async () => {
  console.log(`[agent] started on port ${PORT}`);
  await logActivity({
    eventType: 'AGENT_STARTED',
    reasoning: `Brickt Investment Agent initialized on ${IS_TESTNET ? 'Base Sepolia testnet' : 'Base Mainnet'}. Agent wallet: ${agentAddress}.${hasDedicatedAgentKey ? ' Dedicated agent key is active.' : ' Falling back to operator key because AGENT_PRIVATE_KEY is not set.'} Monitoring active campaigns every ${POLL_MS / 1000}s and executing on-chain decisions autonomously using ${LLM_PROVIDER || 'deterministic fallback'}.`,
    severity: 'info',
  });

  while (true) {
    try {
      await runCycle();
    } catch (error) {
      console.error('[agent] cycle error:', error instanceof Error ? error.message : error);
      await logActivity({
        eventType: 'AGENT_ERROR',
        reasoning: isRetryableLlmError(error)
          ? buildFallbackReasoning('error')
          : `Agent encountered an error during monitoring cycle: ${error instanceof Error ? error.message : 'unknown error'}. Will retry on next cycle.`,
        severity: 'error',
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
});
