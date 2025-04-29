// src/commands/ls-tree.ts
import {
  BunSqliteAdapter,
  SQLiteFSAdapter,
} from "../../../sqlite-fs/src/index.js";
import git from "isomorphic-git";
import path from "node:path";
import fs from "node:fs"; // Using Node's fs for directory/file checks via Bun
import { Database } from "bun:sqlite"; // Import Bun's Database
import chalk from "chalk";
import type { ParsedArgs } from "minimist";

// Helper function to recursively walk the tree
async function walkTree(
  fsAdapter: SQLiteFSAdapter,
  oid: string,
  currentPath: string = "",
): Promise<void> {
  const { tree } = await git.readTree({ fs: fsAdapter, dir: ".", oid });

  for (const entry of tree) {
    const entryPath = path.join(currentPath, entry.path).replace(/^\//, ""); // Build full path, remove leading slash if any
    if (entry.type === "blob") {
      // Print file entries
      console.log(`${entry.mode.toString()} blob ${entry.oid}\t${entryPath}`);
    } else if (entry.type === "tree") {
      // Recursively walk subtrees
      await walkTree(fsAdapter, entry.oid, entryPath);
    }
    // Ignore commits (submodules) for this simple ls-tree
  }
}

export async function lsTreeCommand(
  dbFilePath: string,
  ref: string,
  options: ParsedArgs,
): Promise<void> {
  console.log(
    chalk.blue(
      `Listing tree for ref '${chalk.bold(ref)}' in ${chalk.bold(dbFilePath)}...`,
    ),
  );

  let db: Database | null = null;
  let dbAdapter: BunSqliteAdapter | null = null;

  try {
    // 1. Check if DB file exists
    if (!fs.existsSync(dbFilePath)) {
      throw new Error(`Database file not found: ${dbFilePath}`);
    }

    // 2. Create the bun:sqlite Database instance (read-only recommended)
    db = new Database(dbFilePath, { readonly: true });

    // 3. Instantiate BunSqliteAdapter with the Database instance
    dbAdapter = new BunSqliteAdapter(db);

    // 4. Instantiate SQLiteFSAdapter with the BunSqliteAdapter
    const fsAdapter = new SQLiteFSAdapter(dbAdapter);

    // 5. Resolve the ref to a commit OID
    let commitOid: string;
    try {
      commitOid = await git.resolveRef({ fs: fsAdapter, dir: ".", ref });
    } catch (e: any) {
      throw new Error(`Could not resolve ref '${ref}': ${e.message}`);
    }

    // 6. Read the commit to get the root tree OID
    let treeOid: string;
    try {
      const { commit } = await git.readCommit({
        fs: fsAdapter,
        dir: ".",
        oid: commitOid,
      });
      treeOid = commit.tree;
    } catch (e: any) {
      throw new Error(`Could not read commit '${commitOid}': ${e.message}`);
    }

    // 7. Walk the tree recursively and print entries
    console.log(chalk.yellow(`--- Tree for ${ref} (${commitOid}) ---`));
    await walkTree(fsAdapter, treeOid); // Start walk from root tree
    console.log(chalk.yellow(`--- End Tree ---`));
  } catch (error: any) {
    // Re-throw the error to be caught by the main handler in cli.ts
    throw new Error(`ls-tree failed: ${error.message}`);
  } finally {
    // 8. Ensure the database connection is closed
    if (dbAdapter) {
      dbAdapter.close?.();
    } else if (db) {
      db.close();
    }
  }
}

