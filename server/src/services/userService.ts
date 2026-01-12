/**
 * User Service
 * Handles user management, authentication, and authorization
 */

import { prisma } from '../lib/prisma';
import { logger, createChildLogger } from '../lib/logger';
import { hash, compare } from 'bcrypt';

const log = createChildLogger({ module: 'userService' });

const SALT_ROUNDS = 10;

export interface CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
}

/**
 * Create a new user with hashed password
 */
export async function createUser(data: CreateUserDto) {
  log.info({ email: data.email }, 'Creating new user');
  
  const passwordHash = await hash(data.password, SALT_ROUNDS);
  
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      createdAt: true,
    },
  });
  
  log.info({ userId: user.id }, 'User created successfully');
  return user;
}

/**
 * Verify user credentials
 */
export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
  });
  
  if (!user || !user.passwordHash) {
    return null;
  }
  
  const isValid = await compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }
  
  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
  };
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}

/**
 * Update user
 */
export async function updateUser(userId: string, data: UpdateUserDto) {
  log.info({ userId }, 'Updating user');
  
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      updatedAt: true,
    },
  });
}

/**
 * List all users (for admin)
 */
export async function listUsers() {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get user's project memberships with roles
 */
export async function getUserProjectMemberships(userId: string) {
  return prisma.projectMembership.findMany({
    where: { userId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          isActive: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Check if user has role in project
 */
export async function hasProjectRole(
  userId: string,
  projectId: string,
  requiredRoles: string[]
): Promise<boolean> {
  const membership = await prisma.projectMembership.findUnique({
    where: {
      projectId_userId: { projectId, userId },
    },
  });
  
  if (!membership) {
    return false;
  }
  
  return requiredRoles.includes(membership.role);
}

/**
 * Check if user has specific permission in project
 */
export async function hasProjectPermission(
  userId: string,
  projectId: string,
  permission: 'canAssign' | 'canSendToAcc' | 'canEditSettings'
): Promise<boolean> {
  const membership = await prisma.projectMembership.findUnique({
    where: {
      projectId_userId: { projectId, userId },
    },
  });
  
  if (!membership) {
    return false;
  }
  
  return membership[permission];
}
