FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY services/carrier-summit/package.json services/carrier-summit/
RUN bun install

# Build React UI
FROM base AS ui-builder
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/services/carrier-summit/node_modules services/carrier-summit/node_modules
COPY services/carrier-summit/ui services/carrier-summit/ui
COPY services/carrier-summit/vite.config.ts services/carrier-summit/
COPY services/carrier-summit/tsconfig.ui.json services/carrier-summit/
COPY services/carrier-summit/package.json services/carrier-summit/
WORKDIR /app/services/carrier-summit
RUN bunx vite build --config vite.config.ts

# Runtime
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/services/carrier-summit/node_modules services/carrier-summit/node_modules
COPY packages/shared packages/shared
COPY services/carrier-summit/src services/carrier-summit/src
COPY services/carrier-summit/package.json services/carrier-summit/
COPY services/carrier-summit/tsconfig.json services/carrier-summit/
COPY --from=ui-builder /app/services/carrier-summit/public services/carrier-summit/public
COPY data/seed data/seed

WORKDIR /app/services/carrier-summit

# Seed database at build time
RUN mkdir -p data && bun run src/seed.ts

EXPOSE 3005
CMD ["bun", "run", "src/index.ts"]
