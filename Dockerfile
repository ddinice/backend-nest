FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM deps AS builder
COPY . .
RUN npm run build

FROM builder AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run start:prod


