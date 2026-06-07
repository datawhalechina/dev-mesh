FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.6.2 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mcp-dev-mesh/website build

FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx/static.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/website/docs/.vitepress/dist /usr/share/nginx/html

EXPOSE 80
