import { Request, Response } from 'express';
import { Contract, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import { normalizeAddress, ValidationError } from '../../validators/v1.js';
import { sendError } from '../../lib/apiError.js';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const DEFAULT_WETH = '0x4200000000000000000000000000000000000006';
const DEFAULT_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
];

const parseAmountIn = (value: unknown, decimals: number): { amountIn: string; amountInBaseUnits: bigint } => {
  const amountIn = value?.toString()?.trim() || '';
  if (!amountIn) {
    throw new ValidationError('Missing amountIn');
  }
  const asNumber = Number(amountIn);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    throw new ValidationError('Invalid amountIn');
  }
  try {
    return { amountIn, amountInBaseUnits: parseUnits(amountIn, decimals) };
  } catch (_error) {
    throw new ValidationError('Invalid amountIn precision');
  }
};

const parsePercentToBps = (value: unknown, fallback = 100): number => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError('Invalid slippagePercent');
  }
  if (parsed > 50) {
    throw new ValidationError('slippagePercent cannot exceed 50');
  }
  return Math.round(parsed * 100);
};

const parseAmountEth = (value: unknown): { amountEth: string; amountInWei: bigint } => {
  const { amountIn, amountInBaseUnits } = parseAmountIn(value, 18);
  return { amountEth: amountIn, amountInWei: amountInBaseUnits };
};

const parseFeeTiers = (): number[] => {
  const configured = (process.env.BASE_SEPOLIA_SWAP_FEE_TIERS || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  const defaults = [500, 3000, 10000];
  return Array.from(new Set([...configured, ...defaults]));
};

const resolveAddress = (value: string | undefined, fallback: string): string => {
  const normalized = (value || '').trim();
  if (!normalized) {
    return fallback.toLowerCase();
  }
  return normalized.toLowerCase();
};

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ValidationError) {
    return sendError(res, error.status, error.message, 'validation_error');
  }
  console.error('[quotes.eth-usdc] unexpected-error', error);
  return sendError(res, 500, 'Internal server error', 'internal_error');
};

