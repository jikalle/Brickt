import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BrowserProvider, Contract, concat, dataLength, toBeHex, toUtf8Bytes } from 'ethers';
import {
  getAuthNonce,
  loginWithWallet,
  fetchMyEquityClaims,
  fetchMyInvestments,
  fetchMyProfitClaims,
  fetchMyProfitStatus,
  fetchProperties,
  InvestmentResponse,
  EquityClaimResponse,
  ProfitClaimResponse,
  InvestorProfitStatusResponse,
  PropertyResponse,
} from '../lib/api';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { clearUser, setUser } from '../store/slices/userSlice';
import { useAccount } from 'wagmi';
import { signInWithBaseAccount } from '../lib/baseAccount';
import {
  emitPortfolioActivity,
  subscribePortfolioActivity,
} from '../lib/portfolioActivity';
import { env } from '../config/env';
import TxHashLink from '../components/common/TxHashLink';

// Inline SVG Icons
const ExternalLink = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4m4-6h-8m4 0l-4-4m4 4L5 19" />
  </svg>
);

const AlertIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 0H8m4 0h4" />
  </svg>
);

const PROFIT_DISTRIBUTOR_ABI = ['function claim() external'];
const CROWDFUND_ABI = ['function claimTokens() external'];
const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14A34';
const ERC8021_SUFFIX = '0x80218021802180218021802180218021';

type PendingClaim = {
  txHash: string;
  propertyId: string;
  type: 'claim-profit' | 'claim-equity';
  createdAt: string;
};

