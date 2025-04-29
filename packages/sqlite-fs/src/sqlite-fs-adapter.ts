// src/sqlite-fs-adapter.ts
import type { SyncSqliteDatabase } from './interfaces';
import type { FSError, Stats } from './types';
import { join, dirname, basename, normalize } from 'path';

/**
 * SQLiteFSAdapter provides a file system interface using SQLite as the storage backend.
 * This allows for file system operations in environments where traditional file systems
 * are not available, such as Cloudflare Workers.
 */
export class SQLiteFSAdapter {
  private db: SyncSqliteDatabase;
  
  constructor(db: SyncSqliteDatabase) {
    this.db = db;
    this.initializeDatabase();
  }

  /**
   * Initialize the database schema for the file system.
   */
  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fs_entries (
        path TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content BLOB,
        size INTEGER NOT NULL DEFAULT 0,
        mode INTEGER NOT NULL DEFAULT 0o644,
        mtimeMs INTEGER NOT NULL,
        atimeMs INTEGER NOT NULL,
        ctimeMs INTEGER NOT NULL,
        birthtimeMs INTEGER NOT NULL
      );
    `);
  }

  /**
   * Write data to a file.
   */
  writeFileSync(path: string, data: string | Uint8Array): void {
    path = normalize(path);
    const now = Date.now();
    const isNew = !this.existsSync(path);
    const parentDir = dirname(path);
    
    // Ensure parent directory exists
    if (parentDir !== '/' && parentDir !== '.') {
      this.mkdirSync(parentDir, { recursive: true });
    }

    // Convert string data to Uint8Array if needed
    const content = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const size = content.length;

    try {
      if (isNew) {
        this.db.exec(
          `INSERT INTO fs_entries (path, type, content, size, mtimeMs, atimeMs, ctimeMs, birthtimeMs) 
           VALUES (?, 'file', ?, ?, ?, ?, ?, ?)`,
          [path, content, size, now, now, now, now]
        );
      } else {
        this.db.exec(
          `UPDATE fs_entries 
           SET content = ?, size = ?, mtimeMs = ?, atimeMs = ?, ctimeMs = ? 
           WHERE path = ? AND type = 'file'`,
          [content, size, now, now, now, path]
        );
      }
    } catch (error) {
      const fsError = new Error(`Error writing file: ${path}`) as FSError;
      fsError.code = 'EWRITEFILE';
      fsError.path = path;
      throw fsError;
    }
  }

  /**
   * Read data from a file.
   */
  readFileSync(path: string, options?: { encoding?: string }): string | Uint8Array {
    path = normalize(path);
    
    try {
      const file = this.db.one<{ content: Uint8Array, type: string }>(
        'SELECT content, type FROM fs_entries WHERE path = ?',
        [path]
      );
      
      if (file.type !== 'file') {
        const fsError = new Error(`EISDIR: illegal operation on a directory, read '${path}'`) as FSError;
        fsError.code = 'EISDIR';
        fsError.path = path;
        throw fsError;
      }

      // Update access time
      this.db.exec(
        'UPDATE fs_entries SET atimeMs = ? WHERE path = ?',
        [Date.now(), path]
      );

      // Return as string if encoding is specified
      if (options?.encoding) {
        // Use type assertion for the encoding parameter
        return new TextDecoder(options.encoding as any).decode(file.content);
      }
      
      return file.content;
    } catch (error: any) {
      if (error.message?.includes('No rows found')) {
        const fsError = new Error(`ENOENT: no such file or directory, open '${path}'`) as FSError;
        fsError.code = 'ENOENT';
        fsError.path = path;
        throw fsError;
      }
      throw error;
    }
  }

  /**
   * Create a directory.
   */
  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    path = normalize(path);
    if (path === '') path = '.';
    
    // Check if already exists
    if (this.existsSync(path)) {
      const stats = this.statSync(path);
      if (stats.isDirectory()) {
        return; // Directory already exists, nothing to do
      } else {
        const fsError = new Error(`EEXIST: file already exists, mkdir '${path}'`) as FSError;
        fsError.code = 'EEXIST';
        fsError.path = path;
        throw fsError;
      }
    }

    // Create parent directories if recursive
    const parentDir = dirname(path);
    if (parentDir !== '/' && parentDir !== '.' && parentDir !== path) {
      if (!this.existsSync(parentDir)) {
        if (options?.recursive) {
          this.mkdirSync(parentDir, { recursive: true });
        } else {
          const fsError = new Error(`ENOENT: no such file or directory, mkdir '${path}'`) as FSError;
          fsError.code = 'ENOENT';
          fsError.path = path;
          throw fsError;
        }
      }
    }

    const now = Date.now();
    try {
      this.db.exec(
        `INSERT INTO fs_entries (path, type, size, mode, mtimeMs, atimeMs, ctimeMs, birthtimeMs) 
         VALUES (?, 'directory', 0, ?, ?, ?, ?, ?)`,
        [path, 0o755, now, now, now, now]
      );
    } catch (error) {
      const fsError = new Error(`Error creating directory: ${path}`) as FSError;
      fsError.code = 'EMKDIR';
      fsError.path = path;
      throw fsError;
    }
  }

  /**
   * Check if a file or directory exists.
   */
  existsSync(path: string): boolean {
    path = normalize(path);
    if (path === '') path = '.';
    
    try {
      const count = this.db.one<{ count: number }>(
        'SELECT COUNT(*) as count FROM fs_entries WHERE path = ?',
        [path]
      );
      return count.count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file or directory stats.
   */
  statSync(path: string): Stats {
    path = normalize(path);
    if (path === '') path = '.';
    
    try {
      const entry = this.db.one<{
        type: string;
        size: number;
        mode: number;
        mtimeMs: number;
        atimeMs: number;
        ctimeMs: number;
        birthtimeMs: number;
      }>('SELECT type, size, mode, mtimeMs, atimeMs, ctimeMs, birthtimeMs FROM fs_entries WHERE path = ?', [path]);

      // Update access time
      this.db.exec(
        'UPDATE fs_entries SET atimeMs = ? WHERE path = ?',
        [Date.now(), path]
      );

      return {
        isFile: () => entry.type === 'file',
        isDirectory: () => entry.type === 'directory',
        isSymbolicLink: () => false, // Not supporting symlinks in this implementation
        size: entry.size,
        mode: entry.mode,
        mtimeMs: entry.mtimeMs,
        atimeMs: entry.atimeMs,
        ctimeMs: entry.ctimeMs,
        birthtimeMs: entry.birthtimeMs
      };
    } catch (error: any) {
      if (error.message?.includes('No rows found')) {
        const fsError = new Error(`ENOENT: no such file or directory, stat '${path}'`) as FSError;
        fsError.code = 'ENOENT';
        fsError.path = path;
        throw fsError;
      }
      throw error;
    }
  }

  /**
   * Read directory contents.
   */
  readdirSync(path: string): string[] {
    path = normalize(path);
    if (path === '') path = '.';
    
    // Ensure path exists and is a directory
    if (!this.existsSync(path)) {
      const fsError = new Error(`ENOENT: no such file or directory, readdir '${path}'`) as FSError;
      fsError.code = 'ENOENT';
      fsError.path = path;
      throw fsError;
    }
    
    const stats = this.statSync(path);
    if (!stats.isDirectory()) {
      const fsError = new Error(`ENOTDIR: not a directory, readdir '${path}'`) as FSError;
      fsError.code = 'ENOTDIR';
      fsError.path = path;
      throw fsError;
    }

    // Normalize path for pattern matching
    const dirPath = path === '.' ? '' : (path.endsWith('/') ? path : path + '/');
    
    try {
      // Find all direct children of this directory
      const entries = this.db.all<{ path: string }>(
        `SELECT path FROM fs_entries 
         WHERE path LIKE ? AND path != ? AND path NOT LIKE ?`,
        [`${dirPath}%`, dirPath, `${dirPath}%/%`]
      );
      
      // Extract just the basename of each entry
      return entries.map(entry => basename(entry.path));
    } catch (error) {
      const fsError = new Error(`Error reading directory: ${path}`) as FSError;
      fsError.code = 'EREADDIR';
      fsError.path = path;
      throw fsError;
    }
  }

  /**
   * Remove a file.
   */
  unlinkSync(path: string): void {
    path = normalize(path);
    
    try {
      const stats = this.statSync(path);
      if (stats.isDirectory()) {
        const fsError = new Error(`EISDIR: illegal operation on a directory, unlink '${path}'`) as FSError;
        fsError.code = 'EISDIR';
        fsError.path = path;
        throw fsError;
      }
      
      this.db.exec('DELETE FROM fs_entries WHERE path = ?', [path]);
    } catch (error: any) {
      if (error.code === 'EISDIR') {
        throw error;
      }
      if (error.message?.includes('No rows found')) {
        const fsError = new Error(`ENOENT: no such file or directory, unlink '${path}'`) as FSError;
        fsError.code = 'ENOENT';
        fsError.path = path;
        throw fsError;
      }
      throw error;
    }
  }

  /**
   * Remove a directory.
   */
  rmdirSync(path: string, options?: { recursive?: boolean }): void {
    path = normalize(path);
    if (path === '') path = '.';
    
    try {
      const stats = this.statSync(path);
      if (!stats.isDirectory()) {
        const fsError = new Error(`ENOTDIR: not a directory, rmdir '${path}'`) as FSError;
        fsError.code = 'ENOTDIR';
        fsError.path = path;
        throw fsError;
      }
      
      // Check if directory is empty (unless recursive)
      const contents = this.readdirSync(path);
      if (contents.length > 0 && !options?.recursive) {
        const fsError = new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`) as FSError;
        fsError.code = 'ENOTEMPTY';
        fsError.path = path;
        throw fsError;
      }
      
      if (options?.recursive && contents.length > 0) {
        // Normalize path for pattern matching
        const dirPath = path === '.' ? '' : (path.endsWith('/') ? path : path + '/');
        
        // Delete all children recursively
        this.db.exec('DELETE FROM fs_entries WHERE path LIKE ?', [`${dirPath}%`]);
      }
      
      // Delete the directory itself
      this.db.exec('DELETE FROM fs_entries WHERE path = ?', [path]);
    } catch (error: any) {
      if (['ENOTDIR', 'ENOTEMPTY'].includes(error.code)) {
        throw error;
      }
      if (error.message?.includes('No rows found')) {
        const fsError = new Error(`ENOENT: no such file or directory, rmdir '${path}'`) as FSError;
        fsError.code = 'ENOENT';
        fsError.path = path;
        throw fsError;
      }
      throw error;
    }
  }
}