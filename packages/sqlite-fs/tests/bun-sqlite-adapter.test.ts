// tests/bun-sqlite-adapter.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BunSqliteAdapter } from "../src/bun-sqlite-adapter";
import type { SyncSqliteDatabase } from "../src/interfaces";
import { Database } from "bun:sqlite";

describe("BunSqliteAdapter", () => {
  let db: SyncSqliteDatabase;

  beforeEach(() => {
    // Use new in-memory DB for each test
    const bunDb = new Database(":memory:");
    db = new BunSqliteAdapter(bunDb);
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

  it("should execute INSERT and SELECT using all()", () => {
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice@example.com",
    ]);
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Bob",
      "bob@example.com",
    ]);

    const users = db.all("SELECT name, email FROM users ORDER BY name");
    expect(users).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ]);
  });

  it("should return empty array from all() when no rows match", () => {
    const users = db.all("SELECT name FROM users WHERE name = ?", ["Charlie"]);
    expect(users).toEqual([]);
  });

  it("should execute SELECT using one() successfully", () => {
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice@example.com",
    ]);
    const user = db.one("SELECT name FROM users WHERE email = ?", [
      "alice@example.com",
    ]);
    expect(user).toEqual({ name: "Alice" });
  });

  it("should throw error from one() when no rows match", () => {
    expect(() => {
      db.one("SELECT name FROM users WHERE name = ?", ["Charlie"]);
    }).toThrow("SQLite one() error: No rows found");
  });

  it("should throw error from one() when multiple rows match", () => {
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice1@example.com",
    ]);
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice2@example.com",
    ]);
    expect(() => {
      db.one("SELECT email FROM users WHERE name = ?", ["Alice"]);
    }).toThrow("SQLite one() error: Expected 1 row, got 2");
  });

  it("should iterate results using iterator()", () => {
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice@example.com",
    ]);
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Bob",
      "bob@example.com",
    ]);
    const iter = db.iterator<{ name: string }>(
      "SELECT name FROM users ORDER BY name",
    );
    const names = Array.from(iter).map((row) => row.name);
    expect(names).toEqual(["Alice", "Bob"]);
  });

  it("should handle empty results with iterator()", () => {
    const iter = db.iterator("SELECT name FROM users");
    expect(Array.from(iter)).toEqual([]);
  });

  it("should throw error on invalid SQL", () => {
    expect(() => {
      db.exec("INSERT INTO non_existent_table VALUES (1)");
    }).toThrow();
  });

  it("should handle parameter binding correctly", () => {
    db.exec("INSERT INTO users (name, email) VALUES (?, ?)", [
      "Alice",
      "alice@example.com",
    ]);
    const user = db.one("SELECT * FROM users WHERE name = ? AND email = ?", [
      "Alice",
      "alice@example.com",
    ]);
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
  });
});

