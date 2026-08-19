FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33.0
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter @telecomm/web...

# Build
# tsconfig.base.json is required at /app because apps/web/tsconfig.json
# extends "../../tsconfig.base.json" — Next.js reads that during `next build`
# and errors with TS5083 when the file is missing.
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @telecomm/web build

# Production image
FROM node:20-alpine AS runner
RUN npm install -g pnpm@10.33.0
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web ./apps/web

EXPOSE 3000
CMD ["pnpm", "--filter", "@telecomm/web", "start"]
