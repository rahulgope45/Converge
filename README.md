# Converge

Converge is a local-first collaborative incident-response workspace. Browser replicas apply edits immediately, preserve them offline, and deterministically converge after receiving the same operation set.

## Current MVP

- Versioned title, status, and severity registers
- Lamport logical clocks with deterministic actor-ID tie-breaking
- Duplicate operation protection
- React/Vite incident editor
- IndexedDB replica and pending-operation storage
- Service-worker application shell for full offline reloads
- HTTP catch-up and durable operation submission
- Go WebSocket broadcast hub
- PostgreSQL append-only operation log
- Idempotent server writes

## Architecture

```text
React + IndexedDB
       |
       | HTTP submission/catch-up + WebSocket notifications
       v
Go synchronization server
       |
       v
PostgreSQL operation log
```

## Documentation

- [Project introduction](docs/01-project-introduction.md)
- [Complete development guide](docs/02-development-guide.md)
- [Engineering standards](docs/03-engineering-standards.md)
- [Local startup guide](docs/04-startup-guide.md)
- [Future scope](docs/05-future-scope.md)
- [Deployment guide](docs/06-deployment-guide.md)

## Verification

```bash
npm install
npm run typecheck
npm test
npm run build:web

cd apps/server
go test ./...
go vet ./...
```

Start Docker Desktop before following the local runtime steps in the startup guide.
