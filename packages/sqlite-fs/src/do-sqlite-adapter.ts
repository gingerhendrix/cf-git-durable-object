import type {
  DurableObjectStorage,
  SqlStorage,
} from "@cloudflare/workers-types";
import {
  NoRowsError,
  TooManyRowsError,
  type SyncSqliteDatabase,
  type SyncSqliteIterator,
} from "sqlite-fs";
import { getErrorMessage } from "./errors";

export class DurableObjectSqliteAdapter implements SyncSqliteDatabase {
  private sql: SqlStorage;

  constructor(storage: DurableObjectStorage) {
    if (!storage.sql) {
      throw new Error(
        "DurableObjectStorage missing 'sql' property. Ensure DO uses SQLite backend.",
      );
    }
    this.sql = storage.sql;
  }

  exec(sql: string, params?: any[]): void {
    try {
      console.log("Exec", sql, params);
      this.sql.exec(sql, ...(params ?? [])).toArray();
    } catch (e) {
      console.error(
        `DO Adapter exec Error: ${getErrorMessage(e)}`,
        sql,
        params,
      );
      throw e;
    }
  }

  all<T = Record<string, any>>(sql: string, params?: any[]): T[] {
    try {
      return this.sql.exec(sql, ...(params ?? [])).toArray() as T[];
    } catch (e) {
      console.error(`DO Adapter all Error: ${getErrorMessage(e)}`, sql, params);
      throw e;
    }
  }

  one<T = Record<string, any>>(sql: string, params?: any[]): T {
    let results;
    try {
      results = this.sql.exec(sql, ...(params ?? [])).toArray();
    } catch (e) {
      console.error(`DO Adapter one Error: ${getErrorMessage(e)}`, sql, params);
      throw e;
    }
    if (results.length === 0) {
      throw new NoRowsError("No rows found");
    } else if (results.length > 1) {
      throw new TooManyRowsError("Too many rows found");
    }
    return results[0] as T;
  }

  iterator<T = Record<string, any>>(
    sql: string,
    params?: any[],
  ): SyncSqliteIterator<T> {
    try {
      const cursor = this.sql.exec(sql, ...(params ?? []));
      return {
        [Symbol.iterator]() {
          return this;
        },
        next: () => {
          const result = cursor.next();
          if (result.done) {
            return { done: true, value: {} as T };
          }
          return { done: false, value: result.value as T };
        },
      };
    } catch (e) {
      console.error(
        `DO Adapter iterator Error: ${getErrorMessage(e)}`,
        sql,
        params,
      );
      throw e;
    }
  }
}
