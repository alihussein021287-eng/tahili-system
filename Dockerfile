# مرحلة البناء
FROM public.ecr.aws/docker/library/node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx prisma generate && npm run build

# مرحلة التشغيل
FROM public.ecr.aws/docker/library/node:20-alpine AS runner
RUN apk add --no-cache postgresql16-client libreoffice font-noto font-noto-arabic
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
