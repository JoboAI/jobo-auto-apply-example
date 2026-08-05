# syntax=docker/dockerfile:1

# Node 22, not 20: package.json declares engines.node >=22, and better-sqlite3
# compiles a native binding against whichever Node builds it — the builder and
# the runner have to agree, or the binding fails to load at boot.
FROM node:22-slim AS builder
WORKDIR /app

# better-sqlite3 has no prebuild for every platform, so keep a toolchain around
# for the fallback source build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# No env is read at build time — every route is server-rendered on demand — so
# this needs no secrets. Keep it that way: a build that needs a key cannot be
# verified in CI.
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Where SQLite and the uploaded resumes live. Mount a volume here — without one
# every restart starts from an empty database.
ENV DATA_DIR=/data

# next start needs the built app plus its dependencies. better-sqlite3 is in
# serverExternalPackages, so Next does not bundle it and the real node_modules
# must come along; the native binding is already compiled for this Node major.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
# public/ carries the brand assets (logo, favicons). It genuinely did not exist
# when this Dockerfile was written; forgetting this line once they arrived
# would 404 the header logo in the container and nowhere else.
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
# Migrations run on first query, from process.cwd()/db/migrations.
COPY --from=builder /app/db ./db

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "next", "start", "-p", "3000"]
