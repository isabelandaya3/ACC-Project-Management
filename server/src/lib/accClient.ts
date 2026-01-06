/**
 * Autodesk Construction Cloud (ACC) API Client
 * 
 * This module provides functions for interacting with Autodesk Platform Services (APS)
 * including OAuth, Data Management, and ACC-specific APIs.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger, createChildLogger } from './logger';
import { prisma } from './prisma';
import { encrypt, decrypt } from './crypto';
import type {
  APSTokenResponse,
  APSUserProfile,
  APSHub,
  APSProject,
  APSFolder,
  APSStorageLocation,
  ACCRFI,
  ACCRFIListResponse,
  ACCSubmittal,
  ACCSubmittalListResponse,
  AttachmentRef,
  SyncModule,
} from '@acc-integration/shared';

const log = createChildLogger({ module: 'accClient' });

// ============================================================================
// OAuth Functions
// ============================================================================

/**
 * Generates the OAuth authorization URL
 */
export function getAuthorizationUrl(state: string): string {
  const scopes = config.autodesk.scopes.join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.autodesk.clientId,
    redirect_uri: config.autodesk.callbackUrl,
    scope: scopes,
    state,
  });
  
  return `${config.autodesk.authBaseUrl}/authorize?${params.toString()}`;
}

/**
 * Exchanges authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<APSTokenResponse> {
  log.info('Exchanging authorization code for tokens');
  
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.autodesk.callbackUrl,
  });
  
  const response = await axios.post<APSTokenResponse>(
    `${config.autodesk.authBaseUrl}/token`,
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: config.autodesk.clientId,
        password: config.autodesk.clientSecret,
      },
    }
  );
  
  log.info('Token exchange successful');
  return response.data;
}

/**
 * Refreshes an access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<APSTokenResponse> {
  log.info('Refreshing access token');
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  
  const response = await axios.post<APSTokenResponse>(
    `${config.autodesk.authBaseUrl}/token`,
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: config.autodesk.clientId,
        password: config.autodesk.clientSecret,
      },
    }
  );
  
  log.info('Token refresh successful');
  return response.data;
}

/**
 * Stores tokens in the database (encrypted)
 */
export async function storeTokens(
  userId: string,
  tokens: APSTokenResponse,
  profile: APSUserProfile
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  
  await prisma.authToken.upsert({
    where: { userId },
    create: {
      userId,
      email: profile.emailId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt,
      scopes: config.autodesk.scopes.join(','),
    },
    update: {
      email: profile.emailId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      expiresAt,
      scopes: config.autodesk.scopes.join(','),
    },
  });
  
  log.info({ userId }, 'Tokens stored successfully');
}

/**
 * Gets a valid access token for a user, refreshing if necessary
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const authToken = await prisma.authToken.findUnique({
    where: { userId },
  });
  
  if (!authToken) {
    log.warn({ userId }, 'No token found for user');
    return null;
  }
  
  // Check if token is expired or will expire in the next 5 minutes
  const bufferTime = 5 * 60 * 1000; // 5 minutes
  const isExpired = authToken.expiresAt.getTime() - bufferTime < Date.now();
  
  if (!isExpired) {
    return decrypt(authToken.accessToken);
  }
  
  // Token is expired, try to refresh
  log.info({ userId }, 'Token expired, refreshing');
  
  try {
    const refreshToken = decrypt(authToken.refreshToken);
    const newTokens = await refreshAccessToken(refreshToken);
    
    // Get updated profile
    const profile = await getUserProfile(newTokens.access_token);
    
    // Store new tokens
    await storeTokens(userId, newTokens, profile);
    
    return newTokens.access_token;
  } catch (error) {
    log.error({ userId, error }, 'Failed to refresh token');
    
    // Delete invalid token
    await prisma.authToken.delete({ where: { userId } });
    
    return null;
  }
}

// ============================================================================
// User Profile
// ============================================================================

/**
 * Gets the current user's profile
 */
