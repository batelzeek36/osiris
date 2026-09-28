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

# The camera catalogue and the geocoder cache are saved to /app/.cache so a
# restart starts from them instead of refetching every upstream. The app runs
# as nextjs and /app belongs to root, so the directory has to exist and be
# nextjs's before USER drops privileges, or every save fails with EACCES.
RUN mkdir .cache && chown nextjs:nodejs .cache

# DNS lookups, gzip and file reads all share libuv's thread pool, 4 threads by
# default. Under load the camera catalogue's upstream fetches queued behind it
# and ran past their budget. The dev server already runs with 64.
ENV UV_THREADPOOL_SIZE=64

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
