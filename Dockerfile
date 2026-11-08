# One image for the app (`node build`), the worker and the migrations (both run with tsx).
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
# The build validates src/env.ts while analysing routes: placeholders, the real values are read at runtime
RUN DATABASE_URL=postgres://build BETTER_AUTH_URL=http://build \
	BETTER_AUTH_SECRET=build-placeholder-not-a-real-secret-000 pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json ./
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/build build
COPY drizzle drizzle
# Server code shared with the worker, run from source by tsx
COPY src/lib src/lib
COPY src/worker src/worker
USER node
EXPOSE 3000
CMD ["node", "build"]
