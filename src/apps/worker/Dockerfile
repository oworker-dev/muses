FROM node:22-bookworm-slim
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY .npmrc .npmrc
COPY src/apps/worker/package.json src/apps/worker/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter ./src/apps/worker --prod --frozen-lockfile
COPY src/apps/worker src/apps/worker
WORKDIR /app/src/apps/worker
CMD ["pnpm", "run", "start"]
