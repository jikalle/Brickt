import { Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useEffect, useMemo, useState } from 'react';
import { RootState } from '../../store';
import { setUser, setWalletAddress } from '../../store/slices/userSlice';
import { env } from '../../config/env';
import { signInWithBaseAccount } from '../../lib/baseAccount';
import { getAuthNonce, loginWithWallet, requestTestnetFunds, type FaucetRequestResponse } from '../../lib/api';
import TxHashLink from './TxHashLink';

// Inline SVG Icons
const Menu = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const X = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const Wallet = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const BaseGlyph = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 100 20h5.5a3.5 3.5 0 000-7H11a3.5 3.5 0 010-7h8a10 10 0 00-7-6z" />
  </svg>
);

const MetaMaskIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="4,7 10,3 11.5,8" fill="#e2761b" />
    <polygon points="20,7 14,3 12.5,8" fill="#e4761b" />
    <polygon points="6,15 10.8,14.2 9.4,18.6" fill="#d7c1b3" />
    <polygon points="18,15 13.2,14.2 14.6,18.6" fill="#d7c1b3" />
    <polygon points="10.2,10.2 7.2,12.6 8.4,14.7 11.8,14.4" fill="#f6851b" />
    <polygon points="13.8,10.2 16.8,12.6 15.6,14.7 12.2,14.4" fill="#f6851b" />
    <polygon points="11.8,14.4 12.2,14.4 12,17.6" fill="#c0ad9e" />
  </svg>
);

const CoinbaseIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#1652f0" />
    <circle cx="12" cy="12" r="4.4" fill="#ffffff" />
    <rect x="7.6" y="10.7" width="8.8" height="2.6" fill="#1652f0" />
  </svg>
);

const WalletConnectIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="10" fill="#3b99fc" />
    <path d="M6.2 10.2c3.2-3.2 8.4-3.2 11.6 0l-1 1c-2.6-2.6-6.9-2.6-9.6 0z" fill="#fff" />
    <path d="M8.1 12.1c2.1-2.1 5.7-2.1 7.8 0l-1 1c-1.6-1.6-4.2-1.6-5.8 0z" fill="#fff" />
    <path d="M10 14c1.1-1.1 2.9-1.1 4 0l-2 2z" fill="#fff" />
  </svg>
);

const RabbyIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="6" fill="#8b5cf6" />
    <path d="M7 17V7h5.2c2.3 0 3.8 1.2 3.8 3.2 0 1.5-.8 2.4-2.2 2.9l2.8 3.9h-3.2l-2.4-3.5H10V17zm3-5.8h2c.8 0 1.3-.4 1.3-1.1 0-.8-.5-1.1-1.3-1.1h-2z" fill="#fff" />
  </svg>
);

