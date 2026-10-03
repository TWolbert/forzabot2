FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY web/package.json ./web/package.json
RUN cd web && bun install

COPY . .
RUN cd web && bun run build

FROM oven/bun:1 AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    DASHBOARD_PORT=8080 \
    DATABASE_PATH=/data/forzabot.db \
    CAR_IMAGES_PATH=/data/car-images

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/index.ts ./index.ts
COPY --from=build /app/reloadCommands.ts ./reloadCommands.ts
COPY --from=build /app/src ./src
COPY --from=build /app/web/src/apiserver.ts ./web/src/apiserver.ts
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/media ./media
COPY --from=build /app/output.csv ./output.csv

EXPOSE 8080

CMD ["bun", "run", "index.ts"]
