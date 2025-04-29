**Development Instructions for `git-sqlite-cli`**

**Goal:** Implement the `clone` and `ls-tree` commands for the CLI tool, integrating `sqlite-fs-library` with `isomorphic-git`.

**Prerequisites:**
*   Project directory (`git-sqlite-cli`) initialized with Bun.
*   Dependencies installed: `isomorphic-git`, `sqlite-fs-library` (linked), `minimist`, `chalk`, `typescript`, `@types/node`, `@types/minimist`.
*   Basic `tsconfig.json` exists.

**Steps:**

**1. Create the Main CLI Entry Point (`src/cli.ts`)**

*   **Action:** Create the file `src/cli.ts`.
*   **Content:** Paste the following code. This sets up argument parsing using `minimist` and routes to command handlers.
  ```typescript
  // src/cli.ts
  import parseArgs from 'minimist';
  import chalk from 'chalk'; // Optional: for colored output
  import { cloneCommand } from './commands/clone';
  import { lsTreeCommand } from './commands/ls-tree';

  async function main() {
      // Parse arguments, skipping 'bun' and the script path itself
      const args = parseArgs(Bun.argv.slice(2));
      const command = args._[0];

      // console.log('Args:', args); // Uncomment for debugging args

      switch (command) {
          case 'clone':
              if (args._.length < 3) {
                  console.error(chalk.red('Usage: git-sqlite clone <repository_url> <db_file_path>'));
                  process.exit(1);
              }
              // Pass repository URL and DB file path to the command handler
              await cloneCommand(args._[1], args._[2], args);
              break;

          case 'ls-tree':
               if (args._.length < 2) {
                  console.error(chalk.red('Usage: git-sqlite ls-tree <db_file_path> [ref]'));
                  process.exit(1);
              }
              // Default ref to 'HEAD' if not provided
              const ref = args._[2] || 'HEAD';
              // Pass DB file path and ref to the command handler
              await lsTreeCommand(args._[1], ref, args);
              break;

          default:
              console.error(chalk.red(`Unknown command: ${command || 'No command specified'}`));
              console.error('Available commands: clone, ls-tree');
              process.exit(1);
      }
  }

  // Execute main and handle top-level errors
  main().catch(err => {
      console.error(chalk.redBright('Error:'), err.message);
      // console.error(err.stack); // Uncomment for detailed stack trace
      process.exit(1);
  });
  ```

**2. Create the `clone` Command Handler (`src/commands/clone.ts`)**

*   **Action:** Create the directory `src/commands` and the file `src/commands/clone.ts`.
*   **Content:** Implement the logic to clone a repository into the SQLite DB. **Note the change:** We now create the `bun:sqlite` `Database` instance
first and pass it to `BunSqliteAdapter`.
  ```typescript
  // src/commands/clone.ts
  import { BunSqliteAdapter, SQLiteFSAdapter } from 'sqlite-fs-library';
  import git from 'isomorphic-git';
  import http from 'isomorphic-git/http/node'; // Using Node's HTTP client via Bun
  import path from 'node:path';
  import fs from 'node:fs'; // Using Node's fs for directory/file checks via Bun
  import { Database } from 'bun:sqlite'; // Import Bun's Database
  import chalk from 'chalk';
  import type minimist from 'minimist';

  export async function cloneCommand(repoUrl: string, dbFilePath: string, options: minimist.ParsedArgs): Promise<void> {
      console.log(chalk.blue(`Cloning ${chalk.bold(repoUrl)} into ${chalk.bold(dbFilePath)}...`));

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
              process.stdout.write(message.replace(/(\r\n|\n|\r)$/, '') + '\r');
          };
          const onProgress = (progress: any) => {
              // Example: Log progress stage and loaded/total info if available
              if (progress.phase && progress.loaded !== undefined && progress.total !== undefined) {
                   process.stdout.write(`Phase: ${progress.phase}, Progress: ${progress.loaded}/${progress.total} \r`);
              } else if (progress.phase) {
                   process.stdout.write(`Phase: ${progress.phase} \r`);
              }
          };

          // 6. Execute the clone operation
          await git.clone({
              fs: fsAdapter,
              http,
              dir: '.', // Root directory within the virtual filesystem
              url: repoUrl,
              // ref: 'main', // Optional: Specify a branch if needed
              singleBranch: true, // Recommended for faster clones
              depth: 10, // Optional: Limit history depth (adjust as needed)
              onMessage,
              onProgress,
              // corsProxy: '...', // Add if required for specific environments
          });

          // Clear progress line after completion
          process.stdout.write('\n');
          console.log(chalk.green('Clone completed successfully.'));

      } catch (error: any) {
          process.stdout.write('\n'); // Ensure newline after potential progress messages
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
  ```

