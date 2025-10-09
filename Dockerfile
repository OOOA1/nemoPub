# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ && corepack enable

# Ставим зависимости. Если npm ci не сработает (нет lock-файла/версии),
# делаем fallback на npm install и гарантированно ставим esbuild.
COPY package*.json ./
RUN (npm ci || npm install --include=dev) \
 && (npm ls esbuild >/dev/null 2>&1 || npm install -D esbuild)

COPY . .
# Сборка: БЕЗ TS-типов, одним бандлом dist/index.js
RUN node -e "require('esbuild').buildSync({entryPoints:['server/index.ts'], platform:'node', packages:'external', bundle:true, format:'esm', outfile:'dist/index.js'})"

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nodeuser -G nodejs

# только prod-зависимости
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# артефакты сборки
COPY --from=builder /app/dist ./dist

USER nodeuser
EXPOSE 3000
CMD ["node", "dist/index.js"]

