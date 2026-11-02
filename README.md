# Converge

Converge is a local-first collaborative incident-response workspace. Browser replicas apply edits immediately, preserve them offline, and deterministically converge after receiving the same operation set.



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


