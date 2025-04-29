// src/types.ts

// Basic structure for file system errors
export interface FSError extends Error {
  code?: string;
  path?: string;
  syscall?: string;
}

// Basic structure mimicking Node.js Stats object (key properties)
// We'll refine this later based on SQLiteFSAdapter needs
export interface Stats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtimeMs: number;
  mode: number;
  // Add other common fields with placeholder types if needed now
  atimeMs?: number;
  ctimeMs?: number;
  birthtimeMs?: number;
  dev?: number; ino?: number; nlink?: number; uid?: number; gid?: number;
}