import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { getValidAccessToken } from '../lib/accClient';
import { logger } from '../lib/logger';

// Extend session type
declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

/**
 * Middleware to check if user is authenticated
 * Validates session and token, attaches userId to request
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  
  if (!userId) {
    logger.debug({ requestId: req.requestId }, 'No session userId');
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      requestId: req.requestId,
    });
  }
  
  // Validate token exists and is valid
  const accessToken = await getValidAccessToken(userId);
  
  if (!accessToken) {
    logger.debug({ requestId: req.requestId, userId }, 'No valid token for user');
    // Clear invalid session
    req.session.destroy(() => {});
    return res.status(401).json({
      success: false,
      error: 'Session expired. Please re-authenticate.',
      requestId: req.requestId,
    });
  }
  
  // Attach userId to request
  req.userId = userId;
  
  next();
}

/**
 * Optional auth middleware - doesn't fail if not authenticated
 * Useful for endpoints that work differently with/without auth
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  
  if (userId) {
    const accessToken = await getValidAccessToken(userId);
    if (accessToken) {
      req.userId = userId;
    }
  }
  
  next();
}
