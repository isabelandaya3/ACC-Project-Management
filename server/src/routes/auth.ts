import { Router, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { generateState } from '../lib/crypto';
import { logger } from '../lib/logger';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getUserProfile,
  storeTokens,
} from '../lib/accClient';

const router = Router();

/**
 * GET /auth/login
 * Initiates OAuth flow by redirecting to Autodesk
 */
router.get('/login', async (req: Request, res: Response) => {
  try {
    // Generate and store state for CSRF protection
    const state = generateState();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    await prisma.oAuthState.create({
      data: {
        state,
        expiresAt,
      },
    });
    
    // Clean up expired states
    await prisma.oAuthState.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    
    const authUrl = getAuthorizationUrl(state);
    
    logger.info({ requestId: req.requestId }, 'Redirecting to Autodesk OAuth');
    res.redirect(authUrl);
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to initiate OAuth');
    res.status(500).json({
      success: false,
      error: 'Failed to initiate authentication',
      requestId: req.requestId,
    });
  }
});

/**
 * GET /auth/callback
 * Handles OAuth callback from Autodesk
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;
  
  // Handle OAuth errors
  if (error) {
    logger.error({ requestId: req.requestId, error, error_description }, 'OAuth error');
    return res.redirect(`${config.webOrigin}/auth/error?error=${encodeURIComponent(error as string)}`);
  }
  
  // Validate required parameters
  if (!code || !state) {
    logger.error({ requestId: req.requestId }, 'Missing code or state');
    return res.redirect(`${config.webOrigin}/auth/error?error=missing_params`);
  }
  
  try {
    // Validate state
    const storedState = await prisma.oAuthState.findUnique({
      where: { state: state as string },
    });
    
    if (!storedState || storedState.expiresAt < new Date()) {
      logger.error({ requestId: req.requestId }, 'Invalid or expired state');
      return res.redirect(`${config.webOrigin}/auth/error?error=invalid_state`);
    }
    
    // Delete used state
    await prisma.oAuthState.delete({
      where: { state: state as string },
    });
    
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code as string);
    
    // Get user profile
    const profile = await getUserProfile(tokens.access_token);
    
    // Store tokens
    await storeTokens(profile.userId, tokens, profile);
    
    // Set session
    req.session.userId = profile.userId;
    
    logger.info({
      requestId: req.requestId,
      userId: profile.userId,
      email: profile.emailId,
    }, 'OAuth callback successful');
    
    // Redirect to frontend
    res.redirect(`${config.webOrigin}/auth/success`);
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'OAuth callback failed');
    res.redirect(`${config.webOrigin}/auth/error?error=callback_failed`);
  }
});

/**
 * GET /auth/logout
 * Clears session and tokens
 */
router.get('/logout', async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  
  if (userId) {
    // Optionally delete tokens from database
    // await prisma.authToken.delete({ where: { userId } });
    
    logger.info({ requestId: req.requestId, userId }, 'User logged out');
  }
  
  req.session.destroy((err) => {
    if (err) {
      logger.error({ requestId: req.requestId, error: err }, 'Failed to destroy session');
    }
    res.redirect(`${config.webOrigin}`);
  });
});

/**
 * GET /auth/status
 * Returns current auth status (for frontend polling)
 */
router.get('/status', async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  
  if (!userId) {
    return res.json({
      success: true,
      data: { authenticated: false },
      requestId: req.requestId,
    });
  }
  
  const authToken = await prisma.authToken.findUnique({
    where: { userId },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      expiresAt: true,
      scopes: true,
    },
  });
  
  if (!authToken) {
    return res.json({
      success: true,
      data: { authenticated: false },
      requestId: req.requestId,
    });
  }
  
  res.json({
    success: true,
    data: {
      authenticated: true,
      userId,
      email: authToken.email,
      name: `${authToken.firstName || ''} ${authToken.lastName || ''}`.trim(),
      expiresAt: authToken.expiresAt.toISOString(),
      scopes: authToken.scopes.split(','),
    },
    requestId: req.requestId,
  });
});

export default router;
