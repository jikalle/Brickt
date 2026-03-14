import type { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { sendError } from '../../lib/apiError.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

const getAgentPort = () => Number(process.env.AGENT_PORT || 3001);
const getAgentBaseUrl = () => {
  const configured = process.env.AGENT_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `http://127.0.0.1:${getAgentPort()}`;
};

const fetchJsonWithTimeout = async (url: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
};

export async function listAgentActivities(req: Request, res: Response): Promise<void> {
  const limit = Math.min(Number(req.query.limit || 30), 100);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const campaign = typeof req.query.campaign === 'string' ? req.query.campaign.toLowerCase() : null;
  const severity = typeof req.query.severity === 'string' ? req.query.severity : null;

  const conditions: string[] = [];
  const replacements: Record<string, unknown> = { limit, offset };

  if (campaign) {
    conditions.push('LOWER(campaign_address) = :campaign');
    replacements.campaign = campaign;
  }
  if (severity) {
    conditions.push('severity = :severity');
    replacements.severity = severity;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const activities = await sequelize.query(
      `
      SELECT
        id,
        created_at AS "created_at",
        LOWER(campaign_address) AS "campaign_address",
        property_id AS "property_id",
        event_type AS "event_type",
        raised_usdc AS "raised_usdc",
        target_usdc AS "target_usdc",
        campaign_state AS "campaign_state",
        reasoning,
        tx_hash AS "tx_hash",
        executed,
        user_message AS "user_message",
        severity
      FROM agent_activities
      ${where}
      ORDER BY created_at DESC
      LIMIT :limit
      OFFSET :offset
      `,
      {
        type: QueryTypes.SELECT,
        replacements,
      }
    );

    const countRows = await sequelize.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM agent_activities ${where}`,
      {
        type: QueryTypes.SELECT,
        replacements,
      }
    );

    res.json({
      activities,
      total: Number(countRows[0]?.total || '0'),
      limit,
      offset,
    });
  } catch (error) {
    console.error('[agentController] listAgentActivities error:', error);
    sendError(res, 500, 'Failed to fetch agent activities', 'internal_error');
  }
}

export async function getAgentStatus(_req: Request, res: Response): Promise<void> {
  const agentBaseUrl = getAgentBaseUrl();
  try {
    const { response, data } = await fetchJsonWithTimeout(`${agentBaseUrl}/status`);
    if (!response.ok) {
      throw new Error('agent status unavailable');
    }
    const payload = data && typeof data === 'object' ? data : {};
    res.json({ online: true, ...payload });
  } catch {
    try {
      const lastRows = await sequelize.query<{
        created_at: string | null;
        event_type: string | null;
        severity: string | null;
      }>(
        `
        SELECT created_at, event_type, severity
        FROM agent_activities
        ORDER BY created_at DESC
        LIMIT 1
        `,
        { type: QueryTypes.SELECT }
      );
      const last = lastRows[0];
      res.json({
        online: false,
        lastSeen: last?.created_at || null,
        lastEvent: last?.event_type || null,
        lastSeverity: last?.severity || null,
      });
    } catch {
      res.json({ online: false });
    }
  }
}

export async function chatWithAgent(req: AuthenticatedRequest, res: Response): Promise<void> {
  const body = req.body as { message?: string; propertyId?: string; campaignAddress?: string };
  const message = body?.message?.trim();
  const propertyId = typeof body?.propertyId === 'string' ? body.propertyId.trim() : null;
  const campaignAddress = typeof body?.campaignAddress === 'string' ? body.campaignAddress.trim().toLowerCase() : null;
  if (!message) {
    sendError(res, 400, 'message required', 'validation_error');
    return;
  }
  if (message.length > 1500) {
    sendError(res, 400, 'message too long', 'validation_error');
    return;
  }

  const agentBaseUrl = getAgentBaseUrl();
  try {
    const { response, data } = await fetchJsonWithTimeout(`${agentBaseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        propertyId,
        campaignAddress,
        userAddress: req.user?.address || null,
        userRole: req.user?.role || null,
      }),
    });

    if (!response.ok) {
      throw new Error(String((data as { error?: string })?.error || 'Agent not available'));
    }

    res.json(data);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Agent not available';
    sendError(res, 503, messageText, 'service_unavailable');
  }
}
