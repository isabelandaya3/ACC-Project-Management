/**
 * Response Service
 * Handles sending official responses back to ACC
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import * as accClient from '../lib/accClient';
import { readFile } from './fileService';
import path from 'path';

const log = createChildLogger({ module: 'responseService' });

export interface SendRfiResponseDto {
  responseStatus: string;
  responseText: string;
  selectedFilePaths: string[];
}

export interface SendSubmittalResponseDto {
  responseStatus: string;
  responseText: string;
  selectedFilePaths: string[];
}

/**
 * Send RFI official response to ACC
 */
export async function sendRfiResponseToAcc(
  rfiId: string,
  userId: string,
  data: SendRfiResponseDto
) {
  log.info({ rfiId, userId }, 'Sending RFI response to ACC');
  
  const rfi = await prisma.rfi.findUnique({
    where: { id: rfiId },
    include: {
      project: {
        include: {
          accProjectLink: {
            include: {
              oauthToken: true,
            },
          },
          memberships: {
            where: { userId },
          },
        },
      },
    },
  });
  
  if (!rfi || !rfi.project.accProjectLink) {
    throw new Error('RFI or ACC project link not found');
  }
  
  // PERMISSION CHECK: Only admins can send responses to ACC
  const membership = rfi.project.memberships[0];
  if (!membership) {
    throw new Error('User is not a member of this project');
  }
  
  const isAdmin = membership.role === 'PROJECT_ADMIN' || membership.canSendToAcc === true;
  if (!isAdmin) {
    log.warn({ rfiId, userId, role: membership.role }, 'Non-admin attempted to send response to ACC');
    throw new Error('Only project admins are authorized to send responses to ACC');
  }
  
  // Validate response
  if (!data.responseStatus) {
    throw new Error('Response status is required');
  }
  
  if (!data.responseText || data.responseText.trim().length === 0) {
    throw new Error('Response text is required');
  }
  
  if (!data.selectedFilePaths || data.selectedFilePaths.length === 0) {
    throw new Error('At least one file must be selected');
  }
  
  try {
    // Get valid access token
    const accessToken = await accClient.getValidToken(rfi.project.accProjectLink.oauthToken);
    
    // 1. Update RFI status in ACC
    await accClient.updateRFIStatus(
      rfi.project.accProjectLink.accProjectId,
      rfi.accRfiId,
      data.responseStatus,
      accessToken
    );
    
    // 2. Post response comment in ACC
    await accClient.postRFIResponse(
      rfi.project.accProjectLink.accProjectId,
      rfi.accRfiId,
      data.responseText,
      accessToken
    );
    
    // 3. Upload selected files to ACC
    for (const filePath of data.selectedFilePaths) {
      try {
        const buffer = await readFile(filePath);
        const fileName = path.basename(filePath);
        
        await accClient.uploadRFIAttachment(
          rfi.project.accProjectLink.accProjectId,
          rfi.accRfiId,
          buffer,
          fileName,
          accessToken
        );
        
        log.info({ rfiId, fileName }, 'File uploaded to ACC');
      } catch (error) {
        log.error({ rfiId, filePath, error }, 'Failed to upload file to ACC');
        throw new Error(`Failed to upload file: ${path.basename(filePath)}`);
      }
    }
    
    // 4. Update internal RFI record
    const updated = await prisma.rfi.update({
      where: { id: rfiId },
      data: {
        responseStatus: data.responseStatus,
        responseText: data.responseText,
        responseSentAt: new Date(),
        responseSentBy: userId,
        internalStatus: 'SENT_TO_ACC',
      },
    });
    
    // 5. Create audit log
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'SEND_TO_ACC',
        entityType: 'RFI',
        entityId: rfiId,
        rfiId,
        details: JSON.stringify({
          responseStatus: data.responseStatus,
          fileCount: data.selectedFilePaths.length,
          files: data.selectedFilePaths.map(p => path.basename(p)),
        }),
      },
    });
    
    // 6. Create status history
    await prisma.statusHistory.create({
      data: {
        rfiId,
        fieldName: 'responseStatus',
        newValue: data.responseStatus,
        changedBy: userId,
        changeReason: 'Official response sent to ACC',
      },
    });
    
    log.info({ rfiId }, 'RFI response sent to ACC successfully');
    
    return updated;
  } catch (error) {
    log.error({ rfiId, error }, 'Failed to send RFI response to ACC');
    
    // Log the failure
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'SEND_TO_ACC_FAILED',
        entityType: 'RFI',
        entityId: rfiId,
        rfiId,
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    });
    
    throw error;
  }
}

/**
 * Send Submittal official response to ACC
 */
