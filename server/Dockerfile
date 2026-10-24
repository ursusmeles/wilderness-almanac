FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json LICENSE ./
COPY --from=dependencies /app/server/node_modules ./server/node_modules
COPY server ./server
COPY src ./src
COPY functions ./functions
RUN node --input-type=module -e "import './server/app.js'; import { connect } from './server/database.js'; connect(':memory:').close()"
RUN mkdir -p /data /backups /restore && chown node:node /data /backups /restore
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
