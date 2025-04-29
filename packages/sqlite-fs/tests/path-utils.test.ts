// tests/path-utils.test.ts
import { describe, expect, it } from 'bun:test';
import { dirname, basename, join, normalize, getParentPath } from '../src/path-utils';

describe('path-utils', () => {
  describe('dirname', () => {
    it('should return the directory name of a path', () => {
      expect(dirname('/foo/bar/baz')).toBe('/foo/bar');
      expect(dirname('/foo/bar')).toBe('/foo');
      expect(dirname('/foo')).toBe('/');
    });
  });

  describe('basename', () => {
    it('should return the last portion of a path', () => {
      expect(basename('/foo/bar/baz')).toBe('baz');
      expect(basename('/foo/bar')).toBe('bar');
      expect(basename('/foo')).toBe('foo');
    });
  });

  describe('join', () => {
    it('should join path segments', () => {
      expect(join('/foo', 'bar', 'baz')).toBe('/foo/bar/baz');
      expect(join('foo', 'bar')).toBe('foo/bar');
      expect(join('/foo', '../bar')).toBe('/bar');
    });
  });

  describe('normalize', () => {
    it('should normalize a path', () => {
      expect(normalize('/foo/bar/..')).toBe('/foo');
      expect(normalize('/foo/./bar')).toBe('/foo/bar');
      expect(normalize('foo//bar')).toBe('foo/bar');
    });
  });

  describe('getParentPath', () => {
    it('should return the parent path', () => {
      expect(getParentPath('/foo/bar')).toBe('/foo');
      expect(getParentPath('/foo')).toBe('/');
      expect(getParentPath('/')).toBe('');
    });
  });
});