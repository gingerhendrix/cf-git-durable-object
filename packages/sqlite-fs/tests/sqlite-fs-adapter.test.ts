// tests/sqlite-fs-adapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { BunSqliteAdapter } from '../src/bun-sqlite-adapter';
import { SQLiteFSAdapter } from '../src/sqlite-fs-adapter';
import { CHUNK_SIZE } from '../src/schema';

describe('SQLiteFSAdapter', () => {
  let dbAdapter: BunSqliteAdapter;
  let fs: SQLiteFSAdapter;

  beforeEach(() => {
    // Create in-memory database
    const db = new Database(':memory:');
    dbAdapter = new BunSqliteAdapter(db);
    fs = new SQLiteFSAdapter(dbAdapter);

    // Set up test file system with the new schema
    dbAdapter.exec(`
      INSERT INTO file_chunks (path, chunk_index, type, content, mode, mtime, total_size) VALUES 
        ('.', 0, 'directory', NULL, 16877, '2023-01-01T00:00:00Z', 0),
        ('file.txt', 0, 'file', X'48656C6C6F20576F726C64', 33188, '2023-01-01T00:00:00Z', 11),
        ('dir', 0, 'directory', NULL, 16877, '2023-01-01T00:00:00Z', 0),
        ('dir/nested.txt', 0, 'file', X'4E6573746564206669676C65', 33188, '2023-01-01T00:00:00Z', 13),
        ('emptyDir', 0, 'directory', NULL, 16877, '2023-01-01T00:00:00Z', 0)
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
      expect(stats.size).toBe(11); // "Hello World" length
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
      expect(stats.size).toBe(11); // "Hello World" length
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

  // Helper functions for testing
  async function expectPathToExist(path: string, type: 'file' | 'directory'): Promise<void> {
    const stats = await fs.lstat(path);
    if (type === 'file') {
      expect(stats.isFile()).toBe(true);
    } else {
      expect(stats.isDirectory()).toBe(true);
    }
  }

  async function expectPathToNotExist(path: string): Promise<void> {
    await expect(fs.lstat(path)).rejects.toThrowError(/ENOENT/);
  }

  // mkdir tests
  describe('mkdir', () => {
    it('mkdir: should create a new directory', async () => {
      await fs.mkdir('newDir');
      const stats = await fs.lstat('newDir');
      expect(stats.isDirectory()).toBe(true);
    });

    it('mkdir: should set default mode on new directory', async () => {
      await fs.mkdir('newDir2');
      const stats = await fs.lstat('newDir2');
      expect(stats.mode & 0o777).toBe(0o755);
    });

    it('mkdir: should allow specifying mode', async () => {
      await fs.mkdir('newDirMode', { mode: 0o700 });
      const stats = await fs.lstat('newDirMode');
      expect(stats.mode & 0o777).toBe(0o700);
    });

    it('mkdir: should throw EEXIST if path already exists (file)', async () => {
      await expect(fs.mkdir('file.txt')).rejects.toThrowError(/EEXIST/);
    });

    it('mkdir: should throw EEXIST if path already exists (directory)', async () => {
      await expect(fs.mkdir('dir')).rejects.toThrowError(/EEXIST/);
    });

    it('mkdir: should throw ENOENT if parent directory does not exist', async () => {
      await expect(fs.mkdir('nonexistent/newDir')).rejects.toThrowError(/ENOENT/);
    });

    it('mkdir: should throw ENOTDIR if parent path is a file', async () => {
      await expect(fs.mkdir('file.txt/newDir')).rejects.toThrowError(/ENOTDIR/);
    });
  });

  // writeFile tests
  describe('writeFile', () => {
    it('writeFile: should create a new file with Buffer data', async () => {
      const data = Buffer.from('hello');
      await fs.writeFile('newFile.txt', data);
      const content = await fs.readFile('newFile.txt');
      expect(content).toEqual(data);
      const stats = await fs.lstat('newFile.txt');
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBe(data.length);
    });

    it('writeFile: should create a new file with string data', async () => {
      const data = 'world';
      await fs.writeFile('newFile2.txt', data);
      const content = await fs.readFile('newFile2.txt', { encoding: 'utf8' });
      expect(content).toBe(data);
    });

    it('writeFile: should overwrite an existing file', async () => {
      const newData = 'overwrite';
      await fs.writeFile('file.txt', newData);
      const content = await fs.readFile('file.txt', { encoding: 'utf8' });
      expect(content).toBe(newData);
    });

    it('writeFile: should set default mode on new file', async () => {
      await fs.writeFile('newFileMode.txt', 'data');
      const stats = await fs.lstat('newFileMode.txt');
      expect(stats.mode & 0o777).toBe(0o644);
    });

    it('writeFile: should allow specifying mode', async () => {
      await fs.writeFile('newFileMode2.txt', 'data', { mode: 0o600 });
      const stats = await fs.lstat('newFileMode2.txt');
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('writeFile: should throw ENOENT if parent directory does not exist', async () => {
      await expect(fs.writeFile('nonexistent/newFile.txt', 'data')).rejects.toThrowError(/ENOENT/);
    });

    it('writeFile: should throw ENOTDIR if parent path is a file', async () => {
      await expect(fs.writeFile('file.txt/newFile.txt', 'data')).rejects.toThrowError(/ENOTDIR/);
    });

    it('writeFile: should throw EISDIR if path is an existing directory', async () => {
      await expect(fs.writeFile('dir', 'data')).rejects.toThrowError(/EISDIR/);
    });

    // New test for chunking
    it('writeFile: should store small files in a single chunk', async () => {
      const data = 'small file content';
      await fs.writeFile('smallFile.txt', data);
      
      // Verify file was written correctly
      const content = await fs.readFile('smallFile.txt', { encoding: 'utf8' });
      expect(content).toBe(data);
      
      // Check that only one chunk was created
      const chunks = dbAdapter.all<{ chunk_index: number }>(
        "SELECT chunk_index FROM file_chunks WHERE path = ? ORDER BY chunk_index",
        ['smallFile.txt']
      );
      expect(chunks.length).toBe(1);
      expect(chunks[0].chunk_index).toBe(0);
    });

    // Test for large file chunking
    it('writeFile: should split large files into multiple chunks', async () => {
      // Create a file slightly larger than CHUNK_SIZE
      const chunkSize = CHUNK_SIZE;
      const largeData = Buffer.alloc(chunkSize + 1000, 'A');
      
      await fs.writeFile('largeFile.txt', largeData);
      
      // Verify file was written correctly
      const content = await fs.readFile('largeFile.txt');
      expect(content.length).toBe(largeData.length);
      expect(content).toEqual(largeData);
      
      // Check that multiple chunks were created
      const chunks = dbAdapter.all<{ chunk_index: number }>(
        "SELECT chunk_index FROM file_chunks WHERE path = ? ORDER BY chunk_index",
        ['largeFile.txt']
      );
      expect(chunks.length).toBe(2); // Should be split into 2 chunks
      expect(chunks[0].chunk_index).toBe(0);
      expect(chunks[1].chunk_index).toBe(1);
      
      // Verify total_size is correct
      const stats = await fs.lstat('largeFile.txt');
      expect(stats.size).toBe(largeData.length);
    });

    // Test for very large file chunking
    it('writeFile: should handle very large files with multiple chunks', async () => {
      // Create a file that will be split into 3 chunks
      const chunkSize = CHUNK_SIZE;
      const veryLargeData = Buffer.alloc(chunkSize * 2 + 1000, 'B');
      
      await fs.writeFile('veryLargeFile.txt', veryLargeData);
      
      // Verify file was written correctly
      const content = await fs.readFile('veryLargeFile.txt');
      expect(content.length).toBe(veryLargeData.length);
      expect(content).toEqual(veryLargeData);
      
      // Check that multiple chunks were created
      const chunks = dbAdapter.all<{ chunk_index: number }>(
        "SELECT chunk_index FROM file_chunks WHERE path = ? ORDER BY chunk_index",
        ['veryLargeFile.txt']
      );
      expect(chunks.length).toBe(3); // Should be split into 3 chunks
      expect(chunks[0].chunk_index).toBe(0);
      expect(chunks[1].chunk_index).toBe(1);
      expect(chunks[2].chunk_index).toBe(2);
      
      // Verify total_size is correct
      const stats = await fs.lstat('veryLargeFile.txt');
      expect(stats.size).toBe(veryLargeData.length);
    });
  });

  // unlink tests
  describe('unlink', () => {
    it('unlink: should delete an existing file', async () => {
      await fs.unlink('file.txt');
      await expectPathToNotExist('file.txt');
    });

    it('unlink: should throw ENOENT for a non-existent path', async () => {
      await expect(fs.unlink('nonexistent')).rejects.toThrowError(/ENOENT/);
    });

    it('unlink: should throw EPERM when trying to unlink a directory', async () => {
      await expect(fs.unlink('dir')).rejects.toThrowError(/EPERM/);
    });

    // New test for chunking
    it('unlink: should delete all chunks of a large file', async () => {
      // Create a large file first
      const largeData = Buffer.alloc(CHUNK_SIZE + 1000, 'X');
      await fs.writeFile('largeFileToDelete.txt', largeData);
      
      // Verify file exists and has multiple chunks
      const chunksBeforeDelete = dbAdapter.all<{ chunk_index: number }>(
        "SELECT chunk_index FROM file_chunks WHERE path = ?",
        ['largeFileToDelete.txt']
      );
      expect(chunksBeforeDelete.length).toBeGreaterThan(1);
      
      // Delete the file
      await fs.unlink('largeFileToDelete.txt');
      
      // Verify all chunks are deleted
      const chunksAfterDelete = dbAdapter.all<{ chunk_index: number }>(
        "SELECT chunk_index FROM file_chunks WHERE path = ?",
        ['largeFileToDelete.txt']
      );
      expect(chunksAfterDelete.length).toBe(0);
      
      // Verify file doesn't exist
      await expectPathToNotExist('largeFileToDelete.txt');
    });
  });

  // rmdir tests
  describe('rmdir', () => {
    it('rmdir: should delete an existing empty directory', async () => {
      await fs.rmdir('emptyDir');
      await expectPathToNotExist('emptyDir');
    });

    it('rmdir: should throw ENOENT for a non-existent path', async () => {
      await expect(fs.rmdir('nonexistent')).rejects.toThrowError(/ENOENT/);
    });

    it('rmdir: should throw ENOTDIR for a file path', async () => {
      await expect(fs.rmdir('file.txt')).rejects.toThrowError(/ENOTDIR/);
    });

    it('rmdir: should throw ENOTEMPTY for a non-empty directory', async () => {
      await expect(fs.rmdir('dir')).rejects.toThrowError(/ENOTEMPTY/);
    });
  });
});