# Converge: Local Startup Guide

## 1. Current warning

The server, frontend, database definition, and synchronization core now exist. Static verification passes, but the complete local runtime path still requires Docker Desktop to be running. If a command fails, follow the troubleshooting section and check repository status before changing code.

## 2. Prerequisites

Install:

- Git
- Node.js 24 or newer
- npm 11 or newer
- Go 1.27 or newer
- Docker with Docker Compose
- `psql` client, recommended for applying and inspecting migrations
- curl

Verify:

```bash
git --version
node --version
npm --version
go version
docker --version
docker compose version
psql --version
curl --version
```

## 3. Clone and install

```bash
git clone https://github.com/rahulgope45/converge.git
cd converge
npm install
```

The repository currently uses npm workspaces. Root installation should install frontend, sync-core, and development dependencies after their package files exist.

Download Go modules after the server has been created:

```bash
cd apps/server
go mod download
cd ../..
```

## 4. Environment files

Never commit real `.env` files.

### Server environment

Copy:

```bash
cp apps/server/.env.example apps/server/.env
```

Expected values:

```dotenv
PORT=8080
DATABASE_URL=postgres://converge:converge@localhost:5432/converge?sslmode=disable
ALLOWED_ORIGINS=http://localhost:5173
LOG_LEVEL=debug
```

The Go standard library does not automatically read `.env`. During development either export the variables in the shell or add a small documented development loader. Do not require a `.env` loader in production.

Shell example:

```bash
export PORT=8080
export DATABASE_URL='postgres://converge:converge@localhost:5432/converge?sslmode=disable'
export ALLOWED_ORIGINS='http://localhost:5173'
export LOG_LEVEL=debug
```

### Frontend environment

Copy:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Expected values:

```dotenv
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080
```

Only variables prefixed with `VITE_` are exposed to Vite client code. Never put secrets in them.

## 5. Start PostgreSQL

After `infra/docker-compose.yml` exists:

```bash
docker compose -f infra/docker-compose.yml up -d postgres
docker compose -f infra/docker-compose.yml ps
```

Expected local Compose values:

```text
database: converge
user:     converge
password: converge
port:     5432
```

These credentials are for local development only.

Inspect logs if startup fails:

```bash
docker compose -f infra/docker-compose.yml logs --tail 100 postgres
```

## 6. Apply the database migration

```bash
psql "$DATABASE_URL" -f apps/server/migrations/001_initial.sql
```

Verify tables:

```bash
psql "$DATABASE_URL" -c '\dt'
psql "$DATABASE_URL" -c '\d operations'
```

The migration should be safe to apply to a fresh database. If it is not written as idempotent, do not run it twice against the same database.

## 7. Start the Go server

From a terminal with the environment exported:

```bash
cd apps/server
go run ./cmd/server
```

```bash
Linux - loading up the env
set -a
source env Filepath
set +a
```

Expected local address:

```text
http://localhost:8080
```

Verify health from another terminal:

```bash
curl --fail --silent http://localhost:8080/health
```

Expected response:

```json
{"status":"ok"}
```

## 8. Start the frontend

In another terminal:

```bash
npm --workspace @converge/web run dev
```

Expected address:

```text
http://localhost:5173
```

If the workspace has not yet been named `@converge/web`, enter `apps/web` and run `npm run dev` instead.

## 9. Create and open an incident

Create a document:

```bash
curl --fail \
  --request POST \
  --header 'Content-Type: application/json' \
  http://localhost:8080/api/v1/documents
```

Copy the returned `documentId`, then open:

```text
http://localhost:5173/incidents/<documentId>
```

The final frontend may also create a document through a button and navigate automatically.

## 10. Verify synchronization manually

1. Open the same incident URL in two browser windows.
2. Change the title in window A.
3. Confirm window B updates without refreshing.
4. Put window A in offline mode using browser DevTools.
5. Change status in A.
6. Change severity in B.
7. Refresh A while offline; its status change should remain.
8. Restore network access in A.
9. Confirm both windows converge to the same values.
10. Check that pending-operation count becomes zero.

## 11. Development checks

TypeScript:

```bash
npm run typecheck
npm test
```

Go:

```bash
cd apps/server
gofmt -w .
go test ./...
go vet ./...
```

Fast-track mode requires only the critical convergence test; do not spend time creating broad coverage before the MVP runs.

## 12. Stop local services

Stop frontend and server with `Ctrl+C` in their terminals.

Stop PostgreSQL while preserving data:

```bash
docker compose -f infra/docker-compose.yml down
```

Deleting the named volume removes local database data. Do not use `down -v` unless deletion is intentional.

## 13. Troubleshooting

### `npm: command not found`

The shell may not have loaded the Node version manager. Open a new interactive terminal or load the configured Node environment, then check `command -v node` and `command -v npm`.

### Port 5432 already in use

Another PostgreSQL process is using the port. Stop it or change the Compose host port and update `DATABASE_URL`.

### Server cannot connect to PostgreSQL

Check:

```bash
docker compose -f infra/docker-compose.yml ps
psql "$DATABASE_URL" -c 'SELECT 1'
```

Confirm the database is ready, credentials match, and `sslmode=disable` is used only locally.

### Browser reports a CORS error

Ensure `ALLOWED_ORIGINS` exactly includes the browser origin, including scheme and port.

### WebSocket connects locally but not after deployment

- Use `wss://`, not `ws://`, from an HTTPS page.
- Confirm the platform supports WebSocket upgrade requests.
- Confirm the backend is listening on the platform `PORT` and `0.0.0.0`.
- Inspect server logs for origin rejection or upgrade failure.

### Duplicate operations appear in the database

Verify the unique constraint exists on `operation_id`. Retries must reuse the same ID rather than generating a new one.

### Replicas disagree after reconnect

Check:

- The same operation set reached both replicas.
- Version comparison uses Lamport time and actor ID, not arrival order.
- `lastServerSequence` advances only after persistence.
- The final catch-up request runs after WebSocket establishment.
- Pending operations reuse original IDs.

