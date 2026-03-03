# API Documentation

## Base URL

```
Development: http://localhost:3000/v1
Production: https://api.yourdomain.com/v1
```

## Notes

- Legacy data routes under `/api/properties`, `/api/investments`, `/api/chains`, and `/api/tokens` are removed and return `410 Gone`.
- Authentication is available at `/v1/auth/*` (legacy alias `/api/auth/*` still works for compatibility).
- Current indexed data controllers are scoped to Base Sepolia chain ID `84532`.
- IP-based rate limiting is enabled by default on auth and `/v1` endpoints; over-limit requests return `429`.

## Error Model

All error responses follow this shape:

```json
{
  "error": "Human-readable message",
  "code": "machine_readable_code"
}
```

Common `code` values:
- `bad_request`
- `validation_error`
- `unauthorized`
- `forbidden`
- `not_found`
- `rate_limited`
- `service_unavailable`
- `authentication_failed`
- `internal_error`

## Authentication

### Get Nonce

```http
GET /v1/auth/nonce
```

Response:

```json
{
  "nonce": "a1b2c3d4...",
  "ttlSeconds": 600
}
```

### Login (Wallet Signature)

```http
POST /v1/auth/login
```

Request body:

```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "signature": "0x...",
  "message": "Homeshare wants you to sign in with your wallet.\nAddress: ...\nChain ID: 84532\nNonce: ...\nIssued At: 2026-02-28T10:00:00.000Z",
  "role": "owner"
}
```

Validation notes:
- `Address` in the signed message must match `address`.
- `Chain ID` must be supported (`84532` or `8453`).
- `Issued At` must be recent (within nonce TTL window).

### Verify JWT

```http
POST /v1/auth/verify
Authorization: Bearer <token>
```

## Health

```http
GET /v1/health
```

## Properties

### List Properties

```http
GET /v1/properties?limit=50&cursorPropertyId=prop-001
```

### Get Property

```http
GET /v1/properties/:propertyId
```

### List Equity Claims for Property

```http
GET /v1/properties/:propertyId/equity-claims?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

### List Profit Deposits for Property

```http
GET /v1/properties/:propertyId/profit-deposits?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

### List Profit Claims for Property

```http
GET /v1/properties/:propertyId/profit-claims?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

## Campaigns

### List Campaigns

```http
GET /v1/campaigns?limit=50&cursorStartTime=2026-01-01T00:00:00.000Z&cursorContractAddress=0x...
```

### Get Campaign

```http
GET /v1/campaigns/:campaignAddress
```

### List Campaign Investments

```http
GET /v1/campaigns/:campaignAddress/investments?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

### List Campaign Refunds

```http
GET /v1/campaigns/:campaignAddress/refunds?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

## Me (Authenticated)

All endpoints below require:

```http
Authorization: Bearer <token>
```

### My Investments

```http
GET /v1/me/investments?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

### My Equity Claims

```http
GET /v1/me/equity-claims?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

### My Profit Claims

```http
GET /v1/me/profit-claims?limit=50&cursorBlockNumber=123&cursorLogIndex=0
```

## Admin Intents (Owner Role Required)

All endpoints below require:

```http
Authorization: Bearer <owner_token>
```

### Create Property Intent

```http
POST /v1/admin/properties/intents
```

Request body:

```json
{
  "chainId": 84532,
  "propertyId": "prop-nyc-001",
  "name": "Downtown Apartment",
  "location": "New York, NY",
  "description": "Two-bedroom apartment",
  "targetUsdcBaseUnits": "1000000000",
  "startTime": "2026-03-10T09:00:00.000Z",
  "endTime": "2026-04-10T09:00:00.000Z",
  "crowdfundAddress": "0x..."
}
```

### List Property Intents

```http
GET /v1/admin/properties/intents?status=pending&limit=20
```

### Create Profit Distribution Intent

```http
POST /v1/admin/profits/intents
```

Request body:

```json
{
  "chainId": 84532,
  "propertyId": "prop-nyc-001",
  "profitDistributorAddress": "0x...",
  "usdcAmountBaseUnits": "50000000"
}
```

### List Profit Distribution Intents

```http
GET /v1/admin/profits/intents?status=submitted&limit=20
```

### Create Platform Fee Intent

```http
POST /v1/admin/platform-fees/intents
```

Request body:

```json
{
  "chainId": 84532,
  "campaignAddress": "0x...",
  "platformFeeBps": 250,
  "platformFeeRecipient": "0x..."
}
```

### List Platform Fee Intents

```http
GET /v1/admin/platform-fees/intents?status=failed&limit=20
```

### Admin Metrics (Owner Role Required)

```http
GET /v1/admin/metrics
```
