FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# /app itself is root-owned, so the app could not create its snapshot dir
# (EACCES on /app/.cache) and every restart re-fetched every camera region
# from cold. Pre-create both cache dirs owned by the app user; docker-compose
# mounts named volumes over them so the snapshots survive a rebuild too.
RUN mkdir -p /app/.cache /app/.next/cache && \
    chown nextjs:nodejs /app/.cache /app/.next/cache

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
