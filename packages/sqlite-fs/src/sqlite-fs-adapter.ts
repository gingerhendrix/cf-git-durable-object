// src/sqlite-fs-adapter.ts
import { createError } from "./error-utils";
import type { NoRowsError, SyncSqliteDatabase } from "./interfaces";
import { basename, dirname, normalize } from "./path-utils";
import { CHUNK_SIZE, SQL_SCHEMA } from "./schema";
import { createStats, type DbFileRow } from "./stats-utils";
import type { FSError, Stats } from "./types";

// Helper to check if an error is a "not found" error from the database
function isNotFoundError(error: any): error is NoRowsError {
  return error?.name === "NoRowsError";
}

export interface FileSystem {
  readFile: (
    path: string,
    options?: { encoding?: string },
  ) => Promise<Buffer | string>;
  writeFile: (
    path: string,
    data: string | Buffer | Uint8Array,
    options?: { encoding?: string; mode?: number },
  ) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  mkdir: (path: string, options?: { mode?: number }) => Promise<void>;
  rmdir: (path: string) => Promise<void>;
  stat: (path: string) => Promise<Stats>;
  lstat: (path: string) => Promise<Stats>;
  readlink: (path: string, options?: { encoding?: string }) => Promise<Buffer>;
  symlink: (target: string, path: string) => Promise<void>;
}

export class SQLiteFSAdapter implements FileSystem {
  private db: SyncSqliteDatabase;

  public readFile: (
    path: string,
    options?: { encoding?: string },
  ) => Promise<Buffer | string>;
  public writeFile: (
    path: string,
    data: string | Buffer | Uint8Array,
    options?: { encoding?: string; mode?: number },
  ) => Promise<void>;
  public unlink: (path: string) => Promise<void>;
  public readdir: (path: string) => Promise<string[]>;
  public mkdir: (path: string, options?: { mode?: number }) => Promise<void>;
  public rmdir: (path: string) => Promise<void>;
  public stat: (path: string) => Promise<Stats>;
  public lstat: (path: string) => Promise<Stats>;
  public readlink: (
    path: string,
    options?: { encoding?: string },
  ) => Promise<Buffer>;
  public symlink: (target: string, path: string) => Promise<void>;

  // Add promises property for isomorphic-git compatibility
  public promises: FileSystem;

  constructor(db: SyncSqliteDatabase) {
    this.db = db;

    // Bind methods directly to the adapter for isomorphic-git compatibility
    this.readFile = this._readFile.bind(this);
    this.writeFile = this._writeFile.bind(this);
    this.unlink = this._unlink.bind(this);
    this.readdir = this._readdir.bind(this);
    this.mkdir = this._mkdir.bind(this);
    this.rmdir = this._rmdir.bind(this);
    this.stat = this._stat.bind(this);
    this.lstat = this._lstat.bind(this);
    this.readlink = this._readlink.bind(this);
    this.symlink = this._symlink.bind(this);

    // Initialize the promises object with bound methods
    this.promises = {
      readFile: this._readFile.bind(this),
      writeFile: this._writeFile.bind(this),
      unlink: this._unlink.bind(this),
      readdir: this._readdir.bind(this),
      mkdir: this._mkdir.bind(this),
      rmdir: this._rmdir.bind(this),
      stat: this._stat.bind(this),
      lstat: this._lstat.bind(this),
      readlink: this._readlink.bind(this),
      symlink: this._symlink.bind(this),
    };

    // Ensure schema exists
    try {
      this.db.exec(SQL_SCHEMA);
    } catch (e) {
      console.error("Failed to initialize SQLiteFSAdapter schema", e);
      // Non-fatal error, schema might already exist or DB is read-only
    }
  }

  // Placeholder for path mapping if rootDir is used
  private getDbPath(fsPath: string): string {
    return normalize(fsPath);
  }

