# Docker Setup

## Files

- `docker/build.Dockerfile` - production multi-stage build (`deps` -> `build` -> `prod` -> `prod-distroless`)
- `docker/jobs.Dockerfile` - one-off jobs image for `migrate` and `seed`
- `compose.yml` - prod-like local stack
- `compose.dev.yml` - dev override with bind mount + hot reload
- `.dockerignore` + Dockerfile-specific ignore files

## Команди запуску

### dev

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

### prod-like

```bash
docker compose -f compose.yml up --build
```

### міграції/seed

```bash
docker compose run --rm migrate
docker compose run --rm seed
```

`dev` піднімає `compose.yml + compose.dev.yml` (hot reload), `prod-like` - тільки `compose.yml` (продова збірка), `migrate/seed` - одноразові jobs-контейнери.

### Які файли додані/налаштовані

- `docker/build.Dockerfile` - multi-stage (`deps`, `dev`, `build`, `prod`, `prod-distroless`)
- `docker/jobs.Dockerfile` - image для `migrate` і `seed`
- `compose.yml` - prod-like стек (`api`, `postgres`, jobs)
- `compose.dev.yml` - dev overlay (hot reload + dev service)
- `.dockerignore`, `docker/build.Dockerfile.dockerignore`, `docker/jobs.Dockerfile.dockerignore` - зменшення build-context

## Докази оптимізації

```bash
docker build -f docker/build.Dockerfile --target dev -t backend-nest:dev-evidence .
docker build -f docker/build.Dockerfile --target prod -t backend-nest:prod-evidence .
docker build -f docker/build.Dockerfile --target prod-distroless -t backend-nest:distroless-evidence .
```

### `docker image ls` (dev vs prod vs prod-distroless)

```bash
docker image ls --format '{{.Repository}}:{{.Tag}}|{{.Size}}' | rg '^backend-nest:(dev-evidence|prod-evidence|distroless-evidence)\|'
backend-nest:dev-evidence|479MB
backend-nest:distroless-evidence|230MB
backend-nest:prod-evidence|234MB
```

### `docker history <image>`

```bash
docker history backend-nest:dev-evidence --format '{{.CreatedBy}}|{{.Size}}'
CMD ["npm" "run" "start:dev"]|0B
COPY . . # buildkit|491kB
ENV NODE_ENV=dev|0B
WORKDIR /workspace|0B
RUN /bin/sh -c npm ci # buildkit|343MB

docker history backend-nest:prod-evidence --format '{{.CreatedBy}}|{{.Size}}'
CMD ["node" "dist/main"]|0B
USER node|0B
COPY /workspace/dist ./dist # buildkit|434kB
COPY /workspace/node_modules ./node_modules ...|97.7MB
ENV NODE_ENV=production|0B

docker history backend-nest:distroless-evidence --format '{{.CreatedBy}}|{{.Size}}'
ENTRYPOINT ["/nodejs/bin/node" "/workspace/dist/main.js"]|0B
COPY /workspace/dist ./dist # buildkit|434kB
COPY /workspace/node_modules ./node_modules ...|97.7MB
ENV NODE_ENV=production|0B
bazel build @nodejs20_arm64//:data|97.7MB
```

Короткий висновок: `prod-distroless` у цьому проєкті трохи менший за `prod` (~4MB), Distroless не містить shell/package manager, тому менша attack surface при тому ж runtime payload (`dist` + production `node_modules`).

## Перевірка non-root

### `prod` (команда `id` всередині контейнера)

```bash
docker run --rm backend-nest:prod-evidence id
uid=1000(node) gid=1000(node) groups=1000(node)
```

### `prod-distroless` (через Node API, бо shell відсутній)

```bash
docker run --rm --entrypoint /nodejs/bin/node backend-nest:distroless-evidence -e "console.log('uid=' + process.getuid() + ' gid=' + process.getgid())"
uid=65532 gid=65532
```

```bash
docker image inspect backend-nest:prod-evidence backend-nest:distroless-evidence --format '{{.RepoTags}}|user={{.Config.User}}|size={{.Size}}'
[backend-nest:prod-evidence]|user=node|size=233630551
[backend-nest:distroless-evidence]|user=65532|size=229982454
```

Для distroless гарантія non-root подвійна: базовий образ `gcr.io/distroless/nodejs20-debian12:nonroot` + `Config.User=65532`.
