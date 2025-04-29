// tests/stats-utils.test.ts
import { describe, expect, it } from 'bun:test';
import { createStats } from '../src/stats-utils';
import type { DbFileRow } from '../src/stats-utils';

describe('stats-utils', () => {
  describe('createStats', () => {
    it('should create stats for a file', () => {
      const content = new Uint8Array([1, 2, 3, 4, 5]);
      const row: DbFileRow = {
        type: 'file',
        mode: 0o100644,
        mtime: '2023-01-01T00:00:00.000Z',
        content
      };

      const stats = createStats(row);
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.isSymbolicLink()).toBe(false);
      expect(stats.size).toBe(5);
      expect(stats.mode).toBe(0o100644);
      expect(stats.mtimeMs).toBe(Date.parse('2023-01-01T00:00:00.000Z'));
      expect(stats.atimeMs).toBe(stats.mtimeMs);
      expect(stats.ctimeMs).toBe(stats.mtimeMs);
      expect(stats.birthtimeMs).toBe(stats.mtimeMs);
      expect(stats.blocks).toBe(1); // ceil(5/512) = 1
    });

    it('should create stats for a directory', () => {
      const row: DbFileRow = {
        type: 'directory',
        mode: 0o40755,
        mtime: '2023-01-01T00:00:00.000Z',
        content: null
      };

      const stats = createStats(row);
      expect(stats.isFile()).toBe(false);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
      expect(stats.size).toBe(0);
      expect(stats.mode).toBe(0o40755);
      expect(stats.blocks).toBe(0);
    });

    it('should create stats for a symlink', () => {
      const content = Buffer.from('/target/path');
      const row: DbFileRow = {
        type: 'symlink',
        mode: 0o120755,
        mtime: '2023-01-01T00:00:00.000Z',
        content
      };

      const stats = createStats(row);
      expect(stats.isFile()).toBe(false);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(stats.size).toBe(12); // Length of '/target/path'
      expect(stats.mode).toBe(0o120755);
    });

    it('should handle null content for files', () => {
      const row: DbFileRow = {
        type: 'file',
        mode: 0o100644,
        mtime: '2023-01-01T00:00:00.000Z',
        content: null
      };

      const stats = createStats(row);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBe(0);
    });
  });
});