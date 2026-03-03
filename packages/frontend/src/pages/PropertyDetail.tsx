import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  concat,
  dataLength,
  formatUnits,
  parseUnits,
  toBeHex,
  toUtf8Bytes,
} from 'ethers';
import {
  fetchCampaign,
  fetchCampaignInvestments,
  EthUsdcQuoteResponse,
  fetchEthUsdcQuote,
  fetchProperty,
  CampaignResponse,
  PropertyResponse,
} from '../lib/api';
import { BASE_SEPOLIA_USDC } from '../config/tokens.config';
import { useAccount } from 'wagmi';
import { env } from '../config/env';
import { emitPortfolioActivity } from '../lib/portfolioActivity';

const CROWDFUND_ABI = [
  'function invest(uint256 amountUSDC) external',
  'function claimTokens() external',
  'function claimRefund() external',
  'function usdcToken() view returns (address)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const PROFIT_DISTRIBUTOR_ABI = [
  'function claim() external',
  'function claimable(address user) view returns (uint256)',
];

const WETH_ABI = [
  'function deposit() payable',
  'function approve(address spender, uint256 value) external returns (bool)',
];

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
];

const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14A34';
const OFFICIAL_BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const CAMPAIGN_ACTIVE_STATE = 'ACTIVE';
const CAMPAIGN_FAILED_STATE = 'FAILED';
const ERC8021_SUFFIX = '0x80218021802180218021802180218021';
type CampaignPhase = 'NOT_STARTED' | 'ACTIVE' | 'FAILED' | 'ENDED' | 'UNKNOWN';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const getEthereumProvider = (): EthereumProvider | null => {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return provider ?? null;
};

const toUsd = (baseUnits: string): string =>
  (Number(baseUnits) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });

const formatUsdcUnits = (amountBaseUnits: bigint): string =>
  Number(formatUnits(amountBaseUnits, 6)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });

const toBuilderDataSuffix = (codes: string[]): string | null => {
  if (codes.length === 0) {
    return null;
  }
  const codesHex = `0x${Array.from(toUtf8Bytes(codes.join(',')))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
  const codesLengthHex = toBeHex(dataLength(codesHex), 1);
  const schemaIdHex = toBeHex(0, 1);
  return concat([codesHex, codesLengthHex, schemaIdHex, ERC8021_SUFFIX]);
};

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const { address: connectedAddress, isConnected } = useAccount();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [campaign, setCampaign] = useState<CampaignResponse | null>(null);
  const [crowdfundUsdcAddress, setCrowdfundUsdcAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [amountUsdc, setAmountUsdc] = useState('');
  const [amountEth, setAmountEth] = useState('');
  const [quotedUsdcOutBaseUnits, setQuotedUsdcOutBaseUnits] = useState<bigint | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [isQuotingEth, setIsQuotingEth] = useState(false);
  const [quoteSource, setQuoteSource] = useState<'onchain' | 'market' | null>(null);
  const [ethQuote, setEthQuote] = useState<EthUsdcQuoteResponse | null>(null);
  const [slippagePercent, setSlippagePercent] = useState('1');
  const [investAsset, setInvestAsset] = useState<'USDC' | 'ETH'>('USDC');
  const [txStatus, setTxStatus] = useState('');
  const [txError, setTxError] = useState('');
  const [isInvesting, setIsInvesting] = useState(false);
  const [isClaimingEquity, setIsClaimingEquity] = useState(false);
  const [isClaimingProfit, setIsClaimingProfit] = useState(false);
  const [isClaimingRefund, setIsClaimingRefund] = useState(false);
  const [claimableProfitBaseUnits, setClaimableProfitBaseUnits] = useState<bigint | null>(null);
  const [myInvestedBaseUnits, setMyInvestedBaseUnits] = useState<bigint>(0n);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let isMounted = true;

    const loadProperty = async () => {
      if (!id) {
        if (isMounted) {
          setErrorMessage('Missing property id.');
          setLoading(false);
        }
        return;
      }

      try {
        const data = await fetchProperty(id);
        if (isMounted) {
          setProperty(data);
        }
        try {
          const campaignData = await fetchCampaign(data.crowdfundAddress);
          if (isMounted) {
            setCampaign(campaignData);
          }
        } catch (_campaignError) {
          if (isMounted) {
            setCampaign(null);
          }
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage((error as Error).message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadProperty();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const normalizedAmount = useMemo(() => Number(amountUsdc), [amountUsdc]);
  const effectiveUsdcAddress = crowdfundUsdcAddress || BASE_SEPOLIA_USDC.address;
  const usesOfficialUsdc = effectiveUsdcAddress.toLowerCase() === OFFICIAL_BASE_SEPOLIA_USDC;
  const campaignState = campaign?.state ?? 'UNKNOWN';
  const campaignStartMs = campaign?.startTime ? Date.parse(campaign.startTime) : null;
  const hasCampaignStarted = campaignStartMs === null || Number.isNaN(campaignStartMs) || nowMs >= campaignStartMs;
  const campaignPhase: CampaignPhase = useMemo(() => {
    if (!campaign) return 'UNKNOWN';
    if (campaignState === CAMPAIGN_FAILED_STATE) return 'FAILED';
    if (!hasCampaignStarted) return 'NOT_STARTED';
    if (campaignState === CAMPAIGN_ACTIVE_STATE) return 'ACTIVE';
    return 'ENDED';
  }, [campaign, campaignState, hasCampaignStarted]);
  const canInvest = campaignPhase === 'ACTIVE' || campaignPhase === 'UNKNOWN';
  const canClaimRefund = campaignPhase === 'FAILED';
  const canSwapEthOnBaseSepolia = Boolean(env.BASE_SEPOLIA_SWAP_ROUTER);
  const walletAvailable = getEthereumProvider() !== null;
  const txInFlight = isInvesting || isClaimingEquity || isClaimingProfit || isClaimingRefund;
  const normalizedEthAmount = useMemo(() => Number(amountEth), [amountEth]);
  const normalizedSlippagePercent = useMemo(() => Number(slippagePercent), [slippagePercent]);
  const swapFeeCandidates = useMemo(() => {
    const candidates = [env.BASE_SEPOLIA_SWAP_POOL_FEE, 500, 3000, 10000];
    return Array.from(
      new Set(candidates.filter((value) => Number.isInteger(value) && value > 0))
    );
  }, []);
  const slippageBps = useMemo(() => {
    if (!Number.isFinite(normalizedSlippagePercent)) {
      return 100;
    }
    const clamped = Math.min(Math.max(normalizedSlippagePercent, 0), 50);
    return Math.round(clamped * 100);
  }, [normalizedSlippagePercent]);
  const minUsdcOutBaseUnits = useMemo(() => {
    if (ethQuote?.minUsdcOutBaseUnits) {
      const fromQuote = BigInt(ethQuote.minUsdcOutBaseUnits);
      if (fromQuote > 0n) {
        return fromQuote;
      }
    }
    if (!quotedUsdcOutBaseUnits || quotedUsdcOutBaseUnits <= 0n) {
      return null;
    }
    const minOut = (quotedUsdcOutBaseUnits * BigInt(10_000 - slippageBps)) / 10_000n;
    return minOut > 0n ? minOut : null;
  }, [ethQuote?.minUsdcOutBaseUnits, quotedUsdcOutBaseUnits, slippageBps]);
  const hasNoUsdcRoute =
    quoteError.includes('No usable ETH/USDC quote on Base Sepolia') ||
    quoteError.includes('No usable ETH/USDC quote');
  const builderDataSuffix = useMemo(() => toBuilderDataSuffix(env.BASE_BUILDER_CODES), []);
  const startCountdown = useMemo(() => {
    if (!campaignStartMs || Number.isNaN(campaignStartMs) || hasCampaignStarted) {
      return null;
    }
    const remainingMs = Math.max(0, campaignStartMs - nowMs);
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }, [campaignStartMs, hasCampaignStarted, nowMs]);

  const positionSummary = useMemo(() => {
    const invested = Number(formatUnits(myInvestedBaseUnits, 6));
    const claimableProfit =
      claimableProfitBaseUnits !== null ? Number(formatUnits(claimableProfitBaseUnits, 6)) : null;
    return { invested, claimableProfit };
  }, [claimableProfitBaseUnits, myInvestedBaseUnits]);

  const campaignPhaseBadge = useMemo(() => {
    if (campaignPhase === 'ACTIVE') {
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200';
    }
    if (campaignPhase === 'NOT_STARTED') {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
    }
    if (campaignPhase === 'FAILED') {
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
    }
    if (campaignPhase === 'ENDED') {
      return 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-200';
    }
    return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }, [campaignPhase]);

  const investUnavailableMessage = useMemo(() => {
    if (campaignPhase === 'NOT_STARTED') {
      return `Campaign not started. Countdown: ${startCountdown ?? 'pending'}`;
    }
    if (campaignPhase === 'FAILED') {
      return 'Campaign failed. New investments are closed; refunds are enabled.';
    }
    if (campaignPhase === 'ENDED') {
      return 'Campaign ended. New investments are closed.';
    }
    return 'Investments are currently unavailable.';
  }, [campaignPhase, startCountdown]);

  const ensureBaseSepolia = async (injected: EthereumProvider) => {
    try {
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code !== 4902) {
        throw error;
      }
      await injected.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
            chainName: 'Base Sepolia',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://sepolia.base.org'],
            blockExplorerUrls: ['https://sepolia.basescan.org'],
          },
        ],
      });
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      });
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!property?.crowdfundAddress) {
      setCrowdfundUsdcAddress(null);
      return;
    }

    const loadCrowdfundUsdcAddress = async () => {
      try {
        const rpcUrl = (import.meta as ImportMeta & { env: Record<string, string> }).env
          .VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
        const provider = new JsonRpcProvider(rpcUrl);
        const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, provider);
        const tokenAddress = ((await crowdfund.usdcToken()) as string).toLowerCase();
        if (!cancelled) {
          setCrowdfundUsdcAddress(tokenAddress);
        }
      } catch (_error) {
        if (!cancelled) {
          setCrowdfundUsdcAddress(null);
        }
      }
    };

    void loadCrowdfundUsdcAddress();

    return () => {
      cancelled = true;
    };
  }, [property?.crowdfundAddress]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadClaimableProfit = async () => {
      if (!property?.profitDistributorAddress || !connectedAddress) {
        setClaimableProfitBaseUnits(null);
        return;
      }

      try {
        const rpcUrl = (import.meta as ImportMeta & { env: Record<string, string> }).env
          .VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
        const provider = new JsonRpcProvider(rpcUrl);
        const distributor = new Contract(
          property.profitDistributorAddress,
          PROFIT_DISTRIBUTOR_ABI,
          provider
        );
        const claimable = (await distributor.claimable(connectedAddress)) as bigint;
        if (!cancelled) {
          setClaimableProfitBaseUnits(claimable);
        }
      } catch (_error) {
        if (!cancelled) {
          setClaimableProfitBaseUnits(null);
        }
      }
    };

    void loadClaimableProfit();
    const timer = setInterval(() => {
      void loadClaimableProfit();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectedAddress, property?.profitDistributorAddress]);

  useEffect(() => {
    let cancelled = false;

    const loadMyInvestmentPosition = async () => {
      if (!property?.crowdfundAddress || !connectedAddress) {
        if (!cancelled) {
          setMyInvestedBaseUnits(0n);
          setPositionError('');
          setPositionLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setPositionLoading(true);
          setPositionError('');
        }
        const investments = await fetchCampaignInvestments(property.crowdfundAddress);
        if (cancelled) return;
        const totalInvested = investments
          .filter((item) => item.investorAddress.toLowerCase() === connectedAddress.toLowerCase())
          .reduce<bigint>((sum, item) => sum + BigInt(item.usdcAmountBaseUnits), 0n);
        setMyInvestedBaseUnits(totalInvested);
      } catch (error) {
        if (!cancelled) {
          setPositionError(error instanceof Error ? error.message : 'Failed to load your position');
        }
      } finally {
        if (!cancelled) {
          setPositionLoading(false);
        }
      }
    };

    void loadMyInvestmentPosition();
    const timer = setInterval(() => {
      void loadMyInvestmentPosition();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectedAddress, property?.crowdfundAddress]);

  const handleInvestWithUsdc = async () => {
    setTxError('');
    setTxStatus('');

    if (!property) {
      setTxError('Property is not loaded yet.');
      return;
    }

    if (!canInvest) {
      const notStarted = !hasCampaignStarted && campaignStartMs;
      setTxError(
        notStarted
          ? `Campaign has not started yet. Starts at ${new Date(campaignStartMs).toLocaleString()}.`
          : `Investing is unavailable while campaign state is ${campaignState}.`
      );
      return;
    }

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setTxError('Enter a valid USDC amount greater than 0.');
      return;
    }

    const injected = getEthereumProvider();
    if (!injected) {
      setTxError('No wallet provider found. Install a wallet extension.');
      return;
    }

    setIsInvesting(true);
    try {
      await ensureBaseSepolia(injected);

      await injected.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(injected as never);
      const signer = await provider.getSigner();

      const amountBaseUnits = parseUnits(amountUsdc, 6);
      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer);
      const requiredUsdcAddress = ((await crowdfund.usdcToken()) as string).toLowerCase();
      const usdc = new Contract(requiredUsdcAddress, ERC20_ABI, signer);
      const signerAddress = await signer.getAddress();
      const balance = (await usdc.balanceOf(signerAddress)) as bigint;
      if (balance < amountBaseUnits) {
        throw new Error(
          `Insufficient USDC balance for this property token. Required ${formatUnits(
            amountBaseUnits,
            6
          )} USDC, wallet has ${formatUnits(balance, 6)} USDC at token ${requiredUsdcAddress}.`
        );
      }

      const allowance = (await usdc.allowance(
        signerAddress,
        property.crowdfundAddress
      )) as bigint;
      if (allowance < amountBaseUnits) {
        setTxStatus('Submitting USDC approval...');
        try {
          const approveTx = await sendContractTransaction(signer, usdc, 'approve', [
            property.crowdfundAddress,
            amountBaseUnits,
          ]);
          await approveTx.wait();
        } catch (_approveError) {
          // Some tokens require resetting allowance to 0 before setting a new value.
          const resetTx = await sendContractTransaction(signer, usdc, 'approve', [
            property.crowdfundAddress,
            0n,
          ]);
          await resetTx.wait();
          const approveTx = await sendContractTransaction(signer, usdc, 'approve', [
            property.crowdfundAddress,
            amountBaseUnits,
          ]);
          await approveTx.wait();
        }
      }

      setTxStatus('Submitting investment...');
      const investTx = await sendContractTransaction(signer, crowdfund, 'invest', [amountBaseUnits]);
      await investTx.wait();

      setTxStatus(`Investment confirmed: ${investTx.hash}`);
      setMyInvestedBaseUnits((previous) => previous + amountBaseUnits);
      emitPortfolioActivity({
        txHash: investTx.hash,
        propertyId: property.propertyId,
        type: 'invest',
      });
      setAmountUsdc('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Investment transaction failed';
      setTxError(message);
    } finally {
      setIsInvesting(false);
    }
  };

  const handleInvestWithEth = async () => {
    setTxError('');
    setTxStatus('');

    if (!property) {
      setTxError('Property is not loaded yet.');
      return;
    }

    if (!canInvest) {
      const notStarted = !hasCampaignStarted && campaignStartMs;
      setTxError(
        notStarted
          ? `Campaign has not started yet. Starts at ${new Date(campaignStartMs).toLocaleString()}.`
          : `Investing is unavailable while campaign state is ${campaignState}.`
      );
      return;
    }

    if (!canSwapEthOnBaseSepolia) {
      setTxError('ETH investment is not configured. Set VITE_BASE_SEPOLIA_SWAP_ROUTER.');
      return;
    }

    if (!Number.isFinite(normalizedEthAmount) || normalizedEthAmount <= 0) {
      setTxError('Enter a valid ETH amount greater than 0.');
      return;
    }

    if (!minUsdcOutBaseUnits || minUsdcOutBaseUnits <= 0n) {
      setTxError('Unable to derive minimum USDC out from quote. Wait for live quote and retry.');
      return;
    }
    if (!ethQuote) {
      setTxError('Missing live quote for ETH investment. Wait for quote and retry.');
      return;
    }

    const injected = getEthereumProvider();
    if (!injected) {
      setTxError('No wallet provider found. Install a wallet extension.');
      return;
    }

    setIsInvesting(true);
    try {
      await ensureBaseSepolia(injected);
      await injected.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(injected as never);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      const ethAmountWei = parseUnits(amountEth, 18);
      const quotedAmountInWei = BigInt(ethQuote.amountInWei);
      if (quotedAmountInWei !== ethAmountWei) {
        throw new Error('Quote is stale for current ETH amount. Wait for refreshed quote and retry.');
      }
      const nativeBalanceWei = await provider.getBalance(signerAddress);
      if (ethAmountWei > nativeBalanceWei) {
        throw new Error(
          `Insufficient ETH balance for swap input. Requested ${formatUnits(
            ethAmountWei,
            18
          )} ETH but wallet has ${formatUnits(nativeBalanceWei, 18)} ETH.`
        );
      }
      const primaryFeeTier = ethQuote.feeTier;
      const executionFeeTiers = Array.from(
        new Set([primaryFeeTier, ...swapFeeCandidates])
      );

      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer);
      const requiredUsdcAddress = ((await crowdfund.usdcToken()) as string).toLowerCase();
      if (ethQuote.usdcAddress.toLowerCase() !== requiredUsdcAddress) {
        throw new Error(
          `Quote token mismatch. Quote used ${ethQuote.usdcAddress}, but crowdfund requires ${requiredUsdcAddress}.`
        );
      }
      const usdc = new Contract(requiredUsdcAddress, ERC20_ABI, signer);
      const weth = new Contract(env.BASE_SEPOLIA_WETH, WETH_ABI, signer);
      const swapRouter = new Contract(env.BASE_SEPOLIA_SWAP_ROUTER, SWAP_ROUTER_ABI, signer);

      const usdcBefore = BigInt(await usdc.balanceOf(signerAddress));

      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
      let swapSucceeded = false;
      let lastNativeSwapError: unknown = null;
      let lastWrappedSwapError: unknown = null;

      // Path A: let router wrap native ETH internally.
      for (const feeTier of executionFeeTiers) {
        try {
          setTxStatus(`Swapping ETH -> USDC (native route, fee tier ${feeTier})...`);
          try {
            const swapTx = await sendContractTransaction(
              signer,
              swapRouter,
              'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
              [
                {
                  tokenIn: env.BASE_SEPOLIA_WETH,
                  tokenOut: requiredUsdcAddress,
                  fee: feeTier,
                  recipient: signerAddress,
                  amountIn: ethAmountWei,
                  amountOutMinimum: minUsdcOutBaseUnits,
                  sqrtPriceLimitX96: 0,
                },
              ],
              { value: ethAmountWei }
            );
            await swapTx.wait();
          } catch (_swapWithoutDeadlineError) {
            const swapTxWithDeadline = await sendContractTransaction(
              signer,
              swapRouter,
              'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
              [
                {
                  tokenIn: env.BASE_SEPOLIA_WETH,
                  tokenOut: requiredUsdcAddress,
                  fee: feeTier,
                  recipient: signerAddress,
                  deadline,
                  amountIn: ethAmountWei,
                  amountOutMinimum: minUsdcOutBaseUnits,
                  sqrtPriceLimitX96: 0,
                },
              ],
              { value: ethAmountWei }
            );
            await swapTxWithDeadline.wait();
          }
          swapSucceeded = true;
          break;
        } catch (nativeSwapError) {
          lastNativeSwapError = nativeSwapError;
        }
      }

      // Path B: explicit wrap + approve + swap.
      if (!swapSucceeded) {
        setTxStatus('Native swap route failed. Wrapping ETH to WETH...');
        try {
          const wrapTx = await sendContractTransaction(signer, weth, 'deposit', [], {
            value: ethAmountWei,
          });
          await wrapTx.wait();
        } catch (depositError) {
          try {
            const wrapViaReceiveTx = await signer.sendTransaction({
              to: env.BASE_SEPOLIA_WETH,
              value: ethAmountWei,
            });
            await wrapViaReceiveTx.wait();
          } catch (receiveWrapError) {
            throw new Error(
              `Native swap route failed: ${
                lastNativeSwapError instanceof Error
                  ? lastNativeSwapError.message
                  : String(lastNativeSwapError)
              }. WETH wrap failed. deposit() error: ${
                depositError instanceof Error ? depositError.message : String(depositError)
              }. receive() error: ${
                receiveWrapError instanceof Error
                  ? receiveWrapError.message
                  : String(receiveWrapError)
              }`
            );
          }
        }

        setTxStatus('Approving router for wrapped swap...');
        const approveRouterTx = await sendContractTransaction(signer, weth, 'approve', [
          env.BASE_SEPOLIA_SWAP_ROUTER,
          ethAmountWei,
        ]);
        await approveRouterTx.wait();

        for (const feeTier of executionFeeTiers) {
          try {
            setTxStatus(`Swapping ETH -> USDC (wrapped route, fee tier ${feeTier})...`);
            try {
              const swapTx = await sendContractTransaction(
                signer,
                swapRouter,
                'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
                [
                  {
                    tokenIn: env.BASE_SEPOLIA_WETH,
                    tokenOut: requiredUsdcAddress,
                    fee: feeTier,
                    recipient: signerAddress,
                    amountIn: ethAmountWei,
                    amountOutMinimum: minUsdcOutBaseUnits,
                    sqrtPriceLimitX96: 0,
                  },
                ]
              );
              await swapTx.wait();
            } catch (_swapWithoutDeadlineError) {
              const swapTxWithDeadline = await sendContractTransaction(
                signer,
                swapRouter,
                'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
                [
                  {
                    tokenIn: env.BASE_SEPOLIA_WETH,
                    tokenOut: requiredUsdcAddress,
                    fee: feeTier,
                    recipient: signerAddress,
                    deadline,
                    amountIn: ethAmountWei,
                    amountOutMinimum: minUsdcOutBaseUnits,
                    sqrtPriceLimitX96: 0,
                  },
                ]
              );
              await swapTxWithDeadline.wait();
            }
            swapSucceeded = true;
            break;
          } catch (wrappedSwapError) {
            lastWrappedSwapError = wrappedSwapError;
          }
        }
      }

      if (!swapSucceeded) {
        throw new Error(
          `ETH->USDC swap failed on fee tiers ${swapFeeCandidates.join(', ')}. Native route error: ${
            lastNativeSwapError instanceof Error
              ? lastNativeSwapError.message
              : String(lastNativeSwapError)
          }. Wrapped route error: ${
            lastWrappedSwapError instanceof Error
              ? lastWrappedSwapError.message
              : String(lastWrappedSwapError)
          }. This usually means no active pool/liquidity on Base Sepolia for these tiers.`
        );
      }

      const usdcAfter = BigInt(await usdc.balanceOf(signerAddress));
      const receivedUsdc = usdcAfter - usdcBefore;
      if (receivedUsdc <= 0n) {
        throw new Error('Swap returned 0 USDC.');
      }

      setTxStatus('Approving USDC for investment...');
      const approveCrowdfundTx = await sendContractTransaction(signer, usdc, 'approve', [
        property.crowdfundAddress,
        receivedUsdc,
      ]);
      await approveCrowdfundTx.wait();

      setTxStatus('Submitting investment with swapped USDC...');
      const investTx = await sendContractTransaction(signer, crowdfund, 'invest', [receivedUsdc]);
      await investTx.wait();

      setTxStatus(`ETH swap + investment confirmed: ${investTx.hash}`);
      setMyInvestedBaseUnits((previous) => previous + receivedUsdc);
      emitPortfolioActivity({
        txHash: investTx.hash,
        propertyId: property.propertyId,
        type: 'invest',
      });
      setAmountEth('');
      setQuotedUsdcOutBaseUnits(null);
      setEthQuote(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'ETH swap and investment transaction failed';
      setTxError(message);
    } finally {
      setIsInvesting(false);
    }
  };

  const handleInvest = async () => {
    if (investAsset === 'ETH') {
      await handleInvestWithEth();
      return;
    }
    await handleInvestWithUsdc();
  };

  useEffect(() => {
    let cancelled = false;

    if (investAsset !== 'ETH') {
      setQuoteError('');
      setQuotedUsdcOutBaseUnits(null);
      setIsQuotingEth(false);
      setQuoteSource(null);
      setEthQuote(null);
      return;
    }

    if (!canSwapEthOnBaseSepolia) {
      setQuoteError('ETH swap router is not configured.');
      setQuotedUsdcOutBaseUnits(null);
      setIsQuotingEth(false);
      setQuoteSource(null);
      setEthQuote(null);
      return;
    }

    if (!Number.isFinite(normalizedEthAmount) || normalizedEthAmount <= 0) {
      setQuoteError('');
      setQuotedUsdcOutBaseUnits(null);
      setIsQuotingEth(false);
      setQuoteSource(null);
      setEthQuote(null);
      return;
    }

    const quoteEthToUsdc = async () => {
      try {
        setIsQuotingEth(true);
        setQuoteError('');
        const quote = await fetchEthUsdcQuote({
          amountEth,
          slippagePercent,
          usdcAddress: effectiveUsdcAddress,
        });
        const amountOut = BigInt(quote.estimatedUsdcBaseUnits);
        if (!cancelled) {
          setEthQuote(quote);
          setQuotedUsdcOutBaseUnits(amountOut);
          setQuoteSource('onchain');
        }
      } catch (error) {
        if (!cancelled) {
          setEthQuote(null);
          setQuotedUsdcOutBaseUnits(null);
          setQuoteSource(null);
          setQuoteError(error instanceof Error ? error.message : 'Unable to estimate USDC output');
        }
      } finally {
        if (!cancelled) {
          setIsQuotingEth(false);
        }
      }
    };

    const timer = setTimeout(() => {
      void quoteEthToUsdc();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    amountEth,
    canSwapEthOnBaseSepolia,
    effectiveUsdcAddress,
    investAsset,
    normalizedEthAmount,
    slippagePercent,
  ]);

  const withSigner = async () => {
    const injected = getEthereumProvider();
    if (!injected) {
      throw new Error('No wallet provider found. Install a wallet extension.');
    }

    await ensureBaseSepolia(injected);
    await injected.request({ method: 'eth_requestAccounts' });

    const provider = new BrowserProvider(injected as never);
    return provider.getSigner();
  };

  const sendContractTransaction = async (
    signer: Awaited<ReturnType<BrowserProvider['getSigner']>>,
    contract: Contract,
    functionName: string,
    args: unknown[] = [],
    overrides: { value?: bigint } = {}
  ) => {
    const txData = contract.interface.encodeFunctionData(functionName, args);
    const data = builderDataSuffix ? concat([txData, builderDataSuffix]) : txData;
    const to =
      typeof contract.target === 'string' ? contract.target : await contract.getAddress();
    return signer.sendTransaction({
      to,
      data,
      ...overrides,
    });
  };

  const handleClaimEquity = async () => {
    setTxError('');
    setTxStatus('');
    if (!property) {
      setTxError('Property is not loaded yet.');
      return;
    }

    setIsClaimingEquity(true);
    try {
      const signer = await withSigner();
      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer);
      setTxStatus('Submitting equity claim...');
      const tx = await sendContractTransaction(signer, crowdfund, 'claimTokens');
      await tx.wait();
      setTxStatus(`Equity claim confirmed: ${tx.hash}`);
      emitPortfolioActivity({
        txHash: tx.hash,
        propertyId: property.propertyId,
        type: 'claim-equity',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to claim equity';
      setTxError(message);
    } finally {
      setIsClaimingEquity(false);
    }
  };

  const handleClaimProfit = async () => {
    setTxError('');
    setTxStatus('');
    if (!property) {
      setTxError('Property is not loaded yet.');
      return;
    }

    setIsClaimingProfit(true);
    try {
      const signer = await withSigner();
      const distributor = new Contract(
        property.profitDistributorAddress,
        PROFIT_DISTRIBUTOR_ABI,
        signer
      );
      setTxStatus('Submitting profit claim...');
      const tx = await sendContractTransaction(signer, distributor, 'claim');
      await tx.wait();
      setTxStatus(`Profit claim confirmed: ${tx.hash}`);
      setClaimableProfitBaseUnits(0n);
      emitPortfolioActivity({
        txHash: tx.hash,
        propertyId: property.propertyId,
        type: 'claim-profit',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to claim profit';
      setTxError(message);
    } finally {
      setIsClaimingProfit(false);
    }
  };

  const handleClaimRefund = async () => {
    setTxError('');
    setTxStatus('');
    if (!property) {
      setTxError('Property is not loaded yet.');
      return;
    }

    setIsClaimingRefund(true);
    try {
      const signer = await withSigner();
      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer);
      setTxStatus('Submitting refund claim...');
      const tx = await sendContractTransaction(signer, crowdfund, 'claimRefund');
      await tx.wait();
      setTxStatus(`Refund confirmed: ${tx.hash}`);
      emitPortfolioActivity({
        txHash: tx.hash,
        propertyId: property.propertyId,
        type: 'claim-refund',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to claim refund';
      setTxError(message);
    } finally {
      setIsClaimingRefund(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 text-gray-600 dark:text-gray-300">
        Loading property...
      </div>
    );
  }

  if (errorMessage || !property) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {errorMessage || 'Property not found.'}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
        {property.name}
      </h1>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-gray-300 dark:bg-gray-700 h-96 rounded-lg" />

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
            Property Information
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Location</label>
              <p className="text-gray-900 dark:text-white">{property.location}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Description</label>
              <p className="text-gray-900 dark:text-white">{property.description}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Target Raise</label>
              <p className="text-gray-900 dark:text-white">${toUsd(property.targetUsdcBaseUnits)} USDC</p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Platform Fee</label>
              <p className="text-gray-900 dark:text-white">
                {property.platformFeeBps === null
                  ? 'Not configured'
                  : `${(property.platformFeeBps / 100).toFixed(2)}%`}
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Campaign State</label>
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${campaignPhaseBadge}`}>
                  {campaignPhase}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Raw: {campaign?.state ?? 'Unknown'}
                </span>
              </div>
            </div>
            {campaign?.startTime && (
              <div>
                <label className="text-sm text-gray-500 dark:text-gray-400">Campaign Start Time</label>
                <p className="text-gray-900 dark:text-white">
                  {new Date(campaign.startTime).toLocaleString()}
                </p>
              </div>
            )}
            {isConnected && connectedAddress && (
              <div className="rounded-lg border border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
                <p className="text-gray-600 dark:text-gray-300">
                  My invested: <span className="font-semibold text-gray-900 dark:text-white">
                    {positionSummary.invested.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC
                  </span>
                </p>
                <p className="mt-1 text-gray-600 dark:text-gray-300">
                  My claimable profit:{' '}
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {positionSummary.claimableProfit === null
                      ? '--'
                      : `${positionSummary.claimableProfit.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`}
                  </span>
                </p>
                {positionLoading && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Refreshing position...</p>
                )}
                {positionError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-300">{positionError}</p>
                )}
              </div>
            )}
            {isConnected && connectedAddress && (
              <div>
                <label className="text-sm text-gray-500 dark:text-gray-400">Connected Wallet</label>
                <p className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                  {connectedAddress}
                </p>
              </div>
            )}
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Crowdfund Contract</label>
              <p className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                {property.crowdfundAddress}
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Crowdfund USDC Token</label>
              <p className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                {effectiveUsdcAddress}
              </p>
            </div>
            {!usesOfficialUsdc && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                This property uses a non-standard USDC token address. Investors must hold this exact
                token to invest, and ETH auto-swap routing may be unavailable.
              </div>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
              Investing is risky and may result in loss of capital. Review{' '}
              <Link to="/disclosures" className="underline font-medium">
                Risk Disclosures
              </Link>{' '}
              before transacting.
            </div>

            <div className="pt-2">
              <label className="text-sm text-gray-500 dark:text-gray-400">Invest With</label>
              <select
                value={investAsset}
                onChange={(event) => setInvestAsset(event.target.value as 'USDC' | 'ETH')}
                className="mt-1 w-full rounded-lg border px-4 py-2 dark:bg-gray-700 dark:border-gray-600"
                disabled={txInFlight}
              >
                <option value="USDC">USDC (Direct)</option>
                <option value="ETH" disabled={!canSwapEthOnBaseSepolia || hasNoUsdcRoute}>
                  ETH (Auto-swap to USDC)
                </option>
              </select>
            </div>

            {investAsset === 'USDC' ? (
              <div className="pt-2">
                <label className="text-sm text-gray-500 dark:text-gray-400">Invest Amount (USDC)</label>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={amountUsdc}
                  onChange={(event) => setAmountUsdc(event.target.value)}
                  placeholder="e.g. 100"
                  className="mt-1 w-full rounded-lg border px-4 py-2 dark:bg-gray-700 dark:border-gray-600"
                  disabled={txInFlight}
                />
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">Invest Amount (ETH)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.000000000000000001"
                    value={amountEth}
                    onChange={(event) => setAmountEth(event.target.value)}
                    placeholder="e.g. 0.1"
                    className="mt-1 w-full rounded-lg border px-4 py-2 dark:bg-gray-700 dark:border-gray-600"
                    disabled={txInFlight}
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">Slippage (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    value={slippagePercent}
                    onChange={(event) => setSlippagePercent(event.target.value)}
                    placeholder="e.g. 1"
                    className="mt-1 w-full rounded-lg border px-4 py-2 dark:bg-gray-700 dark:border-gray-600"
                    disabled={txInFlight}
                  />
                </div>
                <div className="rounded-lg border border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
                  <p className="text-gray-600 dark:text-gray-300">
                    Estimated USDC out:{' '}
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {isQuotingEth
                        ? 'Quoting...'
                        : quotedUsdcOutBaseUnits
                          ? `${formatUsdcUnits(quotedUsdcOutBaseUnits)} USDC`
                          : '--'}
                    </span>
                  </p>
                  {quoteSource && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Quote source: {quoteSource === 'onchain' ? 'Onchain Quoter' : 'Market fallback'}
                    </p>
                  )}
                  {ethQuote?.feeTier && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Quoted fee tier: {ethQuote.feeTier}
                    </p>
                  )}
                  {ethQuote?.amountInWei && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Quoted input: {Number(formatUnits(BigInt(ethQuote.amountInWei), 18)).toLocaleString(undefined, {
                        maximumFractionDigits: 18,
                      })} ETH
                    </p>
                  )}
                  <p className="mt-1 text-gray-600 dark:text-gray-300">
                    Auto min USDC out ({slippagePercent || '0'}%):{' '}
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {minUsdcOutBaseUnits ? `${formatUsdcUnits(minUsdcOutBaseUnits)} USDC` : '--'}
                    </span>
                  </p>
                  {quotedUsdcOutBaseUnits !== null && normalizedEthAmount > 0 && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Implied rate:{' '}
                      {(
                        Number(formatUnits(quotedUsdcOutBaseUnits, 6)) / normalizedEthAmount
                      ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                      USDC/ETH
                    </p>
                  )}
                  {quoteError && (
                    <p className="mt-2 text-red-600 dark:text-red-300">{quoteError}</p>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ETH is wrapped and swapped to USDC before investment. You pay gas and swap fees.
                </p>
              </div>
            )}

            {investAsset === 'ETH' && !canSwapEthOnBaseSepolia && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                ETH investing is disabled until swap router env vars are configured.
              </div>
            )}
            {investAsset === 'ETH' && hasNoUsdcRoute && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                ETH auto-swap is unavailable for this property because no liquid WETH/USDC route
                exists for the crowdfund token on Base Sepolia. Use direct USDC investment.
              </div>
            )}

            {!walletAvailable && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                Connect a wallet extension to invest or claim.
              </div>
            )}
            {walletAvailable && !canInvest && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                {investUnavailableMessage}
              </div>
            )}

            {txError && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                {txError}
              </div>
            )}
            {txStatus && (
              <div className="rounded-lg bg-green-50 px-4 py-3 text-green-700 dark:bg-green-900/40 dark:text-green-200">
                {txStatus}
              </div>
            )}

            <button
              className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleInvest}
              disabled={
                isInvesting ||
                !walletAvailable ||
                txInFlight ||
                !canInvest ||
                (investAsset === 'ETH' &&
                  (isQuotingEth || !quotedUsdcOutBaseUnits || !minUsdcOutBaseUnits))
              }
            >
              {isInvesting
                ? 'Processing...'
                : !canInvest
                  ? campaignPhase === 'NOT_STARTED'
                    ? 'Campaign Not Started'
                    : campaignPhase === 'FAILED'
                      ? 'Campaign Failed'
                      : campaignPhase === 'ENDED'
                        ? 'Campaign Ended'
                        : 'Investment Unavailable'
                : investAsset === 'ETH'
                  ? 'Swap ETH and Invest'
                  : 'Invest Onchain'}
            </button>
            <div className="grid grid-cols-1 gap-2 pt-2">
              <button
                className="w-full border border-primary-600 text-primary-700 dark:text-primary-300 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleClaimEquity}
                disabled={isClaimingEquity || !walletAvailable || txInFlight}
              >
                {isClaimingEquity ? 'Claiming Equity...' : 'Claim Equity Tokens'}
              </button>
              <button
                className="w-full border border-primary-600 text-primary-700 dark:text-primary-300 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleClaimProfit}
                disabled={isClaimingProfit || !walletAvailable || txInFlight}
              >
                {isClaimingProfit ? 'Claiming Profit...' : 'Claim Profit (USDC)'}
              </button>
              {connectedAddress && claimableProfitBaseUnits !== null && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Claimable now: {formatUsdcUnits(claimableProfitBaseUnits)} USDC
                </div>
              )}
              <button
                className="w-full border border-primary-600 text-primary-700 dark:text-primary-300 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleClaimRefund}
                disabled={isClaimingRefund || !canClaimRefund || !walletAvailable || txInFlight}
                title={canClaimRefund ? 'Claim refund from failed campaign' : 'Refunds available only when campaign is FAILED'}
              >
                {isClaimingRefund ? 'Claiming Refund...' : canClaimRefund ? 'Claim Refund' : 'Refund Unavailable'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
