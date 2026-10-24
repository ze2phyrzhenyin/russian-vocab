FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
FROM base AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG DATABASE_URL=postgresql://unused@localhost:5432/slovo_demo
ARG BETTER_AUTH_SECRET=build-only-placeholder-not-a-runtime-secret-000000
ARG BETTER_AUTH_URL=http://localhost:4186
ENV DATABASE_URL=$DATABASE_URL BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET BETTER_AUTH_URL=$BETTER_AUTH_URL APP_ENV=development DEMO_MODE=true
RUN pnpm build
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4186 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
USER node
EXPOSE 4186
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:4186/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