export async function sendSubmittalResponseToAcc(
  submittalId: string,
  userId: string,
  data: SendSubmittalResponseDto
) {
  log.info({ submittalId, userId }, 'Sending Submittal response to ACC');
  
  const submittal = await prisma.submittal.findUnique({
    where: { id: submittalId },
    include: {
      project: {
        include: {
          accProjectLink: {
            include: {
              oauthToken: true,
            },
          },
          memberships: {
            where: { userId },
          },
        },
      },
    },
  });
  
  if (!submittal || !submittal.project.accProjectLink) {
    throw new Error('Submittal or ACC project link not found');
  }
  
  // PERMISSION CHECK: Only admins can send responses to ACC
  const membership = submittal.project.memberships[0];
  if (!membership) {
    throw new Error('User is not a member of this project');
  }
  
  const isAdmin = membership.role === 'PROJECT_ADMIN' || membership.canSendToAcc === true;
  if (!isAdmin) {
    log.warn({ submittalId, userId, role: membership.role }, 'Non-admin attempted to send response to ACC');
    throw new Error('Only project admins are authorized to send responses to ACC');
  }
  
  // Validation
  if (!data.responseStatus) {
    throw new Error('Response status is required');
  }
  
  if (!data.responseText || data.responseText.trim().length === 0) {
    throw new Error('Response text is required');
  }
  
  if (!data.selectedFilePaths || data.selectedFilePaths.length === 0) {
    throw new Error('At least one file must be selected');
  }
  
  try {
    const accessToken = await accClient.getValidToken(submittal.project.accProjectLink.oauthToken);
    
    await accClient.updateSubmittalStatus(
      submittal.project.accProjectLink.accProjectId,
      submittal.accSubmittalId,
      data.responseStatus,
      accessToken
    );
    
    await accClient.postSubmittalResponse(
      submittal.project.accProjectLink.accProjectId,
      submittal.accSubmittalId,
      data.responseText,
      accessToken
    );
    
    for (const filePath of data.selectedFilePaths) {
      try {
        const buffer = await readFile(filePath);
        const fileName = path.basename(filePath);
        
        await accClient.uploadSubmittalAttachment(
          submittal.project.accProjectLink.accProjectId,
          submittal.accSubmittalId,
          buffer,
          fileName,
          accessToken
        );
        
        log.info({ submittalId, fileName }, 'File uploaded to ACC');
      } catch (error) {
        log.error({ submittalId, filePath, error }, 'Failed to upload file to ACC');
        throw new Error(`Failed to upload file: ${path.basename(filePath)}`);
      }
    }
    
    const updated = await prisma.submittal.update({
      where: { id: submittalId },
      data: {
        responseStatus: data.responseStatus,
        responseText: data.responseText,
        responseSentAt: new Date(),
        responseSentBy: userId,
        internalStatus: 'SENT_TO_ACC',
      },
    });
    
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'SEND_TO_ACC',
        entityType: 'SUBMITTAL',
        entityId: submittalId,
        submittalId,
        details: JSON.stringify({
          responseStatus: data.responseStatus,
          fileCount: data.selectedFilePaths.length,
          files: data.selectedFilePaths.map(p => path.basename(p)),
        }),
      },
    });
    
    await prisma.statusHistory.create({
      data: {
        submittalId,
        fieldName: 'responseStatus',
        newValue: data.responseStatus,
        changedBy: userId,
        changeReason: 'Official response sent to ACC',
      },
    });
    
    log.info({ submittalId }, 'Submittal response sent to ACC successfully');
    
    return updated;
  } catch (error) {
    log.error({ submittalId, error }, 'Failed to send Submittal response to ACC');
    
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'SEND_TO_ACC_FAILED',
        entityType: 'SUBMITTAL',
        entityId: submittalId,
        submittalId,
        details: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    });
    
    throw error;
  }
}

/**
 * List RFIs with manual responses that need admin confirmation
 */
export async function listRfisWithManualResponses(projectId: string) {
  return prisma.rfi.findMany({
    where: {
      projectId,
      hasManualResponse: true,
      manualResponseConfirmedAt: null,
    },
    include: {
      accProjectLink: {
        select: {
          accProjectName: true,
          folderName: true,
        },
      },
    },
    orderBy: { manualResponseDetectedAt: 'desc' },
  });
}

/**
 * List Submittals with manual responses that need admin confirmation
 */
export async function listSubmittalsWithManualResponses(projectId: string) {
  return prisma.submittal.findMany({
    where: {
      projectId,
      hasManualResponse: true,
      manualResponseConfirmedAt: null,
    },
    include: {
      accProjectLink: {
        select: {
          accProjectName: true,
          folderName: true,
        },
      },
    },
    orderBy: { manualResponseDetectedAt: 'desc' },
  });
}

/**
 * Admin confirms a manual RFI response from ACC and closes it out
 */
