# Managed native starter

This portable reference reuses the adjacent independent starter's Rust model,
browser adapter and disposable application. It adds a complete registration,
managed launcher, separate model preflight, private application policy and
acceptance/health hooks. Read [managed integration](../../docs/managed-integration.md)
and [evidence reporting](../../docs/evidence-reporting.md) before adapting it.
It is synthetic acceptance; no customer catalog or application is included.

## Prepare a fresh integration

Use the selected, verified tools package and engine crate. Keep its adjacent
`examples/starter/` directory: the preparer reuses those exact files. The tools
archive also contains the pinned publisher public key. Use Node, npm, Rust/Cargo
and the selected runtime's matching Playwright Chromium as described in
[native setup](../../docs/native-setup.md). The preparer defaults to offline lock
generation; missing cached Rust dependencies fail explicitly.

In one persistent terminal, start the separately owned synthetic application:

```sh
node /absolute/tools/node_modules/@daedlo/release-tools/examples/managed-starter/serve-fixture.mjs
```

Use the exact printed `origin` in another terminal. Choose a new ignored output
directory whose parent already exists; the preparer refuses an existing output.

```sh
node /absolute/tools/node_modules/@daedlo/release-tools/examples/managed-starter/prepare.mjs \
  --output /absolute/project/.daedlo-local/managed-starter \
  --crate /absolute/extracted/daedlo-engine \
  --origin http://127.0.0.1:PRINTED_PORT \
  --trust /absolute/tools/node_modules/@daedlo/release-tools/docs/update-trust/daedlo-release-2026-10.pem
```

The selected starter pins the shared engine version; a different crate version
fails instead of silently upgrading. The output contains `project/` with the
registration's complete source closure and standalone locks, `ninja.json`, and
`private-policy.json`. The manager creates its own disjoint `store/`. Local
settings and private policy stay outside the registered source. Inspect the
generated configuration and verify its production publisher pin against the
selected kit receipt. `--catalog-url HTTPS_URL` changes only the feed location;
the exported `prepareManagedStarter` accepts explicit publisher/key IDs as well.

The normal configuration attaches to an exact HTTP `127.0.0.1` origin and owns a
fresh headless browser. `settings.headless: false` selects a headed browser from
startup. The example has no customer authentication/profile handling. Keep the
application terminal running while using native Daedlo.

## Install and run

Run the selected tools' native entrypoint with the returned absolute config path:

```sh
node /absolute/tools/node_modules/@daedlo/release-tools/lib/native.mjs doctor --config /absolute/project/.daedlo-local/managed-starter/ninja.json
node /absolute/tools/node_modules/@daedlo/release-tools/lib/native.mjs setup --config /absolute/project/.daedlo-local/managed-starter/ninja.json --version REVIEWED_VERSION
node /absolute/tools/node_modules/@daedlo/release-tools/lib/native.mjs start --config /absolute/project/.daedlo-local/managed-starter/ninja.json
```

Use the exact reviewed version from the authenticated catalog/kit receipt.
Setup runs the registered model preflight, disposable acceptance and health
checks. `installation.offline` defaults to true; select false explicitly if
dependency acquisition is needed. npm lifecycle scripts remain disabled.

Open the exact `startupUrl`, then the ready `viewerUrl`. Edit and Save through
the viewer. A save becomes `saved` only after the starter adapter matches its
operation-scoped independent readback. A lost response can leave a real write
`uncertain`; restarting does not replay it. Native archives each completed run
under the private store. Use `status --config FILE` to reconnect and
`stop --config FILE` to close the owned driver. A dirty or unknown draft blocks
safe stop; discard the synthetic draft deliberately before stopping. The
application terminal and its records survive native stop. Closing that terminal
ends this disposable fixture and removes its in-memory records.

For two independent frontends, prepare two output directories/configurations and
use separate stores, project IDs and frontend names. The exported preparer accepts
`projectId` and `frontendName`; default values are intended for one reference.
Stopping one configured frontend must leave the other running.

## Run acceptance

From reviewed source, run `npm run test:managed-starter`. It creates fresh evidence
under ignored `artifacts/`; set `DAEDLO_MANAGED_OUTPUT` to choose another fresh
absolute output. The runner uses the real native owner/session and browser, with
a seeded source-mode installation receipt. Check `result.json` and inspect the
screenshots. The focused policy regression is
`node --test tests/managed-starter-adapter.test.mjs`.

Release verification invokes the same exported runner with exact installed paths:

```js
import { runManagedStarterAcceptance } from "/absolute/source/tests/managed-starter-acceptance.mjs";
await runManagedStarterAcceptance({
  output: "/absolute/fresh-private-evidence",
  toolsRoot: "/absolute/installed-tools/lib",
  runtimePath: "/absolute/installed-runtime/src/index.mjs",
  engineCrate: "/absolute/extracted/daedlo-engine",
  exampleRoot: "/absolute/installed-tools/examples/managed-starter",
  bundle: "/absolute/verified-kit-bundle",
  expectedManifestSha256: "VERIFIED_MANIFEST_SHA256",
});
```

The harness lives in reviewed source; managed source, hooks, native tools and
runtime come from the supplied installed artifacts. Bundle mode performs actual
managed installation and receipt verification. Supply a bundle already verified
with its selected kit tooling; the harness is acceptance code, not a substitute
for signed release verification. This fixture does not establish a customer's
native registration or upgrade/rollback acceptance.
