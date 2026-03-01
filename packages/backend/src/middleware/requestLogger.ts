import { Request, Response, NextFunction } from 'express';
import { observeRequest } from './requestMetrics.js';

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    observeRequest(req.method, req.path, res.statusCode, duration);
    console.log(
      `${req.method} ${req.path} ${res.statusCode} - ${duration}ms`
    );
  });
  
  next();
};