const BraveIcon = ({ className }: { className: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l6 2.2 2.1 3.5-1.3 9.2L12 22l-6.8-5.1L3.9 7.7 6 4.2z" fill="#fb542b" />
    <path d="M8.3 10.2 10 8.8h4l1.7 1.4-.6 4.7L12 17l-3.1-2.1z" fill="#fff" />
  </svg>
);

type InjectedWalletProvider = {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
};

type ExtensionWallet = 'metamask' | 'coinbase' | 'rabby' | 'brave';

const detectInstalledExtensions = (): Set<ExtensionWallet> => {
  const installed = new Set<ExtensionWallet>();
  const ethereum = (window as Window & { ethereum?: InjectedWalletProvider & { providers?: InjectedWalletProvider[] } }).ethereum;
  if (!ethereum) {
    return installed;
  }
  const providers = Array.isArray(ethereum.providers) && ethereum.providers.length > 0
    ? ethereum.providers
    : [ethereum];

  for (const provider of providers) {
    if (provider.isMetaMask) installed.add('metamask');
    if (provider.isCoinbaseWallet) installed.add('coinbase');
    if (provider.isRabby) installed.add('rabby');
    if (provider.isBraveWallet) installed.add('brave');
  }
  return installed;
};

const getConnectorIcon = (id: string, name: string) => {
  const key = `${id} ${name}`.toLowerCase();
  if (key.includes('metamask')) {
    return <MetaMaskIcon className="h-5 w-5" />;
  }
  if (key.includes('coinbase')) {
    return <CoinbaseIcon className="h-5 w-5" />;
  }
  if (key.includes('walletconnect')) {
    return <WalletConnectIcon className="h-5 w-5" />;
  }
  if (key.includes('rabby')) {
    return <RabbyIcon className="h-5 w-5" />;
  }
  if (key.includes('brave')) {
    return <BraveIcon className="h-5 w-5" />;
  }
  if (key.includes('injected')) {
    return <Wallet className="h-4 w-4 text-slate-200" />;
  }
  return <Wallet className="h-4 w-4 text-slate-200" />;
};

const isConnectorInstalled = (id: string, name: string, installed: Set<ExtensionWallet>) => {
  const key = `${id} ${name}`.toLowerCase();
  if (key.includes('metamask')) return installed.has('metamask');
  if (key.includes('coinbase')) return installed.has('coinbase');
  if (key.includes('rabby')) return installed.has('rabby');
  if (key.includes('injected')) return installed.size > 0;
  if (key.includes('walletconnect')) return true;
  return true;
};

export default function Navbar() {
  const { activeChainId } = useSelector((state: RootState) => state.chain);
  const { role, isAuthenticated } = useSelector((state: RootState) => state.user);
  const dispatch = useDispatch();
  const { address: walletAddress, isConnected } = useAccount();
  const { connectAsync, connectors, isLoading, pendingConnector } = useConnect();
  const { disconnect } = useDisconnect();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isFaucetModalOpen, setIsFaucetModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [isSigningWithBase, setIsSigningWithBase] = useState(false);
  const [faucetToken, setFaucetToken] = useState<'eth' | 'usdc'>('eth');
  const [isRequestingFaucet, setIsRequestingFaucet] = useState(false);
  const [faucetError, setFaucetError] = useState('');
  const [faucetResult, setFaucetResult] = useState<FaucetRequestResponse | null>(null);

  const getChainName = (chainId: number) => {
    switch (chainId) {
      case 84532: return 'Base Sepolia';
      case 8453: return 'Base';
      default: return 'Unknown';
    }
  };

  const displayAddress = isConnected && walletAddress ? walletAddress : '';
  const isAllowlistedConnectedWallet =
    isConnected &&
    !!walletAddress &&
    env.OWNER_ALLOWLIST.includes(walletAddress.toLowerCase());
  const canViewOwnerConsole = (isAuthenticated && role === 'owner') || isAllowlistedConnectedWallet;
  const installedExtensions = useMemo(() => detectInstalledExtensions(), [isConnectModalOpen]);
  const visibleConnectors = useMemo(() => {
    return [...connectors].sort((a, b) => {
      const aInstalled = isConnectorInstalled(a.id, a.name, installedExtensions) ? 1 : 0;
      const bInstalled = isConnectorInstalled(b.id, b.name, installedExtensions) ? 1 : 0;
      if (aInstalled !== bInstalled) return bInstalled - aInstalled;
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [connectors, installedExtensions]);

  const handleConnectClick = () => {
    setConnectError('');
    setIsConnectModalOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleFaucetClick = () => {
    setFaucetError('');
    setFaucetResult(null);
    setIsFaucetModalOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleDisconnectClick = () => {
    disconnect();
    dispatch(setWalletAddress(null));
    setConnectError('');
    setIsMobileMenuOpen(false);
  };

  const handleRequestFaucet = async () => {
    if (!walletAddress) {
      setFaucetError('Connect a wallet before requesting testnet funds.');
      return;
    }

    setIsRequestingFaucet(true);
    setFaucetError('');
    setFaucetResult(null);
    try {
      const result = await requestTestnetFunds({
        address: walletAddress,
        token: faucetToken,
      });
      setFaucetResult(result);
    } catch (error) {
      setFaucetError(error instanceof Error ? error.message : 'Failed to request testnet funds');
    } finally {
      setIsRequestingFaucet(false);
    }
  };

  const handleConnectorSelect = async (connectorId: string) => {
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector) {
      return;
    }
    setConnectError('');
    try {
      await connectAsync({ connector });
      setIsConnectModalOpen(false);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Failed to connect wallet');
    }
  };

  const handleSignInWithBase = async () => {
    setConnectError('');
    setIsSigningWithBase(true);
    try {
      const { nonce } = await getAuthNonce();
      const result = await signInWithBaseAccount({ nonce, chainId: 84532 });
      const normalizedAddress = result.address.toLowerCase();
      const authRole: 'owner' | 'investor' = env.OWNER_ALLOWLIST.includes(normalizedAddress)
        ? 'owner'
        : 'investor';
      const response = await loginWithWallet({
        address: normalizedAddress,
        signature: result.signature,
        message: result.message,
        role: authRole,
      });
      dispatch(
        setUser({
          address: response.user.address,
          role: response.user.role,
          token: response.token,
        })
      );
      dispatch(setWalletAddress(response.user.address));
      setIsConnectModalOpen(false);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : 'Sign in with Base failed');
    } finally {
      setIsSigningWithBase(false);
    }
  };

  useEffect(() => {
    if (isConnected && walletAddress) {
      dispatch(setWalletAddress(walletAddress));
    }
  }, [isConnected, walletAddress, dispatch]);

  return (
    <>
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-slate-950/80 backdrop-blur border-b border-slate-700/50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <Link to="/" className="inline-flex items-center gap-2 hover:opacity-80 transition">
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                Brickt
              </span>
              <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-amber-300">
                TESTNET
              </span>
            </Link>

            {/* Navigation Links (Desktop) */}
            <div className="hidden md:flex items-center space-x-8">
              <Link to="/properties" className="text-slate-300 hover:text-white transition font-medium">
                Properties
              </Link>
              <Link to="/dashboard" className="text-slate-300 hover:text-white transition font-medium">
                Dashboard
              </Link>
              {canViewOwnerConsole && (
                <Link to="/admin" className="text-slate-300 hover:text-white transition font-medium">
                  Admin
                </Link>
              )}
              {canViewOwnerConsole && (
                <Link to="/admin/activities" className="text-slate-300 hover:text-white transition font-medium">
                  Activity
                </Link>
              )}
              {canViewOwnerConsole && (
                <Link to="/admin/system" className="text-slate-300 hover:text-white transition font-medium">
                  System
                </Link>
              )}
            </div>

            {/* Wallet & Chain Info (Desktop) */}
            <div className="hidden md:flex items-center space-x-4">
              <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
                {getChainName(activeChainId)}
              </div>
              <div className="w-px h-5 bg-slate-700/50" />
              <button
                onClick={handleFaucetClick}
                className="px-4 py-2.5 text-slate-300 border border-slate-700/50 rounded-lg hover:border-slate-600 hover:bg-slate-800/50 transition"
              >
                Faucet
              </button>
              <button
                onClick={handleConnectClick}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-emerald-500/20 transition-all"
              >
                <Wallet className="w-4 h-4" />
                {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : 'Connect'}
              </button>
              {isConnected && (
                <button
                  onClick={handleDisconnectClick}
                  className="px-4 py-2.5 text-slate-300 border border-slate-700/50 rounded-lg hover:border-slate-600 hover:bg-slate-800/50 transition"
                >
                  Disconnect
                </button>
              )}
            </div>

            {/* Mobile Menu Button */}
            <div className="flex md:hidden items-center gap-2">
              <button
                onClick={handleFaucetClick}
                className="px-3 py-2 text-slate-300 border border-slate-700/50 rounded-lg text-sm hover:border-slate-600 hover:bg-slate-800/50 transition"
              >
                Faucet
              </button>
              <button
                onClick={handleConnectClick}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white font-semibold rounded-lg text-sm hover:shadow-lg hover:shadow-emerald-500/20 transition"
              >
                <Wallet className="w-4 h-4" />
                {displayAddress ? `${displayAddress.slice(0, 5)}...` : 'Connect'}
              </button>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-slate-300 hover:text-white transition"
              >
                {isMobileMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>

          {/* Mobile Menu */}
          {isMobileMenuOpen && (
            <div className="md:hidden border-t border-slate-700/50 bg-slate-900/50 backdrop-blur py-4 space-y-3 animate-in fade-in slide-in-from-top-2">
              <Link
                to="/properties"
                className="block px-4 py-2 text-slate-300 hover:text-white transition font-medium rounded hover:bg-slate-800/50"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Properties
              </Link>
              <Link
                to="/dashboard"
                className="block px-4 py-2 text-slate-300 hover:text-white transition font-medium rounded hover:bg-slate-800/50"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
              {canViewOwnerConsole && (
                <Link
                  to="/admin"
                  className="block px-4 py-2 text-slate-300 hover:text-white transition font-medium rounded hover:bg-slate-800/50"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Admin Console
                </Link>
              )}
              {canViewOwnerConsole && (
                <Link
                  to="/admin/activities"
                  className="block px-4 py-2 text-slate-300 hover:text-white transition font-medium rounded hover:bg-slate-800/50"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Activity
                </Link>
              )}
              {canViewOwnerConsole && (
                <Link
                  to="/admin/system"
                  className="block px-4 py-2 text-slate-300 hover:text-white transition font-medium rounded hover:bg-slate-800/50"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  System
                </Link>
              )}
              <div className="px-4 py-2 text-xs font-semibold tracking-widest text-slate-400 uppercase">
                {getChainName(activeChainId)}
              </div>
              <div className="px-4 pt-2">
                <button
                  onClick={handleFaucetClick}
                  className="w-full px-4 py-2 text-slate-300 border border-slate-700/50 rounded-lg hover:border-slate-600 hover:bg-slate-800/50 transition text-sm"
                >
                  Open Faucet
                </button>
              </div>
              {isConnected && (
                <div className="px-4 pt-2">
                  <button
                    onClick={handleDisconnectClick}
                    className="w-full px-4 py-2 text-slate-300 border border-slate-700/50 rounded-lg hover:border-slate-600 hover:bg-slate-800/50 transition text-sm"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* Faucet Modal */}
      {isFaucetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900/95 backdrop-blur border border-slate-700/50 p-8 shadow-2xl shadow-black/50 animate-in fade-in zoom-in-95">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Testnet Faucet</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">Request Base Sepolia funds</h3>
              </div>
              <button
                onClick={() => setIsFaucetModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mb-6 text-sm text-slate-300 leading-relaxed">
              Request a small ETH or USDC test balance for the connected wallet. Cooldowns apply after successful requests.
            </p>

            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Wallet</p>
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 px-4 py-3 text-sm text-white">
                  {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Connect a wallet first'}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Asset
                </label>
                <select
                  value={faucetToken}
                  onChange={(event) => setFaucetToken(event.target.value as 'eth' | 'usdc')}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
                  disabled={isRequestingFaucet}
                >
                  <option value="eth">ETH</option>
                  <option value="usdc">USDC</option>
                </select>
              </div>

              {faucetError ? (
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                  <p className="text-sm text-red-200">{faucetError}</p>
                </div>
              ) : null}

              {faucetResult ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                  <p className="text-sm text-emerald-200">
                    Faucet request submitted for {faucetResult.token.toUpperCase()}.
                  </p>
                  {faucetResult.transactionHash ? (
                    <div className="mt-3">
                      <TxHashLink txHash={faucetResult.transactionHash} compact />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleRequestFaucet()}
                disabled={!walletAddress || isRequestingFaucet}
                className="w-full rounded-lg bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRequestingFaucet ? 'Requesting...' : `Request ${faucetToken.toUpperCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connect Wallet Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900/95 backdrop-blur border border-slate-700/50 p-8 shadow-2xl shadow-black/50 animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-2xl font-semibold text-white">Connect Wallet</h3>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="mb-6 text-sm text-slate-300 leading-relaxed">
              Select a wallet provider to connect to your account.
            </p>

            {/* Base Account */}
            <div className="mb-6 rounded-xl bg-blue-500/10 border border-blue-500/30 px-4 py-4">
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Sign in with Base</p>
              <button
                onClick={() => void handleSignInWithBase()}
                disabled={isSigningWithBase || isLoading}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 transition"
              >
                <span className="inline-flex items-center gap-2">
                  <BaseGlyph className="h-4 w-4" />
                  {isSigningWithBase ? 'Signing in...' : 'Continue with Base Account'}
                </span>
              </button>
              <p className="mt-2 text-xs text-blue-200/90">
                Wallets in owner allowlist are authenticated as owner; others as investor.
              </p>
            </div>

            {/* Connectors */}
            <div className="space-y-3 mb-6">
              {visibleConnectors.length > 0 ? (
                visibleConnectors.map((connector) => (
                  <button
                    key={connector.id}
                    onClick={() => handleConnectorSelect(connector.id)}
                    disabled={!connector.ready || (isLoading && pendingConnector?.id === connector.id) || isSigningWithBase}
                    className="w-full rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800 px-4 py-4 text-left transition disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-700/70">
                          {getConnectorIcon(connector.id, connector.name)}
                        </span>
                        <div>
                          <div className="font-semibold text-white">{connector.name}</div>
                          <div className="text-xs text-slate-400">
                            {isConnectorInstalled(connector.id, connector.name, installedExtensions)
                              ? 'Detected in this browser'
                              : connector.ready
                                ? 'Available'
                                : 'Not detected'}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                          isConnectorInstalled(connector.id, connector.name, installedExtensions)
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-600/40 text-slate-300'
                        }`}
                      >
                        {isConnectorInstalled(connector.id, connector.name, installedExtensions) ? 'Installed' : 'Not installed'}
                      </span>
                    </div>
                    {isLoading && pendingConnector?.id === connector.id && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs text-slate-400">Connecting...</span>
                      </div>
                    )}
                  </button>
                ))
              ) : (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-4">
                  <p className="text-sm text-amber-200">
                    No supported wallet connector available. Please install a Web3 wallet extension.
                  </p>
                </div>
              )}
            </div>

            {/* Error Message */}
            {connectError && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                <p className="text-sm text-red-200">{connectError}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spacer for fixed navbar */}
      <div className="h-16" />

      <style>{`
        @keyframes slide-in-from-top-2 {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes zoom-in-95 {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .animate-in {
          animation: slide-in-from-top-2 0.2s ease-out;
        }

        .fade-in {
          animation: fade-in 0.2s ease-out;
        }

        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .zoom-in-95 {
          animation: zoom-in-95 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
