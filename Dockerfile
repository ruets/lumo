# syntax=docker/dockerfile:1
# Single image: Fastify API + static web front end + scheduled jobs. Node 22, non-root user.

FROM node:25-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
# The mobile app is not part of the image (see .dockerignore); only the API and the web app are installed.
RUN pnpm install --frozen-lockfile --filter "@lumo/api..." --filter "@lumo/web..."
RUN pnpm turbo run build --filter=@lumo/api --filter=@lumo/web
RUN pnpm --filter @lumo/api --prod deploy --legacy /out

FROM node:25-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/lumo.db \
    WEB_DIST_PATH=/app/web
# The runtime only runs `node dist/server.js`: drop the package managers shipped with the base image.
# They are not needed in production and their bundled dependencies are a recurring source of scanner findings.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --from=build --chown=node:node /repo/apps/web/dist /app/web
# /data: local volume (never NFS/SMB, WAL requires it).
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
