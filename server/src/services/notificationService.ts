/**
 * Notification Service
 * Handles creation and management of in-app notifications
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';

const log = createChildLogger({ module: 'notificationService' });

export interface CreateNotificationDto {
  userId: string;
  type: 'ASSIGNMENT' | 'DEADLINE_WARNING' | 'ACC_CHANGE' | 'MENTION' | 'STATUS_CHANGE';
  title: string;
  message: string;
  rfiId?: string;
  submittalId?: string;
  metadata?: Record<string, any>;
}

/**
 * Create a new notification
 */
export async function createNotification(data: CreateNotificationDto) {
  log.info({ userId: data.userId, type: data.type }, 'Creating notification');
  
  return prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      rfiId: data.rfiId,
      submittalId: data.submittalId,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      isRead: false,
    },
  });
}

/**
 * List user's notifications
 */
export async function listNotifications(userId: string, unreadOnly: boolean = false) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(unreadOnly && { isRead: false }),
    },
    include: {
      rfi: {
        select: {
          id: true,
          accNumber: true,
          title: true,
        },
      },
      submittal: {
        select: {
          id: true,
          accNumber: true,
          title: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Mark notification as read
 */
export async function markNotificationRead(notificationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

/**
 * Mark all notifications as read
 */
export async function markAllNotificationsRead(userId: string) {
  return prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

/**
 * Delete notification
 */
export async function deleteNotification(notificationId: string, userId: string) {
  return prisma.notification.deleteMany({
    where: {
      id: notificationId,
      userId,
    },
  });
}

/**
 * Get unread count
 */
export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  });
}

/**
 * Create deadline warning notifications (called by cron job)
 */
export async function createDeadlineWarnings() {
  log.info('Creating deadline warning notifications');
  
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  
  // Find RFIs with upcoming deadlines
  const upcomingRfis = await prisma.rfi.findMany({
    where: {
      internalStatus: { in: ['ASSIGNED_FOR_REVIEW', 'UNDER_REVIEW', 'UNDER_QC'] },
      OR: [
        {
          reviewDeadline: {
            gte: now,
            lte: threeDaysFromNow,
          },
        },
        {
          qcDeadline: {
            gte: now,
            lte: threeDaysFromNow,
          },
        },
      ],
    },
    include: {
      assignments: true,
    },
  });
  
  for (const rfi of upcomingRfis) {
    for (const assignment of rfi.assignments) {
      const deadline = assignment.role === 'REVIEWER' ? rfi.reviewDeadline : rfi.qcDeadline;
      if (!deadline) continue;
      
      const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      
      // Check if notification already exists
      const existing = await prisma.notification.findFirst({
        where: {
          userId: assignment.userId,
          rfiId: rfi.id,
          type: 'DEADLINE_WARNING',
          createdAt: {
            gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Within last 24 hours
          },
        },
      });
      
      if (!existing) {
        await createNotification({
          userId: assignment.userId,
          type: 'DEADLINE_WARNING',
          title: `Deadline approaching: ${rfi.accNumber}`,
          message: `${assignment.role} deadline in ${daysUntil} day(s)`,
          rfiId: rfi.id,
        });
      }
    }
  }
  
  // Similar logic for Submittals
  const upcomingSubmittals = await prisma.submittal.findMany({
    where: {
      internalStatus: { in: ['ASSIGNED_FOR_REVIEW', 'UNDER_REVIEW', 'UNDER_QC'] },
      OR: [
        {
          reviewDeadline: {
            gte: now,
            lte: threeDaysFromNow,
          },
        },
        {
          qcDeadline: {
            gte: now,
            lte: threeDaysFromNow,
          },
        },
      ],
    },
    include: {
      assignments: true,
    },
  });
  
  for (const submittal of upcomingSubmittals) {
    for (const assignment of submittal.assignments) {
      const deadline = assignment.role === 'REVIEWER' ? submittal.reviewDeadline : submittal.qcDeadline;
      if (!deadline) continue;
      
      const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      
      const existing = await prisma.notification.findFirst({
        where: {
          userId: assignment.userId,
          submittalId: submittal.id,
          type: 'DEADLINE_WARNING',
          createdAt: {
            gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          },
        },
      });
      
      if (!existing) {
        await createNotification({
          userId: assignment.userId,
          type: 'DEADLINE_WARNING',
          title: `Deadline approaching: ${submittal.accNumber}`,
          message: `${assignment.role} deadline in ${daysUntil} day(s)`,
          submittalId: submittal.id,
        });
      }
    }
  }
  
  log.info('Deadline warnings created');
}
