# Converge: Future Scope

## 1. Purpose

This document records valuable work that is intentionally excluded from the fast-track MVP. Do not implement these items until the MVP completion checklist in `02-development-guide.md` passes.

## 2. Priority 1: strengthen correctness and recovery

### Snapshots and log compaction

Problem: reconstructing a long-lived document from every historical operation becomes slow.

Improvement:

- Store periodic snapshots with the last included server sequence.
- Load the latest snapshot and apply only later operations.
- Retain operations until every relevant recovery requirement is satisfied.
- Define how very old offline replicas recover after compaction.

### Schema and protocol versioning

Add a `protocolVersion` to operation envelopes. Support rolling upgrades in which old and new clients overlap. Reject unsupported versions with a clear upgrade response.

### Property-based convergence testing

Generate random replicas, operations, delivery orders, duplicates, and partitions. Assert eventual convergence and idempotency across thousands of seeds.

### Crash and fault experiments

Integrate ideas from Chaos Harness:

- Kill the Go process after database commit but before response.
- Drop WebSocket connections during broadcasts.
- Add database latency.
- Retry the same operation after an unknown response.
- Verify no acknowledged operation disappears.

## 3. Priority 2: incident-response product features

### Ordered incident timeline

Add append, edit, and delete operations for timeline entries. A collaborative ordered list requires more than last-writer-wins fields. Options include:

- An RGA-style sequence CRDT
- Fractional indexing with deterministic tie-breaking
- Server-assigned ordering with explicit offline reconciliation

Document the selected trade-off before implementation.

### Tasks and ownership

Add tasks with owners, status, and deadlines. Use stable task IDs so edits affect a task rather than replacing the complete task list.

### Post-incident report

Generate a report from the operation history and timeline. Preserve links from report statements back to source events.

### Presence

Show who is viewing the incident and what field they are editing. Presence is ephemeral and should not enter the durable operation log.

### Attachments

Use object storage with metadata in PostgreSQL. Apply size/type limits, signed upload URLs, malware-scanning considerations, and retention rules.

## 4. Priority 3: identity and multi-tenancy

### Authentication

Add OIDC/OAuth login and short-lived server sessions. Avoid exposing provider tokens to the browser application unnecessarily.

### Organizations and roles

Introduce:

- Organizations
- Memberships
- Incident roles such as viewer, responder, and commander
- Invite and revocation flows

Every server query must enforce tenant and incident membership. Client-side hiding is not authorization.

### Audit log

Separate immutable security/audit events from collaborative document operations. Record membership changes, exports, and administrative actions.

## 5. Priority 4: scaling

### Cross-instance broadcasting

The MVP in-memory hub supports one Go process. For multiple processes, publish committed operations using one of:

- PostgreSQL `LISTEN/NOTIFY` for the first upgrade
- Redis pub/sub for a dedicated low-latency channel
- NATS or Kafka only when measured throughput and operational needs justify them

PostgreSQL remains the recovery source even when a pub/sub notification is missed.

### Partition documents across hubs

Route one document's connections to a coordination owner or allow any instance to subscribe to that document's events. Measure active connections, messages per second, and slow-client behavior.

### Backpressure and batching

Batch rapid local edits, cap client outbound queues, and disconnect slow consumers so they can recover using catch-up rather than consuming unbounded memory.

### Read models and caching

Add cached projections only after profiling shows reconstruction or repeated reads are expensive. Keep invalidation driven by committed server sequences.

## 6. Priority 5: security and privacy

- End-to-end encryption for document content
- Key rotation and device revocation
- Content retention and deletion policies
- Rate limiting by identity and IP
- Abuse controls for public share links
- Dependency and container scanning
- Database encryption and backup validation
- Per-tenant encryption keys where required

End-to-end encryption changes server-side validation, search, reporting, and recovery. Treat it as an architectural project, not a toggle.

## 7. Priority 6: observability and operations

- Prometheus-compatible metrics
- OpenTelemetry traces across HTTP, PostgreSQL, and broadcasts
- Dashboards for active sockets, reconnect rate, pending queue age, insertion latency, catch-up size, and slow-client closes
- Alerts tied to service-level objectives
- Automated backup restore drills
- Runbooks for database failure and operation backlog

Potential SLOs should be defined only after measurements exist.

## 8. Priority 7: richer clients

- Progressive Web App installation
- Background sync where browser support permits
- Mobile application reusing the protocol
- Accessible high-contrast and keyboard-first incident mode
- Desktop notifications for severity changes

## 9. Research directions

- Compare Lamport clocks with hybrid logical clocks.
- Compare centralized Figma-style ordering with a true operation-based CRDT.
- Model invariants using TLA+.
- Evaluate Automerge or Yjs against the custom structured-document model.
- Study undo/redo semantics in collaborative systems.
- Measure metadata growth and tombstone collection.

## 10. Portfolio extensions

After the MVP is stable, the most valuable portfolio additions are:

1. A documented failure found by chaos testing and its fix.
2. A convergence property-test report.
3. A benchmark with 100–500 WebSocket clients.
4. A before/after snapshot-compaction measurement.
5. An architecture decision comparing the Go/PostgreSQL design with Cloudflare Durable Objects.

Avoid adding many surface-level features. One measured systems improvement is more valuable than five unfinished UI features.

