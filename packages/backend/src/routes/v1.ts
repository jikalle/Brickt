import { Router, type Router as ExpressRouter } from 'express';
import { auth, requireRole } from '../middleware/auth.js';
import {
  archiveAdminProperty,
  getProperty,
  listAdminProperties,
  listEquityClaims,
  listProfitClaims,
  listProfitDeposits,
  listProperties,
  restoreAdminProperty,
  updateAdminProperty,
} from '../controllers/v1/propertiesController.js';
import {
  getCampaign,
  listCampaignInvestments,
  listCampaignRefunds,
  listCampaigns,
} from '../controllers/v1/campaignsController.js';
import {
  listMyEquityClaims,
  listMyInvestments,
  listMyProfitClaims,
  listMyProfitStatus,
} from '../controllers/v1/meController.js';
import {
  approveProfitAllowance,
  finalizeCampaign,
  getCampaignLifecyclePreflight,
  createCloudinaryUploadSignature,
  createIntentBatch,
  createPlatformFeeIntent,
  createProfitDistributionIntent,
  createPropertyIntent,
  getProfitFlowStatus,
  getProfitPreflight,
  getPlatformFeeFlowStatus,
  getPlatformFeePreflight,
  repairCampaignSetup,
  listAdminOnchainActivities,
  listPlatformFeeIntents,
  listProfitDistributionIntents,
  listPropertyIntents,
  getLastProcessingRun,
  runCronProcessing,
  runAdminProcessingNow,
  resetAdminIntent,
  retryAdminIntent,
  withdrawCampaignFunds,
} from '../controllers/v1/adminController.js';
import { getAdminMetrics } from '../controllers/v1/observabilityController.js';
import { quoteAssetUsdc, quoteEthUsdc } from '../controllers/v1/quotesController.js';

const router: ExpressRouter = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});
router.post('/admin/processing/cron', runCronProcessing);

router.get('/properties', listProperties);
router.get('/properties/:propertyId', getProperty);
router.get('/properties/:propertyId/equity-claims', listEquityClaims);
router.get('/properties/:propertyId/profit-deposits', listProfitDeposits);
router.get('/properties/:propertyId/profit-claims', listProfitClaims);

router.get('/campaigns', listCampaigns);
router.get('/campaigns/:campaignAddress', getCampaign);
router.get('/campaigns/:campaignAddress/investments', listCampaignInvestments);
router.get('/campaigns/:campaignAddress/refunds', listCampaignRefunds);
router.get('/quotes/eth-usdc', quoteEthUsdc);
router.get('/quotes/asset-usdc', quoteAssetUsdc);

router.get('/me/investments', auth, listMyInvestments);
router.get('/me/equity-claims', auth, listMyEquityClaims);
router.get('/me/profit-claims', auth, listMyProfitClaims);
router.get('/me/profit-status', auth, listMyProfitStatus);

router.post('/admin/properties/intents', auth, requireRole('owner'), createPropertyIntent);
router.post('/admin/media/cloudinary/signature', auth, requireRole('owner'), createCloudinaryUploadSignature);
router.get('/admin/properties', auth, requireRole('owner'), listAdminProperties);
router.patch('/admin/properties/:propertyId', auth, requireRole('owner'), updateAdminProperty);
router.delete('/admin/properties/:propertyId', auth, requireRole('owner'), archiveAdminProperty);
router.post('/admin/properties/:propertyId/restore', auth, requireRole('owner'), restoreAdminProperty);
router.post('/admin/intents/batch', auth, requireRole('owner'), createIntentBatch);
router.post('/admin/profits/intents', auth, requireRole('owner'), createProfitDistributionIntent);
router.post('/admin/profits/approve', auth, requireRole('owner'), approveProfitAllowance);
router.post('/admin/platform-fees/intents', auth, requireRole('owner'), createPlatformFeeIntent);
router.post('/admin/intents/:intentType/:intentId/retry', auth, requireRole('owner'), retryAdminIntent);
router.post('/admin/intents/:intentType/:intentId/reset', auth, requireRole('owner'), resetAdminIntent);
router.get('/admin/properties/intents', auth, requireRole('owner'), listPropertyIntents);
router.get('/admin/profits/intents', auth, requireRole('owner'), listProfitDistributionIntents);
router.get('/admin/profits/preflight', auth, requireRole('owner'), getProfitPreflight);
router.get('/admin/profits/flow-status', auth, requireRole('owner'), getProfitFlowStatus);
router.get('/admin/platform-fees/preflight', auth, requireRole('owner'), getPlatformFeePreflight);
router.get('/admin/platform-fees/flow-status', auth, requireRole('owner'), getPlatformFeeFlowStatus);
router.get('/admin/platform-fees/intents', auth, requireRole('owner'), listPlatformFeeIntents);
router.get('/admin/onchain-activities', auth, requireRole('owner'), listAdminOnchainActivities);
router.get('/admin/campaigns/preflight', auth, requireRole('owner'), getCampaignLifecyclePreflight);
router.post('/admin/campaigns/finalize', auth, requireRole('owner'), finalizeCampaign);
router.post('/admin/campaigns/withdraw', auth, requireRole('owner'), withdrawCampaignFunds);
router.post('/admin/campaigns/repair-setup', auth, requireRole('owner'), repairCampaignSetup);
router.post('/admin/processing/run', auth, requireRole('owner'), runAdminProcessingNow);
router.get('/admin/processing/last', auth, requireRole('owner'), getLastProcessingRun);
router.get('/admin/metrics', auth, requireRole('owner'), getAdminMetrics);

export default router;
