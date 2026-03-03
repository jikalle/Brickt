export const PORTFOLIO_ACTIVITY_KEY = 'homeshare:portfolio:activity';
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
  timestamp?: number;
};

const parsePayload = (raw: string | null): PortfolioActivityPayload | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PortfolioActivityPayload;
    if (!parsed?.txHash || !parsed?.propertyId || !parsed?.type) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const emitPortfolioActivity = (payload: PortfolioActivityPayload): void => {
  const eventPayload: PortfolioActivityPayload = {
    ...payload,
    timestamp: payload.timestamp ?? Date.now(),
  };

  try {
    localStorage.setItem(PORTFOLIO_ACTIVITY_KEY, JSON.stringify(eventPayload));
  } catch {
    // Ignore storage failures and still notify same-tab listeners.
  }

  window.dispatchEvent(
    new CustomEvent<PortfolioActivityPayload>(PORTFOLIO_ACTIVITY_EVENT, {
      detail: eventPayload,
    })
  );
};

export const subscribePortfolioActivity = (
  onActivity: (payload: PortfolioActivityPayload) => void
): (() => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PORTFOLIO_ACTIVITY_KEY) {
      return;
    }
    const payload = parsePayload(event.newValue);
    if (payload) {
      onActivity(payload);
    }
  };

  const onCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<PortfolioActivityPayload>;
    const payload = customEvent.detail;
    if (payload?.txHash && payload?.propertyId && payload?.type) {
      onActivity(payload);
    }
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(PORTFOLIO_ACTIVITY_EVENT, onCustomEvent);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PORTFOLIO_ACTIVITY_EVENT, onCustomEvent);
  };
};
