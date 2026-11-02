# Converge

Converge is a local-first collaborative incident-response workspace. Browser replicas apply edits immediately, preserve them offline, and deterministically converge after receiving the same operation set.

## Architecture

Local execution is the critical path. Server synchronization is a recoverable background path.

```mermaid
flowchart LR
    edit["User edit"] --> local["Apply to local replica"]

    local --> ui["Render immediately"]
    local --> idb[("IndexedDB<br/>Replica + pending operations")]

    idb --> network{"Network available?"}

    network -->|"No"| queue["Pending operation queue"]
    network -->|"Yes"| server["Go synchronization server"]
    queue -.->|"Retry after reconnect"| server

    server -->|"Idempotent commit"| postgres[("PostgreSQL<br/>Operation log")]

    postgres -->|"serverSequence catch-up"| merge["Deterministic merge"]
    server -->|"WebSocket after commit"| merge

    merge --> result["All replicas converge"]

    style local fill:#dbeafe,stroke:#3b82f6
    style idb fill:#dbeafe,stroke:#3b82f6
    style queue fill:#fef3c7,stroke:#f59e0b
    style postgres fill:#ede9fe,stroke:#8b5cf6
    style merge fill:#ccfbf1,stroke:#14b8a6
    style result fill:#dcfce7,stroke:#22c55e
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

