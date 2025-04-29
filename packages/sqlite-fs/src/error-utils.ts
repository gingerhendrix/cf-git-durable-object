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