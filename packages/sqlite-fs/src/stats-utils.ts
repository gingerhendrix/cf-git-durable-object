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

    return stats;
}