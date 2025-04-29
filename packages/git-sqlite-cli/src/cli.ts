// src/cli.ts
import parseArgs from 'minimist';
import chalk from 'chalk'; // Optional: for colored output
import { cloneCommand } from './commands/clone.js';
import { lsTreeCommand } from './commands/ls-tree.js';

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