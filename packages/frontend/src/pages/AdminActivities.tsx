import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useAccount } from 'wagmi';
import { RootState } from '../store';
import { clearUser, setUser } from '../store/slices/userSlice';
import { env } from '../config/env';
import {
  fetchAdminOnchainActivities,
  getAuthNonce,
  loginWithWallet,
  type OnchainActivityResponse,
} from '../lib/api';
import TxHashLink from '../components/common/TxHashLink';

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

const buildManualMessage = (address: string, nonce: string, chainId: number): string =>
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

const activityToneClass = (status: OnchainActivityResponse['status']) => {
  if (status === 'indexed') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  if (status === 'confirmed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (status === 'submitted') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-red-500/30 bg-red-500/10 text-red-200';
};

const formatActivityLabel = (activityType: string): string =>
  activityType
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export default function AdminActivities() {
  const dispatch = useDispatch();
  const { token, isAuthenticated, address, role } = useSelector((state: RootState) => state.user);
  const { address: connectedWalletAddress, isConnected } = useAccount();
  const [activities, setActivities] = useState<OnchainActivityResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OnchainActivityResponse['status']>('all');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const lastAutoAuthAddressRef = useRef<string | null>(null);

  const isAllowlistedConnectedWallet =
    isConnected &&
    !!connectedWalletAddress &&
    env.OWNER_ALLOWLIST.includes(connectedWalletAddress.toLowerCase());
  const hasMatchingConnectedWallet =
    !!connectedWalletAddress &&
    !!address &&
    connectedWalletAddress.toLowerCase() === address.toLowerCase();
  const canViewActivityPage =
    ((isAuthenticated && role === 'owner' && !!token && hasMatchingConnectedWallet) ||
      isAllowlistedConnectedWallet) &&
    !!connectedWalletAddress;

  const loadActivities = async (authToken: string) => {
    const next = await fetchAdminOnchainActivities(authToken);
    setActivities(next);
  };

  const authenticateOwner = async () => {
    setErrorMessage('');
    setStatusMessage('Authenticating owner session...');
    setIsAuthenticating(true);
    try {
      const normalizedConnectedAddress = connectedWalletAddress?.toLowerCase();
      if (!normalizedConnectedAddress) {
        throw new Error('Connect an allowlisted wallet first.');
      }
      const injected = getInjectedProvider();
      if (!injected) {
        throw new Error('Wallet provider not found for owner authentication.');
      }
      const { nonce } = await getAuthNonce();
      const message = buildManualMessage(normalizedConnectedAddress, nonce, 84532);
      const signature = (await injected.request({
        method: 'personal_sign',
        params: [toHexUtf8(message), normalizedConnectedAddress],
      })) as string;
      const response = await loginWithWallet({
        address: normalizedConnectedAddress,
        signature,
        message,
        role: 'owner',
      });
      dispatch(
        setUser({
          address: response.user.address,
          role: response.user.role,
          token: response.token,
        })
      );
      setStatusMessage('Owner session authenticated.');
      await loadActivities(response.token);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Owner authentication failed');
      setStatusMessage('');
    } finally {
      setIsAuthenticating(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!canViewActivityPage || !token || role !== 'owner') {
        if (!cancelled) {
          setActivities([]);
          setLoading(false);
        }
        return;
      }
      try {
        await loadActivities(token);
        if (!cancelled) {
          setErrorMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load activity history');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [canViewActivityPage, role, token]);

  useEffect(() => {
    const normalizedConnectedAddress = connectedWalletAddress?.toLowerCase() || '';
    if (!isConnected || !normalizedConnectedAddress) {
      lastAutoAuthAddressRef.current = null;
      return;
    }
    if ((isAuthenticated && role === 'owner' && !!token) || isAuthenticating) {
      return;
    }
    if (!env.OWNER_ALLOWLIST.includes(normalizedConnectedAddress)) {
      return;
    }
    if (lastAutoAuthAddressRef.current === normalizedConnectedAddress) {
      return;
    }
    lastAutoAuthAddressRef.current = normalizedConnectedAddress;
    void authenticateOwner().catch(() => {
      lastAutoAuthAddressRef.current = null;
    });
  }, [connectedWalletAddress, isAuthenticated, isAuthenticating, isConnected, role, token]);

  useEffect(() => {
    if (!token || role !== 'owner' || !canViewActivityPage) {
      return;
    }
    const timer = setInterval(() => {
      void loadActivities(token).catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [canViewActivityPage, role, token]);

  const filteredActivities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activities.filter((activity) => {
      if (statusFilter !== 'all' && activity.status !== statusFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [
        activity.activityType,
        activity.propertyId,
        activity.campaignAddress,
        activity.actorAddress,
        activity.txHash,
        activity.intentType,
        activity.lastError,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [activities, query, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: activities.length,
      indexed: activities.filter((activity) => activity.status === 'indexed').length,
      pending: activities.filter((activity) => activity.status === 'submitted').length,
      failed: activities.filter((activity) => activity.status === 'failed').length,
    };
  }, [activities]);

  const logout = () => {
    dispatch(clearUser());
    setActivities([]);
    setStatusMessage('Logged out.');
    setErrorMessage('');
  };

  if (loading) {
    return (
      <div className="overflow-hidden min-h-screen">
        <div className="container mx-auto px-4 py-20 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading admin activity...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden min-h-screen">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Owner Monitoring</p>
            <h1 className="mt-2 text-4xl md:text-5xl font-light tracking-tight text-white">
              Admin Activity
            </h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              Full onchain activity history recorded by owner actions, workers, and indexer sync.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
            >
              Back to Console
            </Link>
            {isAuthenticated && role === 'owner' ? (
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
              >
                Log out
              </button>
            ) : null}
          </div>
        </div>

        {!canViewActivityPage && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-100">
            <p className="font-medium">Owner access required</p>
            <p className="mt-2 text-sm text-amber-100/80">
              Connect an allowlisted owner wallet and authenticate to view the full activity history.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void authenticateOwner()}
                disabled={!isConnected || isAuthenticating || !isAllowlistedConnectedWallet}
                className="inline-flex items-center rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAuthenticating ? 'Authenticating...' : 'Authenticate Owner'}
              </button>
            </div>
          </div>
        )}

        {statusMessage ? (
          <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
            {statusMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}

        <div className="mb-8 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Total</p>
            <p className="mt-2 text-2xl font-semibold text-white">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Indexed</p>
            <p className="mt-2 text-2xl font-semibold text-cyan-300">{stats.indexed}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Submitted</p>
            <p className="mt-2 text-2xl font-semibold text-amber-300">{stats.pending}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Failed</p>
            <p className="mt-2 text-2xl font-semibold text-red-300">{stats.failed}</p>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 md:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by tx hash, property id, campaign, actor..."
            className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as 'all' | OnchainActivityResponse['status'])
            }
            className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="confirmed">Confirmed</option>
            <option value="indexed">Indexed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Recorded Activity</p>
              <h2 className="mt-1 text-lg font-semibold text-white">All admin activity rows</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                if (token) {
                  void loadActivities(token).catch((error) =>
                    setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh activity history')
                  );
                }
              }}
              disabled={!token}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          {filteredActivities.length === 0 ? (
            <div className="px-6 py-10 text-sm text-slate-400">No activity records found.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredActivities.map((activity) => (
                <div key={`${activity.txHash}:${activity.logIndex ?? 'na'}`} className="px-6 py-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${activityToneClass(
                            activity.status
                          )}`}
                        >
                          {activity.status}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                          {formatActivityLabel(activity.activityType)}
                        </span>
                        {activity.intentType ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                            {activity.intentType}
                          </span>
                        ) : null}
                      </div>

                      <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-2 xl:grid-cols-4">
                        <p>
                          <span className="text-slate-500">Property:</span> {activity.propertyId || '--'}
                        </p>
                        <p>
                          <span className="text-slate-500">Actor:</span> {activity.actorRole || '--'}
                        </p>
                        <p>
                          <span className="text-slate-500">Address:</span>{' '}
                          <span className="font-mono text-xs break-all">{activity.actorAddress || '--'}</span>
                        </p>
                        <p>
                          <span className="text-slate-500">Created:</span>{' '}
                          {new Date(activity.createdAt).toLocaleString()}
                        </p>
                      </div>

                      {activity.campaignAddress ? (
                        <p className="text-sm text-slate-300">
                          <span className="text-slate-500">Campaign:</span>{' '}
                          <span className="font-mono text-xs break-all">{activity.campaignAddress}</span>
                        </p>
                      ) : null}

                      {activity.lastError ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                          {activity.lastError}
                        </div>
                      ) : null}

                      {activity.metadata && Object.keys(activity.metadata).length > 0 ? (
                        <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                          <summary className="cursor-pointer text-sm font-medium text-slate-200">
                            Metadata
                          </summary>
                          <pre className="mt-3 overflow-x-auto text-xs text-slate-400">
                            {JSON.stringify(activity.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>

                    <div className="shrink-0">
                      <TxHashLink txHash={activity.txHash} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
