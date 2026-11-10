# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.22.2-bookworm-slim
ARG RUST_IMAGE=rust:1.96.0-bookworm

# This source SDK also gives customer model builders the matching shared crate.
FROM ${RUST_IMAGE} AS model-sdk
WORKDIR /opt/daedlo-sdk
COPY Cargo.toml Cargo.lock ./
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
COPY crates/daedlo-engine ./crates/daedlo-engine
COPY examples/notebook-engine ./examples/notebook-engine

FROM model-sdk AS notebook-model
RUN cargo build --release --locked -p notebook-engine

FROM ${NODE_IMAGE} AS runtime-base
WORKDIR /opt/daedlo
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DAEDLO_PORT=43100 \
    DAEDLO_PUBLIC_ORIGIN=http://127.0.0.1:43100 \
    DAEDLO_PROJECT=/opt/daedlo/project/project.mjs \
    DAEDLO_REPORT=/evidence/session.json
COPY package.json package-lock.json ./
COPY packages/runtime/package.json ./packages/runtime/package.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && ./node_modules/.bin/playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && mkdir -p /evidence /opt/daedlo/project \
    && chown node:node /evidence /opt/daedlo/project
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
COPY packages/runtime ./packages/runtime
COPY container/entrypoint.sh container/healthcheck.mjs ./container/
USER node
EXPOSE 43100
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "/opt/daedlo/container/healthcheck.mjs"]
ENTRYPOINT ["/bin/sh", "/opt/daedlo/container/entrypoint.sh"]

FROM ${NODE_IMAGE} AS notebook-app
WORKDIR /opt/daedlo
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
COPY examples/notebook/server.mjs examples/notebook/index.html ./examples/notebook/
COPY container/fixture/app.mjs ./container/fixture/app.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=5s --start-period=5s --retries=10 \
    CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:8080/api/session');process.exitCode=r.ok?0:1"]
CMD ["node", "container/fixture/app.mjs"]

FROM runtime-base AS notebook-driver
COPY --from=notebook-model /opt/daedlo-sdk/target/release/notebook-engine ./models/notebook-engine
COPY examples/notebook/adapter.mjs ./examples/notebook/adapter.mjs
COPY container/fixture/project.mjs ./container/fixture/project.mjs
ENV DAEDLO_PROJECT=/opt/daedlo/container/fixture/project.mjs

# Default build is the reusable runtime, with no application or test fixture.
FROM runtime-base AS runtime
