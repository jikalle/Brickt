import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCampaigns, fetchProperties, PropertyResponse, CampaignResponse } from '../lib/api';

// Inline SVG Icons
const SearchIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const ChevronRight = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const Clock = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const TrendingUp = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
  </svg>
);

const formatCountdown = (startTimeIso: string, nowMs: number): string | null => {
  const startMs = Date.parse(startTimeIso);
  if (Number.isNaN(startMs) || startMs <= nowMs) {
    return null;
  }
  const remaining = Math.floor((startMs - nowMs) / 1000);
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
};

const toUsdcNumber = (baseUnits: string | null | undefined): number =>
  Number(baseUnits ?? '0') / 1_000_000;
const formatBestFor = (bestFor: string | null | undefined): string | null => {
  if (!bestFor) return null;
  const normalized = bestFor.split('_').join(' ');
  return `Best for: ${normalized.replace(/\b\w/g, (char: string) => char.toUpperCase())}`;
};

const COMPLETED_STAMP_LABEL = 'Profit Shared';

type PropertyFundingPhase = 'NOT_STARTED' | 'ACTIVE' | 'FUNDED' | 'FAILED' | 'ENDED' | 'UNKNOWN';

const getPropertyFundingPhase = (
  campaign: CampaignResponse | undefined,
  nowMs: number
): PropertyFundingPhase => {
  if (!campaign) return 'NOT_STARTED';
  if (campaign.state === 'FAILED') return 'FAILED';
  if (campaign.state === 'SUCCESS') return 'FUNDED';
  if (campaign.state === 'WITHDRAWN') return 'ENDED';
  const startMs = campaign.startTime ? Date.parse(campaign.startTime) : Number.NaN;
  const endMs = campaign.endTime ? Date.parse(campaign.endTime) : Number.NaN;
  if (!Number.isNaN(startMs) && startMs > nowMs) return 'NOT_STARTED';
  if (!Number.isNaN(endMs) && endMs <= nowMs) return 'ENDED';
  return campaign.state === 'ACTIVE' ? 'ACTIVE' : 'UNKNOWN';
};

