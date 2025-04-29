# Implementation Step 2

**Brief: Step 2 - Define Core Interfaces & Implement/Test `BunSqliteAdapter`**

**Goal:** Define the necessary synchronous database interface (`SyncSqliteDatabase`) and supporting types. Implement this interface using Bun's built-in SQLite module (`bun:sqlite`) in a `BunSqliteAdapter` class. Write unit tests using Vitest to verify the adapter's correctness against the interface contract.

**Tasks:**

1.  **Define Core Interfaces & Types (`src/interfaces.ts`, `src/types.ts`):**
  *   **Action:** Create `src/interfaces.ts`.
  *   **Content (`src/interfaces.ts`):** Define the `SyncSqliteIterator<T>` and `SyncSqliteDatabase` interfaces exactly as specified previously (the version *without* transactions):
      ```typescript
      // src/interfaces.ts

      /**
       * Interface for a synchronous iterator over SQLite query results.
       * Adheres to the standard JavaScript Iterable/Iterator protocol.
       */
      export interface SyncSqliteIterator<T = Record<string, any>> extends Iterable<T> {
        /** Returns the next item in the sequence. */
        next(): IteratorResult<T>;
      }

      /**
       * Defines the core synchronous interface for interacting with different SQLite backends (PoC version without transactions).
       */
      export interface SyncSqliteDatabase {
        /** Executes SQL statement(s), primarily for side effects. Throws on error. */
        exec(sql: string, params?: any[]): void;

        /** Executes SELECT, returns all result rows as an array. Returns empty array if no rows. Throws on error. */
        all<T = Record<string, any>>(sql: string, params?: any[]): T[];

        /** Executes SELECT, returns exactly one result row. Throws if zero or >1 rows. Throws on other errors. */
        one<T = Record<string, any>>(sql: string, params?: any[]): T;

        /** Executes SELECT, returns a synchronous iterator over result rows. Throws on error during prep/execution. */
        iterator<T = Record<string, any>>(sql: string, params?: any[]): SyncSqliteIterator<T>;

        /** Optional: Closes the database connection if applicable. */
        close?(): void;
      }
      ```
  *   **Action:** Create `src/types.ts`.
  *   **Content (`src/types.ts`):** Define placeholder/basic structures for `Stats` and `FSError`. These will be fleshed out more when implementing the `SQLiteFSAdapter`, but having them defined early is good practice.
      ```typescript
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
      ```
  *   *Rationale:* Establishes the clear contract (`SyncSqliteDatabase`) that the `BunSqliteAdapter` must adhere to and defines common types used across the library.

2.  **Implement `BunSqliteAdapter` (`src/bun-sqlite-adapter.ts`):**
  *   **Action:** Create `src/bun-sqlite-adapter.ts`.
  *   **Content:** Implement the `BunSqliteAdapter` class.
      *   Import `Database` and `Statement` from `bun:sqlite`.
      *   Import `SyncSqliteDatabase`, `SyncSqliteIterator` from `./interfaces`.
      *   The constructor should accept connection options (like filename or `:memory:`) and instantiate a `bun:sqlite` `Database`. Store the `Database` instance. Consider enabling WAL mode via `db.exec("PRAGMA journal_mode = WAL;")` in the constructor for file-based DBs if desired, though less critical for
