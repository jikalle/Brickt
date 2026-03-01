import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import { fetchCampaign, fetchProperty, CampaignResponse, PropertyResponse } from '../lib/api';
import { BASE_SEPOLIA_USDC } from '../config/tokens.config';

const CROWDFUND_ABI = [
  'function invest(uint256 amountUSDC) external',
  'function claimTokens() external',
  'function claimRefund() external',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
];

const PROFIT_DISTRIBUTOR_ABI = [
  'function claim() external',
];

const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14A34';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const getEthereumProvider = (): EthereumProvider | null => {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return provider ?? null;
};

const toUsd = (baseUnits: string): string =>
  (Number(baseUnits) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [campaign, setCampaign] = useState<CampaignResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [amountUsdc, setAmountUsdc] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [txError, setTxError] = useState('');
  const [isInvesting, setIsInvesting] = useState(false);
  const [isClaimingEquity, setIsClaimingEquity] = useState(false);
  const [isClaimingProfit, setIsClaimingProfit] = useState(false);
  const [isClaimingRefund, setIsClaimingRefund] = useState(false);

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
  const canClaimRefund = campaign?.state === 'FAILED';
  const walletAvailable = getEthereumProvider() !== null;
  const txInFlight = isInvesting || isClaimingEquity || isClaimingProfit || isClaimingRefund;

  const handleInvest = async () => {
    setTxError('');
    setTxStatus('');

    if (!property) {
      setTxError('Property is not loaded yet.');
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
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      });

      await injected.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(injected as never);
      const signer = await provider.getSigner();

      const amountBaseUnits = parseUnits(amountUsdc, 6);
      const usdc = new Contract(BASE_SEPOLIA_USDC.address, ERC20_ABI, signer);
      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer);

      setTxStatus('Submitting USDC approval...');
      const approveTx = await usdc.approve(property.crowdfundAddress, amountBaseUnits);
      await approveTx.wait();

      setTxStatus('Submitting investment...');
      const investTx = await crowdfund.invest(amountBaseUnits);
      await investTx.wait();

      setTxStatus(`Investment confirmed: ${investTx.hash}`);
      setAmountUsdc('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Investment transaction failed';
      setTxError(message);
    } finally {
      setIsInvesting(false);
    }
  };

  const withSigner = async () => {
    const injected = getEthereumProvider();
    if (!injected) {
      throw new Error('No wallet provider found. Install a wallet extension.');
    }

    await injected.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
    });
    await injected.request({ method: 'eth_requestAccounts' });

    const provider = new BrowserProvider(injected as never);
    return provider.getSigner();
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
      const tx = await crowdfund.claimTokens();
      await tx.wait();
      setTxStatus(`Equity claim confirmed: ${tx.hash}`);
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
      const tx = await distributor.claim();
      await tx.wait();
      setTxStatus(`Profit claim confirmed: ${tx.hash}`);
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
      const tx = await crowdfund.claimRefund();
      await tx.wait();
      setTxStatus(`Refund confirmed: ${tx.hash}`);
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
              <p className="text-gray-900 dark:text-white">{campaign?.state ?? 'Unknown'}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400">Crowdfund Contract</label>
              <p className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">
                {property.crowdfundAddress}
              </p>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
              Investing is risky and may result in loss of capital. Review{' '}
              <Link to="/disclosures" className="underline font-medium">
                Risk Disclosures
              </Link>{' '}
              before transacting.
            </div>

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

            {!walletAvailable && (
              <div className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                Connect a wallet extension to invest or claim.
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
              disabled={isInvesting || !walletAvailable || txInFlight}
            >
              {isInvesting ? 'Processing...' : 'Invest Onchain'}
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
              <button
                className="w-full border border-primary-600 text-primary-700 dark:text-primary-300 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleClaimRefund}
                disabled={isClaimingRefund || !canClaimRefund || !walletAvailable || txInFlight}
                title={canClaimRefund ? 'Claim refund from failed campaign' : 'Refunds available only when campaign is FAILED'}
              >
                {isClaimingRefund ? 'Claiming Refund...' : 'Claim Refund'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
