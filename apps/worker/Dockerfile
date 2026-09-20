FROM node:24-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages ./packages
RUN find packages -type f -not -name package.json -delete && npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
RUN npm run build -w @lfsci/worker

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ARG TYPST_VERSION=0.13.1
RUN apk add --no-cache ca-certificates fontconfig ttf-dejavu \
  && wget -qO /tmp/typst.tar.xz "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-$(uname -m | sed 's/arm64/aarch64/')-unknown-linux-musl.tar.xz" \
  && tar -xJf /tmp/typst.tar.xz -C /tmp \
  && mv /tmp/typst-*/typst /usr/local/bin/typst \
  && rm -rf /tmp/typst* \
  && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/worker/dist ./dist
COPY --from=build --chown=app:app /repo/packages/integrations/pdf/src/templates ./templates
COPY --from=deps --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/packages/db/migrations ./migrations
USER app
CMD ["node", "dist/main.js"]
