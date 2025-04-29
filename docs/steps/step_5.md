**Brief: Step 5 - Implement `SQLiteFSAdapter` - Core Write Methods & Tests**

**Goal:** Implement the core write methods (`mkdir`, `writeFile`, `unlink`, `rmdir`) of the `SQLiteFSAdapter` class. These methods will modify the state of the virtual filesystem stored in the SQLite `files` table. Write tests using Vitest to verify the correctness of these methods, including side effects and
error handling.

**Prerequisites:**
*   Steps 2-4 are complete. The `SQLiteFSAdapter` class exists with working read methods and test setup (`tests/sqlite-fs-adapter.test.ts`).

**Process (Iterative for each method):**

1.  **Setup (Verify/Extend):**
  *   Ensure the `tests/sqlite-fs-adapter.test.ts` file's `beforeEach` creates a fresh in-memory `SQLiteFSAdapter` instance for each test.
  *   You might want helper functions within your test file to easily check the state of the DB after a write operation (e.g., `async function expectPathToExist(path, type)` or `async function expectPathToNotExist(path)` using `fs.lstat`).

2.  **Implement `mkdir` (Non-Recursive):**
  *   **Test:** In `tests/sqlite-fs-adapter.test.ts`, write tests for `mkdir`:
      *   `it('mkdir: should create a new directory', async () => { await fs.mkdir('newDir'); const stats = await fs.lstat('newDir'); expect(stats.isDirectory()).toBe(true); });`
      *   `it('mkdir: should set default mode on new directory', async () => { await fs.mkdir('newDir'); const stats = await fs.lstat('newDir'); expect(stats.mode & 0o777).toBe(0o755); /* Or your chosen default */ });`
      *   `it('mkdir: should allow specifying mode', async () => { await fs.mkdir('newDirMode', { mode: 0o700 }); const stats = await fs.lstat('newDirMode'); expect(stats.mode & 0o777).toBe(0o700); });`
      *   `it('mkdir: should throw EEXIST if path already exists (file)', async () => { /* setup file.txt */ await expect(fs.mkdir('file.txt')).rejects.toThrowError(/EEXIST/); });`
      *   `it('mkdir: should throw EEXIST if path already exists (directory)', async () => { /* setup dir */ await expect(fs.mkdir('dir')).rejects.toThrowError(/EEXIST/); });`
      *   `it('mkdir: should throw ENOENT if parent directory does not exist', async () => { await expect(fs.mkdir('nonexistent/newDir')).rejects.toThrowError(/ENOENT/); });`
      *   `it('mkdir: should throw ENOTDIR if parent path is a file', async () => { /* setup file.txt */ await expect(fs.mkdir('file.txt/newDir')).rejects.toThrowError(/ENOTDIR/); });`
      *   (Defer recursive tests unless implementing now).
  *   **Implement:** Write the `async mkdir` method in `SQLiteFSAdapter`.
      *   Check if the path already exists using `this.db.one()`. If it does, throw `EEXIST`. Catch the "No rows found" error and continue.
      *   Determine the parent path using `dirname`.
      *   If the parent is not root (`.` or `/`), check if the parent exists and is a directory using `this.db.one()`. Throw `ENOENT` or `ENOTDIR` if checks fail.
      *   Use `this.db.exec()` to `INSERT` a new row into `files` with `type='directory'`, the specified or default `mode`, a current `mtime`, and `content=NULL`.
      *   Use `try...catch` around DB calls, translating errors (`UNIQUE constraint` -> `EEXIST`, others -> `EIO`).
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `mkdir` tests pass.

