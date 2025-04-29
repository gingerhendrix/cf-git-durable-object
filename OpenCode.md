# OpenCode Guidelines

This is a monorepo workspace.  You will be working in one of the packages.

## Tasks

Tasks are documented in files in `docs/steps/`, when instructed to do so, please check the files in that directory for the current task (you will be given the file name).  If the task cannot be found, or the previous task is not complete, please stop and ask for clarification.

## Commands
- Build: `cd packages/sqlite-fs && bun run build`
- Typecheck: `cd packages/sqlite-fs && bun run typecheck`
- Run all tests: `cd packages/sqlite-fs && bun run test`
- Run single test: `cd packages/sqlite-fs && bun vitest run src/sum.test.ts`
- Run specific test: `cd packages/sqlite-fs && bun vitest run -t "should execute INSERT and SELECT using all()"`

## Code Style
- **Imports**: Use ESM imports with `.js` extension for local imports
- **Types**: Use TypeScript interfaces for API contracts, generics for flexible typing
- **Error Handling**: Log errors with context, then re-throw for caller handling
- **Naming**: Use camelCase for variables/methods, PascalCase for classes/interfaces
- **Formatting**: 2-space indentation, trailing commas in multi-line objects
- **Comments**: JSDoc style for interfaces and public methods
- **Patterns**: Implement interfaces for consistent APIs across adapters
- **Testing**: Use Vitest with describe/it pattern, clear test descriptions
