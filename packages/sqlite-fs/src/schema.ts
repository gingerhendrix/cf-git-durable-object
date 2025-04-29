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