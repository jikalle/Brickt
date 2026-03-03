import { Response } from 'express';

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'service_unavailable'
  | 'authentication_failed'
  | 'internal_error'
  | 'bad_request';

export const sendError = (
  res: Response,
  status: number,
  error: string,
  code: ApiErrorCode
) => res.status(status).json({ error, code });

