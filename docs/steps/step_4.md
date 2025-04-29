
**Brief: Step 4 - Implement `SQLiteFSAdapter` - Core Read Methods & Tests**

**Goal:** Implement the core read-only methods (`lstat`, `stat`, `readFile`, `readdir`) of the `SQLiteFSAdapter` class. These methods will use the `SyncSqliteDatabase` interface (via the `BunSqliteAdapter` instance) and the utilities created in Step 4. Write tests using Vitest to verify the correctness of these
methods against the `fs.promises` API contract.

**Prerequisites:**
*   Step 2 (Implement & Test `BunSqliteAdapter`) is complete.
*   Step 4 (Schema & Utilities) is complete.

**Tasks:**

1.  **Setup `SQLiteFSAdapter` Class and Test File:**
  *   **Action:** Create `src/sqlite-fs-adapter.ts`.
  *   **Content:** Define the basic `SQLiteFSAdapter` class structure.
      *   Import `SyncSqliteDatabase` interface, `BunSqliteAdapter` (or just the interface), utility functions (`createError`, `createStats`, `getDbPath` helper if needed, path utils), schema constant (`SQL_SCHEMA`), and types (`Stats`, `FSError`).
      *   The constructor should accept an instance of `SyncSqliteDatabase` and optionally a `rootDir` string. Store the database instance.
      *   Consider adding an `initialize()` method (or call it in the constructor) that executes the `SQL_SCHEMA` using `db.exec()` to ensure the `files` table exists. Handle potential errors if the table already exists gracefully (`CREATE TABLE IF NOT EXISTS`).
      *   Stub out the read methods (`lstat`, `stat`, `readFile`, `readdir`) to throw `new Error('Not implemented')` initially.
      ```typescript
      // src/sqlite-fs-adapter.ts (Initial Stub)
      import type { SyncSqliteDatabase } from './interfaces';
      import type { Stats, FSError } from './types';
      import { SQL_SCHEMA } from './schema';
      import { createError } from './error-utils';
      import { createStats, type DbFileRow } from './stats-utils';
      import { dirname, basename, join, normalize } from './path-utils'; // Import path utils

      export class SQLiteFSAdapter {
          private db: SyncSqliteDatabase;
          private rootDir: string; // Track root directory if needed

          constructor(db: SyncSqliteDatabase, rootDir: string = '.') {
              this.db = db;
              this.rootDir = rootDir; // Normalize if needed
              // Ensure schema exists
              try {
                  this.db.exec(SQL_SCHEMA);
              } catch (e) {
                  console.error("Failed to initialize SQLiteFSAdapter schema", e);
                  // Decide if this should be fatal or logged
              }
          }

          // Placeholder for path mapping if rootDir is used
          private getDbPath(fsPath: string): string {
              // Implement mapping based on rootDir later if needed
              return normalize(fsPath);
          }

          // --- Read Methods (Stubs) ---
          async lstat(path: string): Promise<Stats> { throw new Error('Not implemented: lstat'); }
          async stat(path: string): Promise<Stats> { throw new Error('Not implemented: stat'); }
          async readFile(path: string, options?: { encoding?: string }): Promise<Buffer | string> { throw new Error('Not implemented: readFile'); }
          async readdir(path: string): Promise<string[]> { throw new Error('Not implemented: readdir'); }

          // --- Write Methods (Stubs for later) ---
          // async writeFile(...) { throw new Error('Not implemented'); }
          // async mkdir(...) { throw new Error('Not implemented'); }
          // async unlink(...) { throw new Error('Not implemented'); }
          // async rmdir(...) { throw new Error('Not implemented'); }
      }
      ```
  *   **Action:** Create `tests/sqlite-fs-adapter.test.ts`.
  *   **Content:** Import `describe`, `it`, `expect`, `beforeEach`, `afterEach` from `vitest`. Import `BunSqliteAdapter` and `SQLiteFSAdapter`.
  *   Set up `beforeEach`:
      *   Create a new in-memory `BunSqliteAdapter` instance (`dbAdapter = new BunSqliteAdapter()`).
      *   Create a new `SQLiteFSAdapter` instance using the `dbAdapter` (`fs = new SQLiteFSAdapter(dbAdapter)`).
      *   Use `dbAdapter.exec()` *directly* within `beforeEach` or specific tests to insert initial filesystem entries into the `files` table for testing read operations (e.g., insert rows representing `/file.txt`, `/dir`, `/dir/nested.txt`). Remember to include `type`, `content` (as Buffer for files), `mode`,
and `mtime`.
  *   Set up `afterEach` to call `dbAdapter.close()`.

2.  **Implement `lstat`:**
  *   **Test:** In `tests/sqlite-fs-adapter.test.ts`, write tests for `lstat`:
      *   `it('lstat: should return Stats for an existing file', async () => { ... });` (Check `stats.isFile()`, `stats.size`, `stats.mode`, `stats.mtimeMs`).
      *   `it('lstat: should return Stats for an existing directory', async () => { ... });` (Check `stats.isDirectory()`, `stats.size === 0`).
      *   `it('lstat: should throw ENOENT for a non-existent path', async () => { await expect(fs.lstat('nonexistent')).rejects.toThrowError(/ENOENT/); });`
      *   (Add tests for symlinks later if implementing `symlink`).
  *   **Implement:** Write the `async lstat` method in `SQLiteFSAdapter`.
      *   Use `this.db.one()` to query the `files` table for the given `path`.
      *   Use `try...catch` around the DB call.
      *   If `one()` throws a "No rows found" error (use `isNotFoundError` helper), catch it and throw `createError('ENOENT', path, 'lstat')`.
      *   If successful, pass the retrieved row (`type`, `mode`, `mtime`, `content`) to `createStats()` utility.
      *   Return the created `Stats` object.
      *   Handle other potential DB errors by throwing `createError('EIO', path, 'lstat')`.
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `lstat` tests pass.

