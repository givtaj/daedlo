import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createManagedLaunch } from "../examples/managed-starter/managed-launch.mjs";
import { createStarterFixture } from "../examples/starter/fixture.mjs";
import * as runtime from "../packages/runtime/src/index.mjs";
import { buildStarterModel } from "../examples/starter/build-model.mjs";

test("the managed starter requires current, independent recovery evidence from its owned editor", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "daedlo-starter-recovery-"));
  const resources = runtime.createResourceScope();
  let fixture;
  t.after(async () => {
    try {
      await resources.close();
    } finally {
      await fixture?.close();
    }
    await rm(root, { recursive: true, force: true });
  });
  fixture = await createStarterFixture();
  const privateCatalogFile = join(root, "policy.json");
  await writeFile(
    privateCatalogFile,
    JSON.stringify({
      schemaVersion: 1,
      allowedCommands: ["edit", "save", "discard"],
      privateNote: "",
    }),
  );
  const { enginePath } = await buildStarterModel({
    output: join(root, "build"),
    offline: true,
  });
  let page, adapter;
  const handle = await createManagedLaunch({
    enginePath,
    runtime: {
      ...runtime,
      createDriverSession(options) {
        ({ page, adapter } = options);
        return runtime.createDriverSession(options);
      },
    },
    installation: {
      runtimePath: fileURLToPath(
        new URL("../packages/runtime/src/index.mjs", import.meta.url),
      ),
    },
    resources,
    settings: { origin: fixture.url, privateCatalogFile },
  });
  const safety = () => handle.draftState().catch(() => null);
  assert.equal((await handle.session.snapshot()).connected, true);
  assert.equal(await safety(), false, "the fresh editor is clean");
  for (const phase of ["unrecognized", null]) {
    await page.evaluate((phase) => {
      if (phase === null) delete document.body.dataset.phase;
      else document.body.dataset.phase = phase;
    }, phase);
    const rejected = await handle.session.snapshot();
    assert.equal(rejected.connected, false);
    assert.equal(
      rejected.error_code,
      "invalid_observation",
      "the real Rust starter rejects this phase",
    );
    assert.equal(
      await safety(),
      null,
      "an unrecognized or missing phase cannot authorize cleanup",
    );
  }
  await page.evaluate(() => {
    document.body.dataset.phase = "ready";
  });
  adapter.observe = () => {
    throw new Error("synthetic model observer unavailable");
  };
  const disconnected = await handle.session.snapshot();
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.error_code, "observation_failed");
  assert.equal(
    await safety(),
    false,
    "independent evidence survives model observation failure",
  );
  await page.getByLabel("Note", { exact: true }).fill("Unsaved fixture note");
  assert.equal(await safety(), true);
  await page.getByRole("button", { name: "Discard draft" }).click();
  assert.equal(await safety(), false);
  for (const journal of [null, "{", "{}"]) {
    await page.evaluate((value) => {
      const key = "daedlo-starter-pending-saves";
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    }, journal);
    assert.equal(
      await safety(),
      null,
      "missing or malformed journal evidence is unknown",
    );
  }
  await page.evaluate(() =>
    sessionStorage.setItem("daedlo-starter-pending-saves", "[]"),
  );

  const held = fixture.barrier("private");
  try {
    await page.evaluate(() => {
      window.fixtureRequest = fetch("/hold/private");
    });
    await held.arrived;
    assert.notEqual(
      await safety(),
      false,
      "a live owned request prevents cleanup",
    );
  } finally {
    held.release();
  }
  await page.evaluate(() => window.fixtureRequest.then((r) => r.json()));
  await adapter.settle();
  assert.equal(await safety(), false);

  await page.evaluate(() => {
    window.fixtureLease = navigator.locks.request(
      "starter-note-save",
      () =>
        new Promise((resolve) => {
          window.releaseFixtureLease = resolve;
        }),
    );
  });
  await page.waitForFunction(
    () => typeof window.releaseFixtureLease === "function",
  );
  assert.notEqual(
    await safety(),
    false,
    "a held application save lease prevents cleanup without a draft or request",
  );
  await page.evaluate(() => {
    window.releaseFixtureLease();
    return window.fixtureLease;
  });
  assert.equal(await safety(), false);

  const readback = "**/api/notes?operation=*";
  await page.route(readback, (route) => route.fulfill({ json: { items: [] } }));
  await page
    .getByLabel("Note", { exact: true })
    .fill("Verify the actual record");
  await page.getByRole("button", { name: "Save note" }).click();
  await adapter.settle();
  assert.notEqual(
    await safety(),
    false,
    "a matching HTTP acknowledgement with missing independent readback leaves the effect unresolved",
  );
  await page.unroute(readback);
  // The operator explicitly retries the same operation in this disposable fixture.
  await page.getByRole("button", { name: "Save note" }).click();
  await adapter.settle();
  assert.equal(
    await safety(),
    false,
    "an acknowledged and independently verified save is clean",
  );
  assert.equal(
    fixture.writes,
    1,
    "the explicit retry reuses the original operation",
  );
  await page.evaluate(() => {
    document.getElementById("note").value = "Edited outside the model";
  });
  assert.equal(
    await safety(),
    true,
    "changing a saved field leaves a draft even when the phase still says saved",
  );
  await page.route("**/api/notes", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByLabel("Note", { exact: true }).fill("Lost response");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.waitForFunction(() => document.body.dataset.phase === "recovery");
  await page.getByRole("button", { name: "Discard draft" }).click();
  await adapter.settle();
  assert.equal(fixture.writes, 2);
  assert.equal(
    await safety(),
    false,
    "fresh operation-scoped readback can reconcile a lost response after the draft is discarded",
  );
  assert.equal(fixture.writes, 2, "recovery never replays a save");
  const { items } = await fetch(fixture.url + "/api/notes").then((response) =>
    response.json(),
  );
  const stored = items.find((row) => row.text === "Lost response");
  assert.ok(stored);
  for (const conflict of [
    [stored, stored],
    [{ ...stored, category: "work" }],
  ]) {
    const read = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ items: conflict }),
    );
    try {
      assert.equal(
        await safety(),
        null,
        "duplicate or conflicting storage cannot reconcile an intent",
      );
    } finally {
      read.mock.restore();
    }
  }
  await page.unroute("**/api/notes");
  await page.route("**/api/notes", (route) => route.abort("failed"));
  await page
    .getByLabel("Note", { exact: true })
    .fill("Dispatched without commit");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.waitForFunction(() => document.body.dataset.phase === "recovery");
  await page.getByRole("button", { name: "Discard draft" }).click();
  await adapter.settle();
  assert.equal(
    await safety(),
    null,
    "discarding the visible form keeps a pending write without matching storage unresolved",
  );
  assert.equal(fixture.writes, 2);
  const journalKey = "daedlo-starter-pending-saves";
  const original = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    journalKey,
  );
  await page.evaluate((key) => sessionStorage.setItem(key, "[]"), journalKey);
  assert.equal(
    await safety(),
    null,
    "an earlier empty journal cannot overwrite evidence held by this owner",
  );
  await page.evaluate(
    ({ key, original }) => sessionStorage.setItem(key, original),
    { key: journalKey, original },
  );
  await page.reload();
  await page.locator("#note").waitFor();
  assert.notEqual(
    await safety(),
    false,
    "a replacement document cannot establish the earlier owner's safety",
  );
});
