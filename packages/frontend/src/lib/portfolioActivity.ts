const PORTFOLIO_ACTIVITY_EVENT = 'homeshare:portfolio-activity';

export type PortfolioActivityType =
  | 'invest'
  | 'claim-equity'
  | 'claim-profit'
  | 'claim-refund';

export type PortfolioActivityPayload = {
  txHash: string;
  propertyId: string;
  type: PortfolioActivityType;
  amountUsdcBaseUnits?: string;
  campaignAddress?: string;
  investorAddress?: string;
  createdAt?: string;
  timestamp?: number;
};

export const emitPortfolioActivity = (payload: PortfolioActivityPayload): void => {
  const eventPayload: PortfolioActivityPayload = {
    ...payload,
    timestamp: payload.timestamp ?? Date.now(),
  };

  window.dispatchEvent(
    new CustomEvent<PortfolioActivityPayload>(PORTFOLIO_ACTIVITY_EVENT, {
      detail: eventPayload,
    })
  );
};

export const subscribePortfolioActivity = (
  onActivity: (payload: PortfolioActivityPayload) => void
): (() => void) => {
  const onCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<PortfolioActivityPayload>;
    const payload = customEvent.detail;
    if (payload?.txHash && payload?.propertyId && payload?.type) {
      onActivity(payload);
    }
  };

  window.addEventListener(PORTFOLIO_ACTIVITY_EVENT, onCustomEvent);
  return () => {
    window.removeEventListener(PORTFOLIO_ACTIVITY_EVENT, onCustomEvent);
  };
};
