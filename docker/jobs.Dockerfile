FROM node:20-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS jobs
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
ENV NODE_ENV=dev
USER node
CMD ["npm", "run", "migration:run"]