# syntax=docker/dockerfile:1
# Image unique : API Fastify + front web statique + tâches planifiées. Node 22, utilisateur non root.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
# Le mobile n'entre pas dans l'image (voir .dockerignore) ; on n'installe que l'API et le web.
RUN pnpm install --frozen-lockfile --filter "@lumo/api..." --filter "@lumo/web..."
RUN pnpm turbo run build --filter=@lumo/api --filter=@lumo/web
RUN pnpm --filter @lumo/api --prod deploy --legacy /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/lumo.db \
    WEB_DIST_PATH=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --from=build --chown=node:node /repo/apps/web/dist /app/web
# /data : volume local (jamais NFS/SMB, WAL oblige).
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
