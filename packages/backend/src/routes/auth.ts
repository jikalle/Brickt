import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { env } from '../config/env.js';
import { auth, AuthenticatedRequest } from '../middleware/auth.js';
import { loginSchema } from '../validators/auth.js';

const router: Router = Router();
const NONCE_TTL_MS = 10 * 60 * 1000;
const issuedNonces = new Map<string, number>();
const EIP1271_MAGIC_VALUE = '0x1626ba7e';
const SUPPORTED_CHAIN_IDS = new Set([84532, 8453]);
const eip1271Interface = new ethers.Interface([
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
]);
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : null;
const redact = (value: string, visible = 6): string => {
  if (!value) return '';
  if (value.length <= visible * 2) return value;
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
};

const getClientIp = (req: Request): string => {
  const headers = req?.headers ?? {};
  const forwarded = headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) {
    return forwarded[0] || req.ip || '';
  }
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0];
    return (first ? first.trim() : '') || req.ip || '';
  }
  return req.ip || '';
};

const getUserAgent = (req: Request): string => {
  if (typeof req?.get === 'function') {
    return req.get('user-agent') || '';
  }
  const value = req?.headers?.['user-agent'];
  return Array.isArray(value) ? value[0] || '' : value || '';
};

const logAuthFailure = (
  req: Request,
  reason: string,
  context: {
    address?: string;
    role?: string;
    nonce?: string | null;
    chainId?: number | null;
    messageLength?: number;
  }
) => {
  console.error('[auth.login] rejected', {
    reason,
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
    address: context.address ? redact(context.address.toLowerCase(), 8) : '',
    role: context.role || '',
    nonce: context.nonce ? redact(context.nonce, 4) : '',
    chainId: context.chainId ?? null,
    messageLength: context.messageLength ?? 0,
    at: new Date().toISOString(),
  });
};

const isUsersRoleConstraintError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('users_role_check');
};

type LegacyRoleUser = Omit<User, 'role'> & { role: string };

const cleanupNonces = () => {
  const now = Date.now();
  for (const [nonce, expiresAt] of issuedNonces.entries()) {
    if (expiresAt <= now) {
      issuedNonces.delete(nonce);
    }
  }
};

const issueNonce = (): string => {
  cleanupNonces();
  const nonce = crypto.randomBytes(16).toString('hex');
  issuedNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return nonce;
};

const consumeNonce = (nonce: string): boolean => {
  cleanupNonces();
  const expiresAt = issuedNonces.get(nonce);
  if (!expiresAt || expiresAt <= Date.now()) {
    return false;
  }
  issuedNonces.delete(nonce);
  return true;
};

const extractNonce = (message: string): string | null => {
  const match = message.match(/Nonce:\s*([^\s]+)/i);
  return match?.[1] ?? null;
};

const extractAddress = (message: string): string | null => {
  const explicit = message.match(/Address:\s*(0x[a-fA-F0-9]{40})/i);
  if (explicit?.[1]) {
    return explicit[1];
  }

  // SIWE messages put the address on its own line after
  // "<domain> wants you to sign in with your Ethereum account:"
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const firstAddressLine = lines.find((line) => /^0x[a-fA-F0-9]{40}$/.test(line));
  return firstAddressLine ?? null;
};

const extractChainId = (message: string): number | null => {
  const match = message.match(/Chain ID:\s*([0-9]+|0x[a-fA-F0-9]+)/i);
  if (!match?.[1]) {
    return null;
  }

  const raw = match[1].trim();
  const chainId = raw.toLowerCase().startsWith('0x') ? parseInt(raw, 16) : Number(raw);
  return Number.isInteger(chainId) ? chainId : null;
};

const extractIssuedAt = (message: string): number | null => {
  const match = message.match(/Issued At:\s*(.+)/i);
  if (!match?.[1]) {
    return null;
  }
  const timestamp = Date.parse(match[1].trim());
  return Number.isNaN(timestamp) ? null : timestamp;
};

const isOwnerAllowed = (address: string): boolean => {
  if (env.ownerAllowlist.length === 0) {
    return false;
  }
  return env.ownerAllowlist.includes(address.toLowerCase());
};

const verifySmartWalletSignature = async (
  address: string,
  message: string,
  signature: string
): Promise<boolean> => {
  if (!provider) {
    return false;
  }

  try {
    const messageHash = ethers.hashMessage(message);
    const data = eip1271Interface.encodeFunctionData('isValidSignature', [messageHash, signature]);
    const result = await provider.call({ to: address, data });
    const [response] = eip1271Interface.decodeFunctionResult('isValidSignature', result);
    return String(response).toLowerCase() === EIP1271_MAGIC_VALUE;
  } catch (_error) {
    return false;
  }
};

const verifySignature = async (address: string, message: string, signature: string): Promise<boolean> => {
  try {
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() === address.toLowerCase()) {
      return true;
    }
  } catch (_error) {
    // Continue with EIP-1271 fallback.
  }

  return verifySmartWalletSignature(address, message, signature);
};

