# Git Durable Object Demo

This is a proof of concept for using isomorphic-git with Cloudflare Durable Objects to create a Git repository that is backed by a SQLite database.

## Packages

- [sqlite-fs](./packages/sqlite-fs): A node fs implementation that uses SQLite as a backend, provides a bun sqlite adapater and a durable object sqlite adapater.
- [git-sqlite-cli](./packages/git-sqlite-cli): Proof of concept cli app using the bun sqlite backend.
- [cf-demo](./apps/cf-demo): A cloudflare workers/durable object demo app showcasing `clone` and `fetch`
