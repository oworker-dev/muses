FROM node:22-bookworm-slim
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY .npmrc .npmrc
COPY src/apps/api/package.json src/apps/api/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter ./src/apps/api --prod --frozen-lockfile
COPY src/apps/api src/apps/api
COPY src/packages/db/migrations src/packages/db/migrations
COPY interfaces/service-map/saas.service-map.json interfaces/service-map/saas.service-map.json
WORKDIR /app/src/apps/api
EXPOSE 3001
CMD ["pnpm", "run", "docker:start"]
