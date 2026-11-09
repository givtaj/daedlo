import assert from "node:assert/strict";

export async function closeUpgradeManagers(managers) {
  const cleanup = [];
  const closeErrors = new Map();
  let driverClosed = true;
  // All observers share one store. Close current replacements before examining
  // old observer handles, whose status otherwise sees the live replacement.
  for (const [index, value] of [...managers.entries()].reverse()) {
    try {
      if (!value.closed) await value.manager.close();
    } catch (error) {
      closeErrors.set(index, error);
    }
  }
  for (const [index, value] of managers.entries()) {
    try {
      if (closeErrors.has(index)) throw closeErrors.get(index);
      const status = await value.supervisor.status();
      assert.equal(status.running, null);
      assert.equal(status.cleanupPending, false);
      value.closed = true;
      cleanup.push({
        resource: "managed driver",
        instance: index + 1,
        status: "closed",
      });
    } catch (error) {
      driverClosed = false;
      cleanup.push({
        resource: "managed driver",
        instance: index + 1,
        status: "incomplete",
        error: error.message,
      });
    }
  }
  return { cleanup, driverClosed };
}

export function assertAuthoredDependencyMigration(before, after) {
  assert.equal(
    after.registrationSha256,
    before.registrationSha256,
    "Dependency migration must preserve the registration",
  );
  assert.deepEqual(
    after.files.map(({ file }) => file),
    before.files.map(({ file }) => file),
    "Dependency migration must preserve the exact source allowlist",
  );
  const changes = [];
  for (let index = 0; index < before.files.length; index++) {
    const original = before.files[index],
      current = after.files[index];
    if (["package.json", "package-lock.json"].includes(original.file)) {
      assert.equal(
        current.mode,
        original.mode,
        "Dependency migration must preserve file permissions",
      );
      assert.notEqual(
        current.sha256,
        original.sha256,
        "Both reviewed dependency files must be migrated",
      );
      changes.push({ file: original.file, before: original, after: current });
    } else
      assert.deepEqual(
        current,
        original,
        "Dependency migration must preserve all other authored files",
      );
  }
  assert.equal(
    changes.length,
    2,
    "Only the complete package manifest/lock pair may migrate",
  );
  return changes;
}