const quoteAssetToUsdcInternal = async (params: {
  rpcUrl: string;
  quoterAddress: string;
  tokenInAddress: string;
  tokenInDecimals: number;
  amountIn: string;
  slippageBps: number;
  usdcAddress: string;
}) => {
  const feeTiers = parseFeeTiers();
  const provider = new JsonRpcProvider(params.rpcUrl);
  const quoter = new Contract(params.quoterAddress, QUOTER_ABI, provider);
  const { amountIn, amountInBaseUnits } = parseAmountIn(params.amountIn, params.tokenInDecimals);

  let selectedFeeTier: number | null = null;
  let estimatedUsdcBaseUnits: bigint | null = null;
  let lastError: unknown = null;

  for (const feeTier of feeTiers) {
    try {
      let amountOut: bigint | null = null;
      try {
        amountOut = (await quoter[
          'quoteExactInputSingle(address,address,uint24,uint256,uint160)'
        ].staticCall(params.tokenInAddress, params.usdcAddress, feeTier, amountInBaseUnits, 0)) as bigint;
      } catch (_v1Error) {
        const result = (await quoter[
          'quoteExactInputSingle((address,address,uint256,uint24,uint160))'
        ].staticCall({
          tokenIn: params.tokenInAddress,
          tokenOut: params.usdcAddress,
          amountIn: amountInBaseUnits,
          fee: feeTier,
          sqrtPriceLimitX96: 0,
        })) as unknown;
        if (typeof result === 'bigint') {
          amountOut = result;
        } else if (Array.isArray(result) && typeof result[0] === 'bigint') {
          amountOut = result[0];
        } else if (
          typeof result === 'object' &&
          result !== null &&
          'amountOut' in result &&
          typeof (result as { amountOut?: unknown }).amountOut === 'bigint'
        ) {
          amountOut = (result as { amountOut: bigint }).amountOut;
        }
      }

      if (amountOut && amountOut > 0n) {
        estimatedUsdcBaseUnits = amountOut;
        selectedFeeTier = feeTier;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!estimatedUsdcBaseUnits || !selectedFeeTier) {
    throw new ValidationError(
      `No usable asset/USDC quote on Base Sepolia for fee tiers ${feeTiers.join(', ')}`
    );
  }

  const minUsdcOutBaseUnits =
    (estimatedUsdcBaseUnits * BigInt(10_000 - params.slippageBps)) / BigInt(10_000);

  return {
    amountIn,
    amountInBaseUnits,
    estimatedUsdcBaseUnits,
    minUsdcOutBaseUnits,
    feeTier: selectedFeeTier,
    lastError,
  };
};

export const quoteEthUsdc = async (req: Request, res: Response) => {
  try {
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }

    const quoterAddress = (process.env.BASE_SEPOLIA_QUOTER_ADDRESS || '').trim();
    if (!quoterAddress) {
      return sendError(
        res,
        503,
        'BASE_SEPOLIA_QUOTER_ADDRESS is not configured',
        'service_unavailable'
      );
    }

    const { amountEth, amountInWei } = parseAmountEth(req.query.amountEth);
    const slippageBps = parsePercentToBps(req.query.slippagePercent, 100);
    const wethAddress = resolveAddress(process.env.BASE_SEPOLIA_WETH_ADDRESS, DEFAULT_WETH);
    const usdcAddress = req.query.usdcAddress
      ? normalizeAddress(String(req.query.usdcAddress), 'usdcAddress')
      : resolveAddress(process.env.BASE_SEPOLIA_USDC_ADDRESS, DEFAULT_USDC);
    const quote = await quoteAssetToUsdcInternal({
      rpcUrl,
      quoterAddress,
      tokenInAddress: wethAddress,
      tokenInDecimals: 18,
      amountIn: amountEth,
      slippageBps,
      usdcAddress,
    });

    return res.json({
      quote: {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        amountEth,
        amountInWei: amountInWei.toString(),
        estimatedUsdcBaseUnits: quote.estimatedUsdcBaseUnits.toString(),
        estimatedUsdc: formatUnits(quote.estimatedUsdcBaseUnits, 6),
        minUsdcOutBaseUnits: quote.minUsdcOutBaseUnits.toString(),
        minUsdcOut: formatUnits(quote.minUsdcOutBaseUnits, 6),
        slippageBps,
        feeTier: quote.feeTier,
        source: 'onchain-quoter',
        usdcAddress,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const quoteAssetUsdc = async (req: Request, res: Response) => {
  try {
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || '';
    if (!rpcUrl) {
      return sendError(res, 503, 'BASE_SEPOLIA_RPC_URL is not configured', 'service_unavailable');
    }

    const quoterAddress = (process.env.BASE_SEPOLIA_QUOTER_ADDRESS || '').trim();
    if (!quoterAddress) {
      return sendError(
        res,
        503,
        'BASE_SEPOLIA_QUOTER_ADDRESS is not configured',
        'service_unavailable'
      );
    }

    const tokenInAddress = normalizeAddress(String(req.query.tokenInAddress || ''), 'tokenInAddress');
    const tokenInDecimals = Number(req.query.tokenInDecimals);
    if (!Number.isInteger(tokenInDecimals) || tokenInDecimals < 0 || tokenInDecimals > 36) {
      throw new ValidationError('Invalid tokenInDecimals');
    }

    const amountIn = String(req.query.amountIn || '');
    const slippageBps = parsePercentToBps(req.query.slippagePercent, 100);
    const usdcAddress = req.query.usdcAddress
      ? normalizeAddress(String(req.query.usdcAddress), 'usdcAddress')
      : resolveAddress(process.env.BASE_SEPOLIA_USDC_ADDRESS, DEFAULT_USDC);

    const quote = await quoteAssetToUsdcInternal({
      rpcUrl,
      quoterAddress,
      tokenInAddress,
      tokenInDecimals,
      amountIn,
      slippageBps,
      usdcAddress,
    });

    return res.json({
      quote: {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        tokenInAddress,
        tokenInDecimals,
        amountIn: quote.amountIn,
        amountInBaseUnits: quote.amountInBaseUnits.toString(),
        estimatedUsdcBaseUnits: quote.estimatedUsdcBaseUnits.toString(),
        estimatedUsdc: formatUnits(quote.estimatedUsdcBaseUnits, 6),
        minUsdcOutBaseUnits: quote.minUsdcOutBaseUnits.toString(),
        minUsdcOut: formatUnits(quote.minUsdcOutBaseUnits, 6),
        slippageBps,
        feeTier: quote.feeTier,
        source: 'onchain-quoter',
        usdcAddress,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
