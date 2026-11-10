# Run Daedlo as a Compose service

Add `app-daedlo` beside the application's PostgreSQL, API, Swagger and
staff portal services. Compose owns their startup and shutdown. Daedlo owns its
Chromium browser and model process, connects to the application over the Compose
network, and publishes its viewer on the developer's loopback interface.

This is an **unpublished source candidate**. The commands below build local
images; no registry image or customer acceptance is implied. Measured checks
belong in [verification](verification.md). The current public macOS kit and
native onboarding remain separate installation paths.

## Try the independent conformance stack

From this source checkout, with Docker Desktop or Docker Engine running:

```sh
docker compose -p daedlo-conformance -f container/compose.notebook.yaml up --build --wait
```

Open **http://127.0.0.1:43100**. The notebook is an independent engineering fixture
for checking the container, browser and evidence path. It is not a customer demo
or evidence for a customer application flow. Its application runs in `notebook-app`; the
Daedlo browser reaches it at `http://notebook-app:8080`. No QA command executes
automatically on startup.

The fixture app is also published at http://127.0.0.1:43101 for independent
inspection. Set `DAEDLO_VIEWER_PORT` and `DAEDLO_APP_PORT` before the Compose
command if these ports are occupied. The viewer's public Host is configured to
match that external port even though its container port stays `43100`.

For automated verification from a prepared source checkout, run
`npm run test:compose`. It builds an isolated project with temporary host ports,
checks the browser, persistence and service ownership, and cleans up only after
all checks and evidence export succeed. Its logs, screenshot, checkpoint report,
final shutdown report and `results.json` are retained under the printed
`artifacts/compose-*` directory. The focused
non-loopback fixture browser regression is `npm run test:compose:fixture`.

The automated harness and `scripts/compose-ci.mjs` check available disk space
before image builds. The default minimum is **15 GiB** on each filesystem holding
the source checkout, evidence output and Docker backing storage. CI checks again
before each reusable image build. Set `DAEDLO_COMPOSE_MIN_FREE_GIB` to an explicit
minimum of at least 1 GiB when a different budget has been justified. This checks
host filesystem availability; it does not reserve space, measure the remaining
capacity inside Docker Desktop's VM disk, or guarantee that a build fits.

Local Linux Engine storage is discovered from Docker. On macOS, the default
Docker Desktop `Docker.raw` location is checked. For a moved Docker disk,
Docker Desktop on Linux, or another local VM, set `DAEDLO_DOCKER_DISK_PATH` to
the actual existing host backing file or directory. Remote/unknown Docker
endpoints and unmeasurable storage block the build. The raw `docker build` and
`docker compose` commands in this guide do not invoke these automatic guards.

Each automated run gets a unique project and must use an empty evidence
directory (`DAEDLO_COMPOSE_OUTPUT` overrides the default). The host Playwright
module and its reported Chromium executable must exist before building. Build
output streams to `compose.log` instead of accumulating in memory. On success, the harness
stops its driver, exports reports and flushes the log and receipt, removes its own containers,
network and volume, then rechecks the two captured image IDs, project/service
labels and container references before removing only its own image tags. It
never runs a broad prune. Shared build cache, reusable CI runtime/SDK images,
other image aliases, earlier runs and unrelated projects are left alone.

Failed or interrupted runs retain their images, containers and evidence volume;
the harness attempts a graceful driver stop and evidence export while keeping
the fixture app's in-memory state running. Evidence-write or archive failures
prevent teardown. A teardown or image-removal failure can leave partial cleanup;
`results.json` records its phase, known/uncertain image removals and resource
identifiers to inspect. Retained resources require a separate cleanup decision.
SIGKILL, host shutdown and disk failure can still prevent a complete final
receipt, so the live volume and streamed log must not be assumed disposable.

```sh
# Stop only Daedlo; the application and its in-memory records remain running.
docker compose -p daedlo-conformance -f container/compose.notebook.yaml stop daedlo
docker compose -p daedlo-conformance -f container/compose.notebook.yaml cp daedlo:/evidence/session.json ./compose-session.json

# Start a fresh browser against the same application. Nothing is replayed.
docker compose -p daedlo-conformance -f container/compose.notebook.yaml start daedlo

# Remove this disposable conformance project, including its evidence volume.
# Copy any evidence you want to retain before this command.
docker compose -p daedlo-conformance -f container/compose.notebook.yaml down --volumes
```

`session.json` is the latest clean-shutdown session report, overwritten by a
later clean shutdown. It is not a durable per-run archive, complete browser
trace, or proof of persistence by itself. Use the application's existing
[evidence archiving](evidence-reporting.md) integration for retained run reports.
A forced kill can prevent the final report from being written. Compose permits
30 seconds for graceful shutdown; unresolved cleanup must be inspected rather
than treated as successful because the container stopped.

## Build a reusable runtime and matching model SDK

From the same explicit source revision:

```sh
docker build -f container/Dockerfile --target runtime -t daedlo-compose:local .
docker build -f container/Dockerfile --target model-sdk -t daedlo-model-sdk:local .
```

The runtime includes the locked Node dependencies, matching Chromium and browser
system libraries. It runs as the unprivileged `node` user. The SDK contains Rust
1.96.0 and the matching shared engine source. Build the application model for
Linux and the same image architecture. A macOS executable cannot be copied into
this Linux image. Both commands build for Docker's selected architecture; build
and verify additional platforms separately.