in-memory testing.
      *   Implement the `exec`, `all`, `one`, `iterator`, and `close` methods using the corresponding `bun:sqlite` `db.query(...).run/all/get` methods, applying the necessary adaptations identified previously:
          *   `exec(sql, params)`: Use `this.db.query(sql).run(params)`. Ignore the return value.
          *   `all<T>(sql, params)`: Use `this.db.query(sql).all(params) as T[]`.
          *   `one<T>(sql, params)`: Use `this.db.query(sql).all(params)`. Check if the result array length is exactly 1. If yes, return `results[0]`. If not, throw an appropriate `Error` (e.g., "SQLite one() error: No rows found" or "SQLite one() error: Expected 1 row, got N").
          *   `iterator<T>(sql, params)`: Use `const results = this.db.query(sql).all(params); return results[Symbol.iterator]() as SyncSqliteIterator<T>;`.
          *   `close()`: Use `this.db.close()`.
      *   Handle potential parameter differences (e.g., `bun:sqlite` often uses objects like `{ $param: value }` or arrays for positional `?`, ensure the adapter accepts standard arrays `params?: any[]` and maps them correctly if needed, though `bun:sqlite` likely handles plain arrays for positional params
directly).
  *   **Example Snippet (Illustrative):**
      ```typescript
      // src/bun-sqlite-adapter.ts
      import { Database, Statement, type DatabaseOpenOptions } from 'bun:sqlite';
      import type { SyncSqliteDatabase, SyncSqliteIterator } from './interfaces';

      export class BunSqliteAdapter implements SyncSqliteDatabase {
          private db: Database;

          constructor(options?: string | DatabaseOpenOptions | Buffer | Uint8Array) {
              // Default to in-memory if no options provided
              this.db = new Database(options ?? ':memory:');
              // Optional: Enable WAL for file DBs if desired
              // if (typeof options === 'string' && options !== ':memory:') {
              //     this.db.exec("PRAGMA journal_mode = WAL;");
              // }
          }

          exec(sql: string, params?: any[]): void {
              try {
                  this.db.query(sql).run(...(params ?? [])); // Spread params for positional binding
              } catch (e: any) {
                  console.error("BunSqliteAdapter exec error:", e.message, "SQL:", sql);
                  throw e; // Re-throw
              }
          }

          all<T = Record<string, any>>(sql: string, params?: any[]): T[] {
               try {
                  return this.db.query(sql).all(...(params ?? [])) as T[];
               } catch (e: any) {
                  console.error("BunSqliteAdapter all error:", e.message, "SQL:", sql);
                  throw e; // Re-throw
               }
          }

          one<T = Record<string, any>>(sql: string, params?: any[]): T {
               try {
                  const results = this.db.query(sql).all(...(params ?? []));
                  if (results.length === 0) {
                      throw new Error("SQLite one() error: No rows found");
                  }
                  if (results.length > 1) {
                      throw new Error(`SQLite one() error: Expected 1 row, got ${results.length}`);
                  }
                  return results[0] as T;
               } catch (e: any) {
                  // Don't log the expected "No rows found" or "Expected 1 row" errors as console errors
                  if (!e.message?.includes("SQLite one() error:")) {
                       console.error("BunSqliteAdapter one error:", e.message, "SQL:", sql);
                  }
                  throw e; // Re-throw
               }
          }

          iterator<T = Record<string, any>>(sql: string, params?: any[]): SyncSqliteIterator<T> {
               try {
                  const results = this.db.query(sql).all(...(params ?? []));
                  return results[Symbol.iterator]() as SyncSqliteIterator<T>;
               } catch (e: any) {
                  console.error("BunSqliteAdapter iterator error:", e.message, "SQL:", sql);
                  throw e; // Re-throw
               }
          }

          close(): void {
              this.db.close();
          }
      }
      ```
  *   *Rationale:* Provides the concrete implementation mapping the abstract `SyncSqliteDatabase` interface to the specific capabilities of `bun:sqlite`.

