FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/classification/package.json packages/classification/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/meta-api/package.json packages/meta-api/package.json
COPY packages/google-api/package.json packages/google-api/package.json
COPY packages/reporting/package.json packages/reporting/package.json
RUN pnpm install --no-frozen-lockfile

COPY apps/worker apps/worker
COPY packages packages

ENTRYPOINT ["pnpm", "--filter", "@zvedeno/worker", "start"]
CMD ["health"]
