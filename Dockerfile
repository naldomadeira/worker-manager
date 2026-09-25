FROM node:22-alpine AS deps

ARG WORKER_MANAGER_VERSION=latest

WORKDIR /opt/worker-manager
# Tarballs from `scripts/pack-local.sh docker-dist ...` build the image from this checkout;
# without any, the published @worker-manager/cli is installed from npm.
COPY docker-dist/ /tmp/packages/
RUN if ls /tmp/packages/*.tgz > /dev/null 2>&1; then \
      npm install --omit=dev --no-audit --no-fund /tmp/packages/*.tgz; \
    else \
      npm install --omit=dev --no-audit --no-fund "@worker-manager/cli@${WORKER_MANAGER_VERSION}"; \
    fi \
    && rm -rf /tmp/packages

# 22.x is past the 22.12 that --pg-boss needs (pg-boss is ESM only); keep it there.
FROM node:22-alpine

ENV NODE_ENV=production \
    WORKER_MANAGER_HOST=0.0.0.0 \
    WORKER_MANAGER_OPEN=false

COPY --from=deps /opt/worker-manager/node_modules /opt/worker-manager/node_modules
RUN ln -s /opt/worker-manager/node_modules/.bin/worker-manager /usr/local/bin/worker-manager \
    && mkdir -p /app && chown node:node /app

WORKDIR /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD \
    node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_MANAGER_PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

ENTRYPOINT ["worker-manager"]
