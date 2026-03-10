import type { Sequelize, Transaction } from 'sequelize';

export type OnchainActivityStatus = 'submitted' | 'confirmed' | 'indexed' | 'failed';
export type OnchainActivityActorRole = 'owner' | 'worker';
export type OnchainActivityIntentType = 'property' | 'profit' | 'platformFee';

export type UpsertOnchainActivityInput = {
  chainId: number;
  txHash: string;
  activityType: string;
  status: OnchainActivityStatus;
  actorRole?: OnchainActivityActorRole | null;
  actorAddress?: string | null;
  propertyId?: string | null;
  campaignAddress?: string | null;
  intentType?: OnchainActivityIntentType | null;
  intentId?: string | null;
  blockNumber?: number | null;
  logIndex?: number | null;
  metadata?: Record<string, unknown> | null;
  lastError?: string | null;
};

const toJson = (value: Record<string, unknown> | null | undefined): string =>
  JSON.stringify(value ?? {});

export const upsertOnchainActivity = async (
  db: Sequelize,
  input: UpsertOnchainActivityInput,
  options?: { transaction?: Transaction }
): Promise<void> => {
  await db.query(
    `
    INSERT INTO onchain_activities (
      chain_id,
      tx_hash,
      activity_type,
      status,
      actor_role,
      actor_address,
      property_id,
      campaign_address,
      intent_type,
      intent_id,
      block_number,
      log_index,
      metadata_json,
      last_error,
      submitted_at,
      confirmed_at,
      indexed_at
    ) VALUES (
      :chainId,
      :txHash,
      :activityType,
      :status,
      :actorRole,
      :actorAddress,
      :propertyId,
      :campaignAddress,
      :intentType,
      :intentId,
      :blockNumber,
      :logIndex,
      :metadataJson::jsonb,
      :lastError,
      CASE WHEN :status = 'submitted' THEN NOW() ELSE NULL END,
      CASE WHEN :status IN ('confirmed', 'indexed') THEN NOW() ELSE NULL END,
      CASE WHEN :status = 'indexed' THEN NOW() ELSE NULL END
    )
    ON CONFLICT (tx_hash) DO UPDATE
    SET
      activity_type = COALESCE(EXCLUDED.activity_type, onchain_activities.activity_type),
      status = CASE
        WHEN onchain_activities.status = 'indexed' THEN 'indexed'
        WHEN onchain_activities.status = 'confirmed' AND EXCLUDED.status = 'submitted' THEN 'confirmed'
        ELSE EXCLUDED.status
      END,
      actor_role = COALESCE(onchain_activities.actor_role, EXCLUDED.actor_role),
      actor_address = COALESCE(onchain_activities.actor_address, EXCLUDED.actor_address),
      property_id = COALESCE(EXCLUDED.property_id, onchain_activities.property_id),
      campaign_address = COALESCE(EXCLUDED.campaign_address, onchain_activities.campaign_address),
      intent_type = COALESCE(onchain_activities.intent_type, EXCLUDED.intent_type),
      intent_id = COALESCE(onchain_activities.intent_id, EXCLUDED.intent_id),
      block_number = COALESCE(EXCLUDED.block_number, onchain_activities.block_number),
      log_index = COALESCE(EXCLUDED.log_index, onchain_activities.log_index),
      metadata_json = COALESCE(onchain_activities.metadata_json, '{}'::jsonb) || COALESCE(EXCLUDED.metadata_json, '{}'::jsonb),
      last_error = COALESCE(EXCLUDED.last_error, onchain_activities.last_error),
      submitted_at = CASE
        WHEN onchain_activities.submitted_at IS NOT NULL THEN onchain_activities.submitted_at
        WHEN EXCLUDED.status = 'submitted' THEN NOW()
        ELSE onchain_activities.submitted_at
      END,
      confirmed_at = CASE
        WHEN onchain_activities.confirmed_at IS NOT NULL THEN onchain_activities.confirmed_at
        WHEN EXCLUDED.status IN ('confirmed', 'indexed') THEN NOW()
        ELSE onchain_activities.confirmed_at
      END,
      indexed_at = CASE
        WHEN onchain_activities.indexed_at IS NOT NULL THEN onchain_activities.indexed_at
        WHEN EXCLUDED.status = 'indexed' THEN NOW()
        ELSE onchain_activities.indexed_at
      END,
      updated_at = NOW()
    `,
    {
      replacements: {
        chainId: input.chainId,
        txHash: input.txHash,
        activityType: input.activityType,
        status: input.status,
        actorRole: input.actorRole ?? null,
        actorAddress: input.actorAddress ?? null,
        propertyId: input.propertyId ?? null,
        campaignAddress: input.campaignAddress ?? null,
        intentType: input.intentType ?? null,
        intentId: input.intentId ?? null,
        blockNumber: input.blockNumber ?? null,
        logIndex: input.logIndex ?? null,
        metadataJson: toJson(input.metadata),
        lastError: input.lastError ?? null,
      },
      transaction: options?.transaction,
    }
  );
};

export const markOnchainActivityIndexed = async (
  db: Sequelize,
  input: Pick<UpsertOnchainActivityInput, 'chainId' | 'txHash'> &
    Partial<
      Pick<
        UpsertOnchainActivityInput,
        'activityType' | 'propertyId' | 'campaignAddress' | 'blockNumber' | 'logIndex' | 'metadata'
      >
    >,
  options?: { transaction?: Transaction }
): Promise<void> =>
  upsertOnchainActivity(
    db,
    {
      chainId: input.chainId,
      txHash: input.txHash,
      activityType: input.activityType ?? 'indexed-event',
      status: 'indexed',
      propertyId: input.propertyId ?? null,
      campaignAddress: input.campaignAddress ?? null,
      blockNumber: input.blockNumber ?? null,
      logIndex: input.logIndex ?? null,
      metadata: input.metadata ?? null,
    },
    options
  );
