/**
 * Enhanced Sync Service  
 * Comprehensive synchronization of RFIs and Submittals from ACC with change detection
 */

import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import * as accClient from '../lib/accClient';
import { saveFileToItemFolder, generateExportFilename } from './fileService';

const log = createChildLogger({ module: 'enhancedSyncService' });

type SyncModule = 'RFI' | 'SUBMITTAL';

interface SyncResult {
  itemsProcessed: number;
  newItems: number;
  updatedItems: number;
  errors: string[];
}

/**
 * Synchronize all active projects
 */
export async function syncAllProjects(triggeredBy: 'CRON' | 'MANUAL' = 'CRON') {
  log.info({ triggeredBy }, 'Starting sync for all active projects');
  
  const projects = await prisma.project.findMany({
    where: { 
      isActive: true,
      syncEnabled: true,
      accProjectLinks: {
        some: {},
      },
    },
    include: {
      accProjectLinks: {
        include: {
          oauthToken: true,
        },
      },
    },
  });
  
  log.info({ count: projects.length }, 'Found enabled projects');
  
  for (const project of projects) {
    try {
      await syncProject(project.id, triggeredBy);
    } catch (error) {
      log.error({ projectId: project.id, error }, 'Failed to sync project');
    }
  }
  
  log.info('Completed sync for all active projects');
}

/**
 * Synchronize a specific project (supports multiple ACC project links)
 */
export async function syncProject(projectId: string, triggeredBy: 'CRON' | 'MANUAL' | 'PROJECT_OPEN' = 'MANUAL') {
  log.info({ projectId, triggeredBy }, 'Starting project sync');
  
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      accProjectLinks: {
        include: {
          oauthToken: true,
        },
      },
    },
  });
  
  if (!project || !project.accProjectLinks || project.accProjectLinks.length === 0) {
    log.warn({ projectId }, 'Project not found or has no ACC links');
    return;
  }
  
  // Sync each ACC project link
  for (const accProjectLink of project.accProjectLinks) {
    log.info({ 
      projectId, 
      accProjectId: accProjectLink.accProjectId,
      folderName: accProjectLink.folderName 
    }, 'Syncing ACC project link');
    
    if (accProjectLink.syncRfis) {
      await syncProjectModule(projectId, 'RFI', triggeredBy, accProjectLink.id);
    }
    
    if (accProjectLink.syncSubmittals) {
      await syncProjectModule(projectId, 'SUBMITTAL', triggeredBy, accProjectLink.id);
    }
  }
  
  await prisma.project.update({
    where: { id: projectId },
    data: { lastSyncAt: new Date() },
  });
  
  log.info({ projectId }, 'Project sync completed');
}

/**
 * Sync project module with comprehensive error handling
 */
async function syncProjectModule(projectId: string, module: SyncModule, triggeredBy: string, accProjectLinkId?: string) {
  const startTime = Date.now();
  
  log.info({ projectId, module, accProjectLinkId }, 'Starting module sync');
  
  const syncLog = await prisma.syncLog.create({
    data: {
      projectId,
      module,
      status: 'STARTED',
      triggeredBy,
    },
  });
  
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        accProjectLinks: {
          where: accProjectLinkId ? { id: accProjectLinkId } : undefined,
          include: {
            oauthToken: true,
          },
        },
      },
    });
    
    if (!project || !project.accProjectLinks || project.accProjectLinks.length === 0) {
      throw new Error('Project or ACC links not found');
    }
    
    const accProjectLink = project.accProjectLinks[0];
    
    if (!accProjectLink) {
      throw new Error('ACC project link not found');
    }
    
    let cursor = await prisma.syncCursor.findUnique({
      where: {
        projectId_module: { projectId, module },
      },
    });
    
    let result: SyncResult;
    if (module === 'RFI') {
      result = await syncRfis(project, accProjectLink, cursor);
    } else {
      result = await syncSubmittals(project, accProjectLink, cursor);
    }
    
    await prisma.syncCursor.upsert({
      where: {
        projectId_module: { projectId, module },
      },
      create: {
        projectId,
        module,
        lastSeenAt: new Date(),
      },
      update: {
        lastSeenAt: new Date(),
      },
    });
    
    const duration = Date.now() - startTime;
    
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'COMPLETED',
        itemsProcessed: result.itemsProcessed,
        newItems: result.newItems,
        updatedItems: result.updatedItems,
        errors: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
        duration,
        completedAt: new Date(),
      },
    });
    
    await prisma.accProjectLink.update({
      where: { projectId },
      data: {
        lastSyncStatus: result.errors.length > 0 ? 'failed' : 'success',
        lastSyncError: result.errors.length > 0 ? result.errors.join('; ') : null,
      },
    });
    
    log.info({ projectId, module, duration, ...result }, 'Module sync completed');
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    log.error({ projectId, module, error }, 'Module sync failed');
    
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'FAILED',
        errors: JSON.stringify([errorMessage]),
        duration,
        completedAt: new Date(),
      },
    });
    
    await prisma.accProjectLink.update({
      where: { projectId },
      data: {
        lastSyncStatus: 'failed',
        lastSyncError: errorMessage,
      },
    });
  }
}

