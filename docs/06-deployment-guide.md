# Converge: Deployment Guide

## 1. Deployment architecture summary

Converge has three deployable parts:

```text
Static React/Vite frontend
          |
          | HTTPS and WSS
          v
Long-running Go web service
          |
          | TLS PostgreSQL connection
          v
Managed PostgreSQL
```

The frontend can be deployed to Vercel or Cloudflare Pages. The Go server needs an environment that accepts long-lived WebSockets and runs a Go process or container. PostgreSQL must be persistent and must not use an instance's ephemeral filesystem.

## 2. Required production changes

Before any deployment:

- Bind the Go server to `0.0.0.0:$PORT`.
- Add graceful shutdown.
- Configure allowed frontend origins.
- Use `https://` and `wss://` URLs.
- Require TLS for external PostgreSQL connections.
- Keep secrets in platform environment settings.
- Add `/health` and preferably `/ready`.
- Use a production Dockerfile for the Go server.
- Run migrations as a separate release step.
- Set frontend `VITE_API_URL` and `VITE_WS_URL` during build.
- Confirm one backend instance only, unless cross-instance broadcast has been implemented.

## 3. Recommended free portfolio deployment

Use:

```text
Frontend: Vercel
Backend:  Render free Web Service
Database: Neon free PostgreSQL
```

This keeps the existing React/Go/PostgreSQL architecture intact.

### Why this combination

- Vercel deploys the static Vite frontend from Git and provides preview deployments.
- Render Web Services accept WebSocket connections and can build Go or Docker services.
- Render's free service spins down after 15 minutes without inbound HTTP or WebSocket messages and may take about a minute to wake. That is acceptable for a portfolio demo but not production.
- Render's free PostgreSQL expires after 30 days, so use Neon for a longer-lived free demo database.
- Neon's October 2026 free plan announcement lists 1 GB PostgreSQL storage per project, sufficient for an MVP operation log.

Official references:

