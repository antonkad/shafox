# syntax=docker/dockerfile:1

# Shafox runs a Node HTTP server (`server/index.js`) that serves the Vite build
# AND the `/api` routes. kad.dev's `vite` preset is static-nginx, which would
# publish `dist/` and drop the server entirely, so this repo deploys with the
# platform's `dockerfile` preset. Port 8080 matches the platform default and the
# server reads `PORT` (set by the platform) with 8080 as its fallback.
#
# The container stays on the image's default root user. The platform's app
# chart renders an empty pod/container securityContext (no fsGroup, no
# runAsUser) and its `prepare-storage` init container creates the app-disk
# subPath as root without a chown, so a non-root `node` user could not write the
# JSON guestbook at `/data/guestbook.json`. Root is the truthful choice here.

FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

# Optional: `docker build --build-arg BUILD_COMMIT=$(git rev-parse HEAD)` bakes
# the identity into the bundle. kad.dev's dockerfile preset passes no build
# args, so the server injects the deployed identity at request time instead
# (server/app.js), which is authoritative.
ARG BUILD_COMMIT=""
ENV BUILD_COMMIT=${BUILD_COMMIT}

RUN npm run build

FROM node:20-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 8080

CMD ["node", "server/index.js"]
