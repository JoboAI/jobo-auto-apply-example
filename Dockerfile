# syntax=docker/dockerfile:1

# One image, two processes: the web app (default command) and the background
# worker (`node --import tsx scripts/worker.ts`). Run both against the same database, the same
# secrets and the same DATA_DIR volume. Migrations: `npm run db:migrate`.

# Node 22: package.json declares engines.node >=22.
FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The build reads no environment: every route renders on demand and the
# database pool opens on first query. So it needs no secrets, and CI can
# build it as-is. Keep it that way.
# Then drop dev dependencies, and Next's SWC compiler binaries: `next start`
# serves the compiled build and never needs them (they are most of the size).
RUN npm run build && npm prune --omit=dev && rm -rf node_modules/@next/swc-*

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Uploaded resume PDFs. Mount a volume here, shared by the web app and the
# worker: Jobo downloads them over HTTPS for resume upload fields.
ENV DATA_DIR=/data

# Production dependencies only (pg stays external to the Next bundle, and the
# worker and migrations run TypeScript through tsx).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json /app/next.config.mjs /app/tsconfig.json ./
# Sources the worker, migrations and doctor run directly.
COPY --from=builder /app/db ./db
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000

# For the web app. Override it for the worker: `npm run worker:health`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node directly, not npx/npm, so SIGTERM reaches Next and it shuts down cleanly.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
