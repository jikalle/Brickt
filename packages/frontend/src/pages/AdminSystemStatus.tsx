import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useAccount } from 'wagmi';
import { RootState } from '../store';
import { clearUser, setUser } from '../store/slices/userSlice';
import { env } from '../config/env';
import {
  fetchAdminLastProcessingRun,
  fetchAdminMetrics,
  getAuthNonce,
  loginWithWallet,
  type AdminLastProcessingRunResponse,
  type AdminMetricsResponse,
} from '../lib/api';

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

const statusTone = (healthy: boolean) =>
  healthy
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    : 'border-red-500/30 bg-red-500/10 text-red-200';

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : '--';

const formatDuration = (durationMs: number | null | undefined) =>
  typeof durationMs === 'number' ? `${(durationMs / 1000).toFixed(1)}s` : '--';

const MetricCard = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</p>
    <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
    {hint ? <p className="mt-2 text-sm text-slate-400">{hint}</p> : null}
  </div>
);

type IntentMetricsItem = {
  pending: number;
  submitted: number;
  confirmed: number;
  failed: number;
};

export default function AdminSystemStatus() {
  const dispatch = useDispatch();
  const { token, isAuthenticated, address, role } = useSelector((state: RootState) => state.user);
  const { address: connectedWalletAddress, isConnected } = useAccount();
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [lastRun, setLastRun] = useState<AdminLastProcessingRunResponse['run'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
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
  const canViewSystemPage =
    ((isAuthenticated && role === 'owner' && !!token && hasMatchingConnectedWallet) ||
      isAllowlistedConnectedWallet) &&
    !!connectedWalletAddress;

  const loadStatus = async (authToken: string) => {
    const [nextMetrics, nextRun] = await Promise.all([
      fetchAdminMetrics(authToken),
      fetchAdminLastProcessingRun(authToken),
    ]);
    setMetrics(nextMetrics);
    setLastRun(nextRun.run);
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
      await loadStatus(response.token);
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
      if (!canViewSystemPage || !token || role !== 'owner') {
        if (!cancelled) {
          setMetrics(null);
          setLastRun(null);
          setLoading(false);
        }
        return;
      }
      try {
        await loadStatus(token);
        if (!cancelled) {
          setErrorMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load system status');
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
  }, [canViewSystemPage, role, token]);

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
    if (!token || role !== 'owner' || !canViewSystemPage) {
      return;
    }
    const timer = setInterval(() => {
      void loadStatus(token).catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, [canViewSystemPage, role, token]);

  const logout = () => {
    dispatch(clearUser());
    setMetrics(null);
    setLastRun(null);
    setStatusMessage('Logged out.');
    setErrorMessage('');
  };

  const derived = useMemo(() => {
    const checks = metrics?.health?.checks;
    return {
      rpcHealthy: checks?.rpcConfigured ?? false,
      indexerHealthy: checks?.indexerHealthy ?? false,
      workersHealthy: checks?.workersHealthy ?? false,
      faucetHealthy: checks?.faucetHealthy ?? false,
      staleSubmittedIntents: metrics?.health?.staleSubmittedIntents ?? 0,
    };
  }, [metrics]);
  const healthItems: Array<{ label: string; healthy: boolean }> = [
    { label: 'RPC Configured', healthy: derived.rpcHealthy },
    { label: 'Indexer Healthy', healthy: derived.indexerHealthy },
    { label: 'Workers Healthy', healthy: derived.workersHealthy },
    { label: 'Faucet Healthy', healthy: derived.faucetHealthy },
  ];
  const intentGroups: Array<{ label: string; item: IntentMetricsItem | undefined }> = [
    { label: 'Property', item: metrics?.intents?.property },
    { label: 'Profit', item: metrics?.intents?.profit },
    { label: 'Platform Fee', item: metrics?.intents?.platformFee },
  ];

  if (loading) {
    return (
      <div className="min-h-screen overflow-hidden">
        <div className="container mx-auto px-4 py-20 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading system status...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden">
      <div className="container mx-auto px-4 py-12 md:py-16">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Owner Monitoring</p>
            <h1 className="mt-2 text-4xl md:text-5xl font-light tracking-tight text-white">
              System Status
            </h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              Worker, indexer, faucet, and processing health in one place.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
            >
              Back to Console
            </Link>
            <button
              type="button"
              onClick={() => {
                if (token) {
                  void loadStatus(token);
                }
              }}
              className="inline-flex items-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20"
            >
              Refresh
            </button>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
              >
                Logout
              </button>
            ) : null}
          </div>
        </div>

        {statusMessage ? (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {statusMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : null}

        {!canViewSystemPage ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-slate-300">
            Connect an allowlisted owner wallet to view system status.
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="RPC"
                value={derived.rpcHealthy ? 'Configured' : 'Missing'}
                hint="Base RPC configuration"
              />
              <MetricCard
                label="Indexer"
                value={derived.indexerHealthy ? 'Healthy' : 'Needs Attention'}
                hint={metrics?.indexer.byChain.length ? `Chains tracked: ${metrics.indexer.byChain.length}` : 'No indexed chains reported'}
              />
              <MetricCard
                label="Workers"
                value={derived.workersHealthy ? 'Healthy' : 'Stale'}
                hint={`${derived.staleSubmittedIntents} stale submitted intents`}
              />
              <MetricCard
                label="Faucet"
                value={derived.faucetHealthy ? 'Ready' : 'Unhealthy'}
                hint={metrics?.faucet?.enabled ? 'Testnet faucet enabled' : 'Faucet disabled'}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
                <h2 className="text-xl font-semibold text-white">Health Checks</h2>
                <div className="mt-5 grid gap-3">
                  {healthItems.map(({ label, healthy }) => (
                    <div
                      key={label}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${statusTone(Boolean(healthy))}`}
                    >
                      <span>{label}</span>
                      <span className="font-semibold">{healthy ? 'OK' : 'Issue'}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
                <h2 className="text-xl font-semibold text-white">Last Processing Run</h2>
                <div className="mt-5 space-y-3 text-sm text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>Status</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${lastRun?.status === 'ok' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/15 text-red-200'}`}>
                      {lastRun?.status ?? 'No runs yet'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Mode</span>
                    <span>{lastRun?.processingMode ?? '--'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Started</span>
                    <span>{formatDateTime(lastRun?.startedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Duration</span>
                    <span>{formatDuration(lastRun?.durationMs)}</span>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-400">Steps</p>
                    <div className="space-y-2">
                      {lastRun?.steps?.length ? (
                        lastRun.steps.map((step) => (
                          <div key={step.key} className="flex items-center justify-between text-sm">
                            <span className="text-slate-300">{step.label}</span>
                            <span className={step.status === 'ok' ? 'text-emerald-300' : 'text-red-300'}>
                              {step.status}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-500">No processing data available.</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 xl:col-span-2">
                <h2 className="text-xl font-semibold text-white">Intent Backlog</h2>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {intentGroups.map(({ label, item }) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <div className="mt-4 space-y-2 text-sm text-slate-300">
                        <div className="flex justify-between"><span>Pending</span><span>{item?.pending ?? 0}</span></div>
                        <div className="flex justify-between"><span>Submitted</span><span>{item?.submitted ?? 0}</span></div>
                        <div className="flex justify-between"><span>Confirmed</span><span>{item?.confirmed ?? 0}</span></div>
                        <div className="flex justify-between"><span>Failed</span><span>{item?.failed ?? 0}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
                <h2 className="text-xl font-semibold text-white">Faucet</h2>
                <div className="mt-5 space-y-3 text-sm text-slate-300">
                  <div className="flex justify-between"><span>Enabled</span><span>{metrics?.faucet?.enabled ? 'Yes' : 'No'}</span></div>
                  <div className="flex justify-between"><span>CDP Configured</span><span>{metrics?.faucet?.cdpConfigured ? 'Yes' : 'No'}</span></div>
                  <div className="flex justify-between"><span>Requests (24h)</span><span>{metrics?.faucet?.requests24h ?? 0}</span></div>
                  <div className="flex justify-between"><span>Successful (24h)</span><span>{metrics?.faucet?.successful24h ?? 0}</span></div>
                  <div className="flex justify-between"><span>Failed (24h)</span><span>{metrics?.faucet?.failed24h ?? 0}</span></div>
                  <div className="flex justify-between"><span>Pending</span><span>{metrics?.faucet?.pendingCount ?? 0}</span></div>
                  <div className="flex justify-between"><span>Wallet Cooldown</span><span>{metrics?.faucet?.walletCooldownMinutes ?? 0} min</span></div>
                  <div className="flex justify-between"><span>IP Cooldown</span><span>{metrics?.faucet?.ipCooldownMinutes ?? 0} min</span></div>
                  <div className="flex justify-between"><span>Last Request</span><span>{formatDateTime(metrics?.faucet?.lastRequestedAt)}</span></div>
                </div>
              </section>
            </div>

            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
              <h2 className="text-xl font-semibold text-white">Settlement Anomalies</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Fee Stale"
                  value={String(metrics?.settlements?.anomalies.feeTransferStaleSubmitted ?? 0)}
                />
                <MetricCard
                  label="Profit Stale"
                  value={String(metrics?.settlements?.anomalies.profitDepositStaleSubmitted ?? 0)}
                />
                <MetricCard
                  label="Orphaned Fees"
                  value={String(metrics?.settlements?.anomalies.orphanedFeeTransfers ?? 0)}
                />
                <MetricCard
                  label="Failures 24h"
                  value={String(metrics?.settlements?.anomalies.settlementFailures24h ?? 0)}
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
