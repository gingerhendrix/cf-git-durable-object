// src/sqlite-fs-adapter.ts
import { createError } from "./error-utils";
import type { SyncSqliteDatabase } from "./interfaces";
import { basename, dirname, normalize } from "./path-utils";
import { SQL_SCHEMA } from "./schema";
import { createStats, type DbFileRow } from "./stats-utils";
import type { FSError, Stats } from "./types";

// Helper to check if an error is a "not found" error from the database
function isNotFoundError(error: any): boolean {
  return error?.message?.includes("No rows found");
}

export class SQLiteFSAdapter {
  private db: SyncSqliteDatabase;
  private rootDir: string;

  constructor(db: SyncSqliteDatabase, rootDir: string = ".") {
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
      const row = this.db.one<DbFileRow>(
        "SELECT type, mode, mtime, content FROM files WHERE path = ?",
        [dbPath],
      );
      return createStats(row);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw createError("ENOENT", path, "lstat");
      }
      // Other database errors
      throw createError("EIO", path, "lstat");
    }
  }

  async stat(path: string): Promise<Stats> {
    // For this adapter, stat behaves identically to lstat
    return this.lstat(path);
  }

  async readFile(
    path: string,
    options?: { encoding?: string },
  ): Promise<Buffer | string> {
    const dbPath = this.getDbPath(path);

    try {
      // Get the file data
      const row = this.db.one<{
        type: string;
        content: Buffer | Uint8Array | null;
      }>("SELECT type, content FROM files WHERE path = ?", [dbPath]);

      // Check if it's a directory
      if (row.type === "directory") {
        throw createError("EISDIR", path, "readFile");
      }

      // Ensure content is a Buffer
      const buffer = Buffer.from(row.content || new Uint8Array());

      // Return string if encoding is specified, otherwise return Buffer
      if (options?.encoding) {
        return buffer.toString(options.encoding as BufferEncoding);
      }
      return buffer;
    } catch (error) {
      // If we already created a specific error (like EISDIR), re-throw it
      if ((error as FSError).code) {
        throw error;
      }

      if (isNotFoundError(error)) {
        throw createError("ENOENT", path, "readFile");
      }

      // Other database errors
      throw createError("EIO", path, "readFile");
    }
  }

  async readdir(path: string): Promise<string[]> {
    const dbPath = this.getDbPath(path);

    // First check if the path exists and is a directory
    try {
      // Special case for root directory
      if (dbPath !== "." && dbPath !== "/") {
        // Check if path exists and is a directory
        const fileCheck = this.db.one<{ type: string }>(
          "SELECT type FROM files WHERE path = ?",
          [dbPath],
        );

        // If it exists but is not a directory, throw ENOTDIR
        if (fileCheck.type !== "directory") {
          throw createError("ENOTDIR", path, "readdir");
        }
      }

      // Construct the SQL query to find immediate children
      let sql: string;
      let params: string[];

      if (dbPath === "." || dbPath === "/") {
        // For root directory, find entries without '/' in their path (except at the beginning)
        sql =
          "SELECT path FROM files WHERE path != '.' AND path != '/' AND path NOT LIKE '%/%'";
        params = [];
      } else {
        // For other directories, find immediate children
        const dirPrefix = dbPath.endsWith("/") ? dbPath : `${dbPath}/`;
        sql =
          "SELECT path FROM files WHERE path LIKE ? AND path NOT LIKE ? AND path != ?";
        params = [`${dirPrefix}%`, `${dirPrefix}%/%`, dbPath];
      }

      // Get all matching paths
      const rows = this.db.all<{ path: string }>(sql, params);

      // Extract basenames
      return rows.map((row) => basename(row.path));
    } catch (error) {
      if (isNotFoundError(error)) {
        throw createError("ENOENT", path, "readdir");
      }
      // If we already created a specific error (like ENOTDIR), re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      // Other database errors
      throw createError("EIO", path, "readdir");
    }
  }

  // --- Write Methods ---
  async mkdir(path: string, options?: { mode?: number }): Promise<void> {
    const dbPath = this.getDbPath(path);
    const mode = options?.mode ?? 0o755; // Default directory mode
    const mtime = new Date().toISOString();

    try {
      // Check if path already exists
      try {
        this.db.one("SELECT type FROM files WHERE path = ?", [dbPath]);
        // If we get here, the path exists
        throw createError("EEXIST", path, "mkdir");
      } catch (error) {
        // If error is not "No rows found", rethrow it
        if (!isNotFoundError(error)) {
          throw error;
        }
        // Otherwise, path doesn't exist, continue
      }

      // Check parent directory
      const parentPath = dirname(dbPath);
      if (parentPath !== "." && parentPath !== "/") {
        try {
          const parent = this.db.one<{ type: string }>(
            "SELECT type FROM files WHERE path = ?",
            [parentPath]
          );
          if (parent.type !== "directory") {
            throw createError("ENOTDIR", path, "mkdir");
          }
        } catch (error) {
          if (isNotFoundError(error)) {
            throw createError("ENOENT", path, "mkdir");
          }
          throw error;
        }
      }

      // Create the directory
      this.db.exec(
        "INSERT INTO files (path, type, mode, mtime, content) VALUES (?, 'directory', ?, ?, NULL)",
        [dbPath, mode, mtime]
      );
    } catch (error) {
      // If we already created a specific error, re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      // Other database errors
      throw createError("EIO", path, "mkdir");
    }
  }

  async writeFile(
    path: string,
    data: string | Buffer | Uint8Array,
    options?: { encoding?: string; mode?: number }
  ): Promise<void> {
    const dbPath = this.getDbPath(path);
    const mode = options?.mode ?? 0o644; // Default file mode
    const mtime = new Date().toISOString();

    // Convert data to Buffer if it's a string
    const buffer = typeof data === "string"
      ? Buffer.from(data, options?.encoding as BufferEncoding)
      : Buffer.from(data);

    try {
      // Check parent directory
      const parentPath = dirname(dbPath);
      if (parentPath !== "." && parentPath !== "/") {
        try {
          const parent = this.db.one<{ type: string }>(
            "SELECT type FROM files WHERE path = ?",
            [parentPath]
          );
          if (parent.type !== "directory") {
            throw createError("ENOTDIR", path, "writeFile");
          }
        } catch (error) {
          if (isNotFoundError(error)) {
            throw createError("ENOENT", path, "writeFile");
          }
          throw error;
        }
      }

      // Check if path exists and is a directory
      try {
        const existing = this.db.one<{ type: string }>(
          "SELECT type FROM files WHERE path = ?",
          [dbPath]
        );
        if (existing.type === "directory") {
          throw createError("EISDIR", path, "writeFile");
        }
      } catch (error) {
        // If path doesn't exist, that's fine for writeFile
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      // Write the file (create or overwrite)
      this.db.exec(
        "INSERT OR REPLACE INTO files (path, type, mode, mtime, content) VALUES (?, 'file', ?, ?, ?)",
        [dbPath, mode, mtime, buffer]
      );
    } catch (error) {
      // If we already created a specific error, re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      // Other database errors
      throw createError("EIO", path, "writeFile");
    }
  }

  async unlink(path: string): Promise<void> {
    const dbPath = this.getDbPath(path);

    try {
      // Check if path exists and get its type
      const file = this.db.one<{ type: string }>(
        "SELECT type FROM files WHERE path = ?",
        [dbPath]
      );

      // If it's a directory, throw EPERM
      if (file.type === "directory") {
        throw createError("EPERM", path, "unlink");
      }

      // Delete the file
      this.db.exec("DELETE FROM files WHERE path = ?", [dbPath]);
    } catch (error) {
      // If we already created a specific error, re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      
      if (isNotFoundError(error)) {
        throw createError("ENOENT", path, "unlink");
      }
      
      // Other database errors
      throw createError("EIO", path, "unlink");
    }
  }

  async rmdir(path: string): Promise<void> {
    const dbPath = this.getDbPath(path);

    try {
      // Check if path exists and is a directory
      const file = this.db.one<{ type: string }>(
        "SELECT type FROM files WHERE path = ?",
        [dbPath]
      );

      if (file.type !== "directory") {
        throw createError("ENOTDIR", path, "rmdir");
      }

      // Check if directory is empty
      try {
        const dirPrefix = dbPath.endsWith("/") ? dbPath : `${dbPath}/`;
        this.db.one<{ path: string }>(
          "SELECT path FROM files WHERE path LIKE ? LIMIT 1",
          [`${dirPrefix}%`]
        );
        // If we get here, directory has at least one child
        throw createError("ENOTEMPTY", path, "rmdir");
      } catch (error) {
        // If "No rows found", directory is empty, continue
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      // Delete the directory
      this.db.exec("DELETE FROM files WHERE path = ?", [dbPath]);
    } catch (error) {
      // If we already created a specific error, re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      
      if (isNotFoundError(error)) {
        throw createError("ENOENT", path, "rmdir");
      }
      
      // Other database errors
      throw createError("EIO", path, "rmdir");
    }
  }
}

