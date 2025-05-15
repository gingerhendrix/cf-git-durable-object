// src/interfaces.ts

/**
 * Interface for a synchronous iterator over SQLite query results.
 * Adheres to the standard JavaScript Iterable/Iterator protocol.
 */
export interface SyncSqliteIterator<T = Record<string, any>>
  extends Iterable<T> {
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
  iterator<T = Record<string, any>>(
    sql: string,
    params?: any[],
  ): SyncSqliteIterator<T>;

  /** Optional: Closes the database connection if applicable. */
  close?(): void;
}

export class NoRowsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRowsError";
  }
}

export class TooManyRowsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TooManyRowsError";
  }
}

