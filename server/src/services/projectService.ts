/**
 * Project Service
 * Handles project management, membership, and settings
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import { validateNetworkPath } from './fileService';

const log = createChildLogger({ module: 'projectService' });

export interface CreateProjectDto {
  name: string;
  description?: string;
  networkBasePath?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  networkBasePath?: string;
  syncEnabled?: boolean;
  syncIntervalMinutes?: number;
  assignmentRules?: Record<string, string>;
  deadlineRules?: Record<string, any>;
  notificationRules?: Record<string, any>;
}

export interface AddProjectMemberDto {
  userId: string;
  role: 'PROJECT_ADMIN' | 'REVIEWER' | 'QC_REVIEWER' | 'VIEWER';
  canAssign?: boolean;
  canSendToAcc?: boolean;
  canEditSettings?: boolean;
}

/**
 * Create a new project
 */
export async function createProject(data: CreateProjectDto, creatorUserId: string) {
  log.info({ name: data.name }, 'Creating new project');
  
  let isNetworkPathValid = false;
  if (data.networkBasePath) {
    isNetworkPathValid = await validateNetworkPath(data.networkBasePath);
  }
  
  const project = await prisma.project.create({
    data: {
      name: data.name,
      description: data.description,
      networkBasePath: data.networkBasePath,
      isNetworkPathValid,
      lastPathCheckAt: data.networkBasePath ? new Date() : null,
      memberships: {
        create: {
          userId: creatorUserId,
          role: 'PROJECT_ADMIN',
          canAssign: true,
          canSendToAcc: true,
          canEditSettings: true,
        },
      },
    },
    include: {
      memberships: {
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
  });
  
  log.info({ projectId: project.id }, 'Project created successfully');
  return project;
}

/**
 * Get project by ID with full details
 */
export async function getProjectById(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      accProjectLinks: {
        include: {
          oauthToken: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              expiresAt: true,
            },
          },
          _count: {
            select: {
              rfis: true,
              submittals: true,
            },
          },
        },
      },
      memberships: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

/**
 * List all active projects for a user
 */
export async function listUserProjects(userId: string) {
  return prisma.project.findMany({
    where: {
      isActive: true,
      memberships: {
        some: {
          userId,
        },
      },
    },
    include: {
      accProjectLink: {
        select: {
          accProjectName: true,
          lastSyncStatus: true,
        },
      },
      memberships: {
        where: { userId },
        select: {
          role: true,
          canAssign: true,
          canSendToAcc: true,
          canEditSettings: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Update project settings
 */
export async function updateProject(projectId: string, data: UpdateProjectDto) {
  log.info({ projectId }, 'Updating project');
  
  const updateData: any = {};
  
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.syncEnabled !== undefined) updateData.syncEnabled = data.syncEnabled;
  if (data.syncIntervalMinutes !== undefined) updateData.syncIntervalMinutes = data.syncIntervalMinutes;
  
  if (data.networkBasePath !== undefined) {
    updateData.networkBasePath = data.networkBasePath;
    updateData.isNetworkPathValid = await validateNetworkPath(data.networkBasePath);
    updateData.lastPathCheckAt = new Date();
  }
  
  if (data.assignmentRules !== undefined) {
    updateData.assignmentRules = JSON.stringify(data.assignmentRules);
  }
  
  if (data.deadlineRules !== undefined) {
    updateData.deadlineRules = JSON.stringify(data.deadlineRules);
  }
  
  if (data.notificationRules !== undefined) {
    updateData.notificationRules = JSON.stringify(data.notificationRules);
  }
  
  return prisma.project.update({
    where: { id: projectId },
    data: updateData,
  });
}

/**
 * Add member to project
 */
export async function addProjectMember(projectId: string, data: AddProjectMemberDto) {
  log.info({ projectId, userId: data.userId }, 'Adding project member');
  
  return prisma.projectMembership.create({
    data: {
      projectId,
      userId: data.userId,
      role: data.role,
      canAssign: data.canAssign ?? (data.role === 'PROJECT_ADMIN'),
      canSendToAcc: data.canSendToAcc ?? (data.role === 'PROJECT_ADMIN'),
      canEditSettings: data.canEditSettings ?? (data.role === 'PROJECT_ADMIN'),
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
}

/**
 * Update project member role/permissions
 */
export async function updateProjectMember(
  projectId: string,
  userId: string,
  data: Partial<AddProjectMemberDto>
) {
  log.info({ projectId, userId }, 'Updating project member');
  
  return prisma.projectMembership.update({
    where: {
      projectId_userId: { projectId, userId },
    },
    data: {
      role: data.role,
      canAssign: data.canAssign,
      canSendToAcc: data.canSendToAcc,
      canEditSettings: data.canEditSettings,
    },
  });
}

/**
 * Remove member from project
 */
export async function removeProjectMember(projectId: string, userId: string) {
  log.info({ projectId, userId }, 'Removing project member');
  
  return prisma.projectMembership.delete({
    where: {
      projectId_userId: { projectId, userId },
    },
  });
}

/**
 * Get project members
 */
export async function getProjectMembers(projectId: string) {
  return prisma.projectMembership.findMany({
    where: { projectId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
          lastLoginAt: true,
        },
      },
    },
    orderBy: [
      { role: 'asc' },
      { createdAt: 'asc' },
    ],
  });
}

/**
 * Parse JSON settings fields
 */
export function parseProjectSettings(project: any) {
  return {
    ...project,
    assignmentRules: project.assignmentRules ? JSON.parse(project.assignmentRules) : null,
    deadlineRules: project.deadlineRules ? JSON.parse(project.deadlineRules) : null,
    notificationRules: project.notificationRules ? JSON.parse(project.notificationRules) : null,
  };
}

/**
 * Add an ACC project link to an existing project
 */
export async function addAccProjectLink(
  projectId: string,
  accProjectId: string,
  accHubId: string,
  accProjectName: string,
  folderName: string,
  oauthTokenId: string,
  syncRfis: boolean = true,
  syncSubmittals: boolean = true
) {
  log.info({ projectId, accProjectId, folderName }, 'Adding ACC project link');
  
  // Check if link already exists
  const existing = await prisma.accProjectLink.findUnique({
    where: {
      projectId_accProjectId: {
        projectId,
        accProjectId,
      },
    },
  });
  
  if (existing) {
    throw new Error('ACC project link already exists');
  }
  
  const link = await prisma.accProjectLink.create({
    data: {
      projectId,
      accProjectId,
      accHubId,
      accProjectName,
      folderName,
      oauthTokenId,
      syncRfis,
      syncSubmittals,
    },
    include: {
      oauthToken: true,
    },
  });
  
  log.info({ linkId: link.id, projectId, accProjectId }, 'ACC project link created');
  
  return link;
}

/**
 * Update an ACC project link
 */
export async function updateAccProjectLink(
  linkId: string,
  data: {
    folderName?: string;
    syncRfis?: boolean;
    syncSubmittals?: boolean;
    accProjectName?: string;
  }
) {
  log.info({ linkId, data }, 'Updating ACC project link');
  
  const link = await prisma.accProjectLink.update({
    where: { id: linkId },
    data,
    include: {
      oauthToken: true,
    },
  });
  
  log.info({ linkId }, 'ACC project link updated');
  
  return link;
}

/**
 * Remove an ACC project link
 */
export async function removeAccProjectLink(linkId: string) {
  log.info({ linkId }, 'Removing ACC project link');
  
  // Check if there are any RFIs or Submittals using this link
  const rfiCount = await prisma.rfi.count({
    where: { accProjectLinkId: linkId },
  });
  
  const submittalCount = await prisma.submittal.count({
    where: { accProjectLinkId: linkId },
  });
  
  if (rfiCount > 0 || submittalCount > 0) {
    throw new Error(`Cannot remove ACC project link: ${rfiCount} RFIs and ${submittalCount} Submittals are linked to it`);
  }
  
  await prisma.accProjectLink.delete({
    where: { id: linkId },
  });
  
  log.info({ linkId }, 'ACC project link removed');
}

/**
 * List all ACC project links for a project
 */
export async function listAccProjectLinks(projectId: string) {
  return prisma.accProjectLink.findMany({
    where: { projectId },
    include: {
      oauthToken: {
        select: {
          id: true,
          userId: true,
          expiresAt: true,
        },
      },
      _count: {
        select: {
          rfis: true,
          submittals: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Get a single ACC project link by ID
 */
export async function getAccProjectLink(linkId: string) {
  return prisma.accProjectLink.findUnique({
    where: { id: linkId },
    include: {
      project: true,
      oauthToken: true,
      _count: {
        select: {
          rfis: true,
          submittals: true,
        },
      },
    },
  });
}
