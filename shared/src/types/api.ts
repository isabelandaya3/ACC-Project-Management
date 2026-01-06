/**
 * API Request/Response Types
 */

// Auth Types
export interface AuthStatus {
  authenticated: boolean;
  userId?: string;
  email?: string;
  name?: string;
  expiresAt?: string;
  scopes?: string[];
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

// Project List Response
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

// Sync Request/Response
export interface SyncRunRequest {
  projectId: string;
  modules?: ('rfi' | 'submittal')[];
}

export interface SyncRunResponse {
  projectId: string;
  results: {
    module: string;
    success: boolean;
    itemsProcessed: number;
    newItems: number;
    errors: string[];
    duration: number;
  }[];
  totalDuration: number;
}

// Upload Request/Response
export interface UploadTestRequest {
  projectId: string;
  folderUrn: string;
  fileName?: string;
  content?: string;
}

export interface UploadTestResponse {
  success: boolean;
  itemId?: string;
  versionId?: string;
  fileName?: string;
  error?: string;
}
