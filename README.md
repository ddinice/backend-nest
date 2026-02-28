# Docker Setup

## Files

- `docker/build.Dockerfile` - production multi-stage build (`deps` -> `build` -> `prod` -> `prod-distroless`)
- `docker/jobs.Dockerfile` - one-off jobs image for `migrate` and `seed`
- `compose.yml` - prod-like local stack
- `compose.dev.yml` - dev override with bind mount + hot reload
- `.dockerignore` + Dockerfile-specific ignore files

## Run Commands

### Dev (hot reload)

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

### Prod-like

```bash
docker compose -f compose.yml up --build
```

### Migrations / seed (one-off jobs)

```bash
docker compose -f compose.yml --profile jobs run --rm migrate
docker compose -f compose.yml --profile jobs run --rm seed
```

## What Is Configured

- Multi-stage production build:
  - `deps` installs dependencies with `npm ci`
  - `build` compiles TypeScript with `npm run build`
  - `prod` contains only runtime artifacts (`dist` + prod `node_modules`)
  - `prod-distroless` runs the app in distroless runtime
- Runtime user is non-root:
  - `prod` uses `USER node`
  - `prod-distroless` uses `gcr.io/distroless/nodejs20-debian12:nonroot`
- Postgres is private:
  - no published DB port
  - database is available only on internal compose network
- Persistent DB storage:
  - `pgdata:/var/lib/postgresql/data`
- Jobs are separated from runtime:
  - `migrate` and `seed` run in `jobs` image and exit

## Verify Optimizations

```bash
docker image ls | rg "app|backend-nest"
docker history <prod-image>
docker history <distroless-image>
```

Expected result: `prod-distroless` has fewer layers and smaller attack surface, because it has no shell/package manager and includes only runtime files.

## Verify Non-root Runtime

For `prod` image:

```bash
docker run --rm <prod-image> id
```

For distroless image: the base image is `:nonroot`, so the process is not started as root by design.
