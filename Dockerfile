FROM rust:1-bookworm AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown

COPY Cargo.toml Cargo.lock ./
COPY rust ./rust
COPY output.csv ./output.csv
COPY media ./media

# Build the server binaries and data tools.
RUN cargo build --release -p forzabot-api -p forzabot-discord -p forzabot-tools -j 2

# Build the RSX dashboard to WebAssembly. Using the matching wasm-bindgen CLI
# directly avoids the heavyweight Dioxus CLI while producing the same static
# bundle expected by the API's fallback file server.
RUN cargo install wasm-bindgen-cli --version 0.2.130 --locked
RUN cargo build --release -p forzabot-dashboard --target wasm32-unknown-unknown -j 2
RUN mkdir -p /app/dashboard-dist \
    && wasm-bindgen --target web --out-dir /app/dashboard-dist --out-name app \
       /app/target/wasm32-unknown-unknown/release/forzabot-dashboard.wasm \
    && cp rust/dashboard/index.html /app/dashboard-dist/index.html

FROM debian:bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini wget fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /data forzabot \
    && mkdir -p /data && chown forzabot:forzabot /data

ENV NODE_ENV=production \
    RUST_API_ADDR=0.0.0.0:8080 \
    DATABASE_PATH=/data/forzabot.db \
    CAR_IMAGES_PATH=/data/car-images \
    DASHBOARD_DIST=/app/dashboard-dist

COPY --from=build /app/target/release/forzabot-api /usr/local/bin/forzabot-api
COPY --from=build /app/target/release/forzabot-discord /usr/local/bin/forzabot-discord
COPY --from=build /app/target/release/scrape-cars /usr/local/bin/scrape-cars
COPY --from=build /app/target/release/generate-class-icons /usr/local/bin/generate-class-icons
COPY --from=build /app/dashboard-dist ./dashboard-dist
COPY --from=build /app/media ./media
COPY --from=build /app/output.csv ./output.csv
COPY docker-entrypoint.sh /usr/local/bin/forzabot-entrypoint

RUN chmod +x /usr/local/bin/forzabot-entrypoint
# Start as root only long enough to repair ownership of a pre-existing
# (possibly root-owned) data volume, then drop to the unprivileged user in the
# entrypoint. The app itself never runs as root.
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/forzabot-entrypoint"]
