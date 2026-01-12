/**
 * Submittal Service
 * Business logic for Submittal management (mirrors RFI service)
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import { createNotification } from './notificationService';
import { calculateInternalDeadlines } from './workflowService';

const log = createChildLogger({ module: 'submittalService' });

export interface ListSubmittalsQuery {
  projectId: string;
  status?: string;
  priority?: string;
  assignedToUserId?: string;
  showClosed?: boolean;
  search?: string;
}

export interface UpdateSubmittalDto {
  internalStatus?: string;
  responseStatus?: string;
  responseText?: string;
  reviewDeadline?: Date;
  qcDeadline?: Date;
}

export async function listSubmittals(query: ListSubmittalsQuery) {
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
      { specSection: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  
  return prisma.submittal.findMany({
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

export async function getSubmittalById(submittalId: string) {
  return prisma.submittal.findUnique({
    where: { id: submittalId },
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

export async function updateSubmittal(submittalId: string, userId: string, data: UpdateSubmittalDto) {
  log.info({ submittalId, userId }, 'Updating Submittal');
  
  const submittal = await prisma.submittal.findUnique({
    where: { id: submittalId },
    select: { internalStatus: true, responseStatus: true, projectId: true },
  });
  
  if (!submittal) {
    throw new Error('Submittal not found');
  }
  
  const updated = await prisma.submittal.update({
    where: { id: submittalId },
    data,
  });
  
  if (data.internalStatus && data.internalStatus !== submittal.internalStatus) {
    await prisma.statusHistory.create({
      data: {
        submittalId,
        fieldName: 'internalStatus',
        oldValue: submittal.internalStatus,
        newValue: data.internalStatus,
        changedBy: userId,
      },
    });
  }
  
  if (data.responseStatus && data.responseStatus !== submittal.responseStatus) {
    await prisma.statusHistory.create({
      data: {
        submittalId,
        fieldName: 'responseStatus',
        oldValue: submittal.responseStatus || '',
        newValue: data.responseStatus,
        changedBy: userId,
      },
    });
  }
  
  return updated;
}

export async function assignSubmittal(
  submittalId: string,
  userId: string,
  role: 'REVIEWER' | 'QC_REVIEWER',
  assignedBy: string
) {
  log.info({ submittalId, userId, role, assignedBy }, 'Assigning Submittal');
  
  const assignment = await prisma.submittalAssignment.create({
    data: {
      submittalId,
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
  
  const submittal = await prisma.submittal.findUnique({
    where: { id: submittalId },
    select: { accDueDate: true, priority: true, projectId: true },
  });
  
  if (submittal?.accDueDate) {
    const deadlines = await calculateInternalDeadlines(submittal.projectId, submittal.accDueDate, submittal.priority);
    
    await prisma.submittal.update({
      where: { id: submittalId },
      data: {
        reviewDeadline: deadlines.reviewDeadline,
        qcDeadline: deadlines.qcDeadline,
        internalStatus: 'ASSIGNED_FOR_REVIEW',
      },
    });
  }
  
  await createNotification({
    userId,
    type: 'ASSIGNMENT',
    title: 'New Submittal Assignment',
    message: `You have been assigned as ${role} for Submittal`,
    submittalId,
  });
  
  await prisma.statusHistory.create({
    data: {
      submittalId,
      fieldName: 'assignment',
      newValue: `${role}: ${assignment.user.firstName} ${assignment.user.lastName}`,
      changedBy: assignedBy,
    },
  });
  
  return assignment;
}

export async function acknowledgeAccChanges(submittalId: string, userId: string) {
  log.info({ submittalId, userId }, 'Acknowledging ACC changes');
  
  return prisma.submittal.update({
    where: { id: submittalId },
    data: {
      hasUnacknowledgedChange: false,
    },
  });
}

export async function getUserSubmittals(projectId: string, userId: string) {
  return prisma.submittal.findMany({
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
