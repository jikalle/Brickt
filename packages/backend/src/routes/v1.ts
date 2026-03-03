import { Router, type Router as ExpressRouter } from 'express';
import { auth, requireRole } from '../middleware/auth.js';
import {
  getProperty,
  listEquityClaims,
  listProfitClaims,
  listProfitDeposits,
  listProperties,
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
} from '../controllers/v1/meController.js';
import {
  createPlatformFeeIntent,
  createProfitDistributionIntent,
  createPropertyIntent,
  getProfitFlowStatus,
  getProfitPreflight,
  listPlatformFeeIntents,
  listProfitDistributionIntents,
  listPropertyIntents,
} from '../controllers/v1/adminController.js';
import { getAdminMetrics } from '../controllers/v1/observabilityController.js';
import { quoteEthUsdc } from '../controllers/v1/quotesController.js';

const router: ExpressRouter = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

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

router.get('/me/investments', auth, listMyInvestments);
router.get('/me/equity-claims', auth, listMyEquityClaims);
router.get('/me/profit-claims', auth, listMyProfitClaims);

router.post('/admin/properties/intents', auth, requireRole('owner'), createPropertyIntent);
router.post('/admin/profits/intents', auth, requireRole('owner'), createProfitDistributionIntent);
router.post('/admin/platform-fees/intents', auth, requireRole('owner'), createPlatformFeeIntent);
router.get('/admin/properties/intents', auth, requireRole('owner'), listPropertyIntents);
router.get('/admin/profits/intents', auth, requireRole('owner'), listProfitDistributionIntents);
router.get('/admin/profits/preflight', auth, requireRole('owner'), getProfitPreflight);
router.get('/admin/profits/flow-status', auth, requireRole('owner'), getProfitFlowStatus);
router.get('/admin/platform-fees/intents', auth, requireRole('owner'), listPlatformFeeIntents);
router.get('/admin/metrics', auth, requireRole('owner'), getAdminMetrics);

export default router;
