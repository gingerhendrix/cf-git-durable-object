**Brief: Step 3 - Define Schema & Implement Utilities**

**Goal:** Define the SQLite table schema for storing filesystem data. Implement and potentially test utility functions for path manipulation, error creation, and `Stats` object generation.

**Tasks:**

1.  **Define Filesystem Table Schema (`src/schema.ts`):**
  *   **Action:** Create `src/schema.ts`.
  *   **Content:** Define the SQL `CREATE TABLE` statement as an exported constant string.
      ```typescript
      // src/schema.ts
      export const SQL_SCHEMA = `
      CREATE TABLE IF NOT EXISTS files (
          path TEXT PRIMARY KEY NOT NULL,  -- Full virtual path relative to adapter root
          type TEXT NOT NULL CHECK(type IN ('file', 'directory', 'symlink')), -- Type constraint
          content BLOB,                    -- File content, symlink target, or NULL for directory
          mode INTEGER NOT NULL,           -- Numeric file mode (e.g., 0o100644, 0o40000)
          mtime TEXT NOT NULL              -- ISO8601 timestamp string (e.g., using DATETIME('now'))
      );
      `;

      // Optional: Add index creation if anticipating performance needs later
      // export const SQL_INDEXES = [
      //   `CREATE INDEX IF NOT EXISTS idx_files_parent ON files (dirname(path));` // Requires dirname function or careful LIKE queries
      // ];
      ```
  *   *Rationale:* Centralizes the database schema definition required by the `SQLiteFSAdapter`. Adding `CHECK` constraints improves data integrity.

2.  **Implement Path Utilities (`src/path-utils.ts`):**
  *   **Action:** Create `src/path-utils.ts`.
  *   **Content:** Implement helper functions for path manipulation. Using Node's built-in `path` module (available in Bun) is recommended for robustness.
      ```typescript
      // src/path-utils.ts
      import path from 'node:path'; // Use Node's path module via Bun

      // Re-export necessary functions or create simple wrappers if needed
      export const dirname = path.dirname;
      export const basename = path.basename;
      export const join = path.join;
      export const normalize = path.normalize; // Useful for handling '.' and '..'

      // Example custom helper if needed:
      // export function getParentPath(p: string): string {
      //   const parent = path.dirname(p);
      //   return parent === p ? '' : parent; // Handle root case
      // }
      ```
  *   *Rationale:* Provides consistent and reliable path manipulation needed for translating filesystem paths to database keys and querying parent/child relationships.

3.  **Implement Error Utilities (`src/error-utils.ts`):**
  *   **Action:** Create `src/error-utils.ts`.
  *   **Content:** Implement a factory function to create standardized filesystem error objects.
      ```typescript
      // src/error-utils.ts
      import type { FSError } from './types';

      /**
       * Creates an error object mimicking Node.js filesystem errors.
       */
      export function createError(
          code: string,
          path?: string,
          syscall?: string,
          message?: string
      ): FSError {
          const displayPath = path ? `'${path}'` : '';
          const displaySyscall = syscall ? ` ${syscall}` : '';
          const baseMessage = message || `${code}:${displaySyscall}${displayPath}`;

          const error = new Error(baseMessage) as FSError;
          error.code = code;
          if (path) error.path = path;
          if (syscall) error.syscall = syscall;

          // Could potentially add errno mapping here if needed, but code is primary identifier
          return error;
      }
      ```
  *   *Rationale:* Ensures errors thrown by the `SQLiteFSAdapter` have the expected `code` property, which libraries like `isomorphic-git` often check.

4.  **Implement Stats Utilities (`src/stats-utils.ts`):**
  *   **Action:** Create `src/stats-utils.ts`.
  *   **Content:** Implement a factory function to create `Stats` objects from database rows.
      ```typescript
      // src/stats-utils.ts
      import type { Stats } from './types';

      // Define the expected shape of the input row from the DB
      export interface DbFileRow {
          type: 'file' | 'directory' | 'symlink';
          mode: number;
          mtime: string; // ISO8601 string
          content: Buffer | Uint8Array | null; // Assuming BLOB is retrieved as Buffer/Uint8Array
      }

      /**
       * Creates a Stats object from a database row.
       */
      export function createStats(row: DbFileRow): Stats {
          const mtimeMs = Date.parse(row.mtime);
          // Ensure size is calculated correctly (content length or 0 for dirs)
          const size = row.type === 'directory' ? 0 : (row.content?.length ?? 0);

          // Create the base object matching the Stats interface
          const stats: Stats = {
              isFile: () => row.type === 'file',
              isDirectory: () => row.type === 'directory',
              isSymbolicLink: () => row.type === 'symlink',
              mode: row.mode,
              size: size,
              mtimeMs: mtimeMs,
              // Provide sensible defaults for other common Stats fields
              atimeMs: mtimeMs, // Use mtime for atime
              ctimeMs: mtimeMs, // Use mtime for ctime (metadata change time)
              birthtimeMs: mtimeMs, // Use mtime for birthtime
              dev: 0,
              ino: 0, // Inode numbers don't really apply
              nlink: 1, // Typically 1 link unless hard links were simulated
              uid: 0, // Default user/group IDs
              gid: 0,
              rdev: 0,
              blksize: 4096, // Common block size default
              blocks: Math.ceil(size / 512), // Estimate blocks based on size (512b blocks)
          };

          // Optional: Add Date getters like Node's Stats object for convenience,
          // though isomorphic-git likely uses the Ms properties primarily.
          // Object.defineProperties(stats, {
          //   mtime: { get: () => new Date(stats.mtimeMs) },
          //   atime: { get: () => new Date(stats.atimeMs!) },
          //   ctime: { get: () => new Date(stats.ctimeMs!) },
          //   birthtime: { get: () => new Date(stats.birthtimeMs!) },
          // });

          return stats;
      }
      ```
  *   *Rationale:* Provides a consistent way to generate the `Stats` objects required by `isomorphic-git`'s `lstat`/`stat` calls, translating database information into the expected format.

5.  **Testing Utilities:**
  *   **Action:** Create corresponding test files (e.g., `tests/path-utils.test.ts`, `tests/error-utils.test.ts`, `tests/stats-utils.test.ts`).
  *   **Content:** Write simple unit tests to verify the behavior of these utilities, especially `createStats` (ensure correct boolean methods, size calculation, timestamps) and `createError` (ensure correct properties are set). Test edge cases for path utils if not relying solely on `node:path`.
  *   *Rationale:* Catches regressions or errors in these fundamental helper functions early.

6.  **Export Utilities (Update `src/index.ts`):**
  *   **Action:** Update `src/index.ts` to export any utilities needed externally (likely none for this step, as they are primarily internal helpers for `SQLiteFSAdapter`). Keep exports minimal.
      ```typescript
      // src/index.ts
      export * from './interfaces';
      export * from './types';
      export { BunSqliteAdapter } from './bun-sqlite-adapter';
      // export { SQL_SCHEMA } from './schema'; // Only if needed externally
      // Utilities are likely internal, no need to export yet
      // Add SQLiteFSAdapter export later
      ```

7.  **Verify:**
  *   Run `bun test` to execute any utility tests created.
  *   Run `bun run typecheck` to ensure all files parse correctly.
  *   Commit the schema definition and utility implementations/tests.

**Outcome:** The project now has the defined database schema and the necessary helper functions (paths, errors, stats generation) ready to be used by the `SQLiteFSAdapter` implementation in the next steps.
