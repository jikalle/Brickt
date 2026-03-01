export const BASE_SEPOLIA_CHAIN_ID = 84532;

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const PROPERTY_ID_REGEX = /^[a-zA-Z0-9-_]{1,64}$/;

export class ValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const normalizeAddress = (value: string, field = 'address'): string => {
  if (!value || typeof value !== 'string' || !ADDRESS_REGEX.test(value)) {
    throw new ValidationError(`Invalid ${field}`);
  }
  return value.toLowerCase();
};

export const validatePropertyId = (value: string): string => {
  if (!value || typeof value !== 'string' || !PROPERTY_ID_REGEX.test(value)) {
    throw new ValidationError('Invalid propertyId');
  }
  return value;
};

export const parseLimit = (value: unknown, defaultLimit = 50, maxLimit = 200): number => {
  if (value === undefined || value === null || value === '') {
    return defaultLimit;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError('Invalid limit');
  }
  if (parsed > maxLimit) {
    return maxLimit;
  }
  return parsed;
};

const parseCursorDigits = (value: unknown, field: string): string => {
  const asString = value?.toString();
  if (!asString || !/^[0-9]+$/.test(asString)) {
    throw new ValidationError(`Invalid ${field}`);
  }
  return asString;
};

export const parseEventCursor = (query: Record<string, unknown>) => {
  const blockNumber = query.cursorBlockNumber ?? query.blockNumber;
  const logIndex = query.cursorLogIndex ?? query.logIndex;

  if (blockNumber === undefined && logIndex === undefined) {
    return null;
  }

  if (blockNumber === undefined || logIndex === undefined) {
    throw new ValidationError(
      'Provide both cursorBlockNumber and cursorLogIndex (or blockNumber and logIndex)'
    );
  }

  const parsedBlock = parseCursorDigits(blockNumber, 'cursorBlockNumber');
  const parsedLog = parseCursorDigits(logIndex, 'cursorLogIndex');

  return { cursorBlockNumber: parsedBlock, cursorLogIndex: parsedLog };
};

export const parseCampaignCursor = (query: Record<string, unknown>) => {
  const startTime = query.cursorStartTime ?? query.startTime;
  const contractAddress = query.cursorContractAddress ?? query.contractAddress;

  if (startTime === undefined && contractAddress === undefined) {
    return null;
  }

  if (!startTime || !contractAddress) {
    throw new ValidationError('Both cursorStartTime and cursorContractAddress are required');
  }

  const parsedStart = new Date(startTime.toString());
  if (Number.isNaN(parsedStart.getTime())) {
    throw new ValidationError('Invalid cursorStartTime');
  }

  const normalizedAddress = normalizeAddress(contractAddress.toString(), 'cursorContractAddress');

  return { cursorStartTime: parsedStart.toISOString(), cursorContractAddress: normalizedAddress };
};

export const parsePropertyCursor = (query: Record<string, unknown>) => {
  const propertyId = query.cursorPropertyId ?? query.propertyId;
  if (!propertyId) {
    return null;
  }

  return validatePropertyId(propertyId.toString());
};

export const parseBaseUnits = (value: unknown, field: string): string => {
  if (value === undefined || value === null) {
    throw new ValidationError(`Missing ${field}`);
  }
  const asString = value.toString();
  if (!/^[0-9]+$/.test(asString)) {
    throw new ValidationError(`Invalid ${field}`);
  }
  return asString;
};

export const parseFeeBps = (value: unknown, field = 'platformFeeBps'): number => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`Missing ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`Invalid ${field}`);
  }
  if (parsed > 2_000) {
    throw new ValidationError(`${field} cannot exceed 2000`);
  }
  return parsed;
};

export const validateChainId = (value: unknown): number => {
  if (value === undefined || value === null || value === '') {
    return BASE_SEPOLIA_CHAIN_ID;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError('Invalid chainId');
  }
  if (parsed !== BASE_SEPOLIA_CHAIN_ID) {
    throw new ValidationError('Unsupported chainId');
  }
  return parsed;
};