export async function getUserProfile(accessToken: string): Promise<APSUserProfile> {
  log.debug('Fetching user profile');
  
  const response = await axios.get<APSUserProfile>(
    `${config.autodesk.apiBaseUrl}/userprofile/v1/users/@me`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  
  return response.data;
}

// ============================================================================
// API Client Factory
// ============================================================================

/**
 * Creates an authenticated Axios instance for APS API calls
 */
function createApiClient(accessToken: string): AxiosInstance {
  const client = axios.create({
    baseURL: config.autodesk.apiBaseUrl,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  
  // Add request logging
  client.interceptors.request.use((config) => {
    log.debug({ method: config.method, url: config.url }, 'API Request');
    return config;
  });
  
  // Add response logging and error handling
  client.interceptors.response.use(
    (response) => {
      log.debug({ status: response.status, url: response.config.url }, 'API Response');
      return response;
    },
    (error: AxiosError) => {
      log.error({
        status: error.response?.status,
        url: error.config?.url,
        error: error.response?.data,
      }, 'API Error');
      throw error;
    }
  );
  
  return client;
}

// ============================================================================
// Hubs and Projects
// ============================================================================

interface HubsResponse {
  data: APSHub[];
}

interface ProjectsResponse {
  data: APSProject[];
}

/**
 * Lists all hubs (BIM 360/ACC accounts) accessible to the user
 */
export async function listHubs(accessToken: string): Promise<APSHub[]> {
  log.info('Listing hubs');
  
  const client = createApiClient(accessToken);
  const response = await client.get<HubsResponse>('/project/v1/hubs');
  
  log.info({ count: response.data.data.length }, 'Hubs retrieved');
  return response.data.data;
}

/**
 * Lists all projects within a hub
 */
export async function listProjects(accessToken: string, hubId: string): Promise<APSProject[]> {
  log.info({ hubId }, 'Listing projects for hub');
  
  const client = createApiClient(accessToken);
  const response = await client.get<ProjectsResponse>(`/project/v1/hubs/${hubId}/projects`);
  
  log.info({ hubId, count: response.data.data.length }, 'Projects retrieved');
  return response.data.data;
}

/**
 * Lists all hubs and their projects
 */
export async function listHubsAndProjects(accessToken: string): Promise<{ hub: APSHub; projects: APSProject[] }[]> {
  const hubs = await listHubs(accessToken);
  
  const results = await Promise.all(
    hubs.map(async (hub) => {
      const projects = await listProjects(accessToken, hub.id);
      return { hub, projects };
    })
  );
  
  return results;
}

// ============================================================================
// Folders and Items
// ============================================================================

interface FoldersResponse {
  data: APSFolder[];
}

/**
 * Lists top folders in a project
 */
export async function listTopFolders(accessToken: string, hubId: string, projectId: string): Promise<APSFolder[]> {
  log.info({ hubId, projectId }, 'Listing top folders');
  
  const client = createApiClient(accessToken);
  const response = await client.get<FoldersResponse>(
    `/project/v1/hubs/${hubId}/projects/${projectId}/topFolders`
  );
  
  return response.data.data;
}

/**
 * Lists contents of a folder
 */
export async function listFolderContents(accessToken: string, projectId: string, folderId: string): Promise<(APSFolder | APSItem)[]> {
  log.info({ projectId, folderId }, 'Listing folder contents');
  
  const client = createApiClient(accessToken);
  const response = await client.get<{ data: (APSFolder | APSItem)[] }>(
    `/data/v1/projects/${projectId}/folders/${folderId}/contents`
  );
  
  return response.data.data;
}

// Need to import this type
interface APSItem {
  type: string;
  id: string;
  attributes: {
    displayName: string;
    [key: string]: unknown;
  };
}

// ============================================================================
// File Upload (APS Data Management)
// ============================================================================

interface StorageResponse {
  data: APSStorageLocation;
}

interface ItemResponse {
  data: {
    type: string;
    id: string;
  };
}

/**
 * Creates a storage location for file upload
 */
async function createStorageLocation(
  accessToken: string,
  projectId: string,
  folderUrn: string,
  fileName: string
): Promise<APSStorageLocation> {
  log.info({ projectId, folderUrn, fileName }, 'Creating storage location');
  
  const client = createApiClient(accessToken);
  
  const payload = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'objects',
      attributes: {
        name: fileName,
      },
      relationships: {
        target: {
          data: {
            type: 'folders',
            id: folderUrn,
          },
        },
      },
    },
  };
  
  const response = await client.post<StorageResponse>(
    `/data/v1/projects/${projectId}/storage`,
    payload
  );
  
  return response.data.data;
}

/**
 * Uploads a file to the storage location
 */
async function uploadToStorage(
  accessToken: string,
  storageUrn: string,
  filePath: string
): Promise<void> {
  log.info({ storageUrn, filePath }, 'Uploading file to storage');
  
  // Parse the storage URN to get bucket and object key
  // Format: urn:adsk.objects:os.object:bucket/object
  const urnParts = storageUrn.split(':');
  const objectPath = urnParts[urnParts.length - 1];
  const [bucket, ...objectKeyParts] = objectPath.split('/');
  const objectKey = objectKeyParts.join('/');
  
  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  
  await axios.put(
    `${config.autodesk.apiBaseUrl}/oss/v2/buckets/${bucket}/objects/${encodeURIComponent(objectKey)}`,
    fileContent,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileContent.length.toString(),
      },
    }
  );
  
  log.info({ bucket, objectKey, fileName }, 'File uploaded to storage');
}

