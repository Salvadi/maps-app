FROM node:20.18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20.18-alpine
WORKDIR /app
RUN apk add --no-cache curl && \
    addgroup -S opimappa && adduser -S -G opimappa opimappa
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
USER opimappa
EXPOSE 3000
CMD ["node", "dist/index.js"]
