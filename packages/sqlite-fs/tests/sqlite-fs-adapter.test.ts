// tests/sqlite-fs-adapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BunSqliteAdapter } from '../src/bun-sqlite-adapter';
import { SQLiteFSAdapter } from '../src/sqlite-fs-adapter';
import { Database } from 'bun:sqlite';
import type { SyncSqliteDatabase } from '../src/interfaces';

describe('SQLiteFSAdapter', () => {
  let db: SyncSqliteDatabase;
  let fs: SQLiteFSAdapter;

  beforeEach(() => {
    // Use new in-memory DB for each test
    db = new BunSqliteAdapter(new Database(':memory:'));
    fs = new SQLiteFSAdapter(db);
  });

  afterEach(() => {
    db.close?.();
  });

  describe('File Operations', () => {
    it('should write and read a file', () => {
      const content = 'Hello, world!';
      fs.writeFileSync('/test.txt', content);
      
      const result = fs.readFileSync('/test.txt', { encoding: 'utf-8' });
      expect(result).toBe(content);
    });

    it('should handle binary data', () => {
      const content = new Uint8Array([1, 2, 3, 4, 5]);
      fs.writeFileSync('/binary.bin', content);
      
      const result = fs.readFileSync('/binary.bin');
      expect(result).toEqual(content);
    });

    it('should update existing files', () => {
      fs.writeFileSync('/test.txt', 'Original content');
      fs.writeFileSync('/test.txt', 'Updated content');
      
      const result = fs.readFileSync('/test.txt', { encoding: 'utf-8' });
      expect(result).toBe('Updated content');
    });

    it('should throw when reading non-existent files', () => {
      expect(() => {
        fs.readFileSync('/nonexistent.txt');
      }).toThrow(/ENOENT/);
    });

    it('should check if files exist', () => {
      fs.writeFileSync('/exists.txt', 'content');
      
      expect(fs.existsSync('/exists.txt')).toBe(true);
      expect(fs.existsSync('/nonexistent.txt')).toBe(false);
    });

    it('should get file stats', () => {
      const content = 'Hello, world!';
      fs.writeFileSync('/test.txt', content);
      
      const stats = fs.statSync('/test.txt');
      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
      expect(stats.size).toBe(content.length);
      expect(stats.mtimeMs).toBeGreaterThan(0);
    });

    it('should delete files', () => {
      fs.writeFileSync('/delete-me.txt', 'content');
      expect(fs.existsSync('/delete-me.txt')).toBe(true);
      
      fs.unlinkSync('/delete-me.txt');
      expect(fs.existsSync('/delete-me.txt')).toBe(false);
    });

    it('should throw when deleting non-existent files', () => {
      expect(() => {
        fs.unlinkSync('/nonexistent.txt');
      }).toThrow(/ENOENT/);
    });
  });

  describe('Directory Operations', () => {
    it('should create directories', () => {
      fs.mkdirSync('/testdir');
      
      expect(fs.existsSync('/testdir')).toBe(true);
      const stats = fs.statSync('/testdir');
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create nested directories with recursive option', () => {
      fs.mkdirSync('/parent/child/grandchild', { recursive: true });
      
      expect(fs.existsSync('/parent')).toBe(true);
      expect(fs.existsSync('/parent/child')).toBe(true);
      expect(fs.existsSync('/parent/child/grandchild')).toBe(true);
    });

    it('should throw when creating nested directories without recursive option', () => {
      expect(() => {
        fs.mkdirSync('/parent2/child');
      }).toThrow(/ENOENT/);
    });

    it('should list directory contents', () => {
      fs.mkdirSync('/listdir');
      fs.writeFileSync('/listdir/file1.txt', 'content1');
      fs.writeFileSync('/listdir/file2.txt', 'content2');
      fs.mkdirSync('/listdir/subdir');
      
      const contents = fs.readdirSync('/listdir');
      expect(contents).toHaveLength(3);
      expect(contents).toContain('file1.txt');
      expect(contents).toContain('file2.txt');
      expect(contents).toContain('subdir');
    });

    it('should throw when listing non-existent directories', () => {
      expect(() => {
        fs.readdirSync('/nonexistent');
      }).toThrow(/ENOENT/);
    });

    it('should remove empty directories', () => {
      fs.mkdirSync('/emptydir');
      expect(fs.existsSync('/emptydir')).toBe(true);
      
      fs.rmdirSync('/emptydir');
      expect(fs.existsSync('/emptydir')).toBe(false);
    });

    it('should throw when removing non-empty directories without recursive option', () => {
      fs.mkdirSync('/nonemptydir');
      fs.writeFileSync('/nonemptydir/file.txt', 'content');
      
      expect(() => {
        fs.rmdirSync('/nonemptydir');
      }).toThrow(/ENOTEMPTY/);
    });

    it('should remove non-empty directories with recursive option', () => {
      fs.mkdirSync('/recursivedir');
      fs.writeFileSync('/recursivedir/file.txt', 'content');
      fs.mkdirSync('/recursivedir/subdir');
      fs.writeFileSync('/recursivedir/subdir/file.txt', 'content');
      
      fs.rmdirSync('/recursivedir', { recursive: true });
      expect(fs.existsSync('/recursivedir')).toBe(false);
    });
  });

  describe('Path Handling', () => {
    it('should normalize paths', () => {
      fs.writeFileSync('/test/./file.txt', 'content');
      expect(fs.existsSync('/test/file.txt')).toBe(true);
    });

    it('should handle relative paths', () => {
      fs.mkdirSync('/test');
      fs.writeFileSync('test/file.txt', 'content');
      expect(fs.existsSync('/test/file.txt')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw EISDIR when trying to read a directory as a file', () => {
      fs.mkdirSync('/dir');
      
      expect(() => {
        fs.readFileSync('/dir');
      }).toThrow(/EISDIR/);
    });

    it('should throw ENOTDIR when trying to list a file as a directory', () => {
      fs.writeFileSync('/file.txt', 'content');
      
      expect(() => {
        fs.readdirSync('/file.txt');
      }).toThrow(/ENOTDIR/);
    });

    it('should throw EISDIR when trying to unlink a directory', () => {
      fs.mkdirSync('/dir');
      
      expect(() => {
        fs.unlinkSync('/dir');
      }).toThrow(/EISDIR/);
    });

    it('should throw ENOTDIR when trying to rmdir a file', () => {
      fs.writeFileSync('/file.txt', 'content');
      
      expect(() => {
        fs.rmdirSync('/file.txt');
      }).toThrow(/ENOTDIR/);
    });
  });
});