const validateSignedMessage = (address: string, message: string): string | null => {
  const msgAddress = extractAddress(message);
  if (!msgAddress || msgAddress.toLowerCase() !== address.toLowerCase()) {
    return 'Signed message address mismatch';
  }

  const chainId = extractChainId(message);
  if (!chainId || !SUPPORTED_CHAIN_IDS.has(chainId)) {
    return 'Unsupported chain in signed message';
  }

  // Some SIWE providers omit "Issued At". Nonce TTL + one-time nonce consumption
  // already provides replay protection. If present, still enforce freshness.
  const issuedAt = extractIssuedAt(message);
  if (issuedAt) {
    if (Date.now() - issuedAt > NONCE_TTL_MS) {
      return 'Signed message is expired';
    }
    if (issuedAt - Date.now() > 5 * 60 * 1000) {
      return 'Signed message has invalid Issued At timestamp';
    }
  }

  return null;
};

export const getNonceHandler = (_req: Request, res: Response) => {
  res.json({ nonce: issueNonce(), ttlSeconds: NONCE_TTL_MS / 1000 });
};

router.get('/nonce', getNonceHandler);

// POST /api/auth/login - Web3 wallet login
export const loginHandler = async (req: Request, res: Response) => {
  try {
    if (!env.jwtSecret || env.jwtSecret.length < 16) {
      logAuthFailure(req, 'jwt-secret-invalid', {});
      return res.status(500).json({ error: 'JWT secret is not configured securely' });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      logAuthFailure(req, 'invalid-payload', {});
      return res.status(400).json({ error: 'Invalid login payload' });
    }

    const { address, signature, message, role } = parsed.data;
    const nonce = extractNonce(message);
    const chainId = extractChainId(message);
    if (!nonce || !consumeNonce(nonce)) {
      logAuthFailure(req, 'nonce-invalid-or-expired', {
        address,
        role,
        nonce,
        chainId,
        messageLength: message.length,
      });
      return res.status(401).json({ error: 'Invalid or expired nonce' });
    }

    const messageError = validateSignedMessage(address, message);
    if (messageError) {
      logAuthFailure(req, messageError, {
        address,
        role,
        nonce,
        chainId,
        messageLength: message.length,
      });
      return res.status(401).json({ error: messageError });
    }

    const valid = await verifySignature(address, message, signature);
    if (!valid) {
      logAuthFailure(req, 'invalid-signature', {
        address,
        role,
        nonce,
        chainId,
        messageLength: message.length,
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const normalizedAddress = address.toLowerCase();
    const requestedOwnerRole = role === 'owner';
    const ownerAllowed = isOwnerAllowed(normalizedAddress);

    const [user] = await User.findOrCreate({
      where: { address: address.toLowerCase() },
      defaults: {
        address: normalizedAddress,
        role: 'investor',
      },
    });

    if (requestedOwnerRole && !ownerAllowed) {
      logAuthFailure(req, 'owner-not-allowlisted', {
        address,
        role,
        nonce,
        chainId,
        messageLength: message.length,
      });
      return res.status(403).json({ error: 'Owner access requires allowlist approval' });
    }

    const currentRole = String(user.role);
    const nextSessionRole: 'owner' | 'investor' =
      ownerAllowed && (requestedOwnerRole || currentRole === 'owner' || currentRole === 'admin')
        ? 'owner'
        : 'investor';

    const desiredStoredRole = nextSessionRole === 'owner' ? 'owner' : 'investor';
    if (currentRole !== desiredStoredRole) {
      try {
        (user as unknown as LegacyRoleUser).role = desiredStoredRole;
        await user.save();
      } catch (saveError) {
        // Backward compatibility for databases that still enforce ('admin', 'investor').
        if (desiredStoredRole === 'owner' && isUsersRoleConstraintError(saveError)) {
          (user as unknown as LegacyRoleUser).role = 'admin';
          await user.save();
        } else {
          throw saveError;
        }
      }
    }

    const responseUser = {
      id: user.id,
      address: user.address,
      role: nextSessionRole,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    const token = jwt.sign(
      { id: user.id, address: user.address, role: nextSessionRole },
      env.jwtSecret,
      { expiresIn: (process.env.JWT_EXPIRY || '7d') as jwt.SignOptions['expiresIn'] }
    );

    res.json({ token, user: responseUser });
  } catch (error) {
    console.error('[auth.login] unexpected-error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : '',
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      at: new Date().toISOString(),
    });
    res.status(500).json({ error: 'Authentication failed' });
  }
};

router.post('/login', loginHandler);

// POST /api/auth/verify - Verify JWT token
export const verifyHandler = async (req: AuthenticatedRequest, res: Response) => {
  res.json({ valid: true, user: req.user });
};

router.post('/verify', auth, verifyHandler);

export default router;
