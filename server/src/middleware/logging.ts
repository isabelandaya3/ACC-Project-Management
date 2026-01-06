import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pinoHttp from 'pino-http';
import { logger } from '../lib/logger';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      userId?: string;
    }
  }
}

// Request ID middleware
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = req.headers['x-request-id'] as string || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

// Pino HTTP logging middleware
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).requestId,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} completed`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} failed`;
  },
  // Redact sensitive headers
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

// Error handling middleware
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error({
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
  }, 'Unhandled error');
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    requestId: req.requestId,
  });
}

// Not found handler
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: 'Not found',
    requestId: req.requestId,
  });
}
