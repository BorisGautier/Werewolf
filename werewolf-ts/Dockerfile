# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# ---- deps: install all dependencies (needed to compile TS + generate Prisma client)
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# ---- build: compile TypeScript and generate the Prisma client
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ---- prod-deps: production-only node_modules (smaller final image)
FROM base AS prod-deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate

# ---- runtime: minimal final image
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S werewolf && adduser -S werewolf -G werewolf

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY locales ./locales
COPY assets ./assets
COPY package.json ./
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh && chown -R werewolf:werewolf /app

USER werewolf

ENTRYPOINT ["./docker-entrypoint.sh"]
