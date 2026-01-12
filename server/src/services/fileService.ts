/**
 * File Service
 * Handles interaction with network filesystem for backup and attachment management
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { logger, createChildLogger } from '../lib/logger';

const log = createChildLogger({ module: 'fileService' });

export interface FileInfo {
  fileName: string;
  filePath: string;
  size: number;
  mtime: Date;
  isDirectory: boolean;
}

/**
 * Validate that a network path is accessible
 */
export async function validateNetworkPath(basePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(basePath);
    return stats.isDirectory();
  } catch (error) {
    log.warn({ basePath, error }, 'Network path validation failed');
    return false;
  }
}

/**
 * Build item-specific subfolder path with ACC project folder
 */
export function buildItemFolderPath(
  basePath: string,
  accProjectFolder: string,
  itemType: 'RFI' | 'SUBMITTAL',
  itemNumber: string
): string {
  const folderName = itemType === 'RFI' ? 'RFIs' : 'Submittals';
  return path.join(basePath, accProjectFolder, folderName, itemNumber);
}

/**
 * Ensure item folder exists (with ACC project subfolder)
 */
export async function ensureItemFolder(
  basePath: string,
  accProjectFolder: string,
  itemType: 'RFI' | 'SUBMITTAL',
  itemNumber: string
): Promise<string> {
  const itemFolder = buildItemFolderPath(basePath, accProjectFolder, itemType, itemNumber);
  
  try {
    await fs.mkdir(itemFolder, { recursive: true });
    log.debug({ itemFolder }, 'Item folder ensured');
    return itemFolder;
  } catch (error) {
    log.error({ itemFolder, error }, 'Failed to create item folder');
    throw new Error(`Failed to create folder: ${itemFolder}`);
  }
}

/**
 * List files in an item's folder (with ACC project subfolder)
 */
export async function listItemFiles(
  basePath: string,
  accProjectFolder: string,
  itemType: 'RFI' | 'SUBMITTAL',
  itemNumber: string
): Promise<FileInfo[]> {
  const itemFolder = buildItemFolderPath(basePath, accProjectFolder, itemType, itemNumber);
  
  try {
    if (!existsSync(itemFolder)) {
      return [];
    }
    
    const entries = await fs.readdir(itemFolder, { withFileTypes: true });
    
    const fileInfos: FileInfo[] = [];
    for (const entry of entries) {
      const fullPath = path.join(itemFolder, entry.name);
      try {
        const stats = await fs.stat(fullPath);
        fileInfos.push({
          fileName: entry.name,
          filePath: fullPath,
          size: stats.size,
          mtime: stats.mtime,
          isDirectory: stats.isDirectory(),
        });
      } catch (error) {
        log.warn({ fullPath, error }, 'Failed to stat file');
      }
    }
    
    return fileInfos.filter(f => !f.isDirectory).sort((a, b) => a.fileName.localeCompare(b.fileName));
  } catch (error) {
    log.error({ itemFolder, error }, 'Failed to list files');
    return [];
  }
}

/**
 * Save buffer to file in item folder (with ACC project subfolder)
 */
export async function saveFileToItemFolder(
  basePath: string,
  accProjectFolder: string,
  itemType: 'RFI' | 'SUBMITTAL',
  itemNumber: string,
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const itemFolder = await ensureItemFolder(basePath, accProjectFolder, itemType, itemNumber);
  const filePath = path.join(itemFolder, fileName);
  
  try {
    await fs.writeFile(filePath, buffer);
    log.info({ filePath, size: buffer.length }, 'File saved successfully');
    return filePath;
  } catch (error) {
    log.error({ filePath, error }, 'Failed to save file');
    throw new Error(`Failed to save file: ${fileName}`);
  }
}

/**
 * Read file from network path
 */
export async function readFile(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    log.error({ filePath, error }, 'Failed to read file');
    throw new Error(`Failed to read file: ${filePath}`);
  }
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file stats
 */
export async function getFileStats(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    log.error({ filePath, error }, 'Failed to get file stats');
    return null;
  }
}

/**
 * Delete file
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    log.info({ filePath }, 'File deleted');
    return true;
  } catch (error) {
    log.error({ filePath, error }, 'Failed to delete file');
    return false;
  }
}

/**
 * Copy file from one location to another
 */
export async function copyFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    await fs.copyFile(sourcePath, destPath);
    log.info({ sourcePath, destPath }, 'File copied');
  } catch (error) {
    log.error({ sourcePath, destPath, error }, 'Failed to copy file');
    throw new Error(`Failed to copy file from ${sourcePath} to ${destPath}`);
  }
}

/**
 * Sanitize filename to be filesystem-safe
 */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

/**
 * Generate combined export PDF filename
 */
export function generateExportFilename(itemType: 'RFI' | 'SUBMITTAL', itemNumber: string): string {
  return `${itemNumber}_CombinedExport.pdf`;
}
