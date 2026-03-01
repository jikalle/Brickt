import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useAccount } from 'wagmi';
import { SignInWithBaseButton } from '@base-org/account-ui/react';
import { RootState } from '../store';
import { setUser, clearUser } from '../store/slices/userSlice';
import {
  createPlatformFeeIntent,
  createProfitDistributionIntent,
  createPropertyIntent,
  fetchCampaigns,
  fetchPlatformFeeIntents,
  fetchProfitDistributionIntents,
  fetchPropertyIntents,
  getAuthNonce,
  loginWithWallet,
} from '../lib/api';
import { signInWithBaseAccount } from '../lib/baseAccount';
import { env } from '../config/env';
import type {
  CampaignResponse,
  PlatformFeeIntentResponse,
  ProfitDistributionIntentResponse,
  PropertyIntentResponse,
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
    'Homeshare wants you to sign in with your wallet.',
    `Address: ${address}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');

export default function OwnerConsole() {
  const dispatch = useDispatch();
  const { address, role, token, isAuthenticated } = useSelector((state: RootState) => state.user);
  const { address: connectedWalletAddress, isConnected } = useAccount();
  const [isSigning, setIsSigning] = useState(false);
  const [loginForm, setLoginForm] = useState({
    address: '',
    signature: '',
    message: '',
    role: 'owner' as 'owner' | 'investor',
  });
  const [propertyForm, setPropertyForm] = useState({
    propertyId: '',
    name: '',
    description: '',
    location: '',
    targetUsdc: '',
    chainId: '84532',
  });
  const [platformFeeForm, setPlatformFeeForm] = useState({
    campaignAddress: '',
    platformFeeBps: '',
    platformFeeRecipient: '',
  });
  const [profitForm, setProfitForm] = useState({
    propertyId: '',
    profitDistributorAddress: '',
    usdcAmount: '',
  });
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignResponse[]>([]);
  const [propertyIntents, setPropertyIntents] = useState<PropertyIntentResponse[]>([]);
  const [profitIntents, setProfitIntents] = useState<ProfitDistributionIntentResponse[]>([]);
  const [platformFeeIntents, setPlatformFeeIntents] = useState<PlatformFeeIntentResponse[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [intentsLoading, setIntentsLoading] = useState(false);
  const [isAutoAuthenticating, setIsAutoAuthenticating] = useState(false);
  const lastAutoAuthAddressRef = useRef<string | null>(null);

  const isOwnerSession = isAuthenticated && role === 'owner' && !!token;
  const isAllowlistedConnectedWallet =
    isConnected &&
    !!connectedWalletAddress &&
    env.OWNER_ALLOWLIST.includes(connectedWalletAddress.toLowerCase());
  const hasMatchingConnectedWallet =
    !!connectedWalletAddress &&
    !!address &&
    connectedWalletAddress.toLowerCase() === address.toLowerCase();
  const canManageOwnerFlows = isOwnerSession && isConnected && hasMatchingConnectedWallet;
  const canViewOwnerConsole = canManageOwnerFlows || isAllowlistedConnectedWallet;

  const intentStatusClass = (status: string) => {
    if (status === 'confirmed') return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200';
    if (status === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';
    if (status === 'submitted') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200';
    return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
  };

  const handleLoginChange = (field: keyof typeof loginForm, value: string) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePropertyChange = (field: keyof typeof propertyForm, value: string) => {
    setPropertyForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePlatformFeeChange = (
    field: keyof typeof platformFeeForm,
    value: string
  ) => {
    setPlatformFeeForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleProfitChange = (field: keyof typeof profitForm, value: string) => {
    setProfitForm((prev) => ({ ...prev, [field]: value }));
  };

  const getInjectedProvider = (): EthereumProvider | null => {
    const injected = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    return injected && typeof injected.request === 'function' ? injected : null;
  };

  const handleLogin = async () => {
    setErrorMessage('');
    setStatusMessage('Authenticating...');
    try {
      let payload = {
        address: loginForm.address.trim(),
        signature: loginForm.signature.trim(),
        message: loginForm.message.trim(),
        role: loginForm.role,
      };

      if (!payload.address || !payload.signature || !payload.message) {
        const injected = getInjectedProvider();
        if (!injected) {
          throw new Error('Wallet provider not found for manual signing');
        }

        const { nonce } = await getAuthNonce();
        const [walletAddress] = (await injected.request({
          method: 'eth_requestAccounts',
        })) as string[];

        const address = (payload.address || walletAddress || '').trim();
        if (!address) {
          throw new Error('Wallet address is required');
        }

        const message = buildManualMessage(address, nonce, 84532);
        const signature = (await injected.request({
          method: 'personal_sign',
          params: [toHexUtf8(message), address],
        })) as string;

        payload = {
          address,
          signature,
          message,
          role: payload.role,
        };

        setLoginForm((prev) => ({
          ...prev,
          address: payload.address,
          signature: payload.signature,
          message: payload.message,
        }));
      }

      const response = await loginWithWallet(payload);
      dispatch(
        setUser({
          address: response.user.address,
          role: response.user.role,
          token: response.token,
        })
      );
      // Nonces are one-time-use; clear signed payload so next auth attempt
      // always re-signs with a fresh nonce instead of reusing stale data.
      setLoginForm((prev) => ({
        ...prev,
        address: response.user.address,
        signature: '',
        message: '',
      }));
      setStatusMessage(`Authenticated as ${response.user.role}.`);
    } catch (error) {
      if ((error as Error).message.includes('nonce')) {
        setLoginForm((prev) => ({ ...prev, signature: '', message: '' }));
      }
      console.error(
        `[auth.manual] login_failed role=${loginForm.role} address=${
          loginForm.address ? `${loginForm.address.slice(0, 6)}...${loginForm.address.slice(-4)}` : ''
        } error=${error instanceof Error ? error.message : String(error)}`
      );
      setErrorMessage((error as Error).message);
      setStatusMessage('');
    }
  };

  const handleLogout = () => {
    dispatch(clearUser());
    setStatusMessage('Logged out.');
    setErrorMessage('');
  };

  const handleSignInWithBase = async () => {
    setErrorMessage('');
    setStatusMessage('Opening Sign in with Base...');
    setIsSigning(true);
    try {
      const { nonce } = await getAuthNonce();
      const result = await signInWithBaseAccount({ nonce, chainId: 84532 });

      const nextForm = {
        address: result.address,
        message: result.message,
        signature: result.signature,
        role: loginForm.role,
      };

      setLoginForm(nextForm);
      const response = await loginWithWallet(nextForm);
      dispatch(
        setUser({
          address: response.user.address,
          role: response.user.role,
          token: response.token,
        })
      );
      setLoginForm((prev) => ({
        ...prev,
        address: response.user.address,
        signature: '',
        message: '',
      }));
      setStatusMessage(`Authenticated as ${response.user.role}.`);
    } catch (error) {
      if ((error as Error).message.includes('nonce')) {
        setLoginForm((prev) => ({ ...prev, signature: '', message: '' }));
      }
      console.error(
        `[auth.base] login_failed role=${loginForm.role} address=${
          loginForm.address ? `${loginForm.address.slice(0, 6)}...${loginForm.address.slice(-4)}` : ''
        } error=${error instanceof Error ? error.message : String(error)}`
      );
      setErrorMessage((error as Error).message);
      setStatusMessage('');
    } finally {
      setIsSigning(false);
    }
  };

  const handleCreateProperty = async () => {
    setErrorMessage('');
    setStatusMessage('Creating property...');
    try {
      if (!token) {
        throw new Error('You must be logged in as an owner to create properties.');
      }

      const payload = {
        propertyId:
          propertyForm.propertyId.trim() ||
          propertyForm.name
            .toLowerCase()
            .replace(/[^a-z0-9- ]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 48),
        name: propertyForm.name,
        description: propertyForm.description,
        location: propertyForm.location,
        targetUsdcBaseUnits: Math.round(Number(propertyForm.targetUsdc || '0') * 1_000_000).toString(),
        chainId: Number(propertyForm.chainId),
      };

      if (!payload.propertyId) {
        throw new Error('Property name is required');
      }

      if (!Number.isFinite(Number(propertyForm.targetUsdc)) || Number(propertyForm.targetUsdc) <= 0) {
        throw new Error('Target USDC must be greater than 0');
      }

      await createPropertyIntent(payload, token);
      setStatusMessage('Property intent created successfully.');
      void loadCampaigns();
      void loadIntents(token);
      setPropertyForm({
        propertyId: '',
        name: '',
        description: '',
        location: '',
        targetUsdc: '',
        chainId: '84532',
      });
    } catch (error) {
      setErrorMessage((error as Error).message);
      setStatusMessage('');
    }
  };

  const handleCreatePlatformFeeIntent = async () => {
    setErrorMessage('');
    setStatusMessage('Submitting platform fee intent...');
    try {
      if (!token) {
        throw new Error('You must be logged in as an owner to update platform fees.');
      }

      const platformFeeBps = Number(platformFeeForm.platformFeeBps);
      if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 2000) {
        throw new Error('Platform fee must be an integer between 0 and 2000 bps.');
      }

      if (!platformFeeForm.campaignAddress.trim()) {
        throw new Error('Campaign address is required.');
      }

      if (platformFeeBps > 0 && !platformFeeForm.platformFeeRecipient.trim()) {
        throw new Error('Fee recipient is required when fee is greater than 0.');
      }

      await createPlatformFeeIntent(
        {
          chainId: 84532,
          campaignAddress: platformFeeForm.campaignAddress.trim(),
          platformFeeBps,
          platformFeeRecipient:
            platformFeeBps === 0 ? null : platformFeeForm.platformFeeRecipient.trim(),
        },
        token
      );

      setStatusMessage('Platform fee intent submitted.');
      setPlatformFeeForm({
        campaignAddress: '',
        platformFeeBps: '',
        platformFeeRecipient: '',
      });
      void loadCampaigns();
      void loadIntents(token);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setStatusMessage('');
    }
  };

  const handleCreateProfitIntent = async () => {
    setErrorMessage('');
    setStatusMessage('Submitting profit distribution intent...');
    try {
      if (!token) {
        throw new Error('You must be logged in as an owner to create profit intents.');
      }

      if (!profitForm.propertyId.trim()) {
        throw new Error('Property ID is required.');
      }
      if (!profitForm.profitDistributorAddress.trim()) {
        throw new Error('Profit distributor address is required.');
      }
      const usdcAmount = Number(profitForm.usdcAmount);
      if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
        throw new Error('USDC amount must be greater than 0.');
      }

      await createProfitDistributionIntent(
        {
          chainId: 84532,
          propertyId: profitForm.propertyId.trim(),
          profitDistributorAddress: profitForm.profitDistributorAddress.trim(),
          usdcAmountBaseUnits: Math.round(usdcAmount * 1_000_000).toString(),
        },
        token
      );

      setStatusMessage('Profit distribution intent submitted.');
      setProfitForm({
        propertyId: '',
        profitDistributorAddress: '',
        usdcAmount: '',
      });
      void loadIntents(token);
    } catch (error) {
      setErrorMessage((error as Error).message);
      setStatusMessage('');
    }
  };

  const loadCampaigns = async () => {
    setCampaignsLoading(true);
    try {
      const data = await fetchCampaigns();
      setCampaigns(data);
    } catch (_error) {
      // Keep owner console usable even if campaign list fails.
    } finally {
      setCampaignsLoading(false);
    }
  };

  const loadIntents = async (authToken: string | null) => {
    setIntentsLoading(true);
    if (!authToken) {
      setPropertyIntents([]);
      setProfitIntents([]);
      setPlatformFeeIntents([]);
      setIntentsLoading(false);
      return;
    }

    try {
      const [propertyData, profitData, platformFeeData] = await Promise.all([
        fetchPropertyIntents(authToken),
        fetchProfitDistributionIntents(authToken),
        fetchPlatformFeeIntents(authToken),
      ]);
      setPropertyIntents(propertyData);
      setProfitIntents(profitData);
      setPlatformFeeIntents(platformFeeData);
    } catch (_error) {
      // Keep console usable if one of the intent feeds fails.
    } finally {
      setIntentsLoading(false);
    }
  };

  useEffect(() => {
    if (canViewOwnerConsole) {
      void loadCampaigns();
      return;
    }
    setCampaigns([]);
    setCampaignsLoading(false);
  }, [canViewOwnerConsole]);

  useEffect(() => {
    if (canManageOwnerFlows) {
      void loadIntents(token);
      return;
    }
    setPropertyIntents([]);
    setProfitIntents([]);
    setPlatformFeeIntents([]);
    setIntentsLoading(false);
  }, [canManageOwnerFlows, token]);

  useEffect(() => {
    const normalizedConnectedAddress = connectedWalletAddress?.toLowerCase() || '';

    if (!isConnected || !isAllowlistedConnectedWallet || !normalizedConnectedAddress) {
      lastAutoAuthAddressRef.current = null;
      return;
    }

    if (canManageOwnerFlows || isAutoAuthenticating) {
      return;
    }

    if (lastAutoAuthAddressRef.current === normalizedConnectedAddress) {
      return;
    }

    lastAutoAuthAddressRef.current = normalizedConnectedAddress;
    setIsAutoAuthenticating(true);
    setErrorMessage('');
    setStatusMessage('Allowlisted wallet detected. Authenticating owner session...');

    void (async () => {
      try {
        const injected = getInjectedProvider();
        if (!injected) {
          throw new Error('Wallet provider not found for automatic owner authentication');
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
        setLoginForm((prev) => ({
          ...prev,
          address: response.user.address,
          signature: '',
          message: '',
          role: 'owner',
        }));
        setStatusMessage(`Authenticated as ${response.user.role}.`);
      } catch (error) {
        lastAutoAuthAddressRef.current = null;
        console.error(
          `[auth.auto] owner_auto_login_failed address=${normalizedConnectedAddress.slice(0, 6)}...${normalizedConnectedAddress.slice(-4)} error=${
            error instanceof Error ? error.message : String(error)
          }`
        );
        setErrorMessage(error instanceof Error ? error.message : 'Automatic owner authentication failed');
        setStatusMessage('');
      } finally {
        setIsAutoAuthenticating(false);
      }
    })();
  }, [
    canManageOwnerFlows,
    connectedWalletAddress,
    dispatch,
    isAllowlistedConnectedWallet,
    isAutoAuthenticating,
    isConnected,
  ]);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
        Owner Console
      </h1>

      {!canViewOwnerConsole && (
        <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Owner operations are hidden. Connect an allowlisted owner wallet to unlock this console.
        </div>
      )}

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
        Owner actions can materially affect investor outcomes. Review{' '}
        <Link to="/disclosures" className="underline font-medium">
          Risk Disclosures
        </Link>{' '}
        and ensure legal/compliance approvals are in place before production operations.
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Wallet Login</h2>
          <div className="space-y-4">
            <input
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Wallet address"
              value={loginForm.address}
              onChange={(event) => handleLoginChange('address', event.target.value)}
            />
            <input
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Signature"
              value={loginForm.signature}
              onChange={(event) => handleLoginChange('signature', event.target.value)}
            />
            <input
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Message to sign"
              value={loginForm.message}
              onChange={(event) => handleLoginChange('message', event.target.value)}
            />
            <select
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              value={loginForm.role}
              onChange={(event) => handleLoginChange('role', event.target.value)}
            >
              <option value="owner">Owner</option>
              <option value="investor">Investor</option>
            </select>
            <div className="flex flex-wrap gap-3">
              <SignInWithBaseButton
                onClick={handleSignInWithBase}
                colorScheme="light"
                variant="solid"
                align="left"
              />
              <button
                className="border border-primary-600 text-primary-700 dark:text-primary-300 px-6 py-2 rounded-lg"
                onClick={handleSignInWithBase}
                disabled={isSigning}
              >
                {isSigning ? 'Signing...' : 'Sign In'}
              </button>
              <button
                className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700"
                onClick={handleLogin}
              >
                Authenticate (Manual)
              </button>
              {isAuthenticated && (
                <button
                  className="border border-gray-300 dark:border-gray-600 px-6 py-2 rounded-lg text-gray-700 dark:text-gray-200"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Logged in as: {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}{' '}
              {role ? `(${role})` : ''}
            </p>
          </div>
        </div>

        {canViewOwnerConsole && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Create Property</h2>
          <div className="space-y-4">
            <input
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Property name"
              value={propertyForm.name}
              onChange={(event) => handlePropertyChange('name', event.target.value)}
            />
            <input
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Property ID (optional)"
              value={propertyForm.propertyId}
              onChange={(event) => handlePropertyChange('propertyId', event.target.value)}
            />
            <input
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Location"
              value={propertyForm.location}
              onChange={(event) => handlePropertyChange('location', event.target.value)}
            />
            <textarea
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="Description"
              rows={3}
              value={propertyForm.description}
              onChange={(event) => handlePropertyChange('description', event.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <input
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                placeholder="Target raise (USDC)"
                value={propertyForm.targetUsdc}
                onChange={(event) => handlePropertyChange('targetUsdc', event.target.value)}
              />
              <div className="text-xs text-gray-500 dark:text-gray-400 self-center">
                Stored as USDC base units in the backend intent queue.
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <select
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                value={propertyForm.chainId}
                onChange={(event) => handlePropertyChange('chainId', event.target.value)}
              >
                <option value="84532">Base Sepolia</option>
                <option value="8453">Base Mainnet</option>
              </select>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              This submits `/v1/admin/properties/intents`. Onchain deployment should be executed by operator automation.
            </p>
            <button
              className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700"
              onClick={handleCreateProperty}
              disabled={!canManageOwnerFlows}
            >
              Create Property Intent
            </button>
          </div>
        </div>
        )}
      </div>

      {(statusMessage || errorMessage) && (
        <div
          className={`mb-6 rounded-lg px-4 py-3 ${
            errorMessage
              ? 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-200'
              : 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-200'
          }`}
        >
          {errorMessage || statusMessage}
        </div>
      )}

      {canViewOwnerConsole && (
      <>
      {/* Properties List */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Campaign Fee Overview</h2>
          <button
            className="text-sm border border-gray-300 dark:border-gray-600 px-3 py-1 rounded"
            onClick={() => void loadCampaigns()}
          >
            Refresh
          </button>
        </div>
        {campaignsLoading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading campaigns...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">No campaigns indexed yet.</p>
        ) : (
          <div className="space-y-3">
            {campaigns.slice(0, 8).map((campaign) => (
              <div
                key={campaign.campaignAddress}
                className="rounded border border-gray-200 p-3 text-sm dark:border-gray-700"
              >
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Property</span>
                  <span className="font-medium text-gray-900 dark:text-white">{campaign.propertyId}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Platform Fee</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {campaign.platformFeeBps === null
                      ? 'Not available'
                      : `${(campaign.platformFeeBps / 100).toFixed(2)}%`}
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Fee Recipient</span>
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
                    {campaign.platformFeeRecipient ?? 'Not available'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 bg-white p-6 rounded-lg shadow-lg dark:bg-gray-800">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Create Profit Distribution Intent
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <input
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="Property ID"
            value={profitForm.propertyId}
            onChange={(event) => handleProfitChange('propertyId', event.target.value)}
          />
          <input
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="Profit distributor address (0x...)"
            value={profitForm.profitDistributorAddress}
            onChange={(event) =>
              handleProfitChange('profitDistributorAddress', event.target.value)
            }
          />
          <input
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="USDC amount"
            value={profitForm.usdcAmount}
            onChange={(event) => handleProfitChange('usdcAmount', event.target.value)}
          />
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Creates `/v1/admin/profits/intents` for operator execution.
        </p>
        <button
          className="mt-4 bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700"
          onClick={handleCreateProfitIntent}
          disabled={!canManageOwnerFlows}
        >
          Submit Profit Distribution Intent
        </button>
      </div>

      <div className="mt-8 bg-white p-6 rounded-lg shadow-lg dark:bg-gray-800">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          Update Platform Fee (Intent)
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <input
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="Campaign address (0x...)"
            value={platformFeeForm.campaignAddress}
            onChange={(event) => handlePlatformFeeChange('campaignAddress', event.target.value)}
          />
          <input
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="Platform fee bps (0-2000)"
            value={platformFeeForm.platformFeeBps}
            onChange={(event) => handlePlatformFeeChange('platformFeeBps', event.target.value)}
          />
          <input
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
            placeholder="Fee recipient (required if bps > 0)"
            value={platformFeeForm.platformFeeRecipient}
            onChange={(event) =>
              handlePlatformFeeChange('platformFeeRecipient', event.target.value)
            }
          />
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Creates `/v1/admin/platform-fees/intents` for operational execution.
        </p>
        <button
          className="mt-4 bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700"
          onClick={handleCreatePlatformFeeIntent}
          disabled={!canManageOwnerFlows}
        >
          Submit Platform Fee Intent
        </button>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-3 flex justify-end">
          <button
            className="text-sm border border-gray-300 dark:border-gray-600 px-3 py-1 rounded"
            onClick={() => void loadIntents(token)}
            disabled={!canManageOwnerFlows}
          >
            Refresh Intents
          </button>
        </div>
        {intentsLoading && (
          <div className="lg:col-span-3 rounded-lg bg-blue-50 px-4 py-3 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">
            Refreshing intent statuses...
          </div>
        )}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Property Intents</h3>
          {propertyIntents.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No property intents yet.</p>
          ) : (
            <div className="space-y-3">
              {propertyIntents.slice(0, 6).map((intent) => (
                <div key={intent.id} className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {intent.propertyId}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${intentStatusClass(intent.status)}`}>
                      {intent.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Attempts: {intent.attemptCount}
                  </div>
                  {intent.errorMessage && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-300">{intent.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Profit Intents</h3>
          {profitIntents.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No profit intents yet.</p>
          ) : (
            <div className="space-y-3">
              {profitIntents.slice(0, 6).map((intent) => (
                <div key={intent.id} className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {intent.propertyId}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${intentStatusClass(intent.status)}`}>
                      {intent.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    ${(Number(intent.usdcAmountBaseUnits) / 1_000_000).toLocaleString()} USDC
                  </div>
                  {intent.errorMessage && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-300">{intent.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Platform Fee Intents</h3>
          {platformFeeIntents.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No platform fee intents yet.</p>
          ) : (
            <div className="space-y-3">
              {platformFeeIntents.slice(0, 6).map((intent) => (
                <div key={intent.id} className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {(intent.platformFeeBps / 100).toFixed(2)}%
                    </span>
                    <span className={`text-xs px-2 py-1 rounded ${intentStatusClass(intent.status)}`}>
                      {intent.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
                    {intent.campaignAddress}
                  </div>
                  {intent.errorMessage && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-300">{intent.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