- [Vercel deployment methods](https://vercel.com/docs/deployments)
- [Render Web Services and WebSocket support](https://render.com/docs/web-services)
- [Render free-tier limitations](https://render.com/docs/free)
- [Neon free-plan limits](https://neon.com/blog/neon-free-plan-1-gb-per-project)

### 3.1 Deploy PostgreSQL to Neon

1. Create a Neon project.
2. Select a region close to the Render backend region.
3. Copy the pooled PostgreSQL connection string.
4. Require TLS using the connection-string settings Neon provides.
5. Run `apps/server/migrations/001_initial.sql` against the production database.
6. Store the connection string as Render's `DATABASE_URL`; never commit it.

Verify:

```bash
psql "$PRODUCTION_DATABASE_URL" -c '\dt'
```

### 3.2 Deploy the Go server to Render

Connect the GitHub repository and create a Web Service.

Recommended settings:

```text
Root directory: apps/server
Runtime:        Docker, or Go if the build layout is supported
Health path:    /health
Plan:           Free for portfolio preview
```

Environment:

```text
DATABASE_URL=<Neon connection string>
ALLOWED_ORIGINS=https://<frontend>.vercel.app
LOG_LEVEL=info
```

Do not hardcode `PORT`; Render supplies it. The server must read it.

After deployment:

```bash
curl --fail https://<backend>.onrender.com/health
```

Use `wss://<backend>.onrender.com/api/v1/documents/.../stream` in the browser. Render recommends `wss` for public connections and documents that connections end when an instance is replaced, so reconnect/catch-up is mandatory. [Render WebSocket guide](https://render.com/docs/websocket)

### 3.3 Deploy the React frontend to Vercel

Import the GitHub repository into Vercel.

Configure:

```text
Root directory: apps/web
Build command:  npm run build
Output:         dist
```

Environment:

```text
VITE_API_URL=https://<backend>.onrender.com
VITE_WS_URL=wss://<backend>.onrender.com
```

Deploy, then update Render's `ALLOWED_ORIGINS` to the exact Vercel production URL and redeploy the backend if needed.

### 3.4 Free-tier limitations to disclose

- Backend cold starts after idle periods.
- Active inbound WebSocket messages prevent idle spin-down, but interrupted connections still require reconnect.
- Render may restart free services.
- Free services cannot scale beyond one instance.
- Free Render filesystems are ephemeral.
- Provider quotas and terms can change.
- This is a portfolio deployment, not a production availability claim.

## 4. Cloudflare deployment options

### Option A: Cloudflare Pages frontend, unchanged Go backend

Use:

```text
Frontend: Cloudflare Pages
Backend:  Render Go service
Database: Neon PostgreSQL
```

Cloudflare Pages build settings for React/Vite are currently:

```text
Build command: npm run build
Output folder: dist
```

See [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

Set the same `VITE_API_URL` and `VITE_WS_URL` values as the Vercel deployment. Add the exact Pages production origin to Render's allowed origins.

This is the Cloudflare option that preserves the Go learning goal.

### Option B: all-Cloudflare real-time backend

Cloudflare Workers and Durable Objects can accept WebSockets. A Durable Object can coordinate all clients for one document, and the hibernation API can keep sockets connected while the object is not actively executing. [Cloudflare Durable Objects WebSocket guide](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

However, this is not a direct deployment of the Go server. It requires an architectural rewrite:

- Replace Go with a TypeScript Worker.
- Route each document to one Durable Object.
- Replace the in-memory Go hub with Durable Object connection membership.
- Choose Durable Object SQLite/storage or continue using external PostgreSQL.
- Rewrite server validation and persistence APIs for the Workers runtime.
- Use Wrangler configuration and Durable Object migrations.

This is an excellent future comparison project, but it is not the fast path to completing the current Go-based MVP.

## 5. Vercel backend note

Vercel Functions now support WebSocket connections when the relevant compute mode is enabled, but connections are pinned to one function instance, end at maximum function duration, and reconnecting clients may land on another instance. Shared state requires an external coordination layer. [Vercel WebSocket guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)

The current backend is a long-running Go process with an in-memory hub. Therefore:

- Use Vercel for the frontend in the recommended deployment.
- Do not move the Go hub into Vercel Functions without redesigning coordination and lifecycle behavior.

## 6. Paid AWS deployment

Recommended production-style architecture:

```text
Route 53
   |
ACM TLS certificate
   |
CloudFront + S3                 Application Load Balancer
React static frontend           HTTPS/WSS listener
                                      |
                                ECS Fargate service
                                Go container, initially 1 task
                                      |
                                RDS PostgreSQL
                                private subnets
```

AWS Application Load Balancers natively support HTTP WebSocket upgrades and keep the selected target for the resulting connection. [AWS ALB listener documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)

ECS Fargate runs the Go container without managing EC2 instances. [AWS ECS Fargate guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/getting-started-fargate.html)

RDS provides managed PostgreSQL. Place it in private subnets and allow connections only from the ECS service security group. [AWS RDS PostgreSQL guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_GettingStarted.CreatingConnecting.PostgreSQL.html)

### 6.1 AWS resources

- VPC across at least two availability zones
- Public subnets for ALB
- Private subnets for ECS tasks and RDS
- Internet/NAT design appropriate for required outbound access
- ECR repository for the server image
- ECS cluster, task definition, and service
- Application Load Balancer, target group, and HTTPS listener
- RDS PostgreSQL instance
- Secrets Manager or Systems Manager Parameter Store
- CloudWatch Logs
- S3 bucket and CloudFront distribution for the frontend
- ACM certificates
- Route 53 records if using a custom domain

### 6.2 Build and push the server image

The Dockerfile should use a multi-stage build:

1. Build a static or minimal Go binary in a Go builder image.
2. Copy it into a small non-root runtime image.
3. Expose the application port for documentation.
4. Start only the server binary.

Example workflow:

```bash
docker build -t converge-server ./apps/server
aws ecr get-login-password --region <region> | \
  docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker tag converge-server:latest <ecr-repository>:<git-sha>
docker push <ecr-repository>:<git-sha>
```

Use immutable Git-SHA image tags for releases.

### 6.3 Configure ECS

- Run one task initially because the hub is in memory.
- Set container port to the Go server port.
- Configure the ALB target-group health check as `/health` or `/ready`.
- Inject `DATABASE_URL`, `ALLOWED_ORIGINS`, and logging settings from managed secrets/configuration.
- Send stdout/stderr to CloudWatch Logs.
- Set graceful stop timeout and ensure the server handles `SIGTERM`.
- Set ALB idle timeout with expected WebSocket behavior in mind and retain application-level keepalive/reconnect.

### 6.4 Configure RDS

- Use PostgreSQL.
- Keep the instance non-public.
- Require TLS.
- Enable backups appropriate to the environment.
- Allow inbound port 5432 only from the ECS security group.
- Run migrations through a one-off ECS task or controlled CI release step.
- Do not run schema migration concurrently from every server task.

### 6.5 Deploy the frontend

Build:

```bash
VITE_API_URL=https://api.example.com \
VITE_WS_URL=wss://api.example.com \
npm --workspace @converge/web run build
```

Upload `apps/web/dist` to a private S3 origin and invalidate CloudFront after deployment. Configure SPA fallback so client routes return `index.html`.

### 6.6 Scaling beyond one ECS task

Do not increase desired task count above one until cross-instance broadcast exists.

Required change:

1. Commit operation to PostgreSQL.
2. Publish its sequence/document ID using PostgreSQL `LISTEN/NOTIFY`, ElastiCache Redis pub/sub, or another broker.
3. Every ECS task subscribed to the document publishes it to its local sockets.
4. Clients still use PostgreSQL catch-up after gaps.

The broker is a notification path, not the durable source of truth.

## 7. CI/CD outline

On pull request:

- Install npm dependencies with lockfile.
- Run TypeScript type checking.
- Run the minimal sync-core test.
- Run `go test ./...` and `go vet ./...`.
- Build frontend and server image.

On main branch:

- Deploy preview/free environment automatically through connected Git providers, or
- Push an ECR image, run the migration task, update ECS service, wait for health, then publish frontend assets.

Never deploy if migration or health verification fails.

## 8. Post-deployment verification

1. Check health endpoint.
2. Create a document.
3. Submit an operation and record acknowledgement sequence.
4. Fetch from sequence zero and find that operation.
5. Open two browsers and verify live synchronization.
6. Disconnect one browser, edit both, reconnect, and verify convergence.
7. Restart/redeploy the backend and confirm acknowledged history remains.
8. Inspect logs for secrets and unexpected errors.

## 9. Rollback

- Frontend: redeploy the previous known-good build.
- Backend: point the service to the previous immutable image tag.
- Database: prefer forward-compatible migrations and corrective migrations. Do not automatically reverse a destructive migration.
- Keep protocol changes backward compatible during rolling deployment.

## 10. Cost and cleanup warning

Free-tier limits and paid pricing change. Confirm provider dashboards immediately before deployment.

For AWS, delete unused ALBs, NAT gateways, ECS services, ECR images, RDS instances/snapshots, CloudFront distributions, and Route 53 resources when the environment is no longer needed. Some resources continue billing while idle.

