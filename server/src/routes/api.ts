import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import {
  getValidAccessToken,
  getUserProfile,
  listHubsAndProjects,
  listTopFolders,
  uploadToDocs,
} from '../lib/accClient';
import { syncProject } from '../services/syncService';
import type { HubWithProjects, ProjectListItem, SyncRunRequest } from '@acc-integration/shared';

const router = Router();

// All API routes require authentication
router.use(requireAuth);

/**
 * GET /api/me
 * Returns current user info and token status
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    
    const authToken = await prisma.authToken.findUnique({
      where: { userId },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        expiresAt: true,
        scopes: true,
        updatedAt: true,
      },
    });
    
    if (!authToken) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        requestId: req.requestId,
      });
    }
    
    // Get fresh profile from Autodesk
    let profile = null;
    try {
      const accessToken = await getValidAccessToken(userId);
      if (accessToken) {
        profile = await getUserProfile(accessToken);
      }
    } catch (error) {
      logger.warn({ requestId: req.requestId, error }, 'Failed to fetch profile');
    }
    
    res.json({
      success: true,
      data: {
        userId,
        email: profile?.emailId || authToken.email,
        firstName: profile?.firstName || authToken.firstName,
        lastName: profile?.lastName || authToken.lastName,
        tokenExpiresAt: authToken.expiresAt.toISOString(),
        lastUpdated: authToken.updatedAt.toISOString(),
        scopes: authToken.scopes.split(','),
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to get user info');
    res.status(500).json({
      success: false,
      error: 'Failed to get user info',
      requestId: req.requestId,
    });
  }
});

/**
 * GET /api/projects
 * Lists all hubs and projects accessible to the user
 */
router.get('/projects', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        requestId: req.requestId,
      });
    }
    
    const hubsAndProjects = await listHubsAndProjects(accessToken);
    
    // Transform to simpler format
    const result: HubWithProjects[] = hubsAndProjects.map(({ hub, projects }) => ({
      id: hub.id,
      name: hub.attributes.name,
      region: hub.attributes.region,
      projects: projects.map((project): ProjectListItem => ({
        id: project.id,
        name: project.attributes.name,
        hubId: hub.id,
        hubName: hub.attributes.name,
        region: hub.attributes.region,
        projectType: project.attributes.extension?.data?.projectType || 'unknown',
        webViewUrl: project.links?.webView?.href,
      })),
    }));
    
    res.json({
      success: true,
      data: result,
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to list projects');
    res.status(500).json({
      success: false,
      error: 'Failed to list projects',
      requestId: req.requestId,
    });
  }
});

/**
 * GET /api/projects/:projectId/folders
 * Lists top folders for a project
 */
router.get('/projects/:hubId/:projectId/folders', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { hubId, projectId } = req.params;
    
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        requestId: req.requestId,
      });
    }
    
    const folders = await listTopFolders(accessToken, hubId, projectId);
    
    res.json({
      success: true,
      data: folders.map(folder => ({
        id: folder.id,
        name: folder.attributes.displayName || folder.attributes.name,
        type: folder.type,
      })),
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to list folders');
    res.status(500).json({
      success: false,
      error: 'Failed to list folders',
      requestId: req.requestId,
    });
  }
});

/**
 * POST /api/sync/run
 * Triggers a manual sync for a project
 */
router.post('/sync/run', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { projectId, modules = ['rfi', 'submittal'] } = req.body as SyncRunRequest;
    
    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'projectId is required',
        requestId: req.requestId,
      });
    }
    
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        requestId: req.requestId,
      });
    }
    
    const startTime = Date.now();
    
    // Run sync for each module
    const results = await Promise.all(
      modules.map(module => syncProject(accessToken, projectId, module, 'manual'))
    );
    
    const totalDuration = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        projectId,
        results: results.map(r => ({
          module: r.module,
          success: r.success,
          itemsProcessed: r.itemsProcessed,
          newItems: r.newItems,
          errors: r.errors,
          duration: r.duration,
        })),
        totalDuration,
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to run sync');
    res.status(500).json({
      success: false,
      error: 'Failed to run sync',
      requestId: req.requestId,
    });
  }
});

/**
 * POST /api/upload-test
 * Tests file upload to ACC Docs
 */
router.post('/upload-test', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { 
      projectId = config.defaultProjectId,
      folderUrn = config.defaultDocsFolderUrn,
      fileName = `test-upload-${Date.now()}.txt`,
      content = `Test file uploaded at ${new Date().toISOString()}`,
    } = req.body;
    
    if (!projectId || !folderUrn) {
      return res.status(400).json({
        success: false,
        error: 'projectId and folderUrn are required (or set DEFAULT_PROJECT_ID and DEFAULT_DOCS_FOLDER_URN)',
        requestId: req.requestId,
      });
    }
    
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        requestId: req.requestId,
      });
    }
    
    // Create temp file
    const tempDir = path.join(config.storagePath, 'temp');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, fileName);
    await fs.promises.writeFile(tempFilePath, content);
    
    try {
      // Upload to ACC
      const result = await uploadToDocs(accessToken, projectId, folderUrn, tempFilePath);
      
      res.json({
        success: true,
        data: {
          itemId: result.itemId,
          versionId: result.versionId,
          fileName,
        },
        requestId: req.requestId,
      });
    } finally {
      // Clean up temp file
      await fs.promises.unlink(tempFilePath).catch(() => {});
    }
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to upload test file');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload test file',
      requestId: req.requestId,
    });
  }
});

/**
 * GET /api/sync/history
 * Returns sync history for a project
 */
router.get('/sync/history', async (req: Request, res: Response) => {
  try {
    const { projectId, limit = '20' } = req.query;
    
    const where = projectId ? { projectId: projectId as string } : {};
    
    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: parseInt(limit as string, 10),
    });
    
    res.json({
      success: true,
      data: logs.map(log => ({
        id: log.id,
        projectId: log.projectId,
        module: log.module,
        status: log.status,
        itemsProcessed: log.itemsProcessed,
        newItems: log.newItems,
        errors: log.errors ? JSON.parse(log.errors) : [],
        duration: log.duration,
        triggeredBy: log.triggeredBy,
        startedAt: log.startedAt.toISOString(),
        completedAt: log.completedAt?.toISOString(),
      })),
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error({ requestId: req.requestId, error }, 'Failed to get sync history');
    res.status(500).json({
      success: false,
      error: 'Failed to get sync history',
      requestId: req.requestId,
    });
  }
});

export default router;
