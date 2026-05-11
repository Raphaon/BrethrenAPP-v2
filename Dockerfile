# ─── Build Stage ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Dépendances
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --ignore-scripts

# Génération Prisma Client
RUN npx prisma generate

# Compilation TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ─── Production Stage ─────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Créer utilisateur non-root
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Dépendances production uniquement
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

# Prisma
COPY prisma ./prisma/
RUN npx prisma generate

# Code compilé
COPY --from=builder /app/dist ./dist

# Uploads directory
RUN mkdir -p uploads && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
