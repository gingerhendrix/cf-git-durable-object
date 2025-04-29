// src/bun-sqlite-adapter.ts
import { Database } from 'bun:sqlite';
import type { SyncSqliteDatabase, SyncSqliteIterator } from './interfaces';

export class BunSqliteAdapter implements SyncSqliteDatabase {
    private db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    /**
     * Create a new BunSqliteAdapter with an in-memory database
     */
    static createInMemory(): BunSqliteAdapter {
        return new BunSqliteAdapter(new Database(':memory:'));
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