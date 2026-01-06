/**
 * Autodesk Platform Services (APS) Types
 */

// OAuth Types
export interface APSTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface APSUserProfile {
  userId: string;
  userName: string;
  emailId: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  profileImages?: {
    sizeX20: string;
    sizeX40: string;
    sizeX50: string;
    sizeX58: string;
    sizeX80: string;
    sizeX120: string;
    sizeX160: string;
    sizeX176: string;
    sizeX240: string;
    sizeX360: string;
  };
}

// Hub/Account Types
export interface APSHub {
  type: string;
  id: string;
  attributes: {
    name: string;
    region: string;
    extension: {
      type: string;
      version: string;
      schema: {
        href: string;
      };
      data: Record<string, unknown>;
    };
  };
  links: {
    self: {
      href: string;
    };
  };
  relationships: {
    projects: {
      links: {
        related: {
          href: string;
        };
      };
    };
  };
}

export interface APSProject {
  type: string;
  id: string;
  attributes: {
    name: string;
    scopes: string[];
    extension: {
      type: string;
      version: string;
      schema: {
        href: string;
      };
      data: {
        projectType: string;
      };
    };
  };
  links: {
    self: {
      href: string;
    };
    webView: {
      href: string;
    };
  };
  relationships: {
    hub: {
      data: {
        type: string;
        id: string;
      };
      links: {
        related: {
          href: string;
        };
      };
    };
    rootFolder: {
      data: {
        type: string;
        id: string;
      };
      meta: {
        link: {
          href: string;
        };
      };
    };
    topFolders: {
      links: {
        related: {
          href: string;
        };
      };
    };
    issues?: {
      data: {
        type: string;
        id: string;
      };
      meta: {
        link: {
          href: string;
        };
      };
    };
    submittals?: {
      data: {
        type: string;
        id: string;
      };
      meta: {
        link: {
          href: string;
        };
      };
    };
    rfis?: {
      data: {
        type: string;
        id: string;
      };
      meta: {
        link: {
          href: string;
        };
      };
    };
    cost?: {
      data: {
        type: string;
        id: string;
      };
      meta: {
        link: {
          href: string;
        };
      };
    };
  };
}

// Folder/File Types
export interface APSFolder {
  type: string;
  id: string;
  attributes: {
    name: string;
    displayName: string;
    objectCount: number;
    createTime: string;
    createUserId: string;
    createUserName: string;
    lastModifiedTime: string;
    lastModifiedUserId: string;
    lastModifiedUserName: string;
    hidden: boolean;
    extension: {
      type: string;
      version: string;
      schema: {
        href: string;
      };
      data: Record<string, unknown>;
    };
  };
  links: {
    self: {
      href: string;
    };
    webView: {
      href: string;
    };
  };
  relationships: {
    contents: {
      links: {
        related: {
          href: string;
        };
      };
    };
    parent: {
      data: {
        type: string;
        id: string;
      };
      links: {
        related: {
          href: string;
        };
      };
    };
  };
}

export interface APSItem {
  type: string;
  id: string;
  attributes: {
    displayName: string;
    createTime: string;
    createUserId: string;
    createUserName: string;
    lastModifiedTime: string;
    lastModifiedUserId: string;
    lastModifiedUserName: string;
    hidden: boolean;
    extension: {
      type: string;
      version: string;
      schema: {
        href: string;
      };
      data: Record<string, unknown>;
    };
  };
  links: {
    self: {
      href: string;
    };
    webView: {
      href: string;
    };
  };
  relationships: {
    tip: {
      data: {
        type: string;
        id: string;
      };
      links: {
        related: {
          href: string;
        };
      };
    };
    versions: {
      links: {
        related: {
          href: string;
        };
      };
    };
    parent: {
      data: {
        type: string;
        id: string;
      };
      links: {
        related: {
          href: string;
        };
      };
    };
  };
}

// Storage Types
export interface APSStorageLocation {
  type: string;
  id: string;
  attributes: {
    extension: {
      type: string;
      version: string;
      schema: {
        href: string;
      };
      data: Record<string, unknown>;
    };
  };
  relationships: {
    target: {
      data: {
        type: string;
        id: string;
      };
      links: {
        related: {
          href: string;
        };
      };
    };
  };
}

// RFI Types (stub - to be updated when ACC API is available)
export interface ACCRFI {
  id: string;
  externalId: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  attachments?: ACCAttachment[];
  // Add more fields as API documentation becomes available
}

export interface ACCRFIListResponse {
  data: ACCRFI[];
  pagination: {
    limit: number;
    offset: number;
    totalResults: number;
  };
  cursor?: string;
}

// Submittal Types (stub - to be updated when ACC API is available)
export interface ACCSubmittal {
  id: string;
  externalId: string;
  projectId: string;
  title: string;
  specSection?: string;
  status: string;
  dueDate?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  attachments?: ACCAttachment[];
  // Add more fields as API documentation becomes available
}

export interface ACCSubmittalListResponse {
  data: ACCSubmittal[];
  pagination: {
    limit: number;
    offset: number;
    totalResults: number;
  };
  cursor?: string;
}

// Attachment Types
export interface ACCAttachment {
  id: string;
  name: string;
  urn: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface AttachmentRef {
  id: string;
  urn: string;
  projectId: string;
  module: 'rfi' | 'submittal' | 'issue' | 'document';
  fileName: string;
}

// Sync Types
export type SyncModule = 'rfi' | 'submittal';

export interface SyncCursor {
  projectId: string;
  module: SyncModule;
  lastSeenAt: Date;
  lastSeenId?: string;
}

export interface IngestedItem {
  externalId: string;
  module: SyncModule;
  projectId: string;
  payloadHash: string;
  firstSeenAt: Date;
}

export interface SyncResult {
  projectId: string;
  module: SyncModule;
  success: boolean;
  itemsProcessed: number;
  newItems: number;
  errors: string[];
  duration: number;
  cursor?: string;
}