3.  **Implement `writeFile`:**
  *   **Test:** Write tests for `writeFile`:
      *   `it('writeFile: should create a new file with Buffer data', async () => { const data = Buffer.from('hello'); await fs.writeFile('newFile.txt', data); const content = await fs.readFile('newFile.txt'); expect(content).toEqual(data); const stats = await fs.lstat('newFile.txt');
expect(stats.isFile()).toBe(true); expect(stats.size).toBe(data.length); });`
      *   `it('writeFile: should create a new file with string data', async () => { const data = 'world'; await fs.writeFile('newFile2.txt', data); const content = await fs.readFile('newFile2.txt', { encoding: 'utf8' }); expect(content).toBe(data); });`
      *   `it('writeFile: should overwrite an existing file', async () => { /* setup file.txt */ const newData = 'overwrite'; await fs.writeFile('file.txt', newData); const content = await fs.readFile('file.txt', { encoding: 'utf8' }); expect(content).toBe(newData); });`
      *   `it('writeFile: should set default mode on new file', async () => { await fs.writeFile('newFileMode.txt', 'data'); const stats = await fs.lstat('newFileMode.txt'); expect(stats.mode & 0o777).toBe(0o644); /* Or your chosen default */ });`
      *   `it('writeFile: should allow specifying mode', async () => { await fs.writeFile('newFileMode2.txt', 'data', { mode: 0o600 }); const stats = await fs.lstat('newFileMode2.txt'); expect(stats.mode & 0o777).toBe(0o600); });`
      *   `it('writeFile: should throw ENOENT if parent directory does not exist', async () => { await expect(fs.writeFile('nonexistent/newFile.txt', 'data')).rejects.toThrowError(/ENOENT/); });`
      *   `it('writeFile: should throw ENOTDIR if parent path is a file', async () => { /* setup file.txt */ await expect(fs.writeFile('file.txt/newFile.txt', 'data')).rejects.toThrowError(/ENOTDIR/); });`
      *   `it('writeFile: should throw EISDIR if path is an existing directory', async () => { /* setup dir */ await expect(fs.writeFile('dir', 'data')).rejects.toThrowError(/EISDIR/); });`
  *   **Implement:** Write the `async writeFile` method.
      *   Determine parent path. Check if parent exists and is a directory (similar to `mkdir`), throwing `ENOENT` or `ENOTDIR` if needed.
      *   Use `this.db.exec()` with `INSERT OR REPLACE INTO files (...) VALUES (?, 'file', ?, ?, ?)` to write the data. This handles both creation and overwrite atomically at the DB level. Ensure data is passed as a Buffer.
      *   Before the `INSERT OR REPLACE`, you *could* fetch the existing entry to check if it's a directory and throw `EISDIR`, although `INSERT OR REPLACE` might just overwrite it. It's safer to check first: `SELECT type FROM files WHERE path = ?`. If it exists and is a directory, throw `EISDIR`.
      *   Use `try...catch` for DB errors -> `EIO`.
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `writeFile` tests pass.

4.  **Implement `unlink`:**
  *   **Test:** Write tests for `unlink`:
      *   `it('unlink: should delete an existing file', async () => { /* setup file.txt */ await fs.unlink('file.txt'); await expect(fs.lstat('file.txt')).rejects.toThrowError(/ENOENT/); });`
      *   `it('unlink: should throw ENOENT for a non-existent path', async () => { await expect(fs.unlink('nonexistent')).rejects.toThrowError(/ENOENT/); });`
      *   `it('unlink: should throw EPERM or EISDIR when trying to unlink a directory', async () => { /* setup dir */ await expect(fs.unlink('dir')).rejects.toThrowError(/EPERM|EISDIR/); });` // Check Node.js behavior for specific code
  *   **Implement:** Write the `async unlink` method.
      *   Use `this.db.one()` to check if the path exists and get its `type`. Handle "No rows found" -> `ENOENT`.
      *   If `type` is 'directory', throw `createError('EPERM', path, 'unlink')` (or `EISDIR`).
      *   If it's a file (or symlink), use `this.db.exec('DELETE FROM files WHERE path = ?', [dbPath])`.
      *   Use `try...catch` for DB errors -> `EIO`.
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `unlink` tests pass.

5.  **Implement `rmdir`:**
  *   **Test:** Write tests for `rmdir`:
      *   `it('rmdir: should delete an existing empty directory', async () => { /* setup emptyDir */ await fs.rmdir('emptyDir'); await expect(fs.lstat('emptyDir')).rejects.toThrowError(/ENOENT/); });`
      *   `it('rmdir: should throw ENOENT for a non-existent path', async () => { await expect(fs.rmdir('nonexistent')).rejects.toThrowError(/ENOENT/); });`
      *   `it('rmdir: should throw ENOTDIR for a file path', async () => { /* setup file.txt */ await expect(fs.rmdir('file.txt')).rejects.toThrowError(/ENOTDIR/); });`
      *   `it('rmdir: should throw ENOTEMPTY for a non-empty directory', async () => { /* setup dir with nested.txt */ await expect(fs.rmdir('dir')).rejects.toThrowError(/ENOTEMPTY/); });`
  *   **Implement:** Write the `async rmdir` method.
      *   Use `this.db.one()` to check if the path exists and is a directory. Handle `ENOENT` and `ENOTDIR`.
      *   Perform a second query to check for children: `SELECT path FROM files WHERE path LIKE ? LIMIT 1` (binding `dir/%`). Use `this.db.one()` for this. If it succeeds (finds a child), throw `ENOTEMPTY`. Catch the "No rows found" error and continue (means directory is empty).
      *   If empty, use `this.db.exec('DELETE FROM files WHERE path = ?', [dbPath])`.
      *   Use `try...catch` for DB errors -> `EIO`.
  *   **Run:** `bun test tests/sqlite-fs-adapter.test.ts` until `rmdir` tests pass.

6.  **Final Review & Export:**
  *   Run all tests together: `bun test`. Ensure everything passes.
  *   Review the implemented write methods in `SQLiteFSAdapter` for clarity, correctness, and error handling.
  *   Ensure `SQLiteFSAdapter` is exported from `src/index.ts`.
  *   Commit the completed write method implementations and tests.
