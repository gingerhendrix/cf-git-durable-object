// src/schema.ts
export const CHUNK_SIZE = 1.8 * 1024 * 1024; // 1.8MB chunk size (safety margin below 2MB)

export const SQL_SCHEMA = `
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
`;