**3. Create the `ls-tree` Command Handler (`src/commands/ls-tree.ts`)**

*   **Action:** Create the file `src/commands/ls-tree.ts`.
*   **Content:** Implement the logic to read the Git tree from the SQLite DB. **Note the change:** We now create the `bun:sqlite` `Database` instance
first and pass it to `BunSqliteAdapter`.
  ```typescript
  // src/commands/ls-tree.ts
  import { BunSqliteAdapter, SQLiteFSAdapter } from 'sqlite-fs-library';
  import git from 'isomorphic-git';
  import path from 'node:path';
  import fs from 'node:fs'; // Using Node's fs for directory/file checks via Bun
  import { Database } from 'bun:sqlite'; // Import Bun's Database
  import chalk from 'chalk';
  import type minimist from 'minimist';

  // Helper function to recursively walk the tree
  async function walkTree(fsAdapter: SQLiteFSAdapter, oid: string, currentPath: string): Promise<void> {
      const { tree } = await git.readTree({ fs: fsAdapter, dir: '.', oid });

      for (const entry of tree) {
          const entryPath = path.join(currentPath, entry.path).replace(/^\//, ''); // Build full path, remove leading slash if any
          if (entry.type === 'blob') {
              // Print file entries
              console.log(`${entry.mode.toString(8)} blob ${entry.oid}\t${entryPath}`);
          } else if (entry.type === 'tree') {
              // Recursively walk subtrees
              await walkTree(fsAdapter, entry.oid, entryPath);
          }
          // Ignore commits (submodules) for this simple ls-tree
      }
  }

  export async function lsTreeCommand(dbFilePath: string, ref: string, options: minimist.ParsedArgs): Promise<void> {
      console.log(chalk.blue(`Listing tree for ref '${chalk.bold(ref)}' in ${chalk.bold(dbFilePath)}...`));

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
              commitOid = await git.resolveRef({ fs: fsAdapter, dir: '.', ref });
          } catch (e: any) {
              throw new Error(`Could not resolve ref '${ref}': ${e.message}`);
          }

          // 6. Read the commit to get the root tree OID
          let treeOid: string;
          try {
              const { commit } = await git.readCommit({ fs: fsAdapter, dir: '.', oid: commitOid });
              treeOid = commit.tree;
          } catch (e: any) {
              throw new Error(`Could not read commit '${commitOid}': ${e.message}`);
          }

          // 7. Walk the tree recursively and print entries
          console.log(chalk.yellow(`--- Tree for ${ref} (${commitOid}) ---`));
          await walkTree(fsAdapter, treeOid, ''); // Start walk from root tree
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
  ```

**4. Update `src/index.ts` (if you created one for the CLI - often not needed for simple CLIs)**

*   If you have an `src/index.ts`, ensure it doesn't interfere with `src/cli.ts` being the main entry point defined in `package.json`. For a simple CLI
like this, you often don't need an `src/index.ts`.

**5. Running and Testing:**

*   **Clone a Repository:**
  ```bash
  # Example using a small public repo
  bun run src/cli.ts clone https://github.com/isomorphic-git/isomorphic-git.github.io.git ./test-repo.sqlite

  # Example using a local bare repo (if you have one)
  # bun run src/cli.ts clone /path/to/your/local/bare/repo.git ./local-repo.sqlite
  ```
  *   Observe the progress output. Check for success or error messages.
  *   Verify that the `./test-repo.sqlite` file (or your chosen path) is created.

*   **List the Tree:**
  ```bash
  # List tree for the default branch (HEAD)
  bun run src/cli.ts ls-tree ./test-repo.sqlite

  # List tree for a specific branch or tag (if the clone wasn't shallow/single-branch)
  # bun run src/cli.ts ls-tree ./test-repo.sqlite main
  ```
  *   Observe the output, which should resemble the output of `git ls-tree -r HEAD`.

*   **Build Executable (Optional):**
  ```bash
  bun run build
  # Now you can run the compiled executable
  ./git-sqlite clone <url> <db_file>
  ./git-sqlite ls-tree <db_file>
  ```
