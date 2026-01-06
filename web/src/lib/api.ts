const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const url = `${API_URL}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Auth
export interface AuthStatus {
  authenticated: boolean;
  userId?: string;
  email?: string;
  name?: string;
  expiresAt?: string;
  scopes?: string[];
}

export async function getAuthStatus(): Promise<ApiResponse<AuthStatus>> {
  return fetchApi<AuthStatus>('/auth/status');
}

export function getLoginUrl(): string {
  return `${API_URL}/auth/login`;
}

export function getLogoutUrl(): string {
  return `${API_URL}/auth/logout`;
}

// User
export interface UserInfo {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  tokenExpiresAt: string;
  lastUpdated: string;
  scopes: string[];
}

export async function getUserInfo(): Promise<ApiResponse<UserInfo>> {
  return fetchApi<UserInfo>('/api/me');
}

// Projects
export interface ProjectListItem {
  id: string;
  name: string;
  hubId: string;
  hubName: string;
  region: string;
  projectType: string;
  webViewUrl?: string;
}

export interface HubWithProjects {
  id: string;
  name: string;
  region: string;
  projects: ProjectListItem[];
}

export async function getProjects(): Promise<ApiResponse<HubWithProjects[]>> {
  return fetchApi<HubWithProjects[]>('/api/projects');
}

// Folders
export interface FolderItem {
  id: string;
  name: string;
  type: string;
}

export async function getProjectFolders(hubId: string, projectId: string): Promise<ApiResponse<FolderItem[]>> {
  return fetchApi<FolderItem[]>(`/api/projects/${hubId}/${projectId}/folders`);
}

// Sync
export interface SyncResult {
  module: string;
  success: boolean;
  itemsProcessed: number;
  newItems: number;
  errors: string[];
  duration: number;
}

export interface SyncRunResponse {
  projectId: string;
  results: SyncResult[];
  totalDuration: number;
}

export async function runSync(projectId: string, modules?: string[]): Promise<ApiResponse<SyncRunResponse>> {
  return fetchApi<SyncRunResponse>('/api/sync/run', {
    method: 'POST',
    body: JSON.stringify({ projectId, modules }),
  });
}

// Sync History
export interface SyncLogEntry {
  id: string;
  projectId: string;
  module: string;
  status: string;
  itemsProcessed: number;
  newItems: number;
  errors: string[];
  duration: number;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
}

export async function getSyncHistory(projectId?: string): Promise<ApiResponse<SyncLogEntry[]>> {
  const params = projectId ? `?projectId=${projectId}` : '';
  return fetchApi<SyncLogEntry[]>(`/api/sync/history${params}`);
}

// Upload Test
export interface UploadTestResponse {
  itemId: string;
  versionId: string;
  fileName: string;
}

export async function testUpload(
  projectId: string,
  folderUrn: string,
  fileName?: string,
  content?: string
): Promise<ApiResponse<UploadTestResponse>> {
  return fetchApi<UploadTestResponse>('/api/upload-test', {
    method: 'POST',
    body: JSON.stringify({ projectId, folderUrn, fileName, content }),
  });
}
