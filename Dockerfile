# ---------- build ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ \
  && corepack enable
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Собираем TypeScript в dist/
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Безопаснее не работать под root
RUN addgroup -S nodejs && adduser -S nodeuser -G nodejs
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Если нужны статические файлы/шаблоны — скопируй их:
# COPY --from=builder /app/public ./public

USER nodeuser
EXPOSE 3000
CMD ["node", "dist/server/bootstrap.js"]
