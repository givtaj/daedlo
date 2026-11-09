import assert from "node:assert/strict";
import test from "node:test";
import {
  closeUpgradeManagers,
  assertAuthoredDependencyMigration,
} from "./alpha4-upgrade-helpers.mjs";

test("upgrade cleanup closes the replacement before inspecting old handles sharing its store", async () => {
  let replacementRunning = true;
  const calls = [];
  const managers = [
    {
      closed: true,
      manager: {
        close: async () =>
          assert.fail("Already closed old manager must not be reopened"),
      },
      supervisor: {
        status: async () => {
          calls.push("old status");
          return { running: null, cleanupPending: replacementRunning };
        },
      },
    },
    {
      closed: false,
      manager: {
        close: async () => {
          calls.push("close replacement");
          replacementRunning = false;
        },
      },
      supervisor: {
        status: async () => {
          calls.push("replacement status");
          return { running: null, cleanupPending: replacementRunning };
        },
      },
    },
  ];
  const result = await closeUpgradeManagers(managers);
  assert.equal(
    result.driverClosed,
    true,
    "An old observer must not mistake the still-running replacement for failed cleanup",
  );
  assert.equal(calls[0], "close replacement");
  assert.deepEqual(
    result.cleanup.map(({ status }) => status),
    ["closed", "closed"],
  );
});

test("upgrade cleanup attempts every owned close and preserves a failed handle", async () => {
  const calls = [];
  const managers = [0, 1].map((index) => ({
    closed: false,
    manager: {
      close: async () => {
        calls.push(index);
        if (index === 1) throw Error("owned child remains");
      },
    },
    supervisor: {
      status: async () => ({
        running: index === 1 ? { id: "retained" } : null,
        cleanupPending: index === 1,
      }),
    },
  }));
  const result = await closeUpgradeManagers(managers);
  assert.deepEqual(calls, [1, 0]);
  assert.equal(result.driverClosed, false);
  assert.equal(managers[1].closed, false);
  assert.deepEqual(
    result.cleanup.map(({ status }) => status),
    ["closed", "incomplete"],
  );
});

const source = () => ({
  sha256: "before",
  registrationSha256: "same registration",
  files: ["adapter.mjs", "package-lock.json", "package.json"].map((file) => ({
    file,
    bytes: 1,
    mode: 0o600,
    sha256: "before " + file,
  })),
});
function migrated() {
  const value = source();
  value.sha256 = "after";
  for (const file of value.files)
    if (file.file.startsWith("package")) {
      file.bytes = 2;
      file.sha256 = "after " + file.file;
    }
  return value;
}
test("authored dependency migration records exactly the two reviewed file identities", () => {
  const result = assertAuthoredDependencyMigration(source(), migrated());
  assert.deepEqual(
    result.map(({ file }) => file),
    ["package-lock.json", "package.json"],
  );
  for (const record of result) {
    assert.equal(record.before.sha256, "before " + record.file);
    assert.equal(record.after.sha256, "after " + record.file);
  }
});
for (const [name, edit] of [
  [
    "adapter bytes",
    (value) => {
      value.files[0].sha256 = "changed";
    },
  ],
  [
    "registration",
    (value) => {
      value.registrationSha256 = "changed";
    },
  ],
  [
    "added source",
    (value) => {
      value.files.push({ file: "new.mjs" });
    },
  ],
  [
    "removed source",
    (value) => {
      value.files.shift();
    },
  ],
  [
    "manifest permissions",
    (value) => {
      value.files[2].mode = 0o777;
    },
  ],
  [
    "unmigrated lock",
    (value) => {
      value.files[1] = source().files[1];
    },
  ],
])
  test(`authored dependency migration refuses ${name}`, () => {
    const value = migrated();
    edit(value);
    assert.throws(() => assertAuthoredDependencyMigration(source(), value), {
      code: "ERR_ASSERTION",
    });
  });
