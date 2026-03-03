import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { sendError } from '../lib/apiError.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    address: string;
    role: 'owner' | 'investor';
  };
}

export const auth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!env.jwtSecret || env.jwtSecret.length < 16) {
      return sendError(res, 500, 'JWT secret is not configured securely', 'internal_error');
    }

    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return sendError(res, 401, 'No token provided', 'unauthorized');
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded !== 'object' || decoded === null) {
      return sendError(res, 401, 'Invalid token', 'unauthorized');
    }

    req.user = decoded as AuthenticatedRequest['user'];
    next();
  } catch (error) {
    return sendError(res, 401, 'Invalid token', 'unauthorized');
  }
};

export const requireRole = (role: 'owner' | 'investor') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, 401, 'Unauthorized', 'unauthorized');
    }

    if (req.user.role !== role) {
      return sendError(res, 403, 'Forbidden', 'forbidden');
    }

    next();
  };
};