export async function confirmManualRfiResponse(
  rfiId: string,
  userId: string
) {
  log.info({ rfiId, userId }, 'Admin confirming manual RFI response');
  
  const rfi = await prisma.rfi.findUnique({
    where: { id: rfiId },
    include: {
      project: {
        include: {
          memberships: {
            where: { userId },
          },
        },
      },
    },
  });
  
  if (!rfi) {
    throw new Error('RFI not found');
  }
  
  // PERMISSION CHECK: Only admins can confirm manual responses
  const membership = rfi.project.memberships[0];
  if (!membership) {
    throw new Error('User is not a member of this project');
  }
  
  const isAdmin = membership.role === 'PROJECT_ADMIN' || membership.canSendToAcc === true;
  if (!isAdmin) {
    log.warn({ rfiId, userId, role: membership.role }, 'Non-admin attempted to confirm manual response');
    throw new Error('Only project admins can confirm manual responses');
  }
  
  if (!rfi.hasManualResponse) {
    throw new Error('RFI does not have a manual response to confirm');
  }
  
  if (rfi.manualResponseConfirmedAt) {
    throw new Error('Manual response has already been confirmed');
  }
  
  // Parse manual response data
  let manualResponse;
  try {
    manualResponse = JSON.parse(rfi.manualResponseData || '{}');
  } catch (error) {
    log.error({ rfiId, error }, 'Failed to parse manual response data');
    throw new Error('Invalid manual response data');
  }
  
  // Update RFI with confirmation and close it out
  const updated = await prisma.rfi.update({
    where: { id: rfiId },
    data: {
      manualResponseConfirmedBy: userId,
      manualResponseConfirmedAt: new Date(),
      internalStatus: 'CLOSED',
      responseStatus: manualResponse.status,
      responseText: manualResponse.text,
    },
  });
  
  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CONFIRM_MANUAL_RESPONSE',
      entityType: 'RFI',
      entityId: rfiId,
      rfiId,
      details: JSON.stringify({
        manualResponseStatus: manualResponse.status,
        respondedBy: manualResponse.respondedBy,
        respondedAt: manualResponse.respondedAt,
        confirmedAt: new Date().toISOString(),
      }),
    },
  });
  
  // Create status history
  await prisma.statusHistory.create({
    data: {
      rfiId,
      fieldName: 'internalStatus',
      oldValue: rfi.internalStatus,
      newValue: 'CLOSED',
      changeReason: 'Manual response confirmed by admin',
    },
  });
  
  log.info({ rfiId, userId }, 'Manual RFI response confirmed and closed out');
  return updated;
}

/**
 * Admin confirms a manual Submittal response from ACC and closes it out
 */
export async function confirmManualSubmittalResponse(
  submittalId: string,
  userId: string
) {
  log.info({ submittalId, userId }, 'Admin confirming manual Submittal response');
  
  const submittal = await prisma.submittal.findUnique({
    where: { id: submittalId },
    include: {
      project: {
        include: {
          memberships: {
            where: { userId },
          },
        },
      },
    },
  });
  
  if (!submittal) {
    throw new Error('Submittal not found');
  }
  
  // PERMISSION CHECK: Only admins can confirm manual responses
  const membership = submittal.project.memberships[0];
  if (!membership) {
    throw new Error('User is not a member of this project');
  }
  
  const isAdmin = membership.role === 'PROJECT_ADMIN' || membership.canSendToAcc === true;
  if (!isAdmin) {
    log.warn({ submittalId, userId, role: membership.role }, 'Non-admin attempted to confirm manual response');
    throw new Error('Only project admins can confirm manual responses');
  }
  
  if (!submittal.hasManualResponse) {
    throw new Error('Submittal does not have a manual response to confirm');
  }
  
  if (submittal.manualResponseConfirmedAt) {
    throw new Error('Manual response has already been confirmed');
  }
  
  // Parse manual response data
  let manualResponse;
  try {
    manualResponse = JSON.parse(submittal.manualResponseData || '{}');
  } catch (error) {
    log.error({ submittalId, error }, 'Failed to parse manual response data');
    throw new Error('Invalid manual response data');
  }
  
  // Update Submittal with confirmation and close it out
  const updated = await prisma.submittal.update({
    where: { id: submittalId },
    data: {
      manualResponseConfirmedBy: userId,
      manualResponseConfirmedAt: new Date(),
      internalStatus: 'CLOSED',
      responseStatus: manualResponse.status,
      responseText: manualResponse.text,
    },
  });
  
  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'CONFIRM_MANUAL_RESPONSE',
      entityType: 'SUBMITTAL',
      entityId: submittalId,
      submittalId,
      details: JSON.stringify({
        manualResponseStatus: manualResponse.status,
        respondedBy: manualResponse.respondedBy,
        respondedAt: manualResponse.respondedAt,
        confirmedAt: new Date().toISOString(),
      }),
    },
  });
  
  // Create status history
  await prisma.statusHistory.create({
    data: {
      submittalId,
      fieldName: 'internalStatus',
      oldValue: submittal.internalStatus,
      newValue: 'CLOSED',
      changeReason: 'Manual response confirmed by admin',
    },
  });
  
  log.info({ submittalId, userId }, 'Manual Submittal response confirmed and closed out');
  return updated;
}