3.  **Implement `stat`:**
  *   **Test:** Write basic tests for `stat`. Since `stat` and `lstat` behave identically in this adapter (no symlink following), the tests will be very similar to `lstat`.
      *   `it('stat: should return Stats for an existing file', async () => { ... });`
      *   `it('stat: should throw ENOENT for a non-existent path', async () => { ... });`
  *   **Implement:** Implement `async stat` simply by calling and returning `this.lstat(path)`.
      ```typescript
      async stat(path: string): Promise<Stats> {
          // For this adapter, stat behaves identically to lstat
          return this.lstat(path);
      }
      ```
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `stat` tests pass.

4.  **Implement `readFile`:**
  *   **Test:** Write tests for `readFile`:
      *   `it('readFile: should return content Buffer for an existing file', async () => { const content = await fs.readFile('file.txt'); expect(content).toBeInstanceOf(Buffer); expect(content.toString()).toBe('...'); });`
      *   `it('readFile: should return content string for an existing file with encoding option', async () => { const content = await fs.readFile('file.txt', { encoding: 'utf8' }); expect(typeof content).toBe('string'); expect(content).toBe('...'); });`
      *   `it('readFile: should throw ENOENT for a non-existent path', async () => { await expect(fs.readFile('nonexistent')).rejects.toThrowError(/ENOENT/); });`
      *   `it('readFile: should throw EISDIR for a directory path', async () => { await expect(fs.readFile('dir')).rejects.toThrowError(/EISDIR/); });`
  *   **Implement:** Write the `async readFile` method.
      *   Use `this.db.one()` to query `content` and `type` for the `path`.
      *   Use `try...catch`. Handle "No rows found" -> `ENOENT`.
      *   Check if `type` is 'file'. If not (e.g., 'directory'), throw `createError('EISDIR', path, 'readFile')`.
      *   Ensure the retrieved `content` (likely a `Uint8Array` or `Buffer` from `bun:sqlite`) is converted to a `Buffer`.
      *   If `options.encoding` is provided, return `buffer.toString(options.encoding)`. Otherwise, return the `Buffer`.
      *   Handle other DB errors -> `EIO`.
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `readFile` tests pass.

5.  **Implement `readdir`:**
  *   **Test:** Write tests for `readdir`:
      *   `it('readdir: should return names of entries in a directory', async () => { const names = await fs.readdir('dir'); expect(names).toEqual(expect.arrayContaining(['nested.txt', /* other entries */])); expect(names.length).toBe(/* correct number */); });`
      *   `it('readdir: should return empty array for an empty directory', async () => { /* setup empty dir */ const names = await fs.readdir('emptyDir'); expect(names).toEqual([]); });`
      *   `it('readdir: should throw ENOENT for a non-existent path', async () => { await expect(fs.readdir('nonexistent')).rejects.toThrowError(/ENOENT/); });`
      *   `it('readdir: should throw ENOTDIR for a file path', async () => { await expect(fs.readdir('file.txt')).rejects.toThrowError(/ENOTDIR/); });`
      *   `it('readdir: should handle root directory (.) correctly', async () => { const names = await fs.readdir('.'); expect(names).toEqual(expect.arrayContaining(['file.txt', 'dir'])); });` (Adjust based on test setup).
  *   **Implement:** Write the `async readdir` method.
      *   First, check if the `path` exists and is a directory (unless it's the root `.`). Use `this.db.one()` to get the `type`. Handle `ENOENT` and `ENOTDIR` errors appropriately based on the check result.
      *   Construct the SQL `LIKE` query to find immediate children (e.g., `SELECT path FROM files WHERE path LIKE ? AND path NOT LIKE ?`, binding `dir/%` and `dir/%/%`). Handle the root directory case (`.` or `/`) correctly in the patterns.
      *   Use `this.db.all()` to get the full paths of children.
      *   Map the results to extract the `basename` of each child path using the path utility.
      *   Return the array of basenames.
      *   Use `try...catch` for DB errors -> `EIO`.
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `readdir` tests pass.

6.  **Final Review & Export:**
  *   Run all tests together: `bun test`. Ensure everything passes.
  *   Review the implemented read methods in `SQLiteFSAdapter` for clarity and correctness.
  *   Ensure `SQLiteFSAdapter` is exported from `src/index.ts`.
  *   Commit the adapter implementation and tests for the read methods.

**Outcome:** The `SQLiteFSAdapter` now has functional, tested implementations for the core read operations (`lstat`, `stat`, `readFile`, `readdir`), laying the groundwork for using `isomorphic-git`'s read functionalities. The project is ready for Step 6 (Implement Write Methods).
