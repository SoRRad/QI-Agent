# ---------------------------------------------------------------------------
# QI Agent — self-hosted image.
#
# No `# syntax=` directive on purpose: that would make every build pull a
# frontend image from Docker Hub, which fails in exactly the network-restricted
# environment this image is meant for. The built-in frontend is sufficient.
#
# Constraints this Dockerfile is built to satisfy (Q9):
#
#   * The base image is a BUILD ARGUMENT, so a mandated internal base can be
#     substituted without editing this file.
#   * No binary downloads during the build. Dependency install runs with
#     --ignore-scripts, so nothing fetches an engine, a browser or a font from
#     a vendor CDN. Fonts are vendored in the repository.
#   * No calls to external services beyond the package registry, which is
#     itself parameterised (NPM_REGISTRY) so an internal mirror can be used.
#   * No Vercel-only runtime API. Next runs in `standalone` mode under plain
#     `node server.js`.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-bookworm-slim

# --------------------------------------------------------------------- deps
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}

# Corepack ships with Node; this activates the pinned pnpm without a download
# beyond the registry above.
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
# --ignore-scripts is deliberate: it is what keeps postinstall hooks from
# pulling binaries over the network.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ------------------------------------------------------------------ builder
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The Prisma client is generated from the local schema and the WASM compiler
# shipped in the npm package. No engine binary is downloaded.
RUN pnpm exec prisma generate

# Next reads DATABASE_URL only at request time — every route is dynamic — but
# the value must parse during the build, so a placeholder is supplied and
# never persisted into the runtime stage.
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL="postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder" \
    pnpm build

# ------------------------------------------------------------------- runner
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN corepack enable \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone bundle carries only the server's actual dependency closure.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations, schema, seed and library content, so an operator can run
# `prisma migrate deploy` and `db:seed` inside the running container.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/content ./content
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma

USER nextjs
EXPOSE 3000

# /api/health reports database reachability, migration state and the active
# provider name. It never returns a key or any fragment of one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