  // --- Read Methods ---
  async _lstat(path: string): Promise<Stats> {
    const dbPath = this.getDbPath(path);
    try {
      const row = this.db.one<DbFileRow>(
        "SELECT type, mode, mtime, content, total_size FROM file_chunks WHERE path = ? AND chunk_index = 0",
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

  async _stat(path: string): Promise<Stats> {
    // For this adapter, stat behaves identically to lstat
    return this._lstat(path);
  }

  async _readFile(
    path: string,
    options?: { encoding?: string },
  ): Promise<Buffer | string> {
    const dbPath = this.getDbPath(path);

    try {
      // First check if the file exists and get its type
      const metadataRow = this.db.one<{
        type: string;
        total_size: number;
      }>(
        "SELECT type, total_size FROM file_chunks WHERE path = ? AND chunk_index = 0",
        [dbPath],
      );

      // Check if it's a directory
      if (metadataRow.type === "directory") {
        throw createError("EISDIR", path, "readFile");
      }

      // Get all chunks for this file, ordered by chunk_index
      const chunkRows = this.db.all<{
        content: Buffer | Uint8Array | null;
      }>(
        "SELECT content FROM file_chunks WHERE path = ? ORDER BY chunk_index ASC",
        [dbPath],
      );

      // Collect all content chunks
      const contentChunks: Buffer[] = [];
      for (const row of chunkRows) {
        if (row.content) {
          contentChunks.push(Buffer.from(row.content));
        }
      }

      // Concatenate all chunks into a single buffer
      const buffer = Buffer.concat(contentChunks);

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

  async _readdir(path: string): Promise<string[]> {
    const dbPath = this.getDbPath(path);

    // First check if the path exists and is a directory
    try {
      // Special case for root directory
      if (dbPath !== "." && dbPath !== "/") {
        // Check if path exists and is a directory
        const fileCheck = this.db.one<{ type: string }>(
          "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
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
          "SELECT path FROM file_chunks WHERE chunk_index = 0 AND path != '.' AND path != '/' AND path NOT LIKE '%/%'";
        params = [];
      } else {
        // For other directories, find immediate children
        const dirPrefix = dbPath.endsWith("/") ? dbPath : `${dbPath}/`;
        sql =
          "SELECT path FROM file_chunks WHERE chunk_index = 0 AND path LIKE ? AND path NOT LIKE ? AND path != ?";
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
  async _mkdir(path: string, options?: { mode?: number }): Promise<void> {
    const dbPath = this.getDbPath(path);
    const mode = options?.mode ?? 0o755; // Default directory mode
    const mtime = new Date().toISOString();

    try {
      // Check if path already exists
      try {
        this.db.one(
          "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
          [dbPath],
        );
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
            "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
            [parentPath],
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

      // Create the directory (only needs a metadata row with chunk_index = 0)
      this.db.exec(
        "INSERT INTO file_chunks (path, chunk_index, type, mode, mtime, content, total_size) VALUES (?, 0, 'directory', ?, ?, NULL, 0)",
        [dbPath, mode, mtime],
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

  async _writeFile(
    path: string,
    data: string | Buffer | Uint8Array,
    options?: { encoding?: string; mode?: number },
  ): Promise<void> {
    const dbPath = this.getDbPath(path);
    const mode = options?.mode ?? 0o644; // Default file mode
    const mtime = new Date().toISOString();

    // Convert data to Buffer if it's a string
    const buffer =
      typeof data === "string"
        ? Buffer.from(data, options?.encoding as BufferEncoding)
        : Buffer.from(data);

    // Calculate total size
    const totalSize = buffer.length;

    try {
      // Check parent directory
      const parentPath = dirname(dbPath);
      if (parentPath !== "." && parentPath !== "/") {
        try {
          const parent = this.db.one<{ type: string }>(
            "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
            [parentPath],
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
          "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
          [dbPath],
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

      // Delete any existing chunks for this path
      this.db.exec("DELETE FROM file_chunks WHERE path = ?", [dbPath]);

      // If the file is small enough to fit in a single chunk
      if (totalSize <= CHUNK_SIZE) {
        // Write the file as a single chunk (chunk_index = 0)
        this.db.exec(
          "INSERT INTO file_chunks (path, chunk_index, type, mode, mtime, content, total_size) VALUES (?, 0, 'file', ?, ?, ?, ?)",
          [dbPath, mode, mtime, buffer, totalSize],
        );
      } else {
        // For large files, split into chunks
        const chunkCount = Math.ceil(totalSize / CHUNK_SIZE);

        // First, insert the metadata row (chunk_index = 0) with the first chunk of data
        const firstChunk = buffer.subarray(0, CHUNK_SIZE);
        this.db.exec(
          "INSERT INTO file_chunks (path, chunk_index, type, mode, mtime, content, total_size) VALUES (?, 0, 'file', ?, ?, ?, ?)",
          [dbPath, mode, mtime, firstChunk, totalSize],
        );

        // Then insert the remaining chunks
        for (let i = 1; i < chunkCount; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, totalSize);
          const chunk = buffer.subarray(start, end);

          this.db.exec(
            "INSERT INTO file_chunks (path, chunk_index, type, mode, mtime, content, total_size) VALUES (?, ?, 'file', ?, ?, ?, ?)",
            [dbPath, i, mode, mtime, chunk, totalSize],
          );
        }
      }
    } catch (error) {
      // If we already created a specific error, re-throw it
      if ((error as FSError).code) {
        throw error;
      }
      // Other database errors
      throw createError("EIO", path, "writeFile");
    }
  }

  async _unlink(path: string): Promise<void> {
    const dbPath = this.getDbPath(path);

    try {
      // Check if path exists and get its type
      const file = this.db.one<{ type: string }>(
        "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
        [dbPath],
      );

      // If it's a directory, throw EPERM
      if (file.type === "directory") {
        throw createError("EPERM", path, "unlink");
      }

      // Delete all chunks for this file
      this.db.exec("DELETE FROM file_chunks WHERE path = ?", [dbPath]);
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

  async _rmdir(path: string): Promise<void> {
    const dbPath = this.getDbPath(path);

    try {
      // Check if path exists and is a directory
      const file = this.db.one<{ type: string }>(
        "SELECT type FROM file_chunks WHERE path = ? AND chunk_index = 0",
        [dbPath],
      );

      if (file.type !== "directory") {
        throw createError("ENOTDIR", path, "rmdir");
      }

      // Check if directory is empty
      try {
        const dirPrefix = dbPath.endsWith("/") ? dbPath : `${dbPath}/`;
        this.db.one<{ path: string }>(
          "SELECT path FROM file_chunks WHERE path LIKE ? AND path != ? AND chunk_index = 0 LIMIT 1",
          [`${dirPrefix}%`, dbPath],
        );
        // If we get here, directory has at least one child
        throw createError("ENOTEMPTY", path, "rmdir");
      } catch (error) {
        // If "No rows found", directory is empty, continue
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      // Delete the directory (only the metadata row)
      this.db.exec(
        "DELETE FROM file_chunks WHERE path = ? AND chunk_index = 0",
        [dbPath],
      );
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

  // --- Symlink Methods (Stubs) ---
  async _readlink(
    path: string,
    _options?: { encoding?: string },
  ): Promise<Buffer> {
    // This is a stub implementation since we don't support symlinks
    throw createError("EINVAL", path, "readlink");
  }

  async _symlink(_target: string, path: string): Promise<void> {
    // This is a stub implementation since we don't support symlinks
    throw createError("EPERM", path, "symlink");
  }
}
