// src/sqlite-fs-adapter.ts
import type { SyncSqliteDatabase } from './interfaces';
import type { Stats, FSError } from './types';
import { SQL_SCHEMA } from './schema';
import { createError } from './error-utils';
import { createStats, type DbFileRow } from './stats-utils';
import { dirname, basename, join, normalize } from './path-utils';

// Helper to check if an error is a "not found" error from the database
function isNotFoundError(error: any): boolean {
  return error?.message?.includes('No rows found');
}

export class SQLiteFSAdapter {
  private db: SyncSqliteDatabase;
  private rootDir: string;

  constructor(db: SyncSqliteDatabase, rootDir: string = '.') {
    this.db = db;
    this.rootDir = rootDir;
    // Ensure schema exists
    try {
      this.db.exec(SQL_SCHEMA);
    } catch (e) {
      console.error("Failed to initialize SQLiteFSAdapter schema", e);
      // Non-fatal error, schema might already exist
    }
  }

  // Placeholder for path mapping if rootDir is used
  private getDbPath(fsPath: string): string {
    return normalize(fsPath);
  }

  // --- Read Methods ---
  async lstat(path: string): Promise<Stats> {
    const dbPath = this.getDbPath(path);
    try {
      const row = this.db.one<DbFileRow>('SELECT type, mode, mtime, content FROM files WHERE path = ?', [dbPath]);
      return createStats(row);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw createError('ENOENT', path, 'lstat');
      }
      // Other database errors
      throw createError('EIO', path, 'lstat');
    }
  }

  async stat(path: string): Promise<Stats> {
    // For this adapter, stat behaves identically to lstat
    return this.lstat(path);
  }

  async readFile(path: string, options?: { encoding?: string }): Promise<Buffer | string> {
    const dbPath = this.getDbPath(path);
    
    try {
      // Get the file data
      const row = this.db.one<{ type: string, content: Buffer | Uint8Array | null }>('SELECT type, content FROM files WHERE path = ?', [dbPath]);
      
      // Check if it's a directory
      if (row.type === 'directory') {
        throw createError('EISDIR', path, 'readFile');
      }
      
      // Ensure content is a Buffer
      const buffer = Buffer.from(row.content || new Uint8Array());
      
      // Return string if encoding is specified, otherwise return Buffer
      if (options?.encoding) {
        return buffer.toString(options.encoding);
      }
      return buffer;
    } catch (error) {
      // If we already created a specific error (like EISDIR), re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      
      if (isNotFoundError(error)) {
        throw createError('ENOENT', path, 'readFile');
      }
      
      // Other database errors
      throw createError('EIO', path, 'readFile');
    }
  }

  async readdir(path: string): Promise<string[]> {
    const dbPath = this.getDbPath(path);
    
    // First check if the path exists and is a directory
    try {
      // Special case for root directory
      if (dbPath !== '.' && dbPath !== '/') {
        // Check if path exists and is a directory
        const fileCheck = this.db.one<{ type: string }>('SELECT type FROM files WHERE path = ?', [dbPath]);
        
        // If it exists but is not a directory, throw ENOTDIR
        if (fileCheck.type !== 'directory') {
          throw createError('ENOTDIR', path, 'readdir');
        }
      }
      
      // Construct the SQL query to find immediate children
      let sql: string;
      let params: string[];
      
      if (dbPath === '.' || dbPath === '/') {
        // For root directory, find entries without '/' in their path (except at the beginning)
        sql = "SELECT path FROM files WHERE path != '.' AND path != '/' AND path NOT LIKE '%/%'";
        params = [];
      } else {
        // For other directories, find immediate children
        const dirPrefix = dbPath.endsWith('/') ? dbPath : `${dbPath}/`;
        sql = "SELECT path FROM files WHERE path LIKE ? AND path NOT LIKE ? AND path != ?";
        params = [`${dirPrefix}%`, `${dirPrefix}%/%`, dbPath];
      }
      
      // Get all matching paths
      const rows = this.db.all<{ path: string }>(sql, params);
      
      // Extract basenames
      return rows.map(row => basename(row.path));
    } catch (error) {
      if (isNotFoundError(error)) {
        throw createError('ENOENT', path, 'readdir');
      }
      // If we already created a specific error (like ENOTDIR), re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      // Other database errors
      throw createError('EIO', path, 'readdir');
    }
  }

  // --- Write Methods (Stubs for later) ---
  // async writeFile(...) { throw new Error('Not implemented'); }
  // async mkdir(...) { throw new Error('Not implemented'); }
  // async unlink(...) { throw new Error('Not implemented'); }
  // async rmdir(...) { throw new Error('Not implemented'); }
}