/**
 * Creates an item (first version) in the folder
 */
async function createItem(
  accessToken: string,
  projectId: string,
  folderUrn: string,
  fileName: string,
  storageUrn: string
): Promise<{ itemId: string; versionId: string }> {
  log.info({ projectId, folderUrn, fileName }, 'Creating item');
  
  const client = createApiClient(accessToken);
  
  const payload = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'items',
      attributes: {
        displayName: fileName,
        extension: {
          type: 'items:autodesk.bim360:File',
          version: '1.0',
        },
      },
      relationships: {
        tip: {
          data: {
            type: 'versions',
            id: '1',
          },
        },
        parent: {
          data: {
            type: 'folders',
            id: folderUrn,
          },
        },
      },
    },
    included: [
      {
        type: 'versions',
        id: '1',
        attributes: {
          name: fileName,
          extension: {
            type: 'versions:autodesk.bim360:File',
            version: '1.0',
          },
        },
        relationships: {
          storage: {
            data: {
              type: 'objects',
              id: storageUrn,
            },
          },
        },
      },
    ],
  };
  
  const response = await client.post<ItemResponse>(
    `/data/v1/projects/${projectId}/items`,
    payload
  );
  
  // Extract version ID from included resources
  const responseData = response.data as { data: { id: string }; included?: { id: string }[] };
  const versionId = responseData.included?.[0]?.id || '';
  
  log.info({ itemId: response.data.data.id, versionId }, 'Item created');
  
  return {
    itemId: response.data.data.id,
    versionId,
  };
}

/**
 * Creates a new version for an existing item
 */
async function createVersion(
  accessToken: string,
  projectId: string,
  itemId: string,
  fileName: string,
  storageUrn: string
): Promise<string> {
  log.info({ projectId, itemId, fileName }, 'Creating new version');
  
  const client = createApiClient(accessToken);
  
  const payload = {
    jsonapi: { version: '1.0' },
    data: {
      type: 'versions',
      attributes: {
        name: fileName,
        extension: {
          type: 'versions:autodesk.bim360:File',
          version: '1.0',
        },
      },
      relationships: {
        item: {
          data: {
            type: 'items',
            id: itemId,
          },
        },
        storage: {
          data: {
            type: 'objects',
            id: storageUrn,
          },
        },
      },
    },
  };
  
  const response = await client.post<ItemResponse>(
    `/data/v1/projects/${projectId}/versions`,
    payload
  );
  
  log.info({ versionId: response.data.data.id }, 'Version created');
  
  return response.data.data.id;
}

/**
 * Full upload flow: create storage -> upload -> create item/version
 */
