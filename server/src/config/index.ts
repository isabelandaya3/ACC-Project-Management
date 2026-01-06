import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  
  // Autodesk APS
  autodesk: {
    clientId: process.env.AUTODESK_CLIENT_ID || '',
    clientSecret: process.env.AUTODESK_CLIENT_SECRET || '',
    callbackUrl: process.env.AUTODESK_CALLBACK_URL || 'http://localhost:3001/auth/callback',
    authBaseUrl: 'https://developer.api.autodesk.com/authentication/v2',
    apiBaseUrl: 'https://developer.api.autodesk.com',
    scopes: [
      'data:read',
      'data:write',
      'data:create',
      'account:read',
      'user:read',
      'user-profile:read',
    ],
  },
  
  // Security
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || 'dev_key_change_in_production_32chars!',
  sessionSecret: process.env.SESSION_SECRET || 'session_secret_change_in_production',
  
  // Optional defaults
  defaultProjectId: process.env.DEFAULT_PROJECT_ID || '',
  defaultDocsFolderUrn: process.env.DEFAULT_DOCS_FOLDER_URN || '',
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Storage
  storagePath: path.join(process.cwd(), 'storage'),
  
  // Sync
  syncIntervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES || '2', 10),
} as const;

// Validate required config
export function validateConfig(): void {
  const required = [
    'AUTODESK_CLIENT_ID',
    'AUTODESK_CLIENT_SECRET',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0 && config.nodeEnv !== 'development') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
