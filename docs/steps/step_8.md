**Plan: Create `DurableObjectSqliteAdapter`**

**1. Goal:**

Create a class named `DurableObjectSqliteAdapter` that implements the `SyncSqliteDatabase` interface (defined in the `sqlite-fs` library). This adapter will use the synchronous `ctx.storage.sql` API provided by the Cloudflare Durable Object runtime as its backend.

**2. Location:**

*   Create the adapter file at: `apps/cf-demo/worker/lib/durable-object-sqlite-adapter.ts`

**3. Dependencies:**

*   Ensure the `apps/cf-demo` package has `@cloudflare/workers-types` installed as a development dependency (`npm install -D @cloudflare/workers-types` or `bun add -d @cloudflare/workers-types`).
*   The adapter will import `SyncSqliteDatabase` and `SyncSqliteIterator` from the `sqlite-fs` library (e.g., `import type { SyncSqliteDatabase, SyncSqliteIterator } from 'sqlite-fs';`).

**4. Implementation Steps:**

*   **a. Create File and Basic Structure:**
  *   Create the file `durable-object-sqlite-adapter.ts` at the specified location.
  *   Import necessary types from `@cloudflare/workers-types` (`DurableObjectStorage`, `SqlStorage`) and `sqlite-fs` (`SyncSqliteDatabase`, `SyncSqliteIterator`).
  *   Define the class `DurableObjectSqliteAdapter` and declare that it implements `SyncSqliteDatabase`.

*   **b. Implement the Constructor:**
  *   The constructor should accept one argument: `storage: DurableObjectStorage`.
  *   Inside the constructor, check if `storage.sql` exists. If not, throw an informative error (e.g., "DurableObjectStorage does not have the 'sql' property. Ensure the DO is configured for SQLite storage.").
  *   Store the `storage.sql` object (which is of type `SqlStorage`) in a private instance variable (e.g., `this.sql`).

*   **c. Implement `exec` Method:**
  *   **Signature:** `exec(sql: string, params?: any[]): void`
  *   **Logic:** Use `this.sql.prepare(sql).run(...(params ?? []))` to execute the statement. The `run()` method is suitable as `exec` isn't expected to return results.
  *   **Error Handling:** Wrap the call in a `try...catch` block. Log errors for debugging purposes but re-throw the original error.

*   **d. Implement `all` Method:**
  *   **Signature:** `all<T = Record<string, any>>(sql: string, params?: any[]): T[]`
  *   **Logic:** Use `this.sql.prepare(sql).all(...(params ?? []))` which directly returns an array of row objects.
  *   **Type Casting:** Cast the result to `T[]`.
  *   **Error Handling:** Wrap in `try...catch`, log errors, and re-throw.

*   **e. Implement `one` Method:**
  *   **Signature:** `one<T = Record<string, any>>(sql: string, params?: any[]): T`
  *   **Logic:** Use `this.sql.prepare(sql).one(...(params ?? []))`. The DO's `one()` method conveniently throws an exception if zero or more than one row is found, matching the interface requirement.
  *   **Type Casting:** Cast the result to `T`.
  *   **Error Handling:** Wrap in `try...catch`. Log errors (perhaps excluding the expected "No rows found" / "more than one row" errors from verbose logging) and re-throw the original error. The `SQLiteFSAdapter` relies on these specific errors being thrown.

*   **f. Implement `iterator` Method:**
  *   **Signature:** `iterator<T = Record<string, any>>(sql: string, params?: any[]): SyncSqliteIterator<T>`
  *   **Logic:** The result of `this.sql.prepare(sql).all(...(params ?? []))` in the DO API is an iterable cursor. Return its iterator using the `Symbol.iterator` method: `return this.sql.prepare(sql).all(...(params ?? []))[Symbol.iterator]()`.
  *   **Type Casting:** Cast the result to `SyncSqliteIterator<T>`.
  *   **Error Handling:** Wrap in `try...catch`, log errors, and re-throw.

*   **g. Implement `close` Method (Optional):**
  *   **Signature:** `close?(): void`
  *   **Logic:** Durable Object storage does not require explicit closing. This method can be omitted from the class implementation, as it's optional in the `SyncSqliteDatabase` interface.

*   **h. Export the Class:**
  *   Add `export` before the class definition: `export class DurableObjectSqliteAdapter implements SyncSqliteDatabase { ... }`.

**5. Testing Strategy:**

* No testing is required for this step.  The adapter will be testing in the next step.

**6. Code Example Snippet (Illustrative):**

```typescript
// apps/cf-demo/worker/lib/durable-object-sqlite-adapter.ts
import type { DurableObjectStorage, SqlStorage } from '@cloudflare/workers-types';
import type { SyncSqliteDatabase, SyncSqliteIterator } from 'sqlite-fs'; // Adjust import path if needed

export class DurableObjectSqliteAdapter implements SyncSqliteDatabase {
  private sql: SqlStorage;

  constructor(storage: DurableObjectStorage) {
      if (!storage.sql) {
          throw new Error("DurableObjectStorage missing 'sql' property. Ensure DO uses SQLite backend.");
      }
      this.sql = storage.sql;
  }

  exec(sql: string, params?: any[]): void {
      try {
          this.sql.prepare(sql).run(...(params ?? []));
      } catch (e: any) {
          console.error(`DO Adapter exec Error: ${e.message}`, sql, params);
          throw e;
      }
  }

  all<T = Record<string, any>>(sql: string, params?: any[]): T[] {
      try {
          return this.sql.prepare(sql).all(...(params ?? [])) as T[];
      } catch (e: any) {
          console.error(`DO Adapter all Error: ${e.message}`, sql, params);
          throw e;
      }
  }

  one<T = Record<string, any>>(sql: string, params?: any[]): T {
      try {
          // DO's one() throws if 0 or >1 rows, matching interface requirement
          return this.sql.prepare(sql).one(...(params ?? [])) as T;
      } catch (e: any) {
          // Avoid excessive logging for expected "not found" errors, but still re-throw
          if (!e.message?.includes('exactly one row')) { // Check specific DO error message
               console.error(`DO Adapter one Error: ${e.message}`, sql, params);
          }
          throw e;
      }
  }

  iterator<T = Record<string, any>>(sql: string, params?: any[]): SyncSqliteIterator<T> {
      try {
          // DO's .all() result is already iterable
          const cursor = this.sql.prepare(sql).all(...(params ?? []));
          return cursor[Symbol.iterator]() as SyncSqliteIterator<T>;
      } catch (e: any) {
          console.error(`DO Adapter iterator Error: ${e.message}`, sql, params);
          throw e;
      }
  }

  // No close() method needed for DO storage
}
```
