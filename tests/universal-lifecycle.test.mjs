import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeV1 } from "./fixtures/storage-r3/materialize.mjs";
import {
  upgradeCatalog,
  openCatalog,
} from "../packages/universal/src/catalog.mjs";
import { universalCommand } from "../packages/universal/src/cli.mjs";

test(
  "Universal retains its listener and exact evidence handle until explicit cleanup retry succeeds",
  { timeout: 20000 },
  async (t) => {
    const base = await fs.realpath(
      await fs.mkdtemp(join(tmpdir(), "universal-lifecycle-")),
    );
    let handle,
      patched,
      injected = true;
    t.after(async () => {
      injected = false;
      patched?.mock.restore();
      await handle?.close();
      await fs.rm(base, { recursive: true, force: true });
    });
    const fixture = await materializeV1(base);
    await upgradeCatalog({ root: fixture.root });
    const journalBefore = await fs.readFile(fixture.journalPath);
    handle = await universalCommand(["serve", "--workspace", fixture.root]);
    const address = new URL(handle.result.url);
    const authorization = `Bearer ${new URLSearchParams(address.hash.slice(1)).get("token")}`;
    const open = fs.open;
    let retainedHandle,
      closes = 0,
      complete = false;
    handle.closed.then(() => {
      complete = true;
    });
    patched = mock.method(fs, "open", async (...args) => {
      const file = await open(...args);
      if (String(args[0]).endsWith(".bin.tmp")) {
        assert.equal(
          retainedHandle,
          undefined,
          "One owned evidence publication is injected",
        );
        retainedHandle = file;
        const close = file.close.bind(file);
        file.close = async () => {
          closes++;
          if (injected)
            throw Object.assign(Error("Injected owned file close failure"), {
              code: "EIO",
            });
          return close();
        };
      }
      return file;
    });
    const upload = await fetch(
      `${address.origin}/api/targets/${fixture.current.id}/evidence`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          Origin: address.origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          revision: 2,
          runId: fixture.retained.run.runId,
          label: "Cleanup regression evidence",
          mediaType: "text/plain",
          base64: Buffer.from("Independent retained evidence\n").toString(
            "base64",
          ),
        }),
      },
    );
    const response = await upload.json();
    assert.equal(response.error?.code, "evidence_uncommitted");
    assert.ok(retainedHandle && retainedHandle.fd >= 0);
    const pendingPath = join(
      fixture.root,
      "evidence",
      fixture.current.id,
      `.${response.error.evidenceId}.bin.tmp`,
    );
    const retainedBytes = await fs.readFile(pendingPath);
    await assert.rejects(handle.close(), {
      code: "evidence_cleanup_incomplete",
    });
    assert.equal(
      complete,
      false,
      "A failed cleanup is not acknowledged as completed shutdown",
    );
    assert.ok(
      retainedHandle.fd >= 0,
      "The exact failed-close handle remains owned",
    );
    let status;
    try {
      const quiesced = await fetch(`${address.origin}/api/targets`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(2000),
      });
      status = quiesced.status;
      await quiesced.arrayBuffer();
    } catch {
      status = "listener unavailable";
    }
    assert.equal(
      status,
      409,
      "The quiesced listener must retain a live shutdown-retry path instead of disappearing after failed file cleanup",
    );
    assert.deepEqual(await fs.readFile(pendingPath), retainedBytes);
    assert.deepEqual(await fs.readFile(fixture.journalPath), journalBefore);
    const catalog = await openCatalog({ root: fixture.root });
    try {
      assert.equal(
        (await catalog.listEvidence({ targetId: fixture.current.id })).items
          .length,
        0,
      );
    } finally {
      await catalog.close();
    }
    injected = false;
    await handle.close();
    await handle.closed;
    assert.equal(complete, true);
    assert.equal(
      retainedHandle.fd,
      -1,
      "Explicit shutdown retry closes the retained file descriptor",
    );
    assert.equal(closes, 3);
    assert.deepEqual(await fs.readFile(pendingPath), retainedBytes);
    assert.deepEqual(await fs.readFile(fixture.journalPath), journalBefore);
  },
);
