/**
 * Background Jobs
 * 
 * Scheduled tasks using node-cron
 */

import cron from 'node-cron';
import { config } from '../config';
import { logger, createChildLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { getValidAccessToken } from '../lib/accClient';
import { syncAllEnabledProjects } from '../services/syncService';

const log = createChildLogger({ module: 'jobs' });

let syncTask: cron.ScheduledTask | null = null;

/**
 * Gets an access token for a project
 * This is a simple implementation - in production, you might want
 * to associate tokens with specific projects/hubs
 */
async function getAccessTokenForProject(projectId: string): Promise<string | null> {
  // For MVP, we use the first available token
  // In production, you'd want to map projects to specific users/service accounts
  const authToken = await prisma.authToken.findFirst({
    where: {
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
  
  if (!authToken) {
    return null;
  }
  
  return getValidAccessToken(authToken.userId);
}

/**
 * Starts the sync cron job
 */
export function startSyncJob(): void {
  const cronExpression = `*/${config.syncIntervalMinutes} * * * *`;
  
  log.info({ cronExpression, intervalMinutes: config.syncIntervalMinutes }, 'Starting sync job');
  
  syncTask = cron.schedule(cronExpression, async () => {
    log.info('Sync job triggered');
    
    try {
      await syncAllEnabledProjects(getAccessTokenForProject);
    } catch (error) {
      log.error({ error }, 'Sync job failed');
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });
  
  log.info('Sync job started');
}

/**
 * Stops the sync cron job
 */
export function stopSyncJob(): void {
  if (syncTask) {
    syncTask.stop();
    syncTask = null;
    log.info('Sync job stopped');
  }
}

/**
 * Cleans up expired OAuth states and old sync logs
 */
async function cleanupTask(): Promise<void> {
  log.debug('Running cleanup task');
  
  try {
    // Delete expired OAuth states
    const deletedStates = await prisma.oAuthState.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    
    if (deletedStates.count > 0) {
      log.info({ count: deletedStates.count }, 'Deleted expired OAuth states');
    }
    
    // Delete old sync logs (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deletedLogs = await prisma.syncLog.deleteMany({
      where: {
        startedAt: {
          lt: thirtyDaysAgo,
        },
      },
    });
    
    if (deletedLogs.count > 0) {
      log.info({ count: deletedLogs.count }, 'Deleted old sync logs');
    }
  } catch (error) {
    log.error({ error }, 'Cleanup task failed');
  }
}

let cleanupTask_: cron.ScheduledTask | null = null;

/**
 * Starts the cleanup cron job (runs daily at midnight)
 */
export function startCleanupJob(): void {
  log.info('Starting cleanup job');
  
  cleanupTask_ = cron.schedule('0 0 * * *', cleanupTask, {
    scheduled: true,
    timezone: 'UTC',
  });
  
  // Also run immediately on startup
  cleanupTask().catch(err => log.error({ error: err }, 'Initial cleanup failed'));
  
  log.info('Cleanup job started');
}

/**
 * Stops the cleanup cron job
 */
export function stopCleanupJob(): void {
  if (cleanupTask_) {
    cleanupTask_.stop();
    cleanupTask_ = null;
    log.info('Cleanup job stopped');
  }
}

/**
 * Starts all background jobs
 */
export function startAllJobs(): void {
  startSyncJob();
  startCleanupJob();
}

/**
 * Stops all background jobs
 */
export function stopAllJobs(): void {
  stopSyncJob();
  stopCleanupJob();
}
