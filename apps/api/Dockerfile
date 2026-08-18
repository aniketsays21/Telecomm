FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33.0
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ai/package.json ./packages/ai/
RUN pnpm install --frozen-lockfile --filter @telecomm/api...

# Build shared packages
FROM deps AS builder
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm --filter @telecomm/shared build 2>/dev/null || true
RUN pnpm --filter @telecomm/db build 2>/dev/null || true
RUN pnpm --filter @telecomm/ai build 2>/dev/null || true
RUN pnpm --filter @telecomm/api build

# Production image
FROM node:20-alpine AS runner
RUN npm install -g pnpm@10.33.0
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
