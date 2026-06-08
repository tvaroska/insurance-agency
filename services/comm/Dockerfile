FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY services/comm/package.json services/comm/
RUN bun install

# Build
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/services/comm/node_modules services/comm/node_modules
COPY packages/shared packages/shared
COPY services/comm services/comm
COPY data/seed data/seed
COPY data/seed-clean data/seed-clean
COPY scripts/entrypoint.sh /app/entrypoint.sh

WORKDIR /app/services/comm

EXPOSE 3004
CMD ["/app/entrypoint.sh"]