export async function uploadToDocs(
  accessToken: string,
  projectId: string,
  folderUrn: string,
  filePath: string,
  existingItemId?: string
): Promise<{ itemId: string; versionId: string }> {
  const fileName = path.basename(filePath);
  
  log.info({ projectId, folderUrn, fileName, existingItemId }, 'Starting upload flow');
  
  // Step 1: Create storage location
  const storage = await createStorageLocation(accessToken, projectId, folderUrn, fileName);
  const storageUrn = storage.id;
  
  // Step 2: Upload file to storage
  await uploadToStorage(accessToken, storageUrn, filePath);
  
  // Step 3: Create item or new version
  if (existingItemId) {
    const versionId = await createVersion(accessToken, projectId, existingItemId, fileName, storageUrn);
    return { itemId: existingItemId, versionId };
  } else {
    return await createItem(accessToken, projectId, folderUrn, fileName, storageUrn);
  }
}

// ============================================================================
// RFIs (STUB - implement when ACC API is available)
// ============================================================================

/**
 * Lists RFIs for a project
 * 
 * TODO: Implement when ACC RFI API endpoints are available
 * Expected endpoint: GET /construction/rfis/v1/projects/{projectId}/rfis
 * 
 * @stub Returns mock data for testing
 */
export async function listRFIs(
  accessToken: string,
  projectId: string,
  sinceCursor?: string
): Promise<ACCRFIListResponse> {
  log.info({ projectId, sinceCursor }, 'Listing RFIs (STUB)');
  
  // TODO: Replace with actual API call when available
  // Example of what the real implementation might look like:
  /*
  const client = createApiClient(accessToken);
  const params: Record<string, string> = { limit: '50' };
  if (sinceCursor) {
    params.cursor = sinceCursor;
  }
  
  const response = await client.get<ACCRFIListResponse>(
    `/construction/rfis/v1/projects/${projectId}/rfis`,
    { params }
  );
  
  return response.data;
  */
  
  // Stub response for testing
  return {
    data: [],
    pagination: {
      limit: 50,
      offset: 0,
      totalResults: 0,
    },
    cursor: undefined,
  };
}

// ============================================================================
// Submittals (STUB - implement when ACC API is available)
// ============================================================================

/**
 * Lists Submittals for a project
 * 
 * TODO: Implement when ACC Submittals API endpoints are available
 * Expected endpoint: GET /construction/submittals/v1/projects/{projectId}/submittals
 * 
 * @stub Returns mock data for testing
 */
export async function listSubmittals(
  accessToken: string,
  projectId: string,
  sinceCursor?: string
): Promise<ACCSubmittalListResponse> {
  log.info({ projectId, sinceCursor }, 'Listing Submittals (STUB)');
  
  // TODO: Replace with actual API call when available
  // Example of what the real implementation might look like:
  /*
  const client = createApiClient(accessToken);
  const params: Record<string, string> = { limit: '50' };
  if (sinceCursor) {
    params.cursor = sinceCursor;
  }
  
  const response = await client.get<ACCSubmittalListResponse>(
    `/construction/submittals/v1/projects/${projectId}/submittals`,
    { params }
  );
  
  return response.data;
  */
  
  // Stub response for testing
  return {
    data: [],
    pagination: {
      limit: 50,
      offset: 0,
      totalResults: 0,
    },
    cursor: undefined,
  };
}

// ============================================================================
// Attachments (STUB - implement when needed)
// ============================================================================

/**
 * Downloads an attachment from ACC
 * 
 * TODO: Implement based on attachment type and source module
 * 
 * @stub Returns null for testing
 */
export async function downloadAttachment(
  accessToken: string,
  attachmentRef: AttachmentRef
): Promise<{ localPath: string; size: number } | null> {
  log.info({ attachmentRef }, 'Downloading attachment (STUB)');
  
  // TODO: Implement actual download logic
  // 1. Get download URL from attachment reference
  // 2. Download file content
  // 3. Save to local storage
  // 4. Return local path and file size
  
  /*
  const client = createApiClient(accessToken);
  
  // Get signed URL for download
  const signedUrl = await getSignedDownloadUrl(client, attachmentRef.urn);
  
  // Download file
  const response = await axios.get(signedUrl, { responseType: 'arraybuffer' });
  
  // Save to storage
  const localPath = path.join(config.storagePath, attachmentRef.projectId, attachmentRef.fileName);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(localPath, response.data);
  
  return {
    localPath,
    size: response.data.length,
  };
  */
  
  return null;
}
