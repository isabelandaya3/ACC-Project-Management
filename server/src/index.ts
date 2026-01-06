/**
 * ACC Integration MVP - Server Entry Point
 */

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import fs from 'fs';
import path from 'path';

import { config, validateConfig } from './config';
import { logger } from './lib/logger';
import { connectDatabase, disconnectDatabase } from './lib/prisma';
import {
  requestIdMiddleware,
  httpLogger,
  errorHandler,
  notFoundHandler,
} from './middleware';
import { authRoutes, apiRoutes, healthRoutes } from './routes';
import { startAllJobs, stopAllJobs } from './jobs';

// Create Express app
const app = express();

// Trust proxy for secure cookies behind reverse proxy
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: config.webOrigin,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(requestIdMiddleware);
app.use(httpLogger);

// Session configuration
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
  },
}));

// Routes
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Ensure storage directory exists
const storagePath = path.join(process.cwd(), 'storage');
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

// Server startup
async function start() {
  try {
    // Validate configuration
    validateConfig();
    
    // Connect to database
    await connectDatabase();
    
    // Start background jobs
    startAllJobs();
    
    // Start server
    const server = app.listen(config.port, () => {
      logger.info({
        port: config.port,
        env: config.nodeEnv,
        webOrigin: config.webOrigin,
      }, `Server started on port ${config.port}`);
    });
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      
      // Stop background jobs
      stopAllJobs();
      
      // Close server
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Disconnect from database
        await disconnectDatabase();
        
        logger.info('Shutdown complete');
        process.exit(0);
      });
      
      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the server
start();
