FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY .npmrc .npmrc
COPY src/apps/web/package.json src/apps/web/package.json
COPY src/packages/domain/package.json src/packages/domain/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter ./src/apps/web --frozen-lockfile

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter ./src/apps/web run build

FROM build AS runner
ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/src/apps/web
CMD ["pnpm", "run", "docker:start"]
