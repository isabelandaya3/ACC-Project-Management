/**
 * Environment Configuration Validator
 * Run this to verify all required credentials are configured
 */

import { config } from './config';
import { logger } from './lib/logger';

const log = logger.child({ module: 'config-validator' });

export function validateConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  log.info('Validating environment configuration...');
  
  // Check Autodesk credentials
  if (!config.autodesk.clientId || config.autodesk.clientId === 'your_client_id_here') {
    errors.push('AUTODESK_CLIENT_ID is not configured');
  } else {
    log.info({ clientId: config.autodesk.clientId.substring(0, 10) + '...' }, 'Autodesk Client ID configured');
  }
  
  if (!config.autodesk.clientSecret || config.autodesk.clientSecret === 'your_client_secret_here') {
    errors.push('AUTODESK_CLIENT_SECRET is not configured');
  } else {
    log.info('Autodesk Client Secret configured');
  }
  
  if (!config.autodesk.callbackUrl) {
    errors.push('AUTODESK_CALLBACK_URL is not configured');
  } else {
    log.info({ callbackUrl: config.autodesk.callbackUrl }, 'Callback URL configured');
  }
  
  // Check security keys
  if (config.tokenEncryptionKey === 'dev_key_change_in_production_32chars!' && config.nodeEnv === 'production') {
    errors.push('TOKEN_ENCRYPTION_KEY is using default value in production');
  }
  
  if (config.sessionSecret === 'session_secret_change_in_production' && config.nodeEnv === 'production') {
    warnings.push('SESSION_SECRET is using default value in production');
  }
  
  // Check database
  if (!config.databaseUrl) {
    errors.push('DATABASE_URL is not configured');
  } else {
    log.info({ dbUrl: config.databaseUrl.substring(0, 20) + '...' }, 'Database URL configured');
  }
  
  // Report results
  if (errors.length > 0) {
    log.error({ errors }, 'Configuration validation failed');
    errors.forEach(err => log.error(`❌ ${err}`));
    return false;
  }
  
  if (warnings.length > 0) {
    log.warn({ warnings }, 'Configuration warnings');
    warnings.forEach(warn => log.warn(`⚠️  ${warn}`));
  }
  
  log.info('✅ Configuration validation passed');
  
  // Display configuration summary
  log.info({
    environment: config.nodeEnv,
    port: config.port,
    webOrigin: config.webOrigin,
    callbackUrl: config.autodesk.callbackUrl,
    syncInterval: config.syncIntervalMinutes,
    logLevel: config.logLevel,
  }, 'Configuration Summary');
  
  return true;
}

// Run validation if executed directly
if (require.main === module) {
  validateConfig();
  process.exit(validateConfig() ? 0 : 1);
}
