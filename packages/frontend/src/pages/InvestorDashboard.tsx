import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getAuthNonce,
  loginWithWallet,
  fetchMyEquityClaims,
  fetchMyInvestments,
  fetchMyProfitClaims,
  InvestmentResponse,
  EquityClaimResponse,
  ProfitClaimResponse,
} from '../lib/api';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { clearUser, setUser } from '../store/slices/userSlice';
import { useAccount } from 'wagmi';
import { signInWithBaseAccount } from '../lib/baseAccount';
import { subscribePortfolioActivity } from '../lib/portfolioActivity';

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
    'Homeshare wants you to sign in with your wallet.',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

const getInjectedProvider = (): EthereumProvider | null => {
  const injected = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return injected && typeof injected.request === 'function' ? injected : null;
};

export default function InvestorDashboard() {
  const dispatch = useDispatch();
  const { token, isAuthenticated } = useSelector((state: RootState) => state.user);
  const { address, role } = useSelector((state: RootState) => state.user);
  const { address: connectedWalletAddress, isConnected } = useAccount();
  const [investments, setInvestments] = useState<InvestmentResponse[]>([]);
  const [equityClaims, setEquityClaims] = useState<EquityClaimResponse[]>([]);
  const [profitClaims, setProfitClaims] = useState<ProfitClaimResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSigningWithBase, setIsSigningWithBase] = useState(false);
  const lastAutoAuthAddressRef = useRef<string | null>(null);
  const hasMatchingConnectedWallet =
    !!connectedWalletAddress &&
    !!address &&
    connectedWalletAddress.toLowerCase() === address.toLowerCase();
  const canFetchInvestorData = isAuthenticated && !!token && hasMatchingConnectedWallet;

  const loadPortfolio = useCallback(async () => {
    if (!canFetchInvestorData || !token) {
      setInvestments([]);
      setEquityClaims([]);
      setProfitClaims([]);
      setErrorMessage('');
      setLoading(false);
      return;
    }

    try {
      const [investmentsData, equityData, profitData] = await Promise.all([
        fetchMyInvestments(token),
        fetchMyEquityClaims(token),
        fetchMyProfitClaims(token),
      ]);
      setInvestments(investmentsData);
      setEquityClaims(equityData);
      setProfitClaims(profitData);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canFetchInvestorData, token]);

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
    const timer = setInterval(() => {
      void loadPortfolio();
    }, 15000);
    return () => clearInterval(timer);
  }, [canFetchInvestorData, loadPortfolio]);

  useEffect(() => {
    if (!canFetchInvestorData) {
      return;
    }
    const unsubscribe = subscribePortfolioActivity(() => {
      if (!canFetchInvestorData) {
        return;
      }
      void loadPortfolio();
      setStatusMessage('Portfolio refreshed after recent onchain activity.');
    });
    return unsubscribe;
  }, [canFetchInvestorData, loadPortfolio]);

  const authenticateInvestor = async () => {
    setErrorMessage('');
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
    const totalReturns = totalInvested * 0.0;
    const byChain = investments.reduce<Record<string, number>>((acc, investment) => {
      const chain = 'Base Sepolia';
      const amount = Number(investment.usdcAmountBaseUnits) / 1_000_000;
      acc[chain] = (acc[chain] ?? 0) + amount;
      return acc;
    }, {});

    return { totalInvested, activeProperties, totalReturns, byChain };
  }, [investments]);

  const basescanTxUrl = (txHash: string) => `https://sepolia.basescan.org/tx/${txHash}`;
  const shortTx = (txHash: string) => `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
        Investor Dashboard
      </h1>

      {loading && (
        <div className="text-gray-600 dark:text-gray-300">Loading investments...</div>
      )}

      {!loading && !canFetchInvestorData && (
        <div className="mb-6 rounded-lg bg-blue-50 px-4 py-3 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
          Connect a wallet and authenticate as investor to view your onchain portfolio.
        </div>
      )}

      <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="bg-primary-600 px-4 py-2 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void authenticateInvestor()}
            disabled={!isConnected || isAuthenticating || isSigningWithBase}
          >
            {isAuthenticating ? 'Authenticating...' : 'Authenticate Investor'}
          </button>
          <button
            className="border border-primary-600 px-4 py-2 text-primary-700 dark:text-primary-300 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => void authenticateWithBase()}
            disabled={isAuthenticating || isSigningWithBase}
          >
            {isSigningWithBase ? 'Signing...' : 'Sign in with Base'}
          </button>
          {(isAuthenticated || token) && (
            <button
              className="border border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg text-gray-700 dark:text-gray-200"
              onClick={logoutInvestor}
            >
              Log out
            </button>
          )}
          {canFetchInvestorData && (
            <button
              className="border border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg text-gray-700 dark:text-gray-200"
              onClick={() => void loadPortfolio()}
            >
              Refresh Portfolio
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Wallet: {connectedWalletAddress ? `${connectedWalletAddress.slice(0, 6)}...${connectedWalletAddress.slice(-4)}` : 'Not connected'}{' '}
          | Session: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not authenticated'} {role ? `(${role})` : ''}
        </p>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-lg bg-green-50 px-4 py-3 text-green-700 dark:bg-green-900/40 dark:text-green-200">
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-900/40 dark:text-red-200">
          {errorMessage}
        </div>
      )}

      {!loading && !errorMessage && investments.length === 0 && (
        <div className="mb-6 text-gray-600 dark:text-gray-300">No investments yet.</div>
      )}

      {/* Summary Cards */}
      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-sm text-gray-500 dark:text-gray-400 mb-2">Total Invested</h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            ${summary.totalInvested.toLocaleString()}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-sm text-gray-500 dark:text-gray-400 mb-2">Active Properties</h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{summary.activeProperties}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-sm text-gray-500 dark:text-gray-400 mb-2">Total Returns</h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            ${summary.totalReturns.toLocaleString()}
          </p>
        </div>
      </div>

      {/* By Chain */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Investments by Chain</h2>
        <div className="space-y-4">
          {Object.keys(summary.byChain).length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">No chain data yet.</p>
          )}
          {Object.entries(summary.byChain).map(([chain, amount]) => (
            <div key={chain} className="flex justify-between items-center">
              <span className="text-gray-900 dark:text-white">{chain}</span>
              <span className="text-gray-900 dark:text-white">${amount.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Investment History */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Investment History</h2>
        {investments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No investments yet</p>
        ) : (
          <div className="space-y-4">
            {investments.map((investment) => (
              <div
                key={`${investment.txHash}:${investment.logIndex}`}
                className="flex flex-col gap-2 border-b border-gray-200 pb-4 last:border-b-0 dark:border-gray-700"
              >
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">Property ID</span>
                  <span className="text-gray-600 dark:text-gray-300">{investment.propertyId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">Amount</span>
                  <span className="text-gray-600 dark:text-gray-300">
                    ${(Number(investment.usdcAmountBaseUnits) / 1_000_000).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">Chain</span>
                  <span className="text-gray-600 dark:text-gray-300">Base Sepolia</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(investment.createdAt).toLocaleString()}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Link
                    to={`/properties/${investment.propertyId}`}
                    className="text-primary-600 hover:underline dark:text-primary-300"
                  >
                    Open property
                  </Link>
                  <a
                    href={basescanTxUrl(investment.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 hover:underline dark:text-primary-300"
                  >
                    Tx {shortTx(investment.txHash)}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Equity Claim History</h2>
        {equityClaims.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No equity claims yet.</p>
        ) : (
          <div className="space-y-4">
            {equityClaims.map((claim) => (
              <div
                key={`${claim.txHash}:${claim.logIndex}`}
                className="flex flex-col gap-2 border-b border-gray-200 pb-4 last:border-b-0 dark:border-gray-700"
              >
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">Property ID</span>
                  <span className="text-gray-600 dark:text-gray-300">{claim.propertyId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">Equity Amount</span>
                  <span className="text-gray-600 dark:text-gray-300">{claim.equityAmountBaseUnits}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(claim.createdAt).toLocaleString()}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Link
                    to={`/properties/${claim.propertyId}`}
                    className="text-primary-600 hover:underline dark:text-primary-300"
                  >
                    Open property
                  </Link>
                  <a
                    href={basescanTxUrl(claim.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 hover:underline dark:text-primary-300"
                  >
                    Tx {shortTx(claim.txHash)}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Profit Claim History</h2>
        {profitClaims.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No profit claims yet.</p>
        ) : (
          <div className="space-y-4">
            {profitClaims.map((claim) => (
              <div
                key={`${claim.txHash}:${claim.logIndex}`}
                className="flex flex-col gap-2 border-b border-gray-200 pb-4 last:border-b-0 dark:border-gray-700"
              >
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">Property ID</span>
                  <span className="text-gray-600 dark:text-gray-300">{claim.propertyId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-900 dark:text-white">USDC Claimed</span>
                  <span className="text-gray-600 dark:text-gray-300">
                    ${(Number(claim.usdcAmountBaseUnits) / 1_000_000).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(claim.createdAt).toLocaleString()}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Link
                    to={`/properties/${claim.propertyId}`}
                    className="text-primary-600 hover:underline dark:text-primary-300"
                  >
                    Open property
                  </Link>
                  <a
                    href={basescanTxUrl(claim.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 hover:underline dark:text-primary-300"
                  >
                    Tx {shortTx(claim.txHash)}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
