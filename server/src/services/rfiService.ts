/**
 * RFI Service
 * Business logic for RFI management, assignments, and workflows
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import { createNotification } from './notificationService';
import { calculateInternalDeadlines } from './workflowService';

const log = createChildLogger({ module: 'rfiService' });

export interface ListRfisQuery {
  projectId: string;
  status?: string;
  priority?: string;
  assignedToUserId?: string;
  showClosed?: boolean;
  search?: string;
}

export interface UpdateRfiDto {
  internalStatus?: string;
  responseStatus?: string;
  responseText?: string;
  reviewDeadline?: Date;
  qcDeadline?: Date;
}

/**
 * List RFIs with filters
 */
export async function listRfis(query: ListRfisQuery) {
  const where: any = {
    projectId: query.projectId,
    isDeleted: false,
  };
  
  if (!query.showClosed) {
    where.internalStatus = { not: 'CLOSED' };
  }
  
  if (query.status) {
    where.internalStatus = query.status;
  }
  
  if (query.priority) {
    where.priority = query.priority;
  }
  
  if (query.assignedToUserId) {
    where.assignments = {
      some: {
        userId: query.assignedToUserId,
      },
    };
  }
  
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { accNumber: { contains: query.search, mode: 'insensitive' } },
      { accDescription: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  
  return prisma.rfi.findMany({
    where,
    include: {
      assignments: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
    orderBy: [
      { hasUnacknowledgedChange: 'desc' },
      { accDueDate: 'asc' },
      { createdAt: 'desc' },
    ],
  });
}

/**
 * Get RFI by ID with full details
 */
export async function getRfiById(rfiId: string) {
  return prisma.rfi.findUnique({
    where: { id: rfiId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          networkBasePath: true,
        },
      },
      assignments: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { assignedAt: 'asc' },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
      },
      comments: {
        where: { parentId: null },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          replies: {
            include: {
              author: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });
}

/**
 * Update RFI internal status and workflow
 */
export async function updateRfi(rfiId: string, userId: string, data: UpdateRfiDto) {
  log.info({ rfiId, userId }, 'Updating RFI');
  
  const rfi = await prisma.rfi.findUnique({
    where: { id: rfiId },
    select: { internalStatus: true, responseStatus: true, projectId: true },
  });
  
  if (!rfi) {
    throw new Error('RFI not found');
  }
  
  const updated = await prisma.rfi.update({
    where: { id: rfiId },
    data,
  });
  
  // Track status history
  if (data.internalStatus && data.internalStatus !== rfi.internalStatus) {
    await prisma.statusHistory.create({
      data: {
        rfiId,
        fieldName: 'internalStatus',
        oldValue: rfi.internalStatus,
        newValue: data.internalStatus,
        changedBy: userId,
      },
    });
  }
  
  if (data.responseStatus && data.responseStatus !== rfi.responseStatus) {
    await prisma.statusHistory.create({
      data: {
        rfiId,
        fieldName: 'responseStatus',
        oldValue: rfi.responseStatus || '',
        newValue: data.responseStatus,
        changedBy: userId,
      },
    });
  }
  
  return updated;
}

/**
 * Assign user to RFI
 */
export async function assignRfi(
  rfiId: string,
  userId: string,
  role: 'REVIEWER' | 'QC_REVIEWER',
  assignedBy: string
) {
  log.info({ rfiId, userId, role, assignedBy }, 'Assigning RFI');
  
  const assignment = await prisma.rfiAssignment.create({
    data: {
      rfiId,
      userId,
      role,
      assignedBy,
      isUnread: true,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  
  // Calculate internal deadlines
  const rfi = await prisma.rfi.findUnique({
    where: { id: rfiId },
    select: { accDueDate: true, priority: true, projectId: true },
  });
  
  if (rfi?.accDueDate) {
    const deadlines = await calculateInternalDeadlines(rfi.projectId, rfi.accDueDate, rfi.priority);
    
    await prisma.rfi.update({
      where: { id: rfiId },
      data: {
        reviewDeadline: deadlines.reviewDeadline,
        qcDeadline: deadlines.qcDeadline,
        internalStatus: 'ASSIGNED_FOR_REVIEW',
      },
    });
  }
  
  // Create notification
  await createNotification({
    userId,
    type: 'ASSIGNMENT',
    title: 'New RFI Assignment',
    message: `You have been assigned as ${role} for RFI`,
    rfiId,
  });
  
  // Track in history
  await prisma.statusHistory.create({
    data: {
      rfiId,
      fieldName: 'assignment',
      newValue: `${role}: ${assignment.user.firstName} ${assignment.user.lastName}`,
      changedBy: assignedBy,
    },
  });
  
  return assignment;
}

/**
 * Mark assignment as read
 */
export async function markAssignmentRead(rfiId: string, userId: string) {
  return prisma.rfiAssignment.updateMany({
    where: {
      rfiId,
      userId,
      isUnread: true,
    },
    data: {
      isUnread: false,
    },
  });
}

/**
 * Acknowledge ACC changes
 */
export async function acknowledgeAccChanges(rfiId: string, userId: string) {
  log.info({ rfiId, userId }, 'Acknowledging ACC changes');
  
  return prisma.rfi.update({
    where: { id: rfiId },
    data: {
      hasUnacknowledgedChange: false,
    },
  });
}

/**
 * Add comment to RFI
 */
export async function addComment(rfiId: string, userId: string, text: string, parentId?: string) {
  const comment = await prisma.comment.create({
    data: {
      rfiId,
      authorId: userId,
      text,
      parentId,
    },
    include: {
      author: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
  
  // Extract mentions from text (e.g., @userId)
  const mentionRegex = /@([a-f0-9-]+)/g;
  const mentions = [...text.matchAll(mentionRegex)].map(m => m[1]);
  
  if (mentions.length > 0) {
    await prisma.comment.update({
      where: { id: comment.id },
      data: { mentions: JSON.stringify(mentions) },
    });
    
    // Create notifications for mentions
    for (const mentionedUserId of mentions) {
      await createNotification({
        userId: mentionedUserId,
        type: 'MENTION',
        title: 'You were mentioned in a comment',
        message: `${comment.author.firstName} ${comment.author.lastName} mentioned you`,
        rfiId,
      });
    }
  }
  
  return comment;
}

/**
 * Get user's RFIs (for "My Work" page)
 */
export async function getUserRfis(projectId: string, userId: string) {
  return prisma.rfi.findMany({
    where: {
      projectId,
      isDeleted: false,
      internalStatus: { not: 'CLOSED' },
      assignments: {
        some: {
          userId,
        },
      },
    },
    include: {
      assignments: {
        where: { userId },
        select: {
          role: true,
          isUnread: true,
          assignedAt: true,
        },
      },
    },
    orderBy: [
      { hasUnacknowledgedChange: 'desc' },
      { reviewDeadline: 'asc' },
      { accDueDate: 'asc' },
    ],
  });
}
