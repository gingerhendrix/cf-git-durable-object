// src/commands/clone.ts
import {
  BunSqliteAdapter,
  SQLiteFSAdapter,
} from "../../../sqlite-fs/src/index.js";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node"; // Using Node's HTTP client via Bun
import path from "node:path";
import fs from "node:fs"; // Using Node's fs for directory/file checks via Bun
import { Database } from "bun:sqlite"; // Import Bun's Database
import chalk from "chalk";
import type { ParsedArgs } from "minimist";

export async function cloneCommand(
  repoUrl: string,
  dbFilePath: string,
  options: ParsedArgs,
): Promise<void> {
  console.log(
    chalk.blue(
      `Cloning ${chalk.bold(repoUrl)} into ${chalk.bold(dbFilePath)}...`,
    ),
  );

  let db: Database | null = null; // Keep track of DB instance for finally block
  let dbAdapter: BunSqliteAdapter | null = null;

  try {
    // 1. Ensure parent directory for the database file exists
    const dbDir = path.dirname(dbFilePath);
    fs.mkdirSync(dbDir, { recursive: true });

    // 2. Create the bun:sqlite Database instance
    // Use { create: true } to ensure the file is created if it doesn't exist
    db = new Database(dbFilePath, { create: true });
    // Optional: Enable WAL mode for potentially better performance on file DBs
    db.exec("PRAGMA journal_mode = WAL;");

    // 3. Instantiate BunSqliteAdapter with the Database instance
    dbAdapter = new BunSqliteAdapter(db);

    // 4. Instantiate SQLiteFSAdapter with the BunSqliteAdapter
    const fsAdapter = new SQLiteFSAdapter(dbAdapter);
    // The adapter's constructor should handle schema initialization (CREATE TABLE IF NOT EXISTS)

    // 5. Define progress/message handlers for isomorphic-git
    const onMessage = (message: string) => {
      // Clean up potential trailing newlines from isomorphic-git messages
      process.stdout.write(message.replace(/(\r\n|\n|\r)$/, "") + "\r");
    };
    const onProgress = (progress: any) => {
      // Example: Log progress stage and loaded/total info if available
      if (
        progress.phase &&
        progress.loaded !== undefined &&
        progress.total !== undefined
      ) {
        process.stdout.write(
          `Phase: ${progress.phase}, Progress: ${progress.loaded}/${progress.total} \r`,
        );
      } else if (progress.phase) {
        process.stdout.write(`Phase: ${progress.phase} \r`);
      }
    };

    // 6. Execute the clone operation
    await git.clone({
      fs: fsAdapter,
      http,
      dir: ".", // Root directory within the virtual filesystem
      url: repoUrl,
      singleBranch: true, // Recommended for faster clones
      noCheckout: true,
      depth: 1,
      onMessage,
      onProgress,
      // corsProxy: '...', // Add if required for specific environments
    });

    // Clear progress line after completion
    process.stdout.write("\n");
    console.log(chalk.green("Clone completed successfully."));
  } catch (error: any) {
    process.stdout.write("\n"); // Ensure newline after potential progress messages
    // Re-throw the error to be caught by the main handler in cli.ts
    throw new Error(`Clone failed: ${error.message}`);
  } finally {
    // 7. Ensure the database connection is closed
    if (dbAdapter) {
      // The adapter's close method should call the underlying db.close()
      dbAdapter.close?.();
      // console.log(chalk.gray('Database connection closed.'));
    } else if (db) {
      // Fallback if adapter wasn't created but db was
      db.close();
      // console.log(chalk.gray('Database connection closed (fallback).'));
    }
  }
}

