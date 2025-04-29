// tests/error-utils.test.ts
import { describe, expect, it } from 'bun:test';
import { createError } from '../src/error-utils';

describe('error-utils', () => {
  describe('createError', () => {
    it('should create an error with code only', () => {
      const error = createError('ENOENT');
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('ENOENT');
      expect(error.message).toBe('ENOENT:');
      expect(error.path).toBeUndefined();
      expect(error.syscall).toBeUndefined();
    });

    it('should create an error with code and path', () => {
      const error = createError('ENOENT', '/foo/bar');
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('ENOENT');
      expect(error.message).toBe("ENOENT:'/foo/bar'");
      expect(error.path).toBe('/foo/bar');
      expect(error.syscall).toBeUndefined();
    });

    it('should create an error with code, path, and syscall', () => {
      const error = createError('ENOENT', '/foo/bar', 'stat');
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('ENOENT');
      expect(error.message).toBe("ENOENT: stat'/foo/bar'");
      expect(error.path).toBe('/foo/bar');
      expect(error.syscall).toBe('stat');
    });

    it('should create an error with custom message', () => {
      const error = createError('ENOENT', '/foo/bar', 'stat', 'Custom error message');
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('ENOENT');
      expect(error.message).toBe('Custom error message');
      expect(error.path).toBe('/foo/bar');
      expect(error.syscall).toBe('stat');
    });
  });
});