FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production

COPY tsconfig.json ./
COPY src/ ./src/

ENV PORT=7777
EXPOSE 7777

CMD ["bun", "src/server/main.ts"]
