FROM node:18-alpine

# Enable pnpm via corepack
RUN corepack enable && \
    corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3001
CMD ["pnpm", "start"]
