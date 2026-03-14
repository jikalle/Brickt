import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
} from 'ethers'
import { useAccount } from 'wagmi'
import type { ChangeEvent, ReactNode } from 'react'
import {
  fetchAssetUsdcQuote,
  fetchCampaign,
  fetchEthUsdcQuote,
  postAgentChat,
  fetchProperty,
  fetchPropertyEquityClaims,
  fetchPropertyProfitClaims,
  type AssetUsdcQuoteResponse,
  type CampaignResponse,
  type EthUsdcQuoteResponse,
  type PropertyResponse,
} from '../lib/api'
import { BASE_SEPOLIA_USDC, getBaseSepoliaPlatformToken } from '../config/tokens.config'
import { env } from '../config/env'
import { emitPortfolioActivity } from '../lib/portfolioActivity'
import TxHashLink from '../components/common/TxHashLink'
import { extractTxHashes } from '../lib/txHash'
import { getBasePaymasterUrl, trySendSponsoredCall } from '../lib/baseAccount'
import { useSelector } from 'react-redux'
import type { RootState } from '../store'

type AssetType = 'USDC' | 'ETH' | 'PLATFORM'
type CampaignPhase = 'NOT_STARTED' | 'ACTIVE' | 'FAILED' | 'ENDED' | 'UNKNOWN'

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

type PropertyLike = {
  name?: string
  description?: string
  location?: string
  bestFor?: string | null
  crowdfundAddress?: string
  youtubeEmbedUrl?: string | null
  latitude?: number | null
  longitude?: number | null
  profitDistributed?: boolean
}

type PropertyPremiumLayoutProps = {
  property: PropertyLike
  campaignRaisedBaseUnits?: bigint | string | number | null
  campaignTargetBaseUnits?: bigint | string | number | null
  fundingProgressPercent?: number | null
  projectedRoiPercent?: number | null
  galleryImages?: string[] | null
  selectedGalleryImage?: string | null
  setSelectedGalleryImage: (value: string) => void
  handleInvest: () => void | Promise<void>
  handleClaimEquity: () => void | Promise<void>
  handleClaimProfit: () => void | Promise<void>
  handleClaimRefund: () => void | Promise<void>
  amountUsdc: string
  setAmountUsdc: (value: string) => void
  amountEth: string
  setAmountEth: (value: string) => void
  investAsset: AssetType
  setInvestAsset: (value: AssetType) => void
  slippagePercent: string
  setSlippagePercent: (value: string) => void
  txStatus?: string
  txHashesInStatus?: string[]
  txError?: string
  quoteError?: string
  quotedUsdcOutBaseUnits?: bigint | null
  minUsdcOutBaseUnits?: bigint | null
  isQuotingSwapAsset?: boolean
  txInFlight?: boolean
  walletAvailable?: boolean
  canSwapOnBaseSepolia?: boolean
  gasSponsorshipAvailable?: boolean
  platformTokenSymbol?: string
  canInvest?: boolean
  canClaimEquity?: boolean
  canClaimProfit?: boolean
  canClaimRefund?: boolean
  claimableProfitBaseUnits?: bigint | null
  claimableEquityBaseUnits?: bigint | null
  claimProfitUnavailableMessage?: string
  claimEquityUnavailableMessage?: string
  investUnavailableMessage?: string
  formatUsdcUnits: (value: bigint) => string
  agentChatToken?: string | null
  propertyId?: string
  campaignAddress?: string
}

type StatCardProps = {
  label: string
  value: string
  sub?: string
}

type SectionProps = {
  title: string
  eyebrow?: string
  right?: ReactNode
  children: ReactNode
}

const MapPinIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 21s7-4.35 7-11a7 7 0 1 0-14 0c0 6.65 7 11 7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
    />
  </svg>
)

const CROWDFUND_ABI = [
  'function invest(uint256 amountUSDC) external',
  'function claimTokens() external',
  'function claimableTokens(address user) view returns (uint256)',
  'function claimRefund() external',
  'function usdcToken() view returns (address)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 value) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function symbol() external view returns (string)',
]

const PROFIT_DISTRIBUTOR_ABI = [
  'function claim() external',
  'function claimable(address user) view returns (uint256)',
]

const WETH_ABI = ['function deposit() payable', 'function approve(address spender, uint256 value) external returns (bool)']

const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
]

const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14A34'
const CAMPAIGN_ACTIVE_STATE = 'ACTIVE'
const CAMPAIGN_FAILED_STATE = 'FAILED'
const ERC8021_SUFFIX = '0x80218021802180218021802180218021'

const getEthereumProvider = (): EthereumProvider | null => {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum
  return provider ?? null
}

const toBigIntSafe = (value: bigint | string | number | null | undefined): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0n
    try {
      return BigInt(trimmed)
    } catch {
      return 0n
    }
  }
  return 0n
}

const formatCurrencyFromBaseUnits = (value: bigint | string | number | null | undefined): string => {
  const normalized = toBigIntSafe(value)
  return Number(formatUnits(normalized, 6)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })
}

const formatEquityUnits = (value: bigint | null | undefined): string => {
  if (value === null || value === undefined) return '--'
  return Number(formatUnits(value, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })
}

