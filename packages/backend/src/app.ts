import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import v1Router from './routes/v1.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { env } from './config/env.js';

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const legacyApiDeprecated = (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Legacy API has been removed. Use /v1 endpoints.',
  });
};

const authRateLimiter = createRateLimiter({
  keyPrefix: 'auth',
  windowMs: env.authRateLimitWindowMs,
  maxRequests: env.authRateLimitMaxRequests,
});

const apiRateLimiter = createRateLimiter({
  keyPrefix: 'api-v1',
  windowMs: env.rateLimitWindowMs,
  maxRequests: env.rateLimitMaxRequests,
});

// Auth remains temporarily aliased for compatibility.
if (env.rateLimitEnabled) {
  app.use('/api/auth', authRateLimiter);
  app.use('/v1/auth', authRateLimiter);
}
app.use('/api/auth', authRouter);
app.use('/v1/auth', authRouter);

// Legacy routes are hard-deprecated.
app.all('/api/properties', legacyApiDeprecated);
app.all('/api/properties/*', legacyApiDeprecated);
app.all('/api/investments', legacyApiDeprecated);
app.all('/api/investments/*', legacyApiDeprecated);
app.all('/api/chains', legacyApiDeprecated);
app.all('/api/chains/*', legacyApiDeprecated);
app.all('/api/tokens', legacyApiDeprecated);
app.all('/api/tokens/*', legacyApiDeprecated);

if (env.rateLimitEnabled) {
  app.use('/v1', apiRateLimiter);
}
app.use('/v1', v1Router);

// Error handling
app.use(errorHandler);

export default app;