type PendingInvestment = {
  txHash: string;
  propertyId: string;
  usdcAmountBaseUnits: string;
  createdAt: string;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const toHexUtf8 = (value: string): `0x${string}` => {
  const bytes = new TextEncoder().encode(value);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}`;
};

const buildInvestorMessage = (address: string, nonce: string, chainId: number): string =>
  [
    'Brickt wants you to sign in with your wallet.',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

const getInjectedProvider = (): EthereumProvider | null => {
  const injected = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return injected && typeof injected.request === 'function' ? injected : null;
};

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

const getScenarioSellUsdc = (
  property: PropertyResponse | undefined,
  scenario: 'conservative' | 'base' | 'optimistic'
): number | null => {
  if (!property) return null;
  const target = Number(property.targetUsdcBaseUnits) / 1_000_000;
  const fallback = property.estimatedSellUsdcBaseUnits
    ? Number(property.estimatedSellUsdcBaseUnits) / 1_000_000
    : target;

  if (scenario === 'conservative') {
    if (property.conservativeSellUsdcBaseUnits) {
      return Number(property.conservativeSellUsdcBaseUnits) / 1_000_000;
    }
    return (fallback * (property.conservativeMultiplierBps ?? 8500)) / 10000;
  }
  if (scenario === 'base') {
    if (property.baseSellUsdcBaseUnits) {
      return Number(property.baseSellUsdcBaseUnits) / 1_000_000;
    }
    return (fallback * (property.baseMultiplierBps ?? 10000)) / 10000;
  }
  if (property.optimisticSellUsdcBaseUnits) {
    return Number(property.optimisticSellUsdcBaseUnits) / 1_000_000;
  }
  return (fallback * (property.optimisticMultiplierBps ?? 12500)) / 10000;
};

const describeReadinessReason = (reason: string): string => {
  if (reason === 'rpc-unavailable') return 'RPC unavailable';
  if (reason === 'missing-profit-distributor') return 'Profit distributor is not configured';
  if (reason === 'no-profit-deposits') return 'No profit deposit has been made yet';
  if (reason === 'no-unclaimed-profit-pool') return 'No unclaimed profit pool available';
  if (reason === 'no-equity-balance') return 'No equity token balance in wallet';
  if (reason === 'profit-claimable-read-failed') return 'Could not read claimable profit onchain';
  if (reason === 'no-profit-claimable') return 'No claimable profit for this wallet';
  if (reason === 'campaign-not-successful') return 'Campaign is not successful yet';
  if (reason === 'equity-token-not-set') return 'Equity token is not configured yet';
  if (reason === 'no-contribution') return 'No net contribution found for this wallet';
  if (reason === 'equity-claimable-read-failed') return 'Could not read claimable equity onchain';
  if (reason === 'no-equity-claimable') return 'No claimable equity tokens yet';
  return reason.replace(/-/g, ' ');
};

export default function InvestorDashboard() {
  const dispatch = useDispatch();
  const { token, isAuthenticated } = useSelector((state: RootState) => state.user);
  const { address, role } = useSelector((state: RootState) => state.user);
  const { address: connectedWalletAddress, isConnected } = useAccount();
  const [investments, setInvestments] = useState<InvestmentResponse[]>([]);
  const [equityClaims, setEquityClaims] = useState<EquityClaimResponse[]>([]);
  const [profitClaims, setProfitClaims] = useState<ProfitClaimResponse[]>([]);
  const [profitStatuses, setProfitStatuses] = useState<InvestorProfitStatusResponse[]>([]);
  const [propertiesById, setPropertiesById] = useState<Record<string, PropertyResponse>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [claimingProfitPropertyId, setClaimingProfitPropertyId] = useState<string | null>(null);
  const [claimingEquityPropertyId, setClaimingEquityPropertyId] = useState<string | null>(null);
  const [claimSuccessTxHash, setClaimSuccessTxHash] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSigningWithBase, setIsSigningWithBase] = useState(false);
  const [showAllInvestments, setShowAllInvestments] = useState(false);
  const [showAllEquityClaims, setShowAllEquityClaims] = useState(false);
  const [showAllProfitClaims, setShowAllProfitClaims] = useState(false);
  const [showNonActionableClaims, setShowNonActionableClaims] = useState(false);
  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>([]);
  const [pendingInvestments, setPendingInvestments] = useState<PendingInvestment[]>([]);
  const lastHandledPortfolioActivityRef = useRef<string | null>(null);
  const lastAutoAuthAddressRef = useRef<string | null>(null);
  const hasMatchingConnectedWallet =
    !!connectedWalletAddress &&
    !!address &&
    connectedWalletAddress.toLowerCase() === address.toLowerCase();
  const canFetchInvestorData = isAuthenticated && !!token && hasMatchingConnectedWallet;
  const isClaimingProfit = claimingProfitPropertyId !== null;
  const isClaimingEquity = claimingEquityPropertyId !== null;
  const isClaimingAny = isClaimingProfit || isClaimingEquity;
  const builderDataSuffix = useMemo(() => toBuilderDataSuffix(env.BASE_BUILDER_CODES), []);

  const loadPortfolio = useCallback(async () => {
    if (!canFetchInvestorData || !token) {
      setInvestments([]);
      setEquityClaims([]);
      setProfitClaims([]);
      setProfitStatuses([]);
      setPropertiesById({});
      setErrorMessage('');
      setLoading(false);
      return;
    }

    try {
      const [investmentsData, equityData, profitData, profitStatusData, propertiesData] = await Promise.all([
        fetchMyInvestments(token),
        fetchMyEquityClaims(token),
        fetchMyProfitClaims(token),
        fetchMyProfitStatus(token),
        fetchProperties(),
      ]);
      setInvestments(investmentsData);
      setEquityClaims(equityData);
      setProfitClaims(profitData);
      setProfitStatuses(profitStatusData);
      setPropertiesById(
        propertiesData.reduce<Record<string, PropertyResponse>>((acc, property) => {
          acc[property.propertyId] = property;
          return acc;
        }, {})
      );
      setErrorMessage('');
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canFetchInvestorData, token]);

  const addPendingClaim = useCallback((next: PendingClaim) => {
    setPendingClaims((current) => {
      if (current.some((item) => item.txHash.toLowerCase() === next.txHash.toLowerCase())) {
        return current;
      }
      return [next, ...current].slice(0, 20);
    });
  }, []);

  const addPendingInvestment = useCallback((next: PendingInvestment) => {
    setPendingInvestments((current) => {
      if (current.some((item) => item.txHash.toLowerCase() === next.txHash.toLowerCase())) {
        return current;
      }
      return [next, ...current].slice(0, 20);
    });
  }, []);

  const handlePortfolioActivity = useCallback(
    (payload: {
      txHash: string;
      propertyId: string;
      type: 'invest' | 'claim-equity' | 'claim-profit' | 'claim-refund';
      amountUsdcBaseUnits?: string;
      createdAt?: string;
      timestamp?: number;
    }) => {
      if (!canFetchInvestorData) {
        return;
      }

      const activityKey = `${payload.type}:${payload.txHash.toLowerCase()}`;
      if (lastHandledPortfolioActivityRef.current === activityKey) {
        return;
      }
      lastHandledPortfolioActivityRef.current = activityKey;

      if (
        payload.type === 'invest' &&
        payload.amountUsdcBaseUnits &&
        payload.createdAt
      ) {
        addPendingInvestment({
          txHash: payload.txHash,
          propertyId: payload.propertyId,
          usdcAmountBaseUnits: payload.amountUsdcBaseUnits,
          createdAt: payload.createdAt,
        });
        setStatusMessage('Investment confirmed onchain. Waiting for indexer sync...');
      } else if (payload.type === 'claim-profit' || payload.type === 'claim-equity') {
        setStatusMessage('Claim confirmed onchain. Waiting for indexer sync...');
      }

      void loadPortfolio();
    },
    [addPendingInvestment, canFetchInvestorData, loadPortfolio]
  );

  const ensureBaseSepolia = async (provider: EthereumProvider) => {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (switchError) {
      const message = switchError instanceof Error ? switchError.message : String(switchError);
      if (!message.includes('4902')) {
        throw switchError;
      }
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
            chainName: 'Base Sepolia',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://sepolia.base.org'],
            blockExplorerUrls: ['https://sepolia.basescan.org'],
          },
        ],
      });
    }
  };

  const handleClaimProfit = async (status: InvestorProfitStatusResponse) => {
    setErrorMessage('');
    setClaimSuccessTxHash(null);
    setStatusMessage('Submitting profit claim...');
    setClaimingProfitPropertyId(status.propertyId);
    try {
      const injected = getInjectedProvider();
      if (!injected) {
        throw new Error('Wallet provider not found');
      }
      await ensureBaseSepolia(injected);
      await injected.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(injected as never);
      const signer = await provider.getSigner();
      const distributor = new Contract(status.profitDistributorAddress, PROFIT_DISTRIBUTOR_ABI, signer);
      const txData = distributor.interface.encodeFunctionData('claim', []);
      const data = builderDataSuffix ? concat([txData, builderDataSuffix]) : txData;
      const tx = await signer.sendTransaction({
        to: status.profitDistributorAddress,
        data,
      });
      await tx.wait();
      emitPortfolioActivity({
        txHash: tx.hash,
        propertyId: status.propertyId,
        type: 'claim-profit',
      });
      addPendingClaim({
        txHash: tx.hash,
        propertyId: status.propertyId,
        type: 'claim-profit',
        createdAt: new Date().toISOString(),
      });
      setStatusMessage(`Profit claim confirmed: ${tx.hash}`);
      setClaimSuccessTxHash(tx.hash);
      await loadPortfolio();
    } catch (error) {
      setClaimSuccessTxHash(null);
      setErrorMessage(error instanceof Error ? error.message : 'Profit claim failed');
      setStatusMessage('');
    } finally {
      setClaimingProfitPropertyId(null);
    }
  };

  const handleClaimEquity = async (status: InvestorProfitStatusResponse) => {
    setErrorMessage('');
    setClaimSuccessTxHash(null);
    setStatusMessage('Submitting equity claim...');
    setClaimingEquityPropertyId(status.propertyId);
    try {
      if (!status.campaignAddress) {
        throw new Error('Campaign address is missing for this property.');
      }
      const injected = getInjectedProvider();
      if (!injected) {
        throw new Error('Wallet provider not found');
      }
      await ensureBaseSepolia(injected);
      await injected.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(injected as never);
      const signer = await provider.getSigner();
      const campaign = new Contract(status.campaignAddress, CROWDFUND_ABI, signer);
      const txData = campaign.interface.encodeFunctionData('claimTokens', []);
      const data = builderDataSuffix ? concat([txData, builderDataSuffix]) : txData;
      const tx = await signer.sendTransaction({
        to: status.campaignAddress,
        data,
      });
      await tx.wait();
      emitPortfolioActivity({
        txHash: tx.hash,
        propertyId: status.propertyId,
        type: 'claim-equity',
      });
      addPendingClaim({
        txHash: tx.hash,
        propertyId: status.propertyId,
        type: 'claim-equity',
        createdAt: new Date().toISOString(),
      });
      setStatusMessage(`Equity claim confirmed: ${tx.hash}`);
      setClaimSuccessTxHash(tx.hash);
      await loadPortfolio();
    } catch (error) {
      setClaimSuccessTxHash(null);
      setErrorMessage(error instanceof Error ? error.message : 'Equity claim failed');
      setStatusMessage('');
    } finally {
      setClaimingEquityPropertyId(null);
    }
  };

  useEffect(() => {
    if (pendingClaims.length === 0) {
      return;
    }
    const indexedProfit = new Set(profitClaims.map((claim) => claim.txHash.toLowerCase()));
    const indexedEquity = new Set(equityClaims.map((claim) => claim.txHash.toLowerCase()));
    setPendingClaims((current) =>
      current.filter((item) => {
        const txHash = item.txHash.toLowerCase();
        if (item.type === 'claim-profit') {
          return !indexedProfit.has(txHash);
        }
        return !indexedEquity.has(txHash);
      })
    );
  }, [equityClaims, pendingClaims.length, profitClaims]);

  useEffect(() => {
    if (pendingInvestments.length === 0) {
      return;
    }
    const indexedInvestments = new Set(
      investments.map((investment) => investment.txHash.toLowerCase())
    );
    setPendingInvestments((current) =>
      current.filter((item) => !indexedInvestments.has(item.txHash.toLowerCase()))
    );
  }, [investments, pendingInvestments.length]);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      await loadPortfolio();
      if (!isMounted) {
        return;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [loadPortfolio]);

  useEffect(() => {
    if (!canFetchInvestorData) {
      return;
    }
    const hasPendingSync = pendingClaims.length > 0 || pendingInvestments.length > 0;
    const timer = setInterval(() => {
      void loadPortfolio();
    }, hasPendingSync ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [canFetchInvestorData, loadPortfolio, pendingClaims.length, pendingInvestments.length]);

  useEffect(() => {
    if (!canFetchInvestorData) {
      return;
    }
    const unsubscribe = subscribePortfolioActivity((payload) => {
      handlePortfolioActivity(payload);
    });
    return unsubscribe;
  }, [canFetchInvestorData, handlePortfolioActivity]);

  const authenticateInvestor = async () => {
    setErrorMessage('');
    setClaimSuccessTxHash(null);
    setStatusMessage('Authenticating investor session...');
    setIsAuthenticating(true);
    try {
      const normalizedAddress = connectedWalletAddress?.toLowerCase();
      if (!normalizedAddress) {
        throw new Error('Connect a wallet before authentication.');
      }
      const injected = getInjectedProvider();
      if (!injected) {
        throw new Error('Wallet provider not found for investor authentication.');
      }
      const { nonce } = await getAuthNonce();
      const message = buildInvestorMessage(normalizedAddress, nonce, 84532);
      const signature = (await injected.request({
        method: 'personal_sign',
        params: [toHexUtf8(message), normalizedAddress],
      })) as string;

      const response = await loginWithWallet({
        address: normalizedAddress,
        signature,
        message,
        role: 'investor',
      });
      dispatch(
        setUser({
          address: response.user.address,
          role: response.user.role,
          token: response.token,
        })
      );
      setStatusMessage(`Authenticated as ${response.user.role}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Investor authentication failed');
      setStatusMessage('');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const authenticateWithBase = async () => {
    setErrorMessage('');
    setClaimSuccessTxHash(null);
    setStatusMessage('Opening Sign in with Base...');
    setIsSigningWithBase(true);
    try {
      const { nonce } = await getAuthNonce();
      const result = await signInWithBaseAccount({ nonce, chainId: 84532 });
      const response = await loginWithWallet({
        address: result.address,
        signature: result.signature,
        message: result.message,
        role: 'investor',
      });
      dispatch(
        setUser({
          address: response.user.address,
          role: response.user.role,
          token: response.token,
        })
      );
      setStatusMessage(`Authenticated as ${response.user.role}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Sign in with Base failed');
      setStatusMessage('');
    } finally {
      setIsSigningWithBase(false);
    }
  };

  const logoutInvestor = () => {
    dispatch(clearUser());
    setClaimSuccessTxHash(null);
    setStatusMessage('Logged out.');
    setErrorMessage('');
  };

  useEffect(() => {
    const normalizedConnectedAddress = connectedWalletAddress?.toLowerCase() || '';
    if (!isConnected || !normalizedConnectedAddress) {
      lastAutoAuthAddressRef.current = null;
      return;
    }
    if (canFetchInvestorData || isAuthenticating || isSigningWithBase) {
      return;
    }
    if (lastAutoAuthAddressRef.current === normalizedConnectedAddress) {
      return;
    }
    lastAutoAuthAddressRef.current = normalizedConnectedAddress;
    void authenticateInvestor().catch(() => {
      lastAutoAuthAddressRef.current = null;
    });
  }, [canFetchInvestorData, connectedWalletAddress, isAuthenticating, isConnected, isSigningWithBase]);

  const summary = useMemo(() => {
    const totalInvested = investments.reduce(
      (sum, investment) => sum + Number(investment.usdcAmountBaseUnits) / 1_000_000,
      0
    );
    const activeProperties = new Set(investments.map((investment) => investment.propertyId)).size;
    const totalReturns = investments.reduce((sum, investment) => {
      const invested = Number(investment.usdcAmountBaseUnits) / 1_000_000;
      const property = propertiesById[investment.propertyId];
      const target = property ? Number(property.targetUsdcBaseUnits) / 1_000_000 : 0;
      const baseSell = getScenarioSellUsdc(property, 'base');
      if (!baseSell || target <= 0) {
        return sum;
      }
      const projectedExit = (invested / target) * baseSell;
      return sum + (projectedExit - invested);
    }, 0);
    const totalClaimableProfit = profitStatuses.reduce(
      (sum, status) => sum + Number(BigInt(status.claimableBaseUnits ?? '0')) / 1_000_000,
      0
    );
    const totalClaimableEquity = profitStatuses.reduce(
      (sum, status) =>
        sum + Number(BigInt(status.claimableTokensBaseUnits ?? '0')) / 1_000_000_000_000_000_000,
      0
    );

    return { totalInvested, activeProperties, totalReturns, totalClaimableProfit, totalClaimableEquity };
  }, [investments, profitStatuses, propertiesById]);

  const visibleInvestments = showAllInvestments ? investments : investments.slice(0, 3);
  const visiblePendingInvestments = showAllInvestments
    ? pendingInvestments
    : pendingInvestments.slice(0, Math.max(0, 3 - visibleInvestments.length));
  const visibleEquityClaims = showAllEquityClaims ? equityClaims : equityClaims.slice(0, 3);
  const visibleProfitClaims = showAllProfitClaims ? profitClaims : profitClaims.slice(0, 3);
  const visiblePendingClaims = pendingClaims.slice(0, 4);
  const actionableClaimItems = useMemo(
    () => profitStatuses.filter((status) => status.diagnostics.profitReady || status.diagnostics.equityReady),
    [profitStatuses]
  );
  const nonActionableClaimItems = useMemo(
    () => profitStatuses.filter((status) => !status.diagnostics.profitReady && !status.diagnostics.equityReady),
    [profitStatuses]
  );

  if (loading) {
    return (
      <div className="overflow-hidden min-h-screen">
        <div className="container mx-auto px-4 py-20 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-emerald-500 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden min-h-screen">
      <div>
        <div className="container mx-auto px-4 py-12 md:py-16">
          {/* Header */}
          <div className="mb-12">
            <h1 className="text-5xl md:text-6xl font-light tracking-tight text-white mb-3">
              Investor Dashboard
            </h1>
            <p className="text-lg text-slate-300 max-w-2xl">
              Track your investments, monitor payout readiness, and manage claims.
            </p>
          </div>

          {/* Authentication Controls */}
          <div className="mb-8 rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
              <button
                onClick={() => void authenticateInvestor()}
                disabled={!isConnected || isAuthenticating || isSigningWithBase}
                className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-emerald-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isAuthenticating ? 'Authenticating...' : 'Authenticate'}
              </button>
              <button
                onClick={() => void authenticateWithBase()}
                disabled={isAuthenticating || isSigningWithBase}
                className="px-6 py-3 border border-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-800/50 transition disabled:opacity-60"
              >
                {isSigningWithBase ? 'Signing...' : 'Sign in with Base'}
              </button>
              {(isAuthenticated || token) && (
                <button
                  onClick={logoutInvestor}
                  className="px-6 py-3 border border-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-800/50 transition"
                >
                  Log out
                </button>
              )}
              {canFetchInvestorData && (
                <button
                  onClick={() => void loadPortfolio()}
                  className="px-6 py-3 border border-slate-700 text-slate-300 font-semibold rounded-lg hover:bg-slate-800/50 transition"
                >
                  Refresh
                </button>
              )}
            </div>

            <div className="text-sm text-slate-400 space-y-1">
              <p>
                <span className="text-slate-500">Wallet:</span>{' '}
                {connectedWalletAddress ? `${connectedWalletAddress.slice(0, 6)}...${connectedWalletAddress.slice(-4)}` : 'Not connected'}
              </p>
              <p>
                <span className="text-slate-500">Session:</span>{' '}
                {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not authenticated'}{' '}
                {role && <span className="text-emerald-400">({role})</span>}
              </p>
            </div>
          </div>

          {/* Messages */}
          {statusMessage && (
            <div className="mb-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-6 py-4">
              <p className="text-emerald-200 text-sm">{statusMessage}</p>
              {claimSuccessTxHash && (
                <div className="mt-3">
                  <TxHashLink txHash={claimSuccessTxHash} />
                </div>
              )}
            </div>
          )}
          {errorMessage && (
            <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 px-6 py-4 text-red-200 text-sm">
              {errorMessage}
            </div>
          )}
          {!canFetchInvestorData && (
            <div className="mb-6 rounded-xl bg-blue-500/10 border border-blue-500/30 px-6 py-4 flex gap-3">
              <AlertIcon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-blue-200 text-sm">Connect and authenticate to view your portfolio.</p>
            </div>
          )}
          {canFetchInvestorData && pendingClaims.length > 0 && (
            <div className="mb-6 rounded-xl bg-amber-500/10 border border-amber-500/30 px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-amber-200 text-sm font-medium">
                  {pendingClaims.length} claim transaction{pendingClaims.length === 1 ? '' : 's'} pending index sync
                </p>
                <button
                  type="button"
                  onClick={() => void loadPortfolio()}
                  className="text-xs font-semibold text-amber-200 hover:text-amber-100"
                >
                  Refresh now
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {visiblePendingClaims.map((pending) => (
                  <div
                    key={`pending-claim:${pending.txHash}`}
                    className="rounded-lg border border-amber-400/20 bg-slate-900/50 px-3 py-2 text-xs flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex h-2 w-2 rounded-full bg-amber-300 animate-pulse" />
                      <span className="text-amber-100 truncate">
                        {pending.type === 'claim-profit' ? 'Profit claim' : 'Equity claim'} · {pending.propertyId}
                      </span>
                    </div>
                    <TxHashLink txHash={pending.txHash} compact className="shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Strip */}
          <div className="mb-12 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Invested</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                ${summary.totalInvested.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="mt-1 text-xs text-slate-500">{summary.activeProperties} properties</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Claimable Profit</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-300">
                ${summary.totalClaimableProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Claimable Equity</p>
              <p className="mt-2 text-2xl font-semibold text-blue-300">
                {summary.totalClaimableEquity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Projected Return</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                ${summary.totalReturns.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="mt-1 text-xs text-slate-500">Base scenario</p>
            </div>
          </div>

          {/* Investment History */}
          <div className="mb-8 rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-white">Investment History</h2>
              {investments.length + pendingInvestments.length > 3 && (
                <button
                  onClick={() => setShowAllInvestments(!showAllInvestments)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
                >
                  {showAllInvestments
                    ? 'Show less'
                    : `View all (${investments.length + pendingInvestments.length})`}
                </button>
              )}
            </div>

            {!canFetchInvestorData ? (
              <p className="text-slate-400">Authenticate to view investment history.</p>
            ) : investments.length === 0 && pendingInvestments.length === 0 ? (
              <p className="text-slate-400">No investments yet. Start by exploring properties.</p>
            ) : (
              <div className="space-y-4">
                {visiblePendingInvestments.map((investment) => (
                  <div
                    key={`pending-investment:${investment.txHash}`}
                    className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4"
                  >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                      <div>
                        <p className="text-xs text-amber-200/80 mb-1">Property</p>
                        <p className="text-sm font-semibold text-white truncate">{investment.propertyId}</p>
                      </div>
                      <div>
                        <p className="text-xs text-amber-200/80 mb-1">Amount</p>
                        <p className="text-sm font-semibold text-white">
                          ${(Number(investment.usdcAmountBaseUnits) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-amber-200/80 mb-1">Status</p>
                        <p className="text-sm font-semibold text-amber-300">Pending index sync</p>
                      </div>
                      <div className="flex items-end gap-2">
                        <Link
                          to={`/properties/${investment.propertyId}`}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-slate-800/50 text-slate-300 rounded hover:bg-slate-700 transition text-center"
                        >
                          View
                        </Link>
                        <TxHashLink txHash={investment.txHash} compact />
                      </div>
                    </div>
                    <p className="text-xs text-amber-100/80">
                      Confirmed onchain. Waiting for backend indexing before this moves into finalized history.
                    </p>
                  </div>
                ))}
                {visibleInvestments.map((investment) => (
                  <div
                    key={`${investment.txHash}:${investment.logIndex}`}
                    className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-4 hover:border-slate-600 transition"
                  >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Property</p>
                        <p className="text-sm font-semibold text-white truncate">{investment.propertyId}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Amount</p>
                        <p className="text-sm font-semibold text-white">
                          ${(Number(investment.usdcAmountBaseUnits) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Date</p>
                        <p className="text-sm font-semibold text-white">{new Date(investment.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="flex items-end gap-2">
                        <Link
                          to={`/properties/${investment.propertyId}`}
                          className="flex-1 px-3 py-2 text-xs font-semibold bg-slate-800/50 text-slate-300 rounded hover:bg-slate-700 transition text-center"
                        >
                          View
                        </Link>
                        <TxHashLink txHash={investment.txHash} compact />
                      </div>
                    </div>

                    {(() => {
                      const property = propertiesById[investment.propertyId];
                      const target = property ? Number(property.targetUsdcBaseUnits) / 1_000_000 : 0;
                      const invested = Number(investment.usdcAmountBaseUnits) / 1_000_000;
                      const conservative = getScenarioSellUsdc(property, 'conservative');
                      const base = getScenarioSellUsdc(property, 'base');
                      const optimistic = getScenarioSellUsdc(property, 'optimistic');
                      if (!property || target <= 0 || !conservative || !base || !optimistic) {
                        return null;
                      }
                      const conservativeProfit = (invested / target) * conservative - invested;
                      const baseProfit = (invested / target) * base - invested;
                      const optimisticProfit = (invested / target) * optimistic - invested;
                      return (
                        <div className="text-xs text-slate-400 flex gap-4">
                          <span>Conservative: <span className="text-emerald-400">${conservativeProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
                          <span>Base: <span className="text-emerald-400">${baseProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
                          <span>Optimistic: <span className="text-emerald-400">${optimisticProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Claim Queue */}
          <div className="mb-8 rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-white">Claim Center</h2>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Priority queue
              </p>
            </div>

            {!canFetchInvestorData ? (
              <p className="text-slate-400">Authenticate to view claim opportunities.</p>
            ) : actionableClaimItems.length === 0 && nonActionableClaimItems.length === 0 ? (
              <p className="text-slate-400">No claimable profit or equity yet.</p>
            ) : (
              <div className="space-y-3">
                {actionableClaimItems.map((status) => {
                  const claimableProfit = Number(BigInt(status.claimableBaseUnits ?? '0')) / 1_000_000;
                  const claimableEquity =
                    Number(BigInt(status.claimableTokensBaseUnits ?? '0')) / 1_000_000_000_000_000_000;
                  const shouldClaimEquityFirst =
                    !status.diagnostics.profitReady &&
                    status.diagnostics.equityReady &&
                    BigInt(status.equityWalletBalanceBaseUnits ?? '0') <= 0n &&
                    BigInt(status.claimableTokensBaseUnits ?? '0') > 0n;
                  return (
                    <div
                      key={`claim-center:${status.propertyId}:${status.profitDistributorAddress}`}
                      className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{status.propertyId}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            Profit: {claimableProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                            USDC
                            {' • '}
                            Equity:{' '}
                            {claimableEquity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </p>
                        </div>
                        <Link
                          to={`/properties/${status.propertyId}`}
                          className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          View <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                        <div className="rounded border border-white/10 bg-slate-900/40 px-3 py-2">
                          <span className="text-slate-400">Claimable Profit</span>
                          <p className="mt-1 font-semibold text-emerald-300">
                            ${claimableProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="rounded border border-white/10 bg-slate-900/40 px-3 py-2">
                          <span className="text-slate-400">Claimable Equity</span>
                          <p className="mt-1 font-semibold text-blue-300">
                            {claimableEquity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                        <button
                          onClick={() => void handleClaimProfit(status)}
                          disabled={!status.diagnostics.profitReady || isClaimingAny || !canFetchInvestorData}
                          className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:shadow-lg hover:shadow-emerald-500/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {claimingProfitPropertyId === status.propertyId
                            ? 'Claiming Profit...'
                            : shouldClaimEquityFirst
                              ? 'Claim Equity First'
                              : 'Claim Profit'}
                        </button>
                        <button
                          onClick={() => void handleClaimEquity(status)}
                          disabled={
                            !status.diagnostics.equityReady ||
                            !status.campaignAddress ||
                            isClaimingAny ||
                            !canFetchInvestorData
                          }
                          className="w-full md:w-auto px-3 py-2.5 border border-blue-500/50 bg-blue-500/10 text-blue-300 text-sm font-semibold rounded-lg hover:bg-blue-500/20 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {claimingEquityPropertyId === status.propertyId ? 'Claiming...' : 'Claim Equity'}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {nonActionableClaimItems.length > 0 && (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
                    <button
                      onClick={() => setShowNonActionableClaims((prev) => !prev)}
                      className="text-xs font-semibold text-slate-300 hover:text-white"
                    >
                      {showNonActionableClaims
                        ? 'Hide non-claimable items'
                        : `Show non-claimable items (${nonActionableClaimItems.length})`}
                    </button>
                    {showNonActionableClaims && (
                      <div className="mt-3 space-y-2">
                        {nonActionableClaimItems.map((status) => (
                          <details
                            key={`blocked:${status.propertyId}:${status.profitDistributorAddress}`}
                            className="rounded border border-slate-700 bg-slate-900/50 p-2 text-xs text-slate-300"
                          >
                            <summary className="cursor-pointer select-none font-medium text-slate-200">
                              {status.propertyId} · Not claimable yet
                            </summary>
                            <div className="mt-2 space-y-1">
                              {status.diagnostics.profitReasons.length > 0 && (
                                <p className="text-amber-300">
                                  Profit blockers: {status.diagnostics.profitReasons.map(describeReadinessReason).join('; ')}
                                </p>
                              )}
                              {status.diagnostics.equityReasons.length > 0 && (
                                <p>
                                  Equity blockers: {status.diagnostics.equityReasons.map(describeReadinessReason).join('; ')}
                                </p>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Equity & Profit Claims */}
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Equity Claims */}
            <div className="rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-white">Equity Claims</h2>
                {equityClaims.length > 3 && (
                  <button
                    onClick={() => setShowAllEquityClaims(!showAllEquityClaims)}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    {showAllEquityClaims ? 'Show less' : `View all (${equityClaims.length})`}
                  </button>
                )}
              </div>

              {equityClaims.length === 0 ? (
                <p className="text-slate-400 text-sm">No equity claims yet.</p>
              ) : (
                <div className="space-y-3">
                  {visibleEquityClaims.map((claim) => (
                    <div
                      key={`${claim.txHash}:${claim.logIndex}`}
                      className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3 flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white truncate">{claim.propertyId}</p>
                        <p className="text-xs text-slate-400">{new Date(claim.createdAt).toLocaleDateString()}</p>
                      </div>
                      <TxHashLink txHash={claim.txHash} compact className="ml-2" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Profit Claims */}
            <div className="rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-white">Profit Claims</h2>
                {profitClaims.length > 3 && (
                  <button
                    onClick={() => setShowAllProfitClaims(!showAllProfitClaims)}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    {showAllProfitClaims ? 'Show less' : `View all (${profitClaims.length})`}
                  </button>
                )}
              </div>

              {profitClaims.length === 0 ? (
                <p className="text-slate-400 text-sm">No profit claims yet.</p>
              ) : (
                <div className="space-y-3">
                  {visibleProfitClaims.map((claim) => (
                    <div
                      key={`${claim.txHash}:${claim.logIndex}`}
                      className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3 flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white truncate">{claim.propertyId}</p>
                        <p className="text-xs text-emerald-400">
                          ${(Number(claim.usdcAmountBaseUnits) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <TxHashLink txHash={claim.txHash} compact className="ml-2" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
}
