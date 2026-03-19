# Stage 1: deps (all dependencies for build)
FROM node:20-alpine AS deps
WORKDIR /workspace
RUN ls -a
COPY package.json package-lock.json ./
RUN npm ci

# Stage 1.5: dev runtime
FROM deps AS dev
WORKDIR /workspace
ENV NODE_ENV=dev
COPY . .
CMD ["npm", "run", "start:dev"]

# Stage 2: build (compile TS)
FROM node:20-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: prod-deps (only runtime deps)
FROM node:20-alpine AS prod-deps
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3.5: runtime deps for distroless (glibc-compatible)
FROM node:20-bookworm-slim AS prod-deps-distroless
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 4: prod (optional)
FROM node:20-alpine AS prod
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/main"]

# Stage 5: distroless runtime
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS prod-distroless
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=prod-deps-distroless /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
ENTRYPOINT ["/nodejs/bin/node", "/workspace/dist/main.js"]