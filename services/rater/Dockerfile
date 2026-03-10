FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
COPY packages/shared/package.json packages/shared/
COPY services/rater/package.json services/rater/
RUN bun install

# Build
FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --from=deps /app/services/rater/node_modules services/rater/node_modules
COPY packages/shared packages/shared
COPY services/rater services/rater
COPY data/seed data/seed

WORKDIR /app/services/rater

# Seed database at build time
RUN mkdir -p data && bun run src/seed.ts

EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