3.  **Test `BunSqliteAdapter` (`tests/bun-sqlite-adapter.test.ts`):**
  *   **Action:** Create `tests/bun-sqlite-adapter.test.ts`.
  *   **Content:** Write Vitest unit tests for `BunSqliteAdapter`.
      *   Use `beforeEach` or similar to create a *new in-memory* `BunSqliteAdapter` instance for each test to ensure isolation (`new BunSqliteAdapter(':memory:')`).
      *   Inside tests, use the adapter's `exec` method to set up test data (e.g., `CREATE TABLE test_users (...)`, `INSERT INTO test_users (...)`).
      *   Test each method (`exec`, `all`, `one`, `iterator`) thoroughly:
          *   **`exec`:** Verify it runs without error for valid INSERT/UPDATE/DELETE/CREATE. Check for error throwing on invalid SQL.
          *   **`all`:** Verify it returns correct arrays of objects for various SELECT statements. Test with zero results (empty array) and multiple results. Test parameter binding.
          *   **`one`:** Verify it returns the single correct object when exactly one row matches. Verify it *throws* specific, identifiable errors when zero rows match and when more than one row matches. Test parameter binding.
          *   **`iterator`:** Verify it returns an iterator. Use `Array.from(iterator)` or loop through it (`for...of`) to check if it yields the correct sequence of objects. Test with zero results (iterator yields nothing). Test parameter binding.
          *   **`close`:** Call `close()` and potentially try another operation to ensure it throws an error indicating the database is closed (if `bun:sqlite` behaves that way).
  *   **Example Test Snippet (Illustrative):**
      ```typescript
      // tests/bun-sqlite-adapter.test.ts
      import { describe, it, expect, beforeEach } from 'vitest';
      import { BunSqliteAdapter } from '../src/bun-sqlite-adapter';
      import type { SyncSqliteDatabase } from '../src/interfaces';

      describe('BunSqliteAdapter', () => {
        let db: SyncSqliteDatabase;

        beforeEach(() => {
          // Use new in-memory DB for each test
          db = new BunSqliteAdapter(':memory:');
          // Setup common schema if needed
          db.exec(`
            CREATE TABLE users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              email TEXT UNIQUE
            );
          `);
        });

        afterEach(() => {
          db.close?.();
        });

        it('should execute INSERT and SELECT using all()', () => {
          db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com']);
          db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com']);

          const users = db.all('SELECT name, email FROM users ORDER BY name');
          expect(users).toEqual([
            { name: 'Alice', email: 'alice@example.com' },
            { name: 'Bob', email: 'bob@example.com' },
          ]);
        });

        it('should return empty array from all() when no rows match', () => {
           const users = db.all('SELECT name FROM users WHERE name = ?', ['Charlie']);
           expect(users).toEqual([]);
        });

        it('should execute SELECT using one() successfully', () => {
          db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com']);
          const user = db.one('SELECT name FROM users WHERE email = ?', ['alice@example.com']);
          expect(user).toEqual({ name: 'Alice' });
        });

        it('should throw error from one() when no rows match', () => {
          expect(() => {
            db.one('SELECT name FROM users WHERE name = ?', ['Charlie']);
          }).toThrow('SQLite one() error: No rows found');
        });

        it('should throw error from one() when multiple rows match', () => {
          db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice1@example.com']);
          db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice2@example.com']);
          expect(() => {
            db.one('SELECT email FROM users WHERE name = ?', ['Alice']);
          }).toThrow('SQLite one() error: Expected 1 row, got 2');
        });

        it('should iterate results using iterator()', () => {
           db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com']);
           db.exec('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com']);
           const iter = db.iterator<{ name: string }>('SELECT name FROM users ORDER BY name');
           const names = Array.from(iter).map(row => row.name);
           expect(names).toEqual(['Alice', 'Bob']);
        });

         it('should handle empty results with iterator()', () => {
           const iter = db.iterator('SELECT name FROM users');
           expect(Array.from(iter)).toEqual([]);
         });

        // Add more tests for exec errors, parameter types, close behavior etc.
      });
      ```
  *   *Rationale:* Ensures the `BunSqliteAdapter` correctly implements the `SyncSqliteDatabase` interface and handles various scenarios and edge cases using the actual `bun:sqlite` driver.

4.  **Export from `src/index.ts`:**
  *   **Action:** Create or modify `src/index.ts` to export the necessary interfaces and the adapter class.
  *   **Content (`src/index.ts`):**
      ```typescript
      export * from './interfaces';
      export * from './types';
      export { BunSqliteAdapter } from './bun-sqlite-adapter';
      // Add other exports as needed later (e.g., SQLiteFSAdapter)
      ```
  *   *Rationale:* Creates the main entry point for the library, making the defined interfaces and the adapter implementation available for consumers.

5.  **Run Tests:**
  *   **Action:** Execute `bun test` in the terminal.
  *   **Goal:** Verify that all tests for the `BunSqliteAdapter` pass. Debug any failures.

**Outcome:** Upon completion of these combined steps, you will have:
1.  Clearly defined synchronous database interfaces (`SyncSqliteDatabase`, `SyncSqliteIterator`) and basic types (`Stats`, `FSError`).
2.  A working `BunSqliteAdapter` class that implements the `SyncSqliteDatabase` interface using `bun:sqlite`.
3.  A suite of unit tests confirming the adapter's behavior and adherence to the interface contract.
4.  The core components exported from the library's entry point (`src/index.ts`).