/**
 * Sync RFIs with change detection
 */
async function syncRfis(project: any, accProjectLink: any, cursor: any): Promise<SyncResult> {
  const result: SyncResult = {
    itemsProcessed: 0,
    newItems: 0,
    updatedItems: 0,
    errors: [],
  };
  
  try {
    const accessToken = await accClient.getValidToken(accProjectLink.oauthToken);
    const accRfis = await accClient.listRFIs(accProjectLink.accProjectId, accessToken);
    
    log.info({ projectId: project.id, accProjectLinkId: accProjectLink.id, count: accRfis.length }, 'Fetched RFIs from ACC');
    
    for (const accRfi of accRfis) {
      result.itemsProcessed++;
      
      try {
        const isNew = await processRfi(project, accProjectLink, accRfi, accessToken);
        if (isNew) {
          result.newItems++;
        } else {
          result.updatedItems++;
        }
      } catch (error) {
        const errorMessage = `RFI ${accRfi.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMessage);
        log.error({ accRfiId: accRfi.id, error }, 'Failed to process RFI');
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    throw error;
  }
  
  return result;
}

/**
 * Process individual RFI with change detection
 */
async function processRfi(project: any, accProjectLink: any, accRfi: any, accessToken: string): Promise<boolean> {
  const accDataHash = hashAccData(accRfi);
  
  const existing = await prisma.rfi.findUnique({
    where: {
      accProjectLinkId_accRfiId: {
        accProjectLinkId: accProjectLink.id,
        accRfiId: accRfi.id,
      },
    },
  });
  
  const now = new Date();
  let hasUnacknowledgedChange = false;
  let changesSummary = null;
  
  // Detect manual response added directly in ACC
  let hasManualResponse = false;
  let manualResponseData = null;
  
  if (existing) {
    if (existing.accDataHash !== accDataHash) {
      hasUnacknowledgedChange = true;
      changesSummary = detectChanges(existing, accRfi);
    }
    
    // Check if ACC has a response that we didn't send
    if (accRfi.response && accRfi.response.text && !existing.responseSentAt) {
      hasManualResponse = true;
      manualResponseData = JSON.stringify({
        status: accRfi.response.status || accRfi.status,
        text: accRfi.response.text,
        respondedBy: accRfi.response.respondedBy,
        respondedAt: accRfi.response.respondedAt,
        detectedAt: now.toISOString(),
      });
      
      log.info({ 
        rfiId: accRfi.id, 
        accNumber: accRfi.number,
        responseSentAt: existing.responseSentAt 
      }, 'Manual response detected in ACC - requires admin confirmation');
    }
  }
  
  await prisma.rfi.upsert({
    where: {
      accProjectLinkId_accRfiId: {
        accProjectLinkId: accProjectLink.id,
        accRfiId: accRfi.id,
      },
    },
    create: {
      projectId: project.id,
      accProjectLinkId: accProjectLink.id,
      accRfiId: accRfi.id,
      accNumber: accRfi.number || accRfi.id,
      title: accRfi.title || 'Untitled RFI',
      discipline: accRfi.discipline,
      accStatus: accRfi.status,
      priority: accRfi.priority,
      accCreatedBy: accRfi.createdBy,
      accAssignedTo: JSON.stringify(accRfi.assignedTo || []),
      accDueDate: accRfi.dueDate ? new Date(accRfi.dueDate) : null,
      accDescription: accRfi.description,
      accContractorComments: accRfi.contractorComments,
      accCreatedAt: new Date(accRfi.createdAt),
      accUpdatedAt: new Date(accRfi.updatedAt || accRfi.createdAt),
      accDataHash,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      title: accRfi.title || 'Untitled RFI',
      discipline: accRfi.discipline,
      accStatus: accRfi.status,
      priority: accRfi.priority,
      accCreatedBy: accRfi.createdBy,
      accAssignedTo: JSON.stringify(accRfi.assignedTo || []),
      accDueDate: accRfi.dueDate ? new Date(accRfi.dueDate) : null,
      accDescription: accRfi.description,
      accContractorComments: accRfi.contractorComments,
      accUpdatedAt: new Date(accRfi.updatedAt || accRfi.createdAt),
      accDataHash,
      hasUnacknowledgedChange,
      lastAccChangeAt: hasUnacknowledgedChange ? now : undefined,
      changesSummary: hasUnacknowledgedChange ? JSON.stringify(changesSummary) : undefined,
      hasManualResponse: hasManualResponse ? true : undefined,
      manualResponseDetectedAt: hasManualResponse ? now : undefined,
      manualResponseData: hasManualResponse ? manualResponseData : undefined,
      lastSeenAt: now,
    },
  });
  
  if (existing && hasUnacknowledgedChange) {
    await prisma.statusHistory.create({
      data: {
        rfiId: existing.id,
        fieldName: 'accData',
        oldValue: existing.accStatus,
        newValue: accRfi.status,
        changeReason: 'ACC sync detected change',
      },
    });
  }
  
  return !existing;
}

/**
 * Sync Submittals with change detection
 */
async function syncSubmittals(project: any, accProjectLink: any, cursor: any): Promise<SyncResult> {
  const result: SyncResult = {
    itemsProcessed: 0,
    newItems: 0,
    updatedItems: 0,
    errors: [],
  };
  
  try {
    const accessToken = await accClient.getValidToken(accProjectLink.oauthToken);
    const accSubmittals = await accClient.listSubmittals(accProjectLink.accProjectId, accessToken);
    
    log.info({ projectId: project.id, accProjectLinkId: accProjectLink.id, count: accSubmittals.length }, 'Fetched Submittals from ACC');
    
    for (const accSubmittal of accSubmittals) {
      result.itemsProcessed++;
      
      try {
        const isNew = await processSubmittal(project, accProjectLink, accSubmittal, accessToken);
        if (isNew) {
          result.newItems++;
        } else {
          result.updatedItems++;
        }
      } catch (error) {
        const errorMessage = `Submittal ${accSubmittal.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMessage);
        log.error({ accSubmittalId: accSubmittal.id, error }, 'Failed to process Submittal');
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    throw error;
  }
  
  return result;
}

/**
 * Process individual Submittal with change detection
 */
async function processSubmittal(project: any, accProjectLink: any, accSubmittal: any, accessToken: string): Promise<boolean> {
  const accDataHash = hashAccData(accSubmittal);
  
  const existing = await prisma.submittal.findUnique({
    where: {
      accProjectLinkId_accSubmittalId: {
        accProjectLinkId: accProjectLink.id,
        accSubmittalId: accSubmittal.id,
      },
    },
  });
  
  const now = new Date();
  let hasUnacknowledgedChange = false;
  let changesSummary = null;
  
  // Detect manual response added directly in ACC
  let hasManualResponse = false;
  let manualResponseData = null;
  
  if (existing) {
    if (existing.accDataHash !== accDataHash) {
      hasUnacknowledgedChange = true;
      changesSummary = detectChanges(existing, accSubmittal);
    }
    
    // Check if ACC has a response that we didn't send
    if (accSubmittal.response && accSubmittal.response.text && !existing.responseSentAt) {
      hasManualResponse = true;
      manualResponseData = JSON.stringify({
        status: accSubmittal.response.status || accSubmittal.status,
        text: accSubmittal.response.text,
        respondedBy: accSubmittal.response.respondedBy,
        respondedAt: accSubmittal.response.respondedAt,
        detectedAt: now.toISOString(),
      });
      
      log.info({ 
        submittalId: accSubmittal.id, 
        accNumber: accSubmittal.number,
        responseSentAt: existing.responseSentAt 
      }, 'Manual response detected in ACC - requires admin confirmation');
    }
  }
  
  await prisma.submittal.upsert({
    where: {
      accProjectLinkId_accSubmittalId: {
        accProjectLinkId: accProjectLink.id,
        accSubmittalId: accSubmittal.id,
      },
    },
    create: {
      projectId: project.id,
      accProjectLinkId: accProjectLink.id,
      accSubmittalId: accSubmittal.id,
      accNumber: accSubmittal.number || accSubmittal.id,
      title: accSubmittal.title || 'Untitled Submittal',
      specSection: accSubmittal.specSection,
      packageNumber: accSubmittal.packageNumber,
      accStatus: accSubmittal.status,
      priority: accSubmittal.priority,
      accCreatedBy: accSubmittal.createdBy,
      accAssignedTo: JSON.stringify(accSubmittal.assignedTo || []),
      accDueDate: accSubmittal.dueDate ? new Date(accSubmittal.dueDate) : null,
      accDescription: accSubmittal.description,
      accContractorComments: accSubmittal.contractorComments,
      accCreatedAt: new Date(accSubmittal.createdAt),
      accUpdatedAt: new Date(accSubmittal.updatedAt || accSubmittal.createdAt),
      accDataHash,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      title: accSubmittal.title || 'Untitled Submittal',
      specSection: accSubmittal.specSection,
      packageNumber: accSubmittal.packageNumber,
      accStatus: accSubmittal.status,
      priority: accSubmittal.priority,
      accCreatedBy: accSubmittal.createdBy,
      accAssignedTo: JSON.stringify(accSubmittal.assignedTo || []),
      accDueDate: accSubmittal.dueDate ? new Date(accSubmittal.dueDate) : null,
      accDescription: accSubmittal.description,
      accContractorComments: accSubmittal.contractorComments,
      accUpdatedAt: new Date(accSubmittal.updatedAt || accSubmittal.createdAt),
      accDataHash,
      hasUnacknowledgedChange,
      lastAccChangeAt: hasUnacknowledgedChange ? now : undefined,
      changesSummary: hasUnacknowledgedChange ? JSON.stringify(changesSummary) : undefined,
      hasManualResponse: hasManualResponse ? true : undefined,
      manualResponseDetectedAt: hasManualResponse ? now : undefined,
      manualResponseData: hasManualResponse ? manualResponseData : undefined,
      lastSeenAt: now,
    },
  });
  
  if (existing && hasUnacknowledgedChange) {
    await prisma.statusHistory.create({
      data: {
        submittalId: existing.id,
        fieldName: 'accData',
        oldValue: existing.accStatus,
        newValue: accSubmittal.status,
        changeReason: 'ACC sync detected change',
      },
    });
  }
  
  return !existing;
}

/**
 * Hash ACC data for change detection
 */
function hashAccData(data: any): string {
  const relevantData = {
    status: data.status,
    dueDate: data.dueDate,
    title: data.title,
    description: data.description,
    priority: data.priority,
    assignedTo: data.assignedTo,
    updatedAt: data.updatedAt,
  };
  
  return crypto.createHash('sha256')
    .update(JSON.stringify(relevantData))
    .digest('hex');
}

/**
 * Detect specific changes
 */
function detectChanges(existing: any, accData: any): Record<string, any> {
  const changes: Record<string, any> = {};
  
  if (existing.accStatus !== accData.status) {
    changes.status = { old: existing.accStatus, new: accData.status };
  }
  
  if (existing.title !== accData.title) {
    changes.title = { old: existing.title, new: accData.title };
  }
  
  const existingDueDate = existing.accDueDate?.toISOString();
  const newDueDate = accData.dueDate ? new Date(accData.dueDate).toISOString() : null;
  if (existingDueDate !== newDueDate) {
    changes.dueDate = { old: existingDueDate, new: newDueDate };
  }
  
  if (existing.priority !== accData.priority) {
    changes.priority = { old: existing.priority, new: accData.priority };
  }
  
  return changes;
}
