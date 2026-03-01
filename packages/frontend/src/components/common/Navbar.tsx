import { Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useEffect, useMemo, useState } from 'react';
import { RootState } from '../../store';
import { setWalletAddress } from '../../store/slices/userSlice';
import { env } from '../../config/env';

export default function Navbar() {
  const { activeChainId } = useSelector((state: RootState) => state.chain);
  const { role, isAuthenticated } = useSelector((state: RootState) => state.user);
  const dispatch = useDispatch();
  const { address: walletAddress, isConnected } = useAccount();
  const { connectAsync, connectors, isLoading, pendingConnector } = useConnect();
  const { disconnect } = useDisconnect();
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [connectError, setConnectError] = useState('');

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
  const visibleConnectors = useMemo(
    () => connectors.filter((connector) => connector.ready),
    [connectors]
  );

  const handleConnectClick = () => {
    setConnectError('');
    setIsConnectModalOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleDisconnectClick = () => {
    disconnect();
    dispatch(setWalletAddress(null));
    setConnectError('');
    setIsMobileMenuOpen(false);
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

  useEffect(() => {
    if (isConnected && walletAddress) {
      dispatch(setWalletAddress(walletAddress));
    }
  }, [isConnected, walletAddress, dispatch]);

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-lg">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="text-2xl font-bold text-primary-600">
            Homeshare
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex space-x-6">
            <Link to="/properties" className="text-gray-700 dark:text-gray-300 hover:text-primary-600">
              Properties
            </Link>
            <Link to="/dashboard" className="text-gray-700 dark:text-gray-300 hover:text-primary-600">
              Dashboard
            </Link>
            {canViewOwnerConsole && (
              <Link to="/owner" className="text-gray-700 dark:text-gray-300 hover:text-primary-600">
                Owner Console
              </Link>
            )}
          </div>

          {/* Wallet & Chain Info (Desktop) */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="text-sm">
              <span className="text-gray-600 dark:text-gray-400">Chain: </span>
              <span className="text-gray-900 dark:text-white font-medium">
                {getChainName(activeChainId)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
                onClick={handleConnectClick}
              >
                {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : 'Connect Wallet'}
              </button>
              {isConnected && (
                <button
                  className="border border-gray-300 dark:border-gray-600 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-200"
                  onClick={handleDisconnectClick}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>

          {/* Mobile controls */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              className="bg-primary-600 text-white px-3 py-2 rounded-lg text-sm"
              onClick={handleConnectClick}
            >
              {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : 'Connect'}
            </button>
            <button
              className="border border-gray-300 dark:border-gray-600 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-200 text-sm"
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            >
              {isMobileMenuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700 py-3 space-y-3">
            <Link
              to="/properties"
              className="block text-gray-700 dark:text-gray-300 hover:text-primary-600"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Properties
            </Link>
            <Link
              to="/dashboard"
              className="block text-gray-700 dark:text-gray-300 hover:text-primary-600"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Dashboard
            </Link>
            {canViewOwnerConsole && (
              <Link
                to="/owner"
                className="block text-gray-700 dark:text-gray-300 hover:text-primary-600"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Owner Console
              </Link>
            )}
            <div className="pt-2 text-sm">
              <span className="text-gray-600 dark:text-gray-400">Chain: </span>
              <span className="text-gray-900 dark:text-white font-medium">
                {getChainName(activeChainId)}
              </span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm"
                onClick={handleConnectClick}
              >
                {displayAddress ? `${displayAddress.slice(0, 6)}...${displayAddress.slice(-4)}` : 'Connect Wallet'}
              </button>
              {isConnected && (
                <button
                  className="border border-gray-300 dark:border-gray-600 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-200 text-sm"
                  onClick={handleDisconnectClick}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}
        </div>

      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Connect Wallet</h3>
              <button
                className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setIsConnectModalOpen(false)}
              >
                Close
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
              Choose a wallet provider to connect.
            </p>

            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-900/30">
              <div className="font-medium text-blue-900 dark:text-blue-100">Base Account</div>
              <div className="mt-1 text-blue-700 dark:text-blue-200">
                For Sign in with Base, open the{' '}
                <Link
                  to="/owner"
                  className="underline"
                  onClick={() => setIsConnectModalOpen(false)}
                >
                  Owner Console
                </Link>
                .
              </div>
            </div>

            <div className="space-y-2">
              {visibleConnectors.map((connector) => (
                <button
                  key={connector.id}
                  className="w-full rounded-lg border border-gray-200 px-4 py-3 text-left hover:border-primary-500 dark:border-gray-700"
                  onClick={() => handleConnectorSelect(connector.id)}
                  disabled={isLoading}
                >
                  <div className="font-medium text-gray-900 dark:text-white">{connector.name}</div>
                  {isLoading && pendingConnector?.id === connector.id && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">Connecting...</div>
                  )}
                </button>
              ))}
              {visibleConnectors.length === 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                  No supported wallet connector is available in this browser.
                </div>
              )}
            </div>

            {connectError && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
                {connectError}
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
