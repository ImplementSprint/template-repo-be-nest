FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Copy only source files needed for build
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

RUN npm run build

FROM node:22-alpine AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
# Pull patched alpine package for CVE-2026-22184 before app install.
# Upgrade npm itself to pull in picomatch >= 4.0.4, fixing CVE-2026-33671 (ReDoS HIGH).
RUN apk upgrade --no-cache zlib \
  && npm install -g npm@latest \
  && npm ci --omit=dev \
  && rm package-lock.json \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist

USER nestjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/v1/health', (res) => { if (res.statusCode !== 200) process.exit(1); }).on('error', () => process.exit(1));"

CMD ["node", "dist/main"]
