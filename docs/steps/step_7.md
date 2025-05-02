**Plan: Modify `sqlite-fs-library` to Support File Chunking (Max ~2MB)**

**1. Goal:**

Modify the `sqlite-fs-library` to store file content in multiple database rows ("chunks") when the file size exceeds a defined limit (~1.8MB). This ensures compatibility with storage backends like Cloudflare Durable Objects SQLite that have row/blob size limitations. This modification should be done *without*
adding database transaction logic.

**2. Core Problem & Strategy:**

*   **Problem:** Some SQLite backends limit the maximum size of data (like BLOBs) stored in a single row.
*   **Strategy:** We will implement a "chunking" strategy. Files larger than a predefined `CHUNK_SIZE` will have their content split across multiple rows in a new database table. Smaller files, directories, and symlinks will still primarily use a single row for their metadata and content/target.

**3. Schema Changes:**

*   **Action:** Define and use a new SQL schema designed for chunking. Locate the existing schema definition (likely in a `src/schema.ts` or similar) and replace it with the following structure. Ensure the `SQLiteFSAdapter` constructor uses this new schema for `CREATE TABLE IF NOT EXISTS`.
*   **New Schema SQL:**
  ```sql
  -- Define this table structure, replacing the old one
  CREATE TABLE IF NOT EXISTS file_chunks (
      path TEXT NOT NULL,             -- The virtual filesystem path
      chunk_index INTEGER NOT NULL,   -- 0 for the first/only chunk or metadata, 1+ for subsequent chunks
      type TEXT NOT NULL CHECK(type IN ('file', 'directory', 'symlink')), -- Node type
      content BLOB,                   -- File chunk data, symlink target, or NULL for directory
      mode INTEGER NOT NULL,          -- Filesystem mode
      mtime TEXT NOT NULL,            -- Modification time (ISO8601)
      total_size INTEGER NOT NULL,    -- Original total size of the file (0 for dirs/links)
      PRIMARY KEY (path, chunk_index) -- Ensures chunk uniqueness per path
  );

  -- Add indexes for efficient lookups
  CREATE INDEX IF NOT EXISTS idx_file_chunks_metadata ON file_chunks (path, chunk_index) WHERE chunk_index = 0;
  CREATE INDEX IF NOT EXISTS idx_file_chunks_ordered ON file_chunks (path, chunk_index);
  ```

**4. Configuration:**

*   **Action:** Define a constant for the maximum chunk size within the library (e.g., in `src/schema.ts` or a config file).
*   **Value:** `export const CHUNK_SIZE = 1.8 * 1024 * 1024;` (This provides a safety margin below 2MB).

**5. `SQLiteFSAdapter` Modifications:**

*   **General:** Update all methods that interact with the database to use the `file_chunks` table and its columns (`chunk_index`, `total_size`, etc.). Adapt SQL queries accordingly. Remember that existence checks, type checks, and metadata retrieval should primarily target the row where `chunk_index = 0`.

*   **`lstat` / `stat` Methods:**
  *   **Logic:** Query the `file_chunks` table for the row where `path = ?` AND `chunk_index = 0`.
  *   **Data:** Retrieve `type`, `mode`, `mtime`, and `total_size` from this row.
  *   **Stats Object:** Use the retrieved `total_size` for the `Stats.size` property. Update the `createStats` utility if necessary.
  *   **Error Handling:** If the `chunk_index = 0` row is not found, throw an `ENOENT` error.

*   **`readFile` Method:**
  *   **Logic:**
      1.  First, check for the existence and type of the file by querying the `chunk_index = 0` row. Throw `ENOENT` if not found, `EISDIR` if it's a directory.
      2.  If it's a file, query *all* rows for that path, ordered by `chunk_index`: `SELECT content FROM file_chunks WHERE path = ? ORDER BY chunk_index ASC`.
      3.  Iterate through the results, collecting all non-null `content` BLOBs.
      4.  Concatenate these BLOBs (e.g., using `Buffer.concat()`) into a single Buffer.
      5.  Handle encoding options on the final concatenated buffer.
  *   **Error Handling:** Handle database errors during chunk retrieval.

