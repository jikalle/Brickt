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
  const amountEth = value?.toString()?.trim() || '';
  if (!amountEth) {
    throw new ValidationError('Missing amountEth');
  }
  const asNumber = Number(amountEth);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    throw new ValidationError('Invalid amountEth');
  }
  try {
    return { amountEth, amountInWei: parseUnits(amountEth, 18) };
  } catch (_error) {
    throw new ValidationError('Invalid amountEth precision');
  }
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
    const feeTiers = parseFeeTiers();
    const wethAddress = resolveAddress(process.env.BASE_SEPOLIA_WETH_ADDRESS, DEFAULT_WETH);
    const usdcAddress = req.query.usdcAddress
      ? normalizeAddress(String(req.query.usdcAddress), 'usdcAddress')
      : resolveAddress(process.env.BASE_SEPOLIA_USDC_ADDRESS, DEFAULT_USDC);

    const provider = new JsonRpcProvider(rpcUrl);
    const quoter = new Contract(quoterAddress, QUOTER_ABI, provider);

    let selectedFeeTier: number | null = null;
    let estimatedUsdcBaseUnits: bigint | null = null;
    let lastError: unknown = null;

    for (const feeTier of feeTiers) {
      try {
        let amountOut: bigint | null = null;
        try {
          amountOut = (await quoter[
            'quoteExactInputSingle(address,address,uint24,uint256,uint160)'
          ].staticCall(wethAddress, usdcAddress, feeTier, amountInWei, 0)) as bigint;
        } catch (_v1Error) {
          const result = (await quoter[
            'quoteExactInputSingle((address,address,uint256,uint24,uint160))'
          ].staticCall({
            tokenIn: wethAddress,
            tokenOut: usdcAddress,
            amountIn: amountInWei,
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
      return res.status(422).json({
        error: `No usable ETH/USDC quote on Base Sepolia for fee tiers ${feeTiers.join(', ')}`,
        code: 'validation_error',
        detail: lastError instanceof Error ? lastError.message : 'Quote unavailable',
      });
    }

    const minUsdcOutBaseUnits =
      (estimatedUsdcBaseUnits * BigInt(10_000 - slippageBps)) / BigInt(10_000);

    return res.json({
      quote: {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        amountEth,
        amountInWei: amountInWei.toString(),
        estimatedUsdcBaseUnits: estimatedUsdcBaseUnits.toString(),
        estimatedUsdc: formatUnits(estimatedUsdcBaseUnits, 6),
        minUsdcOutBaseUnits: minUsdcOutBaseUnits.toString(),
        minUsdcOut: formatUnits(minUsdcOutBaseUnits, 6),
        slippageBps,
        feeTier: selectedFeeTier,
        source: 'onchain-quoter',
        usdcAddress,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
