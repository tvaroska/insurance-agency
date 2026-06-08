FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY services/claims/package.json services/claims/
RUN bun install

# Build
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/services/claims/node_modules services/claims/node_modules
COPY packages/shared packages/shared
COPY services/claims services/claims
COPY data/seed data/seed
COPY data/seed-clean data/seed-clean
COPY scripts/entrypoint.sh /app/entrypoint.sh

WORKDIR /app/services/claims

EXPOSE 3007
CMD ["/app/entrypoint.sh"]