*   **`writeFile` Method:**
  *   **Logic:**
      1.  Perform necessary parent directory and target path type checks (querying `chunk_index = 0` for relevant paths). Handle `ENOENT`, `ENOTDIR`, `EISDIR`.
      2.  Convert the input data to a Buffer and calculate its `total_size`.
      3.  **Delete Phase (Non-atomic):** Execute `DELETE FROM file_chunks WHERE path = ?` to remove any existing chunks/metadata for this path.
      4.  **Insert Phase (Non-atomic):**
          *   Slice the data Buffer into chunks based on `CHUNK_SIZE`.
          *   Loop through the chunks, maintaining a `chunk_index` (starting at 0).
          *   For each chunk, execute an `INSERT INTO file_chunks (...)` statement, providing the `path`, current `chunk_index`, `type='file'`, the chunk's `content` BLOB, `mode`, `mtime`, and the calculated `total_size`.
  *   **Error Handling:** Handle database errors during delete or insert phases. Note that failures during the insert phase might leave partial data.

*   **`mkdir` Method:**
  *   **Logic:**
      1.  Perform existence and parent directory checks (querying `chunk_index = 0`). Handle `EEXIST`, `ENOENT`, `ENOTDIR`.
      2.  Execute a single `INSERT INTO file_chunks (...)` statement to create the metadata row: `path = ?`, `chunk_index = 0`, `type = 'directory'`, `content = NULL`, `mode = ?`, `mtime = ?`, `total_size = 0`.
  *   **Error Handling:** Handle potential constraint errors during insert (e.g., `EEXIST`).

*   **`unlink` Method:**
  *   **Logic:**
      1.  Check existence and type by querying `chunk_index = 0`. Handle `ENOENT`. Throw `EPERM` or `EISDIR` if it's a directory.
      2.  If it's a file or symlink, execute `DELETE FROM file_chunks WHERE path = ?` to remove all associated rows.
  *   **Error Handling:** Handle database errors.

*   **`rmdir` Method:**
  *   **Logic:**
      1.  Check existence and type (`type = 'directory'`) by querying `chunk_index = 0`. Handle `ENOENT`, `ENOTDIR`.
      2.  Check for emptiness by querying if any *other* rows exist with the target path as a prefix: `SELECT 1 FROM file_chunks WHERE path LIKE ? AND path != ? LIMIT 1` (binding `targetPath/%` and `targetPath`). If this query returns a row, throw `ENOTEMPTY`.
      3.  If empty, execute `DELETE FROM file_chunks WHERE path = ? AND chunk_index = 0` to remove only the directory's metadata row.
  *   **Error Handling:** Handle database errors.

**6. Utility Function Modifications:**

*   **`createStats` (or similar):**
  *   **Action:** Modify the utility function that generates `Stats` objects.
  *   **Logic:** Ensure it accepts the `total_size` value from the database row and uses it directly for the `Stats.size` property, rather than calculating size based on the `content` BLOB (which is now just a chunk for large files). Update related type definitions (like `DbFileRow`) if used.

**7. Testing:**

*   **Action:** Add new unit tests and update existing ones in `tests/sqlite-fs-adapter.test.ts`.
*   **Focus:**
  *   Verify `writeFile` correctly creates single (`chunk_index = 0`) rows for small files.
  *   Verify `writeFile` correctly creates multiple, ordered chunk rows for large files (> `CHUNK_SIZE`).
  *   Verify `readFile` correctly reconstructs both small and large files from the `file_chunks` table.
  *   Verify `lstat`/`stat` report the correct `total_size` for both small and large files.
  *   Verify `unlink` removes *all* chunks for a file.
  *   Verify `rmdir` emptiness check works correctly with the new schema.
  *   Ensure all existing tests for directories, errors (`ENOENT`, `EEXIST`, etc.) still pass with the new schema interaction.