The application still supplies its accepted `project.mjs`, adapter, model,
authentication and evidence checks. Container packaging does not generate those
business rules. Keep that integration under `/opt/daedlo/project` so ESM imports
can resolve the image's `@daedlo/runtime`. A bind mount elsewhere needs its own
explicit dependency resolution.

For example, a project with an isolated `qa/engine` Cargo package can compile its
model into a derived image using a Dockerfile such as `qa/Dockerfile.daedlo`:

```dockerfile
FROM daedlo-model-sdk:local AS model
WORKDIR /work
COPY --from=daedlo-model-sdk:local /opt/daedlo-sdk /work/daedlo
COPY qa/engine /work/qa/engine
RUN cargo build --locked --release --manifest-path /work/qa/engine/Cargo.toml

FROM daedlo-compose:local
COPY --from=model /work/qa/engine/target/release/app-daedlo-engine /opt/daedlo/models/app-daedlo-engine
COPY qa/project.mjs qa/adapter.mjs /opt/daedlo/project/
ENV DAEDLO_ENGINE_PATH=/opt/daedlo/models/app-daedlo-engine
```

This example expects the model package to be named
`app-daedlo-engine`, its Cargo manifest to be its own workspace, and its
`daedlo-engine` dependency path to be `../../daedlo/crates/daedlo-engine`. Retain
its checked-in `Cargo.lock`. Adapt the copied files and output path to the
existing integration; additional adapter dependencies need a locked build step.
The project module must actually read `DAEDLO_ENGINE_PATH` and `DAEDLO_TARGET_URL`
and return its existing `enginePath`, `url` and `createAdapter` contract. These
variables do not manufacture an integration or override hardcoded project URLs.
Keep a restricted customer `.dockerignore` so credentials, caches and private
evidence never enter the build context.

## Add `app-daedlo` to the application's Compose file

The following fragment assumes the staff portal listens on container port `8080`
and already has a health check. Use the real internal port and health prerequisite
from the application's existing configuration:

```yaml
services:
  app-daedlo:
    build:
      context: .
      dockerfile: qa/Dockerfile.daedlo
    init: true
    shm_size: 1gb
    environment:
      DAEDLO_TARGET_URL: http://app-portal:8080
      DAEDLO_PUBLIC_ORIGIN: http://127.0.0.1:43100
    ports:
      - "127.0.0.1:43100:43100"
    volumes:
      - daedlo-evidence:/evidence
    depends_on:
      app-portal:
        condition: service_healthy
    stop_grace_period: 30s

volumes:
  daedlo-evidence:
```

Once the customer model and adapter are connected and verified, the normal
`docker compose up --build --wait` starts this service alongside the rest of the
development stack. Use service names and internal ports for application URLs.
Inside the Daedlo container, `localhost` identifies Daedlo itself. The application
must also provide browser-reachable URLs for API calls, assets and authentication
redirects; container service DNS alone does not repair browser URLs that still
point to a host-only endpoint. Existing auth origins and callback configuration
must be checked with the actual application.

An HTTP service-name URL such as `http://app-portal:8080` is not
a browser secure context. Customer features that require secure-context APIs
need the application's actual HTTPS or local-origin design and certificate
trust; container DNS does not provide those guarantees. The independent
notebook uses `crypto.getRandomValues` for its opaque operation identities so
its save/retry contract also works at an HTTP service-name origin. This fixture
adjustment does not change a customer's security requirements or disable
browser security.

These service-name URLs and health prerequisites follow Docker's
[Compose networking](https://docs.docker.com/compose/how-tos/networking/) and
[startup-order](https://docs.docker.com/compose/how-tos/startup-order/) contracts.

The generic Swagger integration can be supplied through a project session
factory, subject to its existing [compatibility contract](../integrations/swagger/README.md).
It requires the documented same-origin UI/schema/API arrangement. Merely placing
separate Swagger and API services on the same Docker network does not establish
that contract or enable arbitrary cross-origin requests.

## Network and lifecycle contract

- `DAEDLO_PORT` is the internal viewer port, default `43100`.
- `DAEDLO_PUBLIC_ORIGIN` is the exact loopback HTTP origin opened in the host
  browser. Change it together with the published host port. Open the configured
  hostname exactly; `localhost` and `127.0.0.1` are different origins.
- `DAEDLO_PROJECT` selects the trusted project module; the default is
  `/opt/daedlo/project/project.mjs`.
- `DAEDLO_REPORT` selects the clean-shutdown report path, default
  `/evidence/session.json`. The named volume is initialized with the image's
  non-root ownership; a host bind mount must be writable by container UID 1000.
- The entrypoint binds the viewer to the container interface and retains exact
  Host and same-Origin checks. Publish only on `127.0.0.1`; this local development
  viewer does not provide remote authentication. Host checking is not a firewall
  against another process or container that can deliberately supply that Host.
- The health check reads viewer readiness and sends no application commands.
  An HTTP listener with a disconnected driver is unhealthy.
- The service has no Docker socket mount or authority to stop sibling containers.
  The customer adapter must mark existing services as attached and keep cleanup
  scoped to resources it created. `docker compose stop app-daedlo`
  preserves the sibling application services. `docker compose down` is a
  developer request to stop the full Compose project.

Chromium is used for trusted local development applications. The non-root image
does not by itself establish Chromium sandboxing or isolation from untrusted
pages. No agent host or model API key runs inside this service; already authored
flows use the same runtime and model execution contract.
