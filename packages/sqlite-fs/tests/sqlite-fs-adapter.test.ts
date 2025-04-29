// tests/sqlite-fs-adapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { BunSqliteAdapter } from '../src/bun-sqlite-adapter';
import { SQLiteFSAdapter } from '../src/sqlite-fs-adapter';

describe('SQLiteFSAdapter', () => {
  let dbAdapter: BunSqliteAdapter;
  let fs: SQLiteFSAdapter;

  beforeEach(() => {
    // Create in-memory database
    const db = new Database(':memory:');
    dbAdapter = new BunSqliteAdapter(db);
    fs = new SQLiteFSAdapter(dbAdapter);

    // Set up test file system
    dbAdapter.exec(`
      INSERT INTO files (path, type, content, mode, mtime) VALUES 
        ('.', 'directory', NULL, 16877, '2023-01-01T00:00:00Z'),
        ('file.txt', 'file', X'48656C6C6F20576F726C64', 33188, '2023-01-01T00:00:00Z'),
        ('dir', 'directory', NULL, 16877, '2023-01-01T00:00:00Z'),
        ('dir/nested.txt', 'file', X'4E6573746564206669676C65', 33188, '2023-01-01T00:00:00Z'),
        ('emptyDir', 'directory', NULL, 16877, '2023-01-01T00:00:00Z')
    `);
  });

  afterEach(() => {
    dbAdapter.close();
  });

  // lstat tests
  describe('lstat', () => {
    it('should return Stats for an existing file', async () => {
      const stats = await fs.lstat('file.txt');
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.mode).toBe(33188); // 0o100644
      expect(stats.mtimeMs).toBe(Date.parse('2023-01-01T00:00:00Z'));
    });

    it('should return Stats for an existing directory', async () => {
      const stats = await fs.lstat('dir');
      expect(stats.isFile()).toBe(false);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.size).toBe(0);
      expect(stats.mode).toBe(16877); // 0o40755
    });

    it('should throw ENOENT for a non-existent path', async () => {
      await expect(fs.lstat('nonexistent')).rejects.toThrowError(/ENOENT/);
    });
  });

  // stat tests
  describe('stat', () => {
    it('should return Stats for an existing file', async () => {
      const stats = await fs.stat('file.txt');
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });

    it('should throw ENOENT for a non-existent path', async () => {
      await expect(fs.stat('nonexistent')).rejects.toThrowError(/ENOENT/);
    });
  });

  // readFile tests
  describe('readFile', () => {
    it('should return content Buffer for an existing file', async () => {
      const content = await fs.readFile('file.txt');
      expect(content).toBeInstanceOf(Buffer);
      expect(content.toString()).toBe('Hello World');
    });

    it('should return content string for an existing file with encoding option', async () => {
      const content = await fs.readFile('file.txt', { encoding: 'utf8' });
      expect(typeof content).toBe('string');
      expect(content).toBe('Hello World');
    });

    it('should throw ENOENT for a non-existent path', async () => {
      await expect(fs.readFile('nonexistent')).rejects.toThrowError(/ENOENT/);
    });

    it('should throw EISDIR for a directory path', async () => {
      await expect(fs.readFile('dir')).rejects.toThrowError(/EISDIR/);
    });
  });

  // readdir tests
  describe('readdir', () => {
    it('should return names of entries in a directory', async () => {
      const names = await fs.readdir('dir');
      expect(names).toEqual(expect.arrayContaining(['nested.txt']));
      expect(names.length).toBe(1);
    });

    it('should return empty array for an empty directory', async () => {
      const names = await fs.readdir('emptyDir');
      expect(names).toEqual([]);
    });

    it('should throw ENOENT for a non-existent path', async () => {
      await expect(fs.readdir('nonexistent')).rejects.toThrowError(/ENOENT/);
    });

    it('should throw ENOTDIR for a file path', async () => {
      await expect(fs.readdir('file.txt')).rejects.toThrowError(/ENOTDIR/);
    });

    it('should handle root directory (.) correctly', async () => {
      const names = await fs.readdir('.');
      expect(names).toEqual(expect.arrayContaining(['file.txt', 'dir', 'emptyDir']));
      expect(names.length).toBe(3);
    });
  });
});