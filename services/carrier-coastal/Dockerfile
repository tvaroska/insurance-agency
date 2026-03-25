FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY services/carrier-coastal/package.json services/carrier-coastal/
RUN bun install

# Build React UI
FROM base AS ui-builder
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/services/carrier-coastal/node_modules services/carrier-coastal/node_modules
COPY services/carrier-coastal/ui services/carrier-coastal/ui
COPY services/carrier-coastal/vite.config.ts services/carrier-coastal/
COPY services/carrier-coastal/tsconfig.ui.json services/carrier-coastal/
COPY services/carrier-coastal/package.json services/carrier-coastal/
WORKDIR /app/services/carrier-coastal
RUN bunx vite build --config vite.config.ts

# Runtime
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/services/carrier-coastal/node_modules services/carrier-coastal/node_modules
COPY packages/shared packages/shared
COPY services/carrier-coastal/src services/carrier-coastal/src
COPY services/carrier-coastal/package.json services/carrier-coastal/
COPY services/carrier-coastal/tsconfig.json services/carrier-coastal/
COPY --from=ui-builder /app/services/carrier-coastal/public services/carrier-coastal/public
COPY data/seed data/seed
COPY data/seed-clean data/seed-clean

ARG SEED_MODE=realistic
ENV SEED_MODE=${SEED_MODE}

WORKDIR /app/services/carrier-coastal

# Seed database at build time
RUN mkdir -p data && bun run src/seed.ts

EXPOSE 3006
CMD ["bun", "run", "src/index.ts"]
