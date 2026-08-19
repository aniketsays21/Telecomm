# syntax=docker/dockerfile:1.7
#
# Build context is the REPO ROOT (not apps/api). Railway service should be
# configured with Root Directory = "/" and Dockerfile Path = "apps/api/Dockerfile".
# The .dockerignore at the repo root keeps host node_modules, dist/, .env and
# .git out of the build context so the layers below stay hermetic.

# ---------- base ----------
FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33.0
WORKDIR /app

# ---------- deps ----------
# Cache-friendly install: only manifest files here, so a source-only change
# never invalidates the install layer.
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/widget/package.json ./apps/widget/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/ai/package.json ./packages/ai/
# `--filter @telecomm/api...` installs the API package and every workspace
# dependency it transitively needs. `--filter @telecomm/widget` adds the
# embeddable chat widget so we can build its bundle and serve it from the API
# at /widget.js. --frozen-lockfile guarantees identical versions to CI/local.
RUN pnpm install --frozen-lockfile --filter @telecomm/api... --filter @telecomm/widget

# ---------- build ----------
# tsconfig.base.json (line: COPY tsconfig.base.json ./) is required — the API
# tsconfig extends it, and its absence was what broke the previous build with
# TS5083 and cascading module/target errors.
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/widget/ ./apps/widget/
# Build widget FIRST so its dist/widget.js exists before the API bundle is
# assembled — the API's /widget.js route reads that file off disk at runtime,
# so it must be present in the runner image.
RUN pnpm --filter @telecomm/widget build
# Then build the API: `tsc --noEmit` type gate + esbuild bundle at
# apps/api/dist/index.js with @telecomm/* workspace source inlined. Every real
# npm dependency stays external and is resolved from node_modules at runtime.
RUN pnpm --filter @telecomm/api build

# ---------- prune ----------
# Reduce node_modules to production-only for the runner. Everything the bundle
# does NOT inline (fastify, drizzle, postgres, nodemailer, ...) must still be
# present at runtime.
FROM deps AS prod-deps
# CI=true tells pnpm never to prompt for interactive confirmation. Without it,
# Railway's non-TTY Docker build aborts with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
# when the --prod install prunes devDependencies from the deps-stage node_modules.
ENV CI=true
RUN pnpm install --frozen-lockfile --filter @telecomm/api... --prod

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Container listens on whatever PORT Railway injects; falls back to 4000 for
# local `docker run`.
ENV PORT=4000

# The bundle inlines all workspace source, so we do NOT copy packages/ or the
# API source tree into the runner. Only the compiled artifact + the external
# node_modules the bundle expects to resolve at import time.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
# The API serves /widget.js by reading this file at request time; leaving it
# out is what made the settings-page live preview show "widget load failed".
COPY --from=builder /app/apps/widget/dist ./apps/widget/dist

# Run as a non-root user; node:20-alpine ships the `node` user for exactly this.
USER node

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
