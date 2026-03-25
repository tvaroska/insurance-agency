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

ARG SEED_MODE=realistic
ENV SEED_MODE=${SEED_MODE}

WORKDIR /app/services/claims

# Seed database at build time
RUN mkdir -p data && bun run src/seed.ts

EXPOSE 3007
CMD ["bun", "run", "src/index.ts"]