export default function Properties() {
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [campaignByPropertyId, setCampaignByPropertyId] = useState<Record<string, CampaignResponse>>({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedBestFor, setSelectedBestFor] = useState('all');

  useEffect(() => {
    let isMounted = true;

    const loadProperties = async (showLoading = false) => {
      if (showLoading && isMounted) {
        setLoading(true);
      }
      try {
        const [propertiesData, campaignsData] = await Promise.all([fetchProperties(), fetchCampaigns()]);
        const campaignMap = campaignsData.reduce<Record<string, CampaignResponse>>((acc, campaign) => {
          acc[campaign.propertyId] = campaign;
          return acc;
        }, {});
        if (isMounted) {
          setProperties(propertiesData);
          setCampaignByPropertyId(campaignMap);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage((error as Error).message);
        }
      } finally {
        if (showLoading && isMounted) {
          setLoading(false);
        }
      }
    };

    void loadProperties(true);
    const poll = setInterval(() => {
      void loadProperties(false);
    }, 10000);

    return () => {
      isMounted = false;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredProperties = properties.filter((property) => {
    const campaign = campaignByPropertyId[property.propertyId];
    const phase = getPropertyFundingPhase(campaign, nowMs);
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      property.name.toLowerCase().includes(query) ||
      property.propertyId.toLowerCase().includes(query) ||
      property.location.toLowerCase().includes(query) ||
      property.description.toLowerCase().includes(query);
    const matchesStatus = selectedStatus === 'all' || phase.toLowerCase() === selectedStatus.toLowerCase();
    const matchesBestFor = selectedBestFor === 'all' || property.bestFor === selectedBestFor;
    return matchesSearch && matchesStatus && matchesBestFor;
  });

  const statusCounts = useMemo(() => {
    const counts = {
      all: 0,
      not_started: 0,
      active: 0,
      funded: 0,
      failed: 0,
      ended: 0,
    };
    for (const property of properties) {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        query.length === 0 ||
        property.name.toLowerCase().includes(query) ||
        property.propertyId.toLowerCase().includes(query) ||
        property.location.toLowerCase().includes(query) ||
        property.description.toLowerCase().includes(query);
      const matchesBestFor = selectedBestFor === 'all' || property.bestFor === selectedBestFor;
      if (!matchesSearch || !matchesBestFor) continue;
      const phase = getPropertyFundingPhase(campaignByPropertyId[property.propertyId], nowMs).toLowerCase();
      counts.all += 1;
      if (phase === 'not_started') counts.not_started += 1;
      else if (phase === 'active') counts.active += 1;
      else if (phase === 'funded') counts.funded += 1;
      else if (phase === 'failed') counts.failed += 1;
      else if (phase === 'ended') counts.ended += 1;
    }
    return counts;
  }, [properties, campaignByPropertyId, nowMs, searchQuery, selectedBestFor]);

  return (
    <div className="overflow-hidden min-h-screen">
      <div>
        <div className="container mx-auto px-4 py-12 md:py-16">
          {/* Header */}
          <div className="mb-12">
            <div className="space-y-3 mb-8">
              <h1 className="text-5xl md:text-6xl font-light tracking-tight text-white">
                Property Listings
              </h1>
              <p className="text-lg text-slate-300 max-w-2xl">
                Discover active and upcoming investment opportunities in real estate. Browse properties, view details, and invest directly onchain.
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-12 rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Best For Filter */}
              <div className="space-y-2">
                <label className="text-xs font-semibold tracking-widest text-slate-400 uppercase">Best For</label>
                <select
                  value={selectedBestFor}
                  onChange={(e) => setSelectedBestFor(e.target.value)}
                  className="w-full rounded-lg bg-slate-800/50 border border-slate-700 text-white px-4 py-3 focus:outline-none focus:border-emerald-500/50 transition"
                >
                  <option value="all">All Strategies</option>
                  <option value="sell">Best for: Sell</option>
                  <option value="rent">Best for: Rent</option>
                  <option value="build_and_sell">Best for: Build and Sell</option>
                  <option value="build_and_rent">Best for: Build and Rent</option>
                </select>
              </div>

              {/* Search */}
              <div className="space-y-2">
                <label className="text-xs font-semibold tracking-widest text-slate-400 uppercase">Search</label>
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search name, ID, location..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg bg-slate-800/50 border border-slate-700 text-white px-4 py-3 pl-10 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 transition"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <label className="text-xs font-semibold tracking-widest text-slate-400 uppercase">Status</label>
                <select 
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="w-full rounded-lg bg-slate-800/50 border border-slate-700 text-white px-4 py-3 focus:outline-none focus:border-emerald-500/50 transition"
                >
                  <option value="all">All Status</option>
                  <option value="not_started">Upcoming</option>
                  <option value="active">Live Funding</option>
                  <option value="funded">Funded</option>
                  <option value="failed">Failed</option>
                  <option value="ended">Closed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Status Counts */}
          <div className="mb-8 flex flex-wrap items-center gap-2">
            {[
              { key: 'all', label: 'All', value: statusCounts.all },
              { key: 'not_started', label: 'Upcoming', value: statusCounts.not_started },
              { key: 'active', label: 'Live', value: statusCounts.active },
              { key: 'funded', label: 'Funded', value: statusCounts.funded },
              { key: 'failed', label: 'Failed', value: statusCounts.failed },
              { key: 'ended', label: 'Closed', value: statusCounts.ended },
            ].map((item) => {
              const active = selectedStatus === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedStatus(item.key)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                    active
                      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-600/70 bg-slate-900/60 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px]">{item.value}</span>
                </button>
              );
            })}
          </div>

          {/* Error State */}
          {errorMessage && (
            <div className="mb-8 rounded-xl bg-red-500/10 border border-red-500/30 px-6 py-4 flex gap-3">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex-shrink-0 flex items-center justify-center mt-0.5">
                <span className="text-red-400 text-xs font-bold">!</span>
              </div>
              <p className="text-red-200 text-sm">{errorMessage}</p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full border-2 border-slate-700 border-t-emerald-500 animate-spin mx-auto mb-4" />
                <p className="text-slate-400">Loading properties...</p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!loading && !errorMessage && filteredProperties.length === 0 && (
            <div className="rounded-2xl bg-slate-900/80 backdrop-blur border border-slate-700/50 p-12 text-center">
              <p className="text-slate-400 text-lg">
                {properties.length === 0 ? 'No properties available yet.' : 'No properties match your filters.'}
              </p>
            </div>
          )}

          {/* Properties Grid */}
          {!loading && (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredProperties.map((property) => {
                const campaign = campaignByPropertyId[property.propertyId];
                const targetUsdc = toUsdcNumber(campaign?.targetUsdcBaseUnits ?? property.targetUsdcBaseUnits);
                const raisedUsdc = toUsdcNumber(campaign?.raisedUsdcBaseUnits);
                const fundingPercent =
                  targetUsdc > 0 ? Math.max(0, Math.min(100, (raisedUsdc / targetUsdc) * 100)) : 0;
                const fundingPhase = getPropertyFundingPhase(campaign, nowMs);
                const countdown =
                  fundingPhase === 'NOT_STARTED' && campaign?.startTime
                    ? formatCountdown(campaign.startTime, nowMs)
                    : null;
                const showCompletionStamp = property.profitDistributed && fundingPhase === 'ENDED';

                return (
                  <div
                    key={property.propertyId}
                    className="group relative rounded-2xl overflow-hidden bg-slate-900/80 backdrop-blur border border-slate-700/50 transition-all duration-300 hover:border-emerald-500/50 hover:shadow-2xl hover:shadow-emerald-500/10"
                  >
                    {/* Image Container */}
                    <div className="relative h-48 overflow-hidden bg-slate-800">
                      {property.imageUrl || property.imageUrls?.[0] ? (
                        <img
                          src={property.imageUrl || property.imageUrls?.[0]}
                          alt={property.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                          <div className="text-center">
                            <div className="w-12 h-12 rounded-lg bg-slate-700/50 flex items-center justify-center mx-auto mb-2">
                              <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <p className="text-slate-500 text-sm">No image available</p>
                          </div>
                        </div>
                      )}

                      {/* Countdown Badge */}
                      {countdown && (
                        <div className="absolute top-3 right-3">
                          <div className="flex items-center gap-2 bg-gradient-to-r from-blue-500/20 to-emerald-500/20 backdrop-blur border border-emerald-500/30 rounded-full px-4 py-2">
                            <Clock className="w-4 h-4 text-emerald-400" />
                            <span className="text-xs font-semibold text-emerald-300">{countdown}</span>
                          </div>
                        </div>
                      )}

                      {/* Status Badge */}
                      <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                        {campaign ? (
                          <div className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 border border-blue-500/30 text-blue-300">
                            {fundingPhase}
                          </div>
                        ) : null}
                        {showCompletionStamp ? (
                          <div className="rounded-full border border-emerald-300/40 bg-emerald-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">
                            {COMPLETED_STAMP_LABEL}
                          </div>
                        ) : null}
                      </div>

                      {showCompletionStamp ? (
                        <div className="pointer-events-none absolute -right-20 top-8 rotate-[24deg]">
                          <div className="border border-emerald-100/70 bg-emerald-300/88 px-20 py-2.5 text-xs font-black uppercase tracking-[0.34em] text-slate-950 shadow-[0_14px_40px_rgba(16,185,129,0.35)]">
                            {COMPLETED_STAMP_LABEL}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-4">
                      <div>
                        <h3 className="text-lg font-semibold text-white mb-2 line-clamp-2">
                          {property.name}
                        </h3>
                        <p className="text-slate-400 text-sm line-clamp-2">
                          {property.description}
                        </p>
                        {formatBestFor(property.bestFor) && (
                          <div className="mt-3">
                            <span className="inline-flex rounded-full border border-cyan-500/40 bg-cyan-500 px-2.5 py-1 text-[11px] font-medium text-gray-800">
                              {formatBestFor(property.bestFor)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Stats */}
                      <div className="space-y-2 py-4 border-t border-slate-700/50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Target</span>
                          <span className="text-sm font-semibold text-white">
                            ${targetUsdc.toLocaleString()} USDC
                          </span>
                        </div>
                        
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-slate-500">Funding Progress</span>
                            <span className="text-slate-300">{fundingPercent.toFixed(1)}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                              style={{ width: `${fundingPercent}%` }}
                            />
                          </div>
                        </div>

                        {property.estimatedSellUsdcBaseUnits && (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-500">Est. Sell Price</span>
                              <span className="text-sm font-semibold text-white">
                                ${(Number(property.estimatedSellUsdcBaseUnits) / 1_000_000).toLocaleString()} USDC
                              </span>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                              <span className="text-xs text-slate-500">Projected Upside</span>
                              <div className="flex items-center gap-1">
                                <TrendingUp className="w-4 h-4 text-emerald-400" />
                                <span className="text-sm font-semibold text-emerald-400">
                                  {(
                                    ((Number(property.estimatedSellUsdcBaseUnits) -
                                      Number(property.targetUsdcBaseUnits)) /
                                      Number(property.targetUsdcBaseUnits || '1')) *
                                    100
                                  ).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                  %
                                </span>
                              </div>
                            </div>
                          </>
                        )}

                      </div>

                      {/* CTA */}
                      <Link
                        to={`/properties/${property.propertyId}`}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:shadow-lg hover:shadow-emerald-500/20 transition-all group/btn"
                      >
                        View Details
                        <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Animation Styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
}
