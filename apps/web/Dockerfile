# Build de produção do front + nginx com HTTP/2.
# Contexto de build: raiz do monorepo (ver docker-compose.yml).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web
COPY apps/web apps/web
RUN pnpm --filter web build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker/gen-cert.sh /docker-entrypoint.d/05-gen-cert.sh
RUN chmod +x /docker-entrypoint.d/05-gen-cert.sh
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
