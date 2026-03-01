import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

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
      return res.status(500).json({ error: 'JWT secret is not configured securely' });
    }

    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, env.jwtSecret);
    if (typeof decoded !== 'object' || decoded === null) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = decoded as AuthenticatedRequest['user'];
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const requireRole = (role: 'owner' | 'investor') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
