import { Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/apiError.js';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err.stack);
  return sendError(res, 500, 'Internal server error', 'internal_error');
};
