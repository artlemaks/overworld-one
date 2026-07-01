# Server container image (referenced by the ECS task definition).
# Runs the server via tsx (shared/ is source-consumed). Built for linux/arm64 in CI
# to match the Graviton Fargate task (cheaper). Build context = repo root:
#   docker buildx build --platform linux/arm64 -f server/Dockerfile -t <ecr>:<tag> .
FROM node:20-alpine

RUN corepack enable
WORKDIR /app

# Copy the whole workspace (node_modules/dist excluded via .dockerignore) and install.
COPY . .
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@overworld/server", "start"]
