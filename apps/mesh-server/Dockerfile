FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.6.2 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mcp-dev-mesh/mesh-server... build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV DEV_MESH_HOST=0.0.0.0
ENV DEV_MESH_PORT=8721
ENV DEV_MESH_PROJECT_ROOT=/data/devmesh
ENV DEV_MESH_LOGGER=true

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/.npmrc ./.npmrc
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/mesh-server ./apps/mesh-server
COPY --from=build /app/packages ./packages

RUN mkdir -p /data/devmesh

EXPOSE 8721

CMD ["node", "apps/mesh-server/dist/index.js"]
