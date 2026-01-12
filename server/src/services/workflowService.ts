/**
 * Workflow Service
 * Handles internal workflow rules, auto-assignment, and deadline calculation
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';

const log = createChildLogger({ module: 'workflowService' });

/**
 * Calculate internal deadlines based on project rules
 */
export async function calculateInternalDeadlines(
  projectId: string,
  accDueDate: Date,
  priority?: string | null
): Promise<{ reviewDeadline: Date; qcDeadline: Date }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { deadlineRules: true },
  });
  
  const rules = project?.deadlineRules ? JSON.parse(project.deadlineRules) : null;
  
  // Default percentages if no rules configured
  let reviewPercent = 50;
  let qcPercent = 75;
  
  if (rules && priority) {
    const priorityLower = priority.toLowerCase();
    if (rules[priorityLower]) {
      reviewPercent = rules[priorityLower].reviewPercent || reviewPercent;
      qcPercent = rules[priorityLower].qcPercent || qcPercent;
    }
  }
  
  const now = new Date();
  const totalMs = accDueDate.getTime() - now.getTime();
  
  const reviewDeadline = new Date(now.getTime() + totalMs * (reviewPercent / 100));
  const qcDeadline = new Date(now.getTime() + totalMs * (qcPercent / 100));
  
  return { reviewDeadline, qcDeadline };
}

/**
 * Auto-assign RFI/Submittal based on project rules
 */
export async function autoAssign(
  projectId: string,
  itemType: 'RFI' | 'SUBMITTAL',
  itemId: string,
  discipline?: string
): Promise<void> {
  log.info({ projectId, itemType, itemId, discipline }, 'Auto-assigning item');
  
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { assignmentRules: true },
  });
  
  if (!project?.assignmentRules) {
    log.debug('No assignment rules configured');
    return;
  }
  
  const rules = JSON.parse(project.assignmentRules);
  
  let reviewerUserId: string | null = null;
  let qcUserId: string | null = null;
  
  // Check discipline mapping
  if (discipline && rules.disciplines && rules.disciplines[discipline]) {
    reviewerUserId = rules.disciplines[discipline];
  }
  
  // Fallback to defaults
  if (!reviewerUserId && rules.defaultReviewer) {
    reviewerUserId = rules.defaultReviewer;
  }
  
  if (rules.defaultQC) {
    qcUserId = rules.defaultQC;
  }
  
  // Create assignments
  if (reviewerUserId) {
    if (itemType === 'RFI') {
      await prisma.rfiAssignment.create({
        data: {
          rfiId: itemId,
          userId: reviewerUserId,
          role: 'REVIEWER',
          isUnread: true,
        },
      });
    } else {
      await prisma.submittalAssignment.create({
        data: {
          submittalId: itemId,
          userId: reviewerUserId,
          role: 'REVIEWER',
          isUnread: true,
        },
      });
    }
    
    log.info({ reviewerUserId, itemType, itemId }, 'Auto-assigned reviewer');
  }
  
  if (qcUserId && qcUserId !== reviewerUserId) {
    if (itemType === 'RFI') {
      await prisma.rfiAssignment.create({
        data: {
          rfiId: itemId,
          userId: qcUserId,
          role: 'QC_REVIEWER',
          isUnread: true,
        },
      });
    } else {
      await prisma.submittalAssignment.create({
        data: {
          submittalId: itemId,
          userId: qcUserId,
          role: 'QC_REVIEWER',
          isUnread: true,
        },
      });
    }
    
    log.info({ qcUserId, itemType, itemId }, 'Auto-assigned QC reviewer');
  }
}

/**
 * Validate status transition
 */
export function canTransitionStatus(
  currentStatus: string,
  newStatus: string,
  userRole: string
): boolean {
  const transitions: Record<string, string[]> = {
    UNASSIGNED: ['ASSIGNED_FOR_REVIEW'],
    ASSIGNED_FOR_REVIEW: ['UNDER_REVIEW', 'UNASSIGNED'],
    UNDER_REVIEW: ['UNDER_QC', 'ASSIGNED_FOR_REVIEW'],
    UNDER_QC: ['READY_FOR_RESPONSE', 'UNDER_REVIEW'],
    READY_FOR_RESPONSE: ['SENT_TO_ACC', 'UNDER_QC'],
    SENT_TO_ACC: ['CLOSED'],
    CLOSED: [],
  };
  
  const allowedTransitions = transitions[currentStatus] || [];
  
  if (!allowedTransitions.includes(newStatus)) {
    return false;
  }
  
  // Role-based restrictions
  if (userRole === 'VIEWER') {
    return false;
  }
  
  if (userRole === 'REVIEWER' && ['SENT_TO_ACC', 'CLOSED'].includes(newStatus)) {
    return false;
  }
  
  if (userRole === 'QC_REVIEWER' && ['SENT_TO_ACC', 'CLOSED'].includes(newStatus)) {
    return false;
  }
  
  return true;
}
