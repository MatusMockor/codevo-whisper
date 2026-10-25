FROM node:24-trixie-slim AS app
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/protocol ./packages/protocol
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile --filter "@codevo-whisper/server..." --filter codevo-whisper
RUN pnpm --filter @codevo-whisper/server build

FROM node:24-trixie-slim
WORKDIR /app
COPY --from=app /repo/apps/server/dist ./dist
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/codevo-whisper \
  && chmod 0755 /usr/local/bin/codevo-whisper \
  && install -d -m 0700 -o node -g node /data /run/codevo-whisper
ENV NODE_ENV=production \
  CW_BIND=0.0.0.0 \
  CW_PORT=8787 \
  CW_DATA_DIR=/data \
  CW_ADMIN_SOCKET=/run/codevo-whisper/admin.sock
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/').then((r) => process.exit(r.status === 426 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