const clampPercent = (value: number | null | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const buildGoogleMapsCoordUrl = (latitude?: number | null, longitude?: number | null): string | null => {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return `https://www.google.com/maps?q=${latitude},${longitude}`
}

const formatBestFor = (bestFor: string | null | undefined): string => {
  if (!bestFor) return '--'
  const normalized = bestFor.split('_').join(' ')
  return normalized.replace(/\b\w/g, (char: string) => char.toUpperCase())
}

const CompletionSeal = ({ className = '' }: { className?: string }) => (
  <div
    className={`relative flex items-center justify-center ${className}`.trim()}
    style={{
      transform: 'rotate(-18deg)',
      width: 148,
      height: 148,
      filter: 'drop-shadow(0 0 12px rgba(16,185,129,0.55))',
    }}
  >
    <div
      className="absolute inset-[6px] rounded-full"
      style={{
        background:
          'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.96) 0%, rgba(232,245,238,0.96) 30%, rgba(199,230,214,0.94) 68%, rgba(164,214,190,0.92) 100%)',
        boxShadow:
          'inset 0 2px 10px rgba(255,255,255,0.55), inset 0 -10px 18px rgba(6,95,70,0.18)',
      }}
    />

    <div
      className="absolute inset-0 rounded-full border-[4px] border-emerald-300/95"
      style={{ boxShadow: 'inset 0 0 0 2.5px rgba(6,95,70,0.8), 0 0 0 1.5px rgba(167,243,208,0.45)' }}
    />
    <div
      className="absolute rounded-full border-[2px] border-emerald-300/80"
      style={{ inset: 10, boxShadow: 'inset 0 0 0 1px rgba(6,95,70,0.55)' }}
    />

    <svg className="absolute inset-0" viewBox="0 0 148 148" style={{ opacity: 0.9 }}>
      <defs>
        <path id="topArcDetail" d="M 20,74 A 54,54 0 0,1 128,74" />
        <path id="bottomArcDetail" d="M 26,88 A 54,54 0 0,0 122,88" />
      </defs>
      <text
        fill="#111827"
        fontSize="11.5"
        fontWeight="800"
        letterSpacing="3.5"
        fontFamily="monospace"
        textAnchor="middle"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="0.45"
        paintOrder="stroke"
      >
        <textPath href="#topArcDetail" startOffset="50%">
          INVESTMENT COMPLETE
        </textPath>
      </text>
      <text
        fill="#111827"
        fontSize="10"
        fontWeight="700"
        letterSpacing="2"
        fontFamily="monospace"
        textAnchor="middle"
        opacity="0.7"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="0.35"
        paintOrder="stroke"
      >
        <textPath href="#bottomArcDetail" startOffset="50%">
          ✦ VERIFIED ✦
        </textPath>
      </text>
    </svg>

    <div className="relative flex flex-col items-center justify-center gap-0.5 text-center">
      <span
        className="block text-[13px] font-black uppercase tracking-[0.22em] text-slate-900"
        style={{
          fontFamily: 'monospace',
          textShadow: '0 1px 0 rgba(255,255,255,0.28), 0 0 6px rgba(15,23,42,0.08)',
        }}
      >
        PROFIT
      </span>
      <div className="w-10 border-t border-emerald-500/55" />
      <span
        className="block text-[13px] font-black uppercase tracking-[0.22em] text-slate-900"
        style={{
          fontFamily: 'monospace',
          textShadow: '0 1px 0 rgba(255,255,255,0.28), 0 0 6px rgba(15,23,42,0.08)',
        }}
      >
        SHARED
      </span>
    </div>

    <div
      className="absolute inset-0 rounded-full"
      style={{
        background:
          'radial-gradient(ellipse at 35% 35%, rgba(255,255,255,0.24) 0%, transparent 58%), radial-gradient(ellipse at 68% 74%, rgba(6,95,70,0.08) 0%, transparent 54%)',
        mixBlendMode: 'screen',
      }}
    />
  </div>
)

const toBuilderDataSuffix = (codes: string[]): string | null => {
  if (codes.length === 0) {
    return null
  }
  const codesHex = `0x${Array.from(toUtf8Bytes(codes.join(',')))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
  const codesLengthHex = toBeHex(dataLength(codesHex), 1)
  const schemaIdHex = toBeHex(0, 1)
  return concat([codesHex, codesLengthHex, schemaIdHex, ERC8021_SUFFIX])
}

const StatCard = ({ label, value, sub }: StatCardProps) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</p>
    <p className="mt-2 break-words text-2xl font-semibold text-white">{value}</p>
    {sub ? <p className="mt-1 text-xs text-slate-400">{sub}</p> : null}
  </div>
)

const Section = ({ title, eyebrow, right, children }: SectionProps) => (
  <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#08111f]/90 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
    <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p> : null}
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      {right}
    </div>
    <div className="p-6">{children}</div>
  </section>
)

function PropertyPremiumLayout({
  property,
  campaignRaisedBaseUnits,
  campaignTargetBaseUnits,
  fundingProgressPercent,
  projectedRoiPercent,
  galleryImages,
  selectedGalleryImage,
  setSelectedGalleryImage,
  handleInvest,
  handleClaimEquity,
  handleClaimProfit,
  handleClaimRefund,
  amountUsdc,
  setAmountUsdc,
  amountEth,
  setAmountEth,
  investAsset,
  setInvestAsset,
  slippagePercent,
  setSlippagePercent,
  txStatus = '',
  txHashesInStatus = [],
  txError = '',
  quoteError = '',
  quotedUsdcOutBaseUnits = null,
  minUsdcOutBaseUnits = null,
  isQuotingSwapAsset = false,
  txInFlight = false,
  walletAvailable = false,
  canSwapOnBaseSepolia = false,
  gasSponsorshipAvailable = false,
  platformTokenSymbol = 'BRICKT',
  canInvest = false,
  canClaimEquity = false,
  canClaimProfit = false,
  canClaimRefund = false,
  claimableProfitBaseUnits,
  claimableEquityBaseUnits,
  claimProfitUnavailableMessage = 'No claimable profit yet.',
  claimEquityUnavailableMessage = 'No claimable equity yet.',
  investUnavailableMessage = 'Investment currently unavailable.',
  formatUsdcUnits,
  agentChatToken,
  propertyId,
  campaignAddress,
}: PropertyPremiumLayoutProps) {
  const safeProperty = property ?? {}
  const safeGalleryImages = Array.isArray(galleryImages) ? galleryImages.filter(isNonEmptyString) : []
  const progress = clampPercent(fundingProgressPercent)
  const raised = formatCurrencyFromBaseUnits(campaignRaisedBaseUnits)
  const target = formatCurrencyFromBaseUnits(campaignTargetBaseUnits)
  const roiValue = typeof projectedRoiPercent === 'number' && Number.isFinite(projectedRoiPercent)
  const roi = roiValue ? `${projectedRoiPercent.toFixed(1)}%` : '--'
  const profitDisplay = typeof claimableProfitBaseUnits === 'bigint' ? formatUsdcUnits(claimableProfitBaseUnits) : '--'
  const equityDisplay = formatEquityUnits(claimableEquityBaseUnits)
  const hasSelectedImage = isNonEmptyString(selectedGalleryImage)
  const selectedImageExists = hasSelectedImage && safeGalleryImages.includes(selectedGalleryImage)
  const primaryImage = selectedImageExists ? selectedGalleryImage : safeGalleryImages[0] ?? null
  const googleMapsUrl = buildGoogleMapsCoordUrl(safeProperty.latitude, safeProperty.longitude)
  const showCompletionStamp = safeProperty.profitDistributed === true
  const showInvestSection = canInvest
  const showClaimsSection = !canInvest || canClaimEquity || canClaimProfit || canClaimRefund
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentReply, setAgentReply] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)

  const onAssetChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setInvestAsset(e.target.value as AssetType)
  }

  const onAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (investAsset === 'ETH') {
      setAmountEth(e.target.value)
      return
    }
    setAmountUsdc(e.target.value)
  }

  const handleAskAgent = async () => {
    const message = agentPrompt.trim()
    if (!message || !agentChatToken) return

    setAgentLoading(true)
    setAgentReply(null)
    try {
      const data = await postAgentChat(agentChatToken, {
        message,
        propertyId,
        campaignAddress,
      })
      setAgentReply(data.response || data.error || 'No response.')
    } catch (error) {
      setAgentReply(error instanceof Error ? error.message : 'Could not reach the agent.')
    } finally {
      setAgentLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-transparent text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-200px] top-[-200px] h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[160px]" />
        <div className="absolute right-[-200px] top-[100px] h-[500px] w-[500px] rounded-full bg-emerald-500/10 blur-[160px]" />
      </div>

      <div className="relative mx-auto max-w-7xl space-y-10 px-6 py-10">
        <Link
          to="/properties"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
        >
          ← Back to Properties
        </Link>

        <section className="rounded-[32px] border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 p-8">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="min-w-0">
              <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{safeProperty.name ?? 'Property'}</h1>

              <p className="mt-4 max-w-2xl text-slate-300">{safeProperty.description ?? 'No description available.'}</p>

              <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="Raised" value={`$${raised}`} sub={`of $${target}`} />
                <StatCard label="ROI" value={roi} />
                <StatCard label="Funding" value={`${progress.toFixed(1)}%`} />
                <StatCard label="Location" value={safeProperty.location ?? '--'} />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
              <p className="text-sm text-slate-400">Funding Progress</p>

              <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="mt-4 text-sm text-slate-300">${raised} raised of ${target}</p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-slate-400">Claimable Profit</p>
                  <p className="font-semibold text-emerald-300">{profitDisplay} USDC</p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-slate-400">Equity Tokens</p>
                  <p className="font-semibold text-white">{equityDisplay}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-10 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="min-w-0 space-y-10">
            <Section title="Property Media" eyebrow="Overview">
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_140px]">
                  <div className="space-y-4">
                    <div className="relative aspect-[16/10] overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                      {primaryImage ? (
                        <img
                          src={primaryImage}
                          alt={safeProperty.name ?? 'Property image'}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-400">No image</div>
                      )}

                      {/* Rubber Stamp Overlay */}
                      {showCompletionStamp ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <CompletionSeal />
                        </div>
                      ) : null}
                    </div>

                    {safeGalleryImages.length > 0 ? (
                      <div className="grid grid-cols-4 gap-2 lg:hidden">
                        {safeGalleryImages.map((img) => (
                          <button
                            key={`mobile-${img}`}
                            type="button"
                            onClick={() => setSelectedGalleryImage(img)}
                            className={`aspect-square overflow-hidden rounded-xl border ${primaryImage === img ? 'border-cyan-300' : 'border-white/10'}`}
                          >
                            <img src={img} alt="Property thumbnail" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {isNonEmptyString(safeProperty.youtubeEmbedUrl) ? (
                      <div className="aspect-[16/11] overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                        <iframe
                          title={`${safeProperty.name ?? 'Property'} video`}
                          src={safeProperty.youtubeEmbedUrl}
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      </div>
                    ) : null}
                  </div>

                  {safeGalleryImages.length > 0 ? (
                    <div className="hidden grid-cols-4 gap-2 lg:grid lg:grid-cols-1 lg:gap-1">
                      {safeGalleryImages.map((img) => (
                        <button
                          key={`desktop-${img}`}
                          type="button"
                          onClick={() => setSelectedGalleryImage(img)}
                          className={`aspect-square overflow-hidden rounded-xl border ${primaryImage === img ? 'border-cyan-300' : 'border-white/10'}`}
                        >
                          <img src={img} alt="Property thumbnail" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Section>

            <Section title="Investment Thesis" eyebrow="Why this deal">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h4 className="font-semibold">Location</h4>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="truncate text-sm text-slate-400">{safeProperty.location ?? '--'}</p>
                    {googleMapsUrl ? (
                      <a
                        href={googleMapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-xs text-cyan-300 transition hover:border-cyan-300/40 hover:text-cyan-200"
                        title="Open location in Google Maps"
                        aria-label="Open location in Google Maps"
                      >
                        <MapPinIcon className="h-4 w-4" />
                        Map
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h4 className="font-semibold">Best For</h4>
                  <p className="mt-2 text-sm text-slate-400">{formatBestFor(safeProperty.bestFor)}</p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h4 className="font-semibold">Target Raise</h4>
                  <p className="mt-2 text-sm text-slate-400">${target}</p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h4 className="font-semibold">Estimated Exit</h4>
                  <p className="mt-2 text-sm text-slate-400">{roi}</p>
                </div>
              </div>
            </Section>
          </div>

          <div className="h-fit space-y-8 xl:sticky xl:top-6">
            {showInvestSection ? (
              <Section title="Invest" eyebrow="Primary Action">
                <div className="space-y-4">
                  <select
                    value={investAsset}
                    onChange={onAssetChange}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 p-3"
                    disabled={txInFlight}
                  >
                    <option value="USDC">USDC</option>
                    <option value="ETH" disabled={!canSwapOnBaseSepolia}>ETH</option>
                    <option value="PLATFORM" disabled>{platformTokenSymbol} (Coming soon)</option>
                  </select>

                  <input
                    type="text"
                    value={investAsset === 'USDC' ? amountUsdc : amountEth}
                    onChange={onAmountChange}
                    placeholder={
                      investAsset === 'USDC'
                        ? 'Amount (USDC)'
                        : investAsset === 'ETH'
                          ? 'Amount (ETH)'
                          : `Amount (${platformTokenSymbol})`
                    }
                    inputMode="decimal"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 p-3"
                    disabled={txInFlight}
                  />

                  {investAsset !== 'USDC' ? (
                    <>
                      <input
                        type="text"
                        value={slippagePercent}
                        onChange={(e) => setSlippagePercent(e.target.value)}
                        placeholder="Slippage (%)"
                        inputMode="decimal"
                        className="w-full rounded-xl border border-white/10 bg-slate-900 p-3"
                        disabled={txInFlight}
                      />
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                        <p>
                          Estimated USDC out:{' '}
                          <span className="font-semibold text-white">
                            {isQuotingSwapAsset
                              ? 'Quoting...'
                              : quotedUsdcOutBaseUnits
                                ? `${formatUsdcUnits(quotedUsdcOutBaseUnits)} USDC`
                                : '--'}
                          </span>
                        </p>
                        <p className="mt-1">
                          Auto min USDC out:{' '}
                          <span className="font-semibold text-white">
                            {minUsdcOutBaseUnits ? `${formatUsdcUnits(minUsdcOutBaseUnits)} USDC` : '--'}
                          </span>
                        </p>
                      </div>
                    </>
                  ) : null}

                  {!walletAvailable ? <p className="text-xs text-amber-300">Connect wallet to invest.</p> : null}
                  {walletAvailable && !canInvest ? <p className="text-xs text-amber-300">{investUnavailableMessage}</p> : null}
                  {quoteError ? <p className="text-xs text-red-300">{quoteError}</p> : null}
                  {txError ? <p className="text-xs text-red-300">{txError}</p> : null}
                  {txStatus ? <p className="text-xs text-emerald-300">{txStatus}</p> : null}
                  {txHashesInStatus.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {txHashesInStatus.map((txHash) => (
                        <TxHashLink key={txHash} txHash={txHash} compact />
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleInvest}
                    disabled={
                      !walletAvailable ||
                      txInFlight ||
                      !canInvest ||
                      (investAsset !== 'USDC' && (isQuotingSwapAsset || !quotedUsdcOutBaseUnits || !minUsdcOutBaseUnits))
                    }
                    className="w-full rounded-xl bg-cyan-400 py-4 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {txInFlight ? 'Processing...' : investAsset !== 'USDC' ? 'Swap & Invest' : 'Invest'}
                  </button>
                </div>
              </Section>
            ) : null}

            {showClaimsSection ? (
              <Section title="Claims" eyebrow="Investor Actions">
                <div className="space-y-3">
                  {gasSponsorshipAvailable ? (
                    <p className="text-xs text-cyan-300">Gas sponsorship is available for supported Base wallets.</p>
                  ) : null}
                  {!canClaimEquity ? <p className="text-xs text-slate-400">Equity: {claimEquityUnavailableMessage}</p> : null}
                  {!canClaimProfit ? <p className="text-xs text-slate-400">Profit: {claimProfitUnavailableMessage}</p> : null}

                  <button
                    type="button"
                    onClick={handleClaimEquity}
                    disabled={txInFlight || !walletAvailable || !canClaimEquity}
                    className="w-full rounded-xl border border-white/10 p-3 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Claim Equity
                  </button>

                  <button
                    type="button"
                    onClick={handleClaimProfit}
                    disabled={txInFlight || !walletAvailable || !canClaimProfit}
                    className="w-full rounded-xl border border-white/10 p-3 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Claim Profit
                  </button>

                  <button
                    type="button"
                    onClick={handleClaimRefund}
                    disabled={txInFlight || !walletAvailable || !canClaimRefund}
                    className="w-full rounded-xl border border-white/10 p-3 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Claim Refund
                  </button>
                </div>
              </Section>
            ) : null}

            <Section title="Ask Brickt Agent" eyebrow="Property Guidance">
              <div className="space-y-4">
                <p className="text-sm leading-6 text-slate-300">
                  Ask about this property&apos;s current stage, whether investing still makes sense, or what happens next for investors.
                </p>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <textarea
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.target.value)}
                    placeholder={
                      agentChatToken
                        ? 'Example: What stage is this property in, and what should investors expect next?'
                        : 'Sign in from the header to ask the agent about this property...'
                    }
                    disabled={!agentChatToken || agentLoading}
                    className="min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <p className="text-xs text-slate-400">
                      {agentChatToken
                        ? 'The answer is grounded in this property’s current campaign and lifecycle data.'
                        : 'Complete app sign-in from the header to unlock property-aware agent chat.'}
                    </p>
                    <button
                      type="button"
                      onClick={handleAskAgent}
                      disabled={!agentChatToken || agentLoading || !agentPrompt.trim()}
                      className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:border-cyan-200/60 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {agentLoading ? 'Thinking...' : 'Ask Agent'}
                    </button>
                  </div>
                </div>
                {agentReply ? (
                  <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/5 p-4">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-cyan-300">Brickt Agent</p>
                    <p className="text-sm leading-6 text-slate-200">{agentReply}</p>
                  </div>
                ) : null}
              </div>
            </Section>

            <Section title="Contract Details" eyebrow="Transparency">
              <div className="space-y-4 break-all font-mono text-xs text-slate-300">
                <div>
                  <p className="text-slate-400">Crowdfund</p>
                  <p>{safeProperty.crowdfundAddress ?? '--'}</p>
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

const formatUsdcUnits = (amountBaseUnits: bigint): string =>
  Number(formatUnits(amountBaseUnits, 6)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>()
  const { address: connectedAddress } = useAccount()
  const token = useSelector((state: RootState) => state.user.token)

  const [property, setProperty] = useState<PropertyResponse | null>(null)
  const [campaign, setCampaign] = useState<CampaignResponse | null>(null)
  const [crowdfundUsdcAddress, setCrowdfundUsdcAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string>('')
  const [amountUsdc, setAmountUsdc] = useState('')
  const [amountEth, setAmountEth] = useState('')
  const [slippagePercent, setSlippagePercent] = useState('1')
  const [investAsset, setInvestAsset] = useState<AssetType>('USDC')

  const [quotedUsdcOutBaseUnits, setQuotedUsdcOutBaseUnits] = useState<bigint | null>(null)
  const [swapQuote, setSwapQuote] = useState<AssetUsdcQuoteResponse | EthUsdcQuoteResponse | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [isQuotingSwapAsset, setIsQuotingSwapAsset] = useState(false)

  const [txStatus, setTxStatus] = useState('')
  const [txError, setTxError] = useState('')
  const [isInvesting, setIsInvesting] = useState(false)
  const [isClaimingEquity, setIsClaimingEquity] = useState(false)
  const [isClaimingProfit, setIsClaimingProfit] = useState(false)
  const [isClaimingRefund, setIsClaimingRefund] = useState(false)

  const [claimableProfitBaseUnits, setClaimableProfitBaseUnits] = useState<bigint | null>(null)
  const [claimableEquityBaseUnits, setClaimableEquityBaseUnits] = useState<bigint | null>(null)
  const [claimableEquityError, setClaimableEquityError] = useState('')
  const platformToken = useMemo(() => getBaseSepoliaPlatformToken(), [])
  const [nowMs, setNowMs] = useState(Date.now())

  const builderDataSuffix = useMemo(() => toBuilderDataSuffix(env.BASE_BUILDER_CODES), [])
  const walletAvailable = getEthereumProvider() !== null

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!id) {
        if (mounted) {
          setErrorMessage('Missing property id.')
          setLoading(false)
        }
        return
      }

      try {
        const propertyData = await fetchProperty(id)
        if (!mounted) return
        setProperty(propertyData)

        const initialGallery = [
          ...(propertyData.imageUrl ? [propertyData.imageUrl] : []),
          ...(Array.isArray(propertyData.imageUrls) ? propertyData.imageUrls : []),
        ].filter(isNonEmptyString)
        setSelectedGalleryImage(initialGallery[0] ?? '')

        try {
          const campaignData = await fetchCampaign(propertyData.crowdfundAddress)
          if (mounted) {
            setCampaign(campaignData)
          }
        } catch {
          if (mounted) {
            setCampaign(null)
          }
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage((error as Error).message)
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void load()
    return () => {
      mounted = false
    }
  }, [id])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadCampaignLive = async () => {
      if (!property?.crowdfundAddress) return
      try {
        const live = await fetchCampaign(property.crowdfundAddress)
        if (!cancelled) {
          setCampaign(live)
        }
      } catch {
        // Ignore transient fetch errors.
      }
    }

    void loadCampaignLive()
    const timer = setInterval(() => {
      void loadCampaignLive()
    }, 10000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [property?.crowdfundAddress])

  useEffect(() => {
    let cancelled = false

    const loadCrowdfundUsdcAddress = async () => {
      if (!property?.crowdfundAddress) {
        setCrowdfundUsdcAddress(null)
        return
      }
      try {
        const rpcUrl = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
        const provider = new JsonRpcProvider(rpcUrl)
        const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, provider)
        const tokenAddress = ((await crowdfund.usdcToken()) as string).toLowerCase()
        if (!cancelled) {
          setCrowdfundUsdcAddress(tokenAddress)
        }
      } catch {
        if (!cancelled) {
          setCrowdfundUsdcAddress(null)
        }
      }
    }

    void loadCrowdfundUsdcAddress()
    return () => {
      cancelled = true
    }
  }, [property?.crowdfundAddress])

  useEffect(() => {
    let cancelled = false

    const loadClaimableProfit = async () => {
      if (!property?.profitDistributorAddress || !connectedAddress) {
        setClaimableProfitBaseUnits(null)
        return
      }

      try {
        const rpcUrl = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
        const provider = new JsonRpcProvider(rpcUrl)
        const distributor = new Contract(property.profitDistributorAddress, PROFIT_DISTRIBUTOR_ABI, provider)
        const claimable = (await distributor.claimable(connectedAddress)) as bigint
        if (!cancelled) {
          setClaimableProfitBaseUnits(claimable)
        }
      } catch {
        if (!cancelled) {
          setClaimableProfitBaseUnits(null)
        }
      }
    }

    void loadClaimableProfit()
    const timer = setInterval(() => {
      void loadClaimableProfit()
    }, 15000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [connectedAddress, property?.profitDistributorAddress])

  useEffect(() => {
    let cancelled = false

    const loadClaimableEquity = async () => {
      if (!property?.crowdfundAddress || !connectedAddress) {
        setClaimableEquityBaseUnits(null)
        setClaimableEquityError('')
        return
      }

      try {
        const rpcUrl = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
        const provider = new JsonRpcProvider(rpcUrl)
        const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, provider)
        const claimable = (await crowdfund.claimableTokens(connectedAddress)) as bigint
        if (!cancelled) {
          setClaimableEquityBaseUnits(claimable)
          setClaimableEquityError('')
        }
      } catch (error) {
        if (!cancelled) {
          setClaimableEquityBaseUnits(null)
          const message = error instanceof Error ? error.message : 'Could not read claimable equity'
          if (message.includes('Equity token not set')) {
            setClaimableEquityError('Equity token is not configured for this campaign yet.')
          } else {
            setClaimableEquityError('Could not read claimable equity onchain.')
          }
        }
      }
    }

    void loadClaimableEquity()
    const timer = setInterval(() => {
      void loadClaimableEquity()
    }, 15000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [connectedAddress, property?.crowdfundAddress])

  useEffect(() => {
    if (investAsset === 'PLATFORM') {
      setInvestAsset('USDC')
    }
  }, [investAsset])

  useEffect(() => {
    let cancelled = false

    if (investAsset === 'USDC') {
      setQuoteError('')
      setQuotedUsdcOutBaseUnits(null)
      setSwapQuote(null)
      setIsQuotingSwapAsset(false)
      return
    }

    if (!env.BASE_SEPOLIA_SWAP_ROUTER) {
      setQuoteError('Swap router is not configured.')
      setQuotedUsdcOutBaseUnits(null)
      setSwapQuote(null)
      return
    }

    if (investAsset === 'PLATFORM' && !platformToken) {
      setQuoteError('Platform token is not configured.')
      setQuotedUsdcOutBaseUnits(null)
      setSwapQuote(null)
      return
    }

    if (!Number.isFinite(Number(amountEth)) || Number(amountEth) <= 0) {
      setQuoteError('')
      setQuotedUsdcOutBaseUnits(null)
      setSwapQuote(null)
      setIsQuotingSwapAsset(false)
      return
    }

    const quoteAssetToUsdc = async () => {
      try {
        setIsQuotingSwapAsset(true)
        setQuoteError('')
        const quote =
          investAsset === 'ETH'
            ? await fetchEthUsdcQuote({
                amountEth,
                slippagePercent,
                usdcAddress: (crowdfundUsdcAddress || BASE_SEPOLIA_USDC.address).toLowerCase(),
              })
            : await fetchAssetUsdcQuote({
                tokenInAddress: platformToken!.address,
                tokenInDecimals: platformToken!.decimals,
                amountIn: amountEth,
                slippagePercent,
                usdcAddress: (crowdfundUsdcAddress || BASE_SEPOLIA_USDC.address).toLowerCase(),
              })
        if (!cancelled) {
          setSwapQuote(quote)
          setQuotedUsdcOutBaseUnits(BigInt(quote.estimatedUsdcBaseUnits))
        }
      } catch (error) {
        if (!cancelled) {
          setSwapQuote(null)
          setQuotedUsdcOutBaseUnits(null)
          setQuoteError(error instanceof Error ? error.message : 'Unable to estimate USDC output')
        }
      } finally {
        if (!cancelled) {
          setIsQuotingSwapAsset(false)
        }
      }
    }

    const timer = setTimeout(() => {
      void quoteAssetToUsdc()
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [amountEth, crowdfundUsdcAddress, investAsset, platformToken, slippagePercent])

  const campaignRaisedBaseUnits = useMemo(
    () => BigInt(campaign?.raisedUsdcBaseUnits ?? '0'),
    [campaign?.raisedUsdcBaseUnits]
  )

  const campaignTargetBaseUnits = useMemo(
    () => BigInt(campaign?.targetUsdcBaseUnits ?? property?.targetUsdcBaseUnits ?? '0'),
    [campaign?.targetUsdcBaseUnits, property?.targetUsdcBaseUnits]
  )

  const fundingProgressPercent = useMemo(() => {
    if (campaignTargetBaseUnits <= 0n) return 0
    return Math.min(100, Number((campaignRaisedBaseUnits * 10_000n) / campaignTargetBaseUnits) / 100)
  }, [campaignRaisedBaseUnits, campaignTargetBaseUnits])

  const projectedRoiPercent = useMemo(() => {
    if (!property?.estimatedSellUsdcBaseUnits) return null
    const sell = Number(formatUnits(BigInt(property.estimatedSellUsdcBaseUnits), 6))
    const target = Number(formatUnits(BigInt(property.targetUsdcBaseUnits), 6))
    if (!Number.isFinite(sell) || !Number.isFinite(target) || target <= 0) return null
    return ((sell - target) / target) * 100
  }, [property?.estimatedSellUsdcBaseUnits, property?.targetUsdcBaseUnits])

  const galleryImages = useMemo(() => {
    if (!property) return []
    const images = [
      ...(property.imageUrl ? [property.imageUrl] : []),
      ...(Array.isArray(property.imageUrls) ? property.imageUrls : []),
    ].filter(isNonEmptyString)
    return Array.from(new Set(images))
  }, [property])

  const campaignState = campaign?.state ?? 'UNKNOWN'
  const campaignStartMs = campaign?.startTime ? Date.parse(campaign.startTime) : null
  const campaignEndMs = campaign?.endTime ? Date.parse(campaign.endTime) : null
  const hasCampaignStarted = campaignStartMs === null || Number.isNaN(campaignStartMs) || nowMs >= campaignStartMs
  const hasCampaignEnded = campaignEndMs !== null && !Number.isNaN(campaignEndMs) && nowMs >= campaignEndMs

  const campaignPhase: CampaignPhase = useMemo(() => {
    if (!campaign) return 'UNKNOWN'
    if (campaignState === CAMPAIGN_FAILED_STATE) return 'FAILED'
    if (!hasCampaignStarted) return 'NOT_STARTED'
    if (hasCampaignEnded) return 'ENDED'
    if (campaignState === CAMPAIGN_ACTIVE_STATE) return 'ACTIVE'
    return 'ENDED'
  }, [campaign, campaignState, hasCampaignEnded, hasCampaignStarted])

  const isTargetReached = useMemo(
    () => campaignTargetBaseUnits > 0n && campaignRaisedBaseUnits >= campaignTargetBaseUnits,
    [campaignRaisedBaseUnits, campaignTargetBaseUnits]
  )

  const canInvest = campaignPhase === 'ACTIVE' && !isTargetReached
  const canClaimRefund = campaignPhase === 'FAILED'
  const canClaimProfit = claimableProfitBaseUnits !== null && claimableProfitBaseUnits > 0n
  const canClaimEquity = claimableEquityBaseUnits !== null && claimableEquityBaseUnits > 0n
  const canSwapOnBaseSepolia = Boolean(env.BASE_SEPOLIA_SWAP_ROUTER)

  const claimProfitUnavailableMessage =
    claimableProfitBaseUnits === null ? 'Unable to read claimable profit right now.' : 'No claimable profit yet.'

  const claimEquityUnavailableMessage = claimableEquityError
    ? claimableEquityError
    : claimableEquityBaseUnits === null
      ? 'Unable to read claimable equity right now.'
      : 'No claimable equity yet.'

  const investUnavailableMessage = useMemo(() => {
    if (isTargetReached) {
      return 'Target reached. Campaign is awaiting/processing finalization and new investments are disabled.'
    }
    if (campaignPhase === 'NOT_STARTED') {
      return `Campaign not started. Countdown: ${campaignStartMs ? new Date(campaignStartMs).toLocaleString() : 'pending'}`
    }
    if (campaignPhase === 'FAILED') {
      return 'Campaign failed. New investments are closed; refunds are enabled.'
    }
    if (campaignPhase === 'ENDED') {
      return 'Campaign ended. New investments are closed.'
    }
    return 'Investments are currently unavailable.'
  }, [campaignPhase, campaignStartMs, isTargetReached])

  const normalizedAmount = useMemo(() => Number(amountUsdc), [amountUsdc])
  const normalizedEthAmount = useMemo(() => Number(amountEth), [amountEth])
  const normalizedSlippagePercent = useMemo(() => Number(slippagePercent), [slippagePercent])

  const swapFeeCandidates = useMemo(() => {
    const candidates = [env.BASE_SEPOLIA_SWAP_POOL_FEE, 500, 3000, 10000]
    return Array.from(new Set(candidates.filter((value) => Number.isInteger(value) && value > 0)))
  }, [])

  const slippageBps = useMemo(() => {
    if (!Number.isFinite(normalizedSlippagePercent)) return 100
    const clamped = Math.min(Math.max(normalizedSlippagePercent, 0), 50)
    return Math.round(clamped * 100)
  }, [normalizedSlippagePercent])

  const minUsdcOutBaseUnits = useMemo(() => {
    if (swapQuote?.minUsdcOutBaseUnits) {
      const quoted = BigInt(swapQuote.minUsdcOutBaseUnits)
      if (quoted > 0n) return quoted
    }
    if (!quotedUsdcOutBaseUnits || quotedUsdcOutBaseUnits <= 0n) return null
    const minOut = (quotedUsdcOutBaseUnits * BigInt(10_000 - slippageBps)) / 10_000n
    return minOut > 0n ? minOut : null
  }, [quotedUsdcOutBaseUnits, slippageBps, swapQuote?.minUsdcOutBaseUnits])

  const txInFlight = isInvesting || isClaimingEquity || isClaimingProfit || isClaimingRefund
  const txHashesInStatus = useMemo(() => extractTxHashes(txStatus), [txStatus])
  const gasSponsorshipAvailable = Boolean(env.BASE_SEPOLIA_PAYMASTER_URL)

  const ensureBaseSepolia = async (injected: EthereumProvider) => {
    try {
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      })
    } catch (error) {
      const code = (error as { code?: number })?.code
      if (code !== 4902) throw error

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
      })

      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      })
    }
  }

  const withSigner = async () => {
    const injected = getEthereumProvider()
    if (!injected) {
      throw new Error('No wallet provider found. Install a wallet extension.')
    }

    await ensureBaseSepolia(injected)
    await injected.request({ method: 'eth_requestAccounts' })
    const provider = new BrowserProvider(injected as never)
    return provider.getSigner()
  }

  const sendContractTransaction = async (
    signer: Awaited<ReturnType<BrowserProvider['getSigner']>>,
    contract: Contract,
    functionName: string,
    args: unknown[] = [],
    overrides: { value?: bigint } = {}
  ) => {
    const txData = contract.interface.encodeFunctionData(functionName, args)
    const data = builderDataSuffix ? concat([txData, builderDataSuffix]) : txData
    const to = typeof contract.target === 'string' ? contract.target : await contract.getAddress()
    return signer.sendTransaction({
      to,
      data,
      ...overrides,
    })
  }

  const handleInvestWithUsdc = async () => {
    setTxError('')
    setTxStatus('')

    if (!property) {
      setTxError('Property is not loaded yet.')
      return
    }

    if (!canInvest) {
      setTxError(investUnavailableMessage)
      return
    }

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setTxError('Enter a valid USDC amount greater than 0.')
      return
    }

    const injected = getEthereumProvider()
    if (!injected) {
      setTxError('No wallet provider found. Install a wallet extension.')
      return
    }

    setIsInvesting(true)
    try {
      await ensureBaseSepolia(injected)
      await injected.request({ method: 'eth_requestAccounts' })
      const provider = new BrowserProvider(injected as never)
      const signer = await provider.getSigner()

      const amountBaseUnits = parseUnits(amountUsdc, 6)
      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer)
      const requiredUsdcAddress = ((await crowdfund.usdcToken()) as string).toLowerCase()
      const usdc = new Contract(requiredUsdcAddress, ERC20_ABI, signer)
      const signerAddress = await signer.getAddress()

      const balance = (await usdc.balanceOf(signerAddress)) as bigint
      if (balance < amountBaseUnits) {
        throw new Error(
          `Insufficient USDC balance for this property token. Required ${formatUnits(amountBaseUnits, 6)} USDC, wallet has ${formatUnits(balance, 6)} USDC at token ${requiredUsdcAddress}.`
        )
      }

      const allowance = (await usdc.allowance(signerAddress, property.crowdfundAddress)) as bigint
      if (allowance < amountBaseUnits) {
        setTxStatus('Submitting USDC approval...')
        try {
          const approveTx = await sendContractTransaction(signer, usdc, 'approve', [property.crowdfundAddress, amountBaseUnits])
          await approveTx.wait()
        } catch {
          const resetTx = await sendContractTransaction(signer, usdc, 'approve', [property.crowdfundAddress, 0n])
          await resetTx.wait()
          const approveTx = await sendContractTransaction(signer, usdc, 'approve', [property.crowdfundAddress, amountBaseUnits])
          await approveTx.wait()
        }
      }

      setTxStatus('Submitting investment...')
      const investTx = await sendContractTransaction(signer, crowdfund, 'invest', [amountBaseUnits])
      await investTx.wait()

      setTxStatus(`Investment confirmed: ${investTx.hash}`)
      setCampaign((previous) => {
        if (!previous) return previous
        const currentRaised = BigInt(previous.raisedUsdcBaseUnits || '0')
        return {
          ...previous,
          raisedUsdcBaseUnits: (currentRaised + amountBaseUnits).toString(),
        }
      })
      emitPortfolioActivity({
        txHash: investTx.hash,
        propertyId: property.propertyId,
        campaignAddress: property.crowdfundAddress,
        amountUsdcBaseUnits: amountBaseUnits.toString(),
        type: 'invest',
        createdAt: new Date().toISOString(),
      })
      void fetchCampaign(property.crowdfundAddress)
        .then((liveCampaign) => setCampaign(liveCampaign))
        .catch(() => undefined)
      setAmountUsdc('')
    } catch (error) {
      setTxError(error instanceof Error ? error.message : 'Investment transaction failed')
    } finally {
      setIsInvesting(false)
    }
  }

  const handleInvestWithSwapAsset = async () => {
    setTxError('')
    setTxStatus('')

    if (!property) {
      setTxError('Property is not loaded yet.')
      return
    }
    if (!canInvest) {
      setTxError(investUnavailableMessage)
      return
    }
    if (!canSwapOnBaseSepolia) {
      setTxError('Swap investment is not configured. Set VITE_BASE_SEPOLIA_SWAP_ROUTER.')
      return
    }
    if (!Number.isFinite(normalizedEthAmount) || normalizedEthAmount <= 0) {
      setTxError(`Enter a valid ${investAsset === 'ETH' ? 'ETH' : platformToken?.symbol || 'token'} amount greater than 0.`)
      return
    }
    if (!minUsdcOutBaseUnits || minUsdcOutBaseUnits <= 0n) {
      setTxError('Unable to derive minimum USDC out from quote. Wait for live quote and retry.')
      return
    }
    if (!swapQuote) {
      setTxError('Missing live quote for swap investment. Wait for quote and retry.')
      return
    }
    if (investAsset === 'PLATFORM' && !platformToken) {
      setTxError('Platform token is not configured.')
      return
    }

    const injected = getEthereumProvider()
    if (!injected) {
      setTxError('No wallet provider found. Install a wallet extension.')
      return
    }

    setIsInvesting(true)
    try {
      await ensureBaseSepolia(injected)
      await injected.request({ method: 'eth_requestAccounts' })
      const provider = new BrowserProvider(injected as never)
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()

      const inputDecimals = investAsset === 'ETH' ? 18 : platformToken!.decimals
      const inputAmountBaseUnits = parseUnits(amountEth, inputDecimals)
      const quotedAmountInBaseUnits = BigInt(
        'amountInBaseUnits' in swapQuote ? swapQuote.amountInBaseUnits : swapQuote.amountInWei
      )
      if (quotedAmountInBaseUnits !== inputAmountBaseUnits) {
        throw new Error('Quote is stale for current amount. Wait for refreshed quote and retry.')
      }

      if (investAsset === 'ETH') {
        const nativeBalanceWei = await provider.getBalance(signerAddress)
        if (inputAmountBaseUnits > nativeBalanceWei) {
          throw new Error(
            `Insufficient ETH balance for swap input. Requested ${formatUnits(inputAmountBaseUnits, 18)} ETH but wallet has ${formatUnits(nativeBalanceWei, 18)} ETH.`
          )
        }
      }

      const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer)
      const requiredUsdcAddress = ((await crowdfund.usdcToken()) as string).toLowerCase()
      if (swapQuote.usdcAddress.toLowerCase() !== requiredUsdcAddress) {
        throw new Error(
          `Quote token mismatch. Quote used ${swapQuote.usdcAddress}, but crowdfund requires ${requiredUsdcAddress}.`
        )
      }

      const usdc = new Contract(requiredUsdcAddress, ERC20_ABI, signer)
      const weth = new Contract(env.BASE_SEPOLIA_WETH, WETH_ABI, signer)
      const swapRouter = new Contract(env.BASE_SEPOLIA_SWAP_ROUTER, SWAP_ROUTER_ABI, signer)

      const usdcBefore = BigInt(await usdc.balanceOf(signerAddress))
      const deadline = Math.floor(Date.now() / 1000) + 20 * 60
      const executionFeeTiers = Array.from(new Set([swapQuote.feeTier, ...swapFeeCandidates]))
      const tokenInAddress = investAsset === 'ETH' ? env.BASE_SEPOLIA_WETH : platformToken!.address
      const inputSymbol = investAsset === 'ETH' ? 'ETH' : platformToken!.symbol

      let swapSucceeded = false
      let lastNativeSwapError: unknown = null
      let lastWrappedSwapError: unknown = null

      if (investAsset === 'ETH') {
        for (const feeTier of executionFeeTiers) {
          try {
            setTxStatus(`Swapping ETH -> USDC (native route, fee tier ${feeTier})...`)
            try {
              const tx = await sendContractTransaction(
                signer,
                swapRouter,
                'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
                [
                  {
                    tokenIn: tokenInAddress,
                    tokenOut: requiredUsdcAddress,
                    fee: feeTier,
                    recipient: signerAddress,
                    amountIn: inputAmountBaseUnits,
                    amountOutMinimum: minUsdcOutBaseUnits,
                    sqrtPriceLimitX96: 0,
                  },
                ]
                ,
                { value: inputAmountBaseUnits }
              )
              await tx.wait()
            } catch {
              const tx = await sendContractTransaction(
                signer,
                swapRouter,
                'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
                [
                  {
                    tokenIn: tokenInAddress,
                    tokenOut: requiredUsdcAddress,
                    fee: feeTier,
                    recipient: signerAddress,
                    deadline,
                    amountIn: inputAmountBaseUnits,
                    amountOutMinimum: minUsdcOutBaseUnits,
                    sqrtPriceLimitX96: 0,
                  },
                ]
                ,
                { value: inputAmountBaseUnits }
              )
              await tx.wait()
            }
            swapSucceeded = true
            break
          } catch (error) {
            lastNativeSwapError = error
          }
        }
        if (!swapSucceeded) {
          setTxStatus('Native swap route failed. Wrapping ETH to WETH...')
          try {
            const wrapTx = await sendContractTransaction(signer, weth, 'deposit', [], { value: inputAmountBaseUnits })
            await wrapTx.wait()
          } catch (depositError) {
            try {
              const wrapViaReceiveTx = await signer.sendTransaction({ to: env.BASE_SEPOLIA_WETH, value: inputAmountBaseUnits })
              await wrapViaReceiveTx.wait()
            } catch (receiveWrapError) {
              throw new Error(
                `Native swap route failed: ${
                  lastNativeSwapError instanceof Error ? lastNativeSwapError.message : String(lastNativeSwapError)
                }. WETH wrap failed. deposit() error: ${
                  depositError instanceof Error ? depositError.message : String(depositError)
                }. receive() error: ${
                  receiveWrapError instanceof Error ? receiveWrapError.message : String(receiveWrapError)
                }`
              )
            }
          }

          setTxStatus('Approving router for wrapped swap...')
          const approveRouterTx = await sendContractTransaction(signer, weth, 'approve', [env.BASE_SEPOLIA_SWAP_ROUTER, inputAmountBaseUnits])
          await approveRouterTx.wait()

          for (const feeTier of executionFeeTiers) {
            try {
              setTxStatus(`Swapping ETH -> USDC (wrapped route, fee tier ${feeTier})...`)
              try {
                const tx = await sendContractTransaction(
                  signer,
                  swapRouter,
                  'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
                  [
                    {
                      tokenIn: tokenInAddress,
                      tokenOut: requiredUsdcAddress,
                      fee: feeTier,
                      recipient: signerAddress,
                      amountIn: inputAmountBaseUnits,
                      amountOutMinimum: minUsdcOutBaseUnits,
                      sqrtPriceLimitX96: 0,
                    },
                  ]
                )
                await tx.wait()
              } catch {
                const tx = await sendContractTransaction(
                  signer,
                  swapRouter,
                  'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
                  [
                    {
                      tokenIn: tokenInAddress,
                      tokenOut: requiredUsdcAddress,
                      fee: feeTier,
                      recipient: signerAddress,
                      deadline,
                      amountIn: inputAmountBaseUnits,
                      amountOutMinimum: minUsdcOutBaseUnits,
                      sqrtPriceLimitX96: 0,
                    },
                  ]
                )
                await tx.wait()
              }
              swapSucceeded = true
              break
            } catch (error) {
              lastWrappedSwapError = error
            }
          }
        }
      } else {
        const inputToken = new Contract(tokenInAddress, ERC20_ABI, signer)
        const balance = BigInt(await inputToken.balanceOf(signerAddress))
        if (balance < inputAmountBaseUnits) {
          throw new Error(
            `Insufficient ${inputSymbol} balance for swap input. Requested ${formatUnits(inputAmountBaseUnits, inputDecimals)} ${inputSymbol} but wallet has ${formatUnits(balance, inputDecimals)} ${inputSymbol}.`
          )
        }
        const allowance = BigInt(await inputToken.allowance(signerAddress, env.BASE_SEPOLIA_SWAP_ROUTER))
        if (allowance < inputAmountBaseUnits) {
          setTxStatus(`Approving router for ${inputSymbol} swap...`)
          const approveRouterTx = await sendContractTransaction(
            signer,
            inputToken,
            'approve',
            [env.BASE_SEPOLIA_SWAP_ROUTER, inputAmountBaseUnits]
          )
          await approveRouterTx.wait()
        }
        for (const feeTier of executionFeeTiers) {
          try {
            setTxStatus(`Swapping ${inputSymbol} -> USDC (fee tier ${feeTier})...`)
            try {
              const tx = await sendContractTransaction(
                signer,
                swapRouter,
                'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
                [
                  {
                    tokenIn: tokenInAddress,
                    tokenOut: requiredUsdcAddress,
                    fee: feeTier,
                    recipient: signerAddress,
                    amountIn: inputAmountBaseUnits,
                    amountOutMinimum: minUsdcOutBaseUnits,
                    sqrtPriceLimitX96: 0,
                  },
                ]
              )
              await tx.wait()
            } catch {
              const tx = await sendContractTransaction(
                signer,
                swapRouter,
                'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
                [
                  {
                    tokenIn: tokenInAddress,
                    tokenOut: requiredUsdcAddress,
                    fee: feeTier,
                    recipient: signerAddress,
                    deadline,
                    amountIn: inputAmountBaseUnits,
                    amountOutMinimum: minUsdcOutBaseUnits,
                    sqrtPriceLimitX96: 0,
                  },
                ]
              )
              await tx.wait()
            }
            swapSucceeded = true
            break
          } catch (error) {
            lastWrappedSwapError = error
          }
        }
      }

      if (!swapSucceeded) {
        throw new Error(
          `${inputSymbol}->USDC swap failed on fee tiers ${swapFeeCandidates.join(', ')}. Native route error: ${
            lastNativeSwapError instanceof Error ? lastNativeSwapError.message : String(lastNativeSwapError)
          }. Secondary route error: ${
            lastWrappedSwapError instanceof Error ? lastWrappedSwapError.message : String(lastWrappedSwapError)
          }.`
        )
      }

      const usdcAfter = BigInt(await usdc.balanceOf(signerAddress))
      const receivedUsdc = usdcAfter - usdcBefore
      if (receivedUsdc <= 0n) {
        throw new Error('Swap returned 0 USDC.')
      }

      setTxStatus('Approving USDC for investment...')
      const approveTx = await sendContractTransaction(signer, usdc, 'approve', [property.crowdfundAddress, receivedUsdc])
      await approveTx.wait()

      setTxStatus('Submitting investment with swapped USDC...')
      const investTx = await sendContractTransaction(signer, crowdfund, 'invest', [receivedUsdc])
      await investTx.wait()

      setTxStatus(`${inputSymbol} swap + investment confirmed: ${investTx.hash}`)
      setCampaign((previous) => {
        if (!previous) return previous
        const currentRaised = BigInt(previous.raisedUsdcBaseUnits || '0')
        return {
          ...previous,
          raisedUsdcBaseUnits: (currentRaised + receivedUsdc).toString(),
        }
      })
      emitPortfolioActivity({
        txHash: investTx.hash,
        propertyId: property.propertyId,
        campaignAddress: property.crowdfundAddress,
        amountUsdcBaseUnits: receivedUsdc.toString(),
        type: 'invest',
        createdAt: new Date().toISOString(),
      })
      void fetchCampaign(property.crowdfundAddress)
        .then((liveCampaign) => setCampaign(liveCampaign))
        .catch(() => undefined)

      setAmountEth('')
      setSwapQuote(null)
      setQuotedUsdcOutBaseUnits(null)
    } catch (error) {
      setTxError(error instanceof Error ? error.message : 'Swap and investment transaction failed')
    } finally {
      setIsInvesting(false)
    }
  }

  const handleInvest = async () => {
    if (investAsset !== 'USDC') {
      await handleInvestWithSwapAsset()
      return
    }
    await handleInvestWithUsdc()
  }

  const handleClaimEquity = async () => {
    setTxError('')
    setTxStatus('')

    if (!property) {
      setTxError('Property is not loaded yet.')
      return
    }
    if (!canClaimEquity) {
      setTxError(claimEquityUnavailableMessage)
      return
    }

    setIsClaimingEquity(true)
    try {
      let txHash: string | null = null
      const injected = getEthereumProvider()
      const paymasterUrl = getBasePaymasterUrl(84532)

      if (injected && connectedAddress) {
        await ensureBaseSepolia(injected)
        await injected.request({ method: 'eth_requestAccounts' })
        const txData = new Contract(property.crowdfundAddress, CROWDFUND_ABI).interface.encodeFunctionData('claimTokens')
        const data = (builderDataSuffix ? concat([txData, builderDataSuffix]) : txData) as `0x${string}`
        setTxStatus('Requesting gas-sponsored equity claim...')
        const sponsored = await trySendSponsoredCall({
          walletProvider: injected,
          from: connectedAddress,
          chainId: 84532,
          call: {
            to: property.crowdfundAddress,
            data,
          },
          paymasterUrl,
        })
        txHash = sponsored?.txHash || null
      }

      if (!txHash) {
        const signer = await withSigner()
        const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer)
        setTxStatus('Submitting equity claim...')
        const tx = await sendContractTransaction(signer, crowdfund, 'claimTokens')
        await tx.wait()
        txHash = tx.hash
      }
      if (!txHash) {
        throw new Error('Equity claim transaction hash unavailable')
      }

      setTxStatus(`Equity claim confirmed: ${txHash}`)
      emitPortfolioActivity({
        txHash,
        propertyId: property.propertyId,
        type: 'claim-equity',
      })
      await fetchPropertyEquityClaims(property.propertyId)
    } catch (error) {
      setTxError(error instanceof Error ? error.message : 'Failed to claim equity')
    } finally {
      setIsClaimingEquity(false)
    }
  }

  const handleClaimProfit = async () => {
    setTxError('')
    setTxStatus('')

    if (!property) {
      setTxError('Property is not loaded yet.')
      return
    }
    if (!canClaimProfit) {
      setTxError(claimProfitUnavailableMessage)
      return
    }

    setIsClaimingProfit(true)
    try {
      let txHash: string | null = null
      const injected = getEthereumProvider()
      const paymasterUrl = getBasePaymasterUrl(84532)

      if (injected && connectedAddress) {
        await ensureBaseSepolia(injected)
        await injected.request({ method: 'eth_requestAccounts' })
        const txData = new Contract(
          property.profitDistributorAddress,
          PROFIT_DISTRIBUTOR_ABI
        ).interface.encodeFunctionData('claim')
        const data = (builderDataSuffix ? concat([txData, builderDataSuffix]) : txData) as `0x${string}`
        setTxStatus('Requesting gas-sponsored profit claim...')
        const sponsored = await trySendSponsoredCall({
          walletProvider: injected,
          from: connectedAddress,
          chainId: 84532,
          call: {
            to: property.profitDistributorAddress,
            data,
          },
          paymasterUrl,
        })
        txHash = sponsored?.txHash || null
      }

      if (!txHash) {
        const signer = await withSigner()
        const distributor = new Contract(property.profitDistributorAddress, PROFIT_DISTRIBUTOR_ABI, signer)
        setTxStatus('Submitting profit claim...')
        const tx = await sendContractTransaction(signer, distributor, 'claim')
        await tx.wait()
        txHash = tx.hash
      }
      if (!txHash) {
        throw new Error('Profit claim transaction hash unavailable')
      }

      setTxStatus(`Profit claim confirmed: ${txHash}`)
      setClaimableProfitBaseUnits(0n)
      emitPortfolioActivity({
        txHash,
        propertyId: property.propertyId,
        type: 'claim-profit',
      })
      await fetchPropertyProfitClaims(property.propertyId)
    } catch (error) {
      setTxError(error instanceof Error ? error.message : 'Failed to claim profit')
    } finally {
      setIsClaimingProfit(false)
    }
  }

  const handleClaimRefund = async () => {
    setTxError('')
    setTxStatus('')

    if (!property) {
      setTxError('Property is not loaded yet.')
      return
    }
    if (!canClaimRefund) {
      setTxError('Refunds are not available for this campaign.')
      return
    }

    setIsClaimingRefund(true)
    try {
      let txHash: string | null = null
      const injected = getEthereumProvider()
      const paymasterUrl = getBasePaymasterUrl(84532)

      if (injected && connectedAddress) {
        await ensureBaseSepolia(injected)
        await injected.request({ method: 'eth_requestAccounts' })
        const txData = new Contract(property.crowdfundAddress, CROWDFUND_ABI).interface.encodeFunctionData('claimRefund')
        const data = (builderDataSuffix ? concat([txData, builderDataSuffix]) : txData) as `0x${string}`
        setTxStatus('Requesting gas-sponsored refund claim...')
        const sponsored = await trySendSponsoredCall({
          walletProvider: injected,
          from: connectedAddress,
          chainId: 84532,
          call: {
            to: property.crowdfundAddress,
            data,
          },
          paymasterUrl,
        })
        txHash = sponsored?.txHash || null
      }

      if (!txHash) {
        const signer = await withSigner()
        const crowdfund = new Contract(property.crowdfundAddress, CROWDFUND_ABI, signer)
        setTxStatus('Submitting refund claim...')
        const tx = await sendContractTransaction(signer, crowdfund, 'claimRefund')
        await tx.wait()
        txHash = tx.hash
      }
      if (!txHash) {
        throw new Error('Refund transaction hash unavailable')
      }

      setTxStatus(`Refund confirmed: ${txHash}`)
      emitPortfolioActivity({
        txHash,
        propertyId: property.propertyId,
        type: 'claim-refund',
      })
    } catch (error) {
      setTxError(error instanceof Error ? error.message : 'Failed to claim refund')
    } finally {
      setIsClaimingRefund(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-transparent px-6 py-10 text-slate-300">Loading property details...</div>
  }

  if (errorMessage || !property) {
    return <div className="min-h-screen bg-transparent px-6 py-10 text-red-300">{errorMessage || 'Property not found.'}</div>
  }

  return (
    <PropertyPremiumLayout
      property={property}
      campaignRaisedBaseUnits={campaignRaisedBaseUnits}
      campaignTargetBaseUnits={campaignTargetBaseUnits}
      fundingProgressPercent={fundingProgressPercent}
      projectedRoiPercent={projectedRoiPercent}
      galleryImages={galleryImages}
      selectedGalleryImage={selectedGalleryImage}
      setSelectedGalleryImage={setSelectedGalleryImage}
      handleInvest={handleInvest}
      handleClaimEquity={handleClaimEquity}
      handleClaimProfit={handleClaimProfit}
      handleClaimRefund={handleClaimRefund}
      amountUsdc={amountUsdc}
      setAmountUsdc={setAmountUsdc}
      amountEth={amountEth}
      setAmountEth={setAmountEth}
      investAsset={investAsset}
      setInvestAsset={setInvestAsset}
      slippagePercent={slippagePercent}
      setSlippagePercent={setSlippagePercent}
      txStatus={txStatus}
      txHashesInStatus={txHashesInStatus}
      txError={txError}
      quoteError={quoteError}
      quotedUsdcOutBaseUnits={quotedUsdcOutBaseUnits}
      minUsdcOutBaseUnits={minUsdcOutBaseUnits}
      isQuotingSwapAsset={isQuotingSwapAsset}
      txInFlight={txInFlight}
      walletAvailable={walletAvailable}
      canSwapOnBaseSepolia={canSwapOnBaseSepolia}
      gasSponsorshipAvailable={gasSponsorshipAvailable}
      platformTokenSymbol={platformToken?.symbol || 'BRICKT'}
      canInvest={canInvest}
      canClaimEquity={canClaimEquity}
      canClaimProfit={canClaimProfit}
      canClaimRefund={canClaimRefund}
      claimableProfitBaseUnits={claimableProfitBaseUnits}
      claimableEquityBaseUnits={claimableEquityBaseUnits}
      claimProfitUnavailableMessage={claimProfitUnavailableMessage}
      claimEquityUnavailableMessage={claimEquityUnavailableMessage}
      investUnavailableMessage={investUnavailableMessage}
      formatUsdcUnits={formatUsdcUnits}
      agentChatToken={token}
      propertyId={property.propertyId}
      campaignAddress={property.crowdfundAddress}
    />
  )
}
