/**
 * Sync Service
 * 
 * Handles polling RFIs/Submittals from ACC and tracking ingestion
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import { hashData } from '../lib/crypto';
import {
  listRFIs,
  listSubmittals,
  downloadAttachment,
} from '../lib/accClient';
import type { SyncModule, SyncResult, ACCRFI, ACCSubmittal } from '@acc-integration/shared';

const log = createChildLogger({ service: 'sync' });

/**
 * Syncs a specific module (RFI or Submittal) for a project
 */
export async function syncProject(
  accessToken: string,
  projectId: string,
  module: SyncModule,
  triggeredBy: 'cron' | 'manual' | 'webhook'
): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let itemsProcessed = 0;
  let newItems = 0;
  
  // Create sync log entry
  const syncLog = await prisma.syncLog.create({
    data: {
      projectId,
      module,
      status: 'started',
      triggeredBy,
    },
  });
  
  log.info({ projectId, module, syncLogId: syncLog.id }, 'Starting sync');
  
  try {
    // Get current cursor
    const cursor = await prisma.syncCursor.findUnique({
      where: {
        projectId_module: { projectId, module },
      },
    });
    
    const sinceCursor = cursor?.cursorToken || undefined;
    
    // Fetch items based on module type
    const items = module === 'rfi'
      ? await fetchRFIs(accessToken, projectId, sinceCursor)
      : await fetchSubmittals(accessToken, projectId, sinceCursor);
    
    itemsProcessed = items.data.length;
    
    // Process each item
    for (const item of items.data) {
      try {
        const isNew = await processItem(projectId, module, item);
        if (isNew) newItems++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to process ${module} ${item.id}: ${errorMessage}`);
        log.error({ projectId, module, itemId: item.id, error }, 'Failed to process item');
      }
    }
    
    // Update cursor
    await prisma.syncCursor.upsert({
      where: {
        projectId_module: { projectId, module },
      },
      create: {
        projectId,
        module,
        lastSeenAt: new Date(),
        lastSeenId: items.data[items.data.length - 1]?.id,
        cursorToken: items.cursor,
      },
      update: {
        lastSeenAt: new Date(),
        lastSeenId: items.data[items.data.length - 1]?.id,
        cursorToken: items.cursor,
      },
    });
    
    const duration = Date.now() - startTime;
    
    // Update sync log
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        itemsProcessed,
        newItems,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        duration,
        completedAt: new Date(),
      },
    });
    
    log.info({
      projectId,
      module,
      itemsProcessed,
      newItems,
      errors: errors.length,
      duration,
    }, 'Sync completed');
    
    return {
      projectId,
      module,
      success: true,
      itemsProcessed,
      newItems,
      errors,
      duration,
      cursor: items.cursor,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Update sync log with failure
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'failed',
        itemsProcessed,
        newItems,
        errors: JSON.stringify([errorMessage, ...errors]),
        duration,
        completedAt: new Date(),
      },
    });
    
    log.error({ projectId, module, error }, 'Sync failed');
    
    return {
      projectId,
      module,
      success: false,
      itemsProcessed,
      newItems,
      errors: [errorMessage, ...errors],
      duration,
    };
  }
}

/**
 * Fetches RFIs from ACC
 */
async function fetchRFIs(
  accessToken: string,
  projectId: string,
  sinceCursor?: string
): Promise<{ data: ACCRFI[]; cursor?: string }> {
  const response = await listRFIs(accessToken, projectId, sinceCursor);
  return {
    data: response.data,
    cursor: response.cursor,
  };
}

/**
 * Fetches Submittals from ACC
 */
async function fetchSubmittals(
  accessToken: string,
  projectId: string,
  sinceCursor?: string
): Promise<{ data: ACCSubmittal[]; cursor?: string }> {
  const response = await listSubmittals(accessToken, projectId, sinceCursor);
  return {
    data: response.data,
    cursor: response.cursor,
  };
}

/**
 * Processes a single item (RFI or Submittal)
 * Returns true if the item is new, false if already ingested
 */
async function processItem(
  projectId: string,
  module: SyncModule,
  item: ACCRFI | ACCSubmittal
): Promise<boolean> {
  // Create hash of item payload for change detection
  const payloadHash = hashData(JSON.stringify(item));
  
  // Check if already ingested
  const existing = await prisma.ingestedItem.findUnique({
    where: {
      externalId_module_projectId: {
        externalId: item.externalId,
        module,
        projectId,
      },
    },
  });
  
  if (existing) {
    // Update last seen and check for changes
    if (existing.payloadHash !== payloadHash) {
      await prisma.ingestedItem.update({
        where: { id: existing.id },
        data: {
          payloadHash,
          lastSeenAt: new Date(),
        },
      });
      log.debug({ externalId: item.externalId, module }, 'Item updated');
    } else {
      await prisma.ingestedItem.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return false;
  }
  
  // New item - create record
  await prisma.ingestedItem.create({
    data: {
      externalId: item.externalId,
      module,
      projectId,
      payloadHash,
    },
  });
  
  log.info({ externalId: item.externalId, module, projectId }, 'New item ingested');
  
  // TODO: Process attachments if needed
  // if (item.attachments) {
  //   for (const attachment of item.attachments) {
  //     await downloadAttachment(accessToken, {
  //       id: attachment.id,
  //       urn: attachment.urn,
  //       projectId,
  //       module,
  //       fileName: attachment.name,
  //     });
  //   }
  // }
  
  return true;
}

/**
 * Runs sync for all enabled projects
 * Called by the cron job
 */
export async function syncAllEnabledProjects(getAccessToken: (projectId: string) => Promise<string | null>): Promise<void> {
  log.info('Starting scheduled sync for all enabled projects');
  
  const enabledProjects = await prisma.enabledProject.findMany({
    where: { isActive: true },
  });
  
  if (enabledProjects.length === 0) {
    log.info('No enabled projects to sync');
    return;
  }
  
  for (const project of enabledProjects) {
    const accessToken = await getAccessToken(project.projectId);
    
    if (!accessToken) {
      log.warn({ projectId: project.projectId }, 'No valid token for project, skipping');
      continue;
    }
    
    if (project.syncRfis) {
      await syncProject(accessToken, project.projectId, 'rfi', 'cron');
    }
    
    if (project.syncSubs) {
      await syncProject(accessToken, project.projectId, 'submittal', 'cron');
    }
  }
  
  log.info('Scheduled sync completed');
}
