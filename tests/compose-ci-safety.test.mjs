import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_MIN_FREE_GIB,
  assertComposeDiskSpace,
  assertFreshComposeImages,
  captureComposeImages,
  removeComposeImages,
} from "../scripts/compose-ci-safety.mjs";

const GiB = 1024n ** 3n;
const project = "daedlo-conformance-00000000-0000-4000-8000-000000000001";
const services = ["notebook-app", "daedlo"];
const identities = services.map((service, index) => ({
  service,
  tag: `${project}-${service}:latest`,
  id: `sha256:${String(index + 1).repeat(64)}`,
}));
const inspected = (identity, extra = {}) => ({
  Id: identity.id,
  RepoTags: [identity.tag],
  Config: {
    Labels: {
      "io.daedlo.compose.project": project,
      "io.daedlo.compose.service": identity.service,
    },
  },
  ...extra,
});

function diskFixture(overrides = {}) {
  const calls = [];
  const stats = [];
  const options = {
    cwd: "/source",
    output: "/evidence",
    env: {},
    platform: "linux",
    home: "/fixture-home",
    async resolvePath(path) {
      return path;
    },
    async stat(path, options) {
      stats.push([path, options]);
      return { bavail: 20n * GiB, bsize: 1n, bfree: 100n * GiB };
    },
    async run(command, args) {
      calls.push([command, args]);
      if (args[0] === "context") return "unix:///var/run/docker.sock\n";
      if (args.includes("{{.OperatingSystem}}"))
        return options.platform === "darwin"
          ? "Docker Desktop\n"
          : "Ubuntu 24.04 LTS\n";
      if (args[0] === "info") return "/var/lib/docker\n";
      throw Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
    ...overrides,
  };
  return { options, calls, stats };
}

test("disk guard checks source, evidence and local Linux Docker storage using available blocks", async () => {
  const fixture = diskFixture();
  const receipt = await assertComposeDiskSpace(fixture.options);
  assert.equal(DEFAULT_MIN_FREE_GIB, 15);
  assert.equal(receipt.minimumFreeBytes, String(15n * GiB));
  assert.equal(receipt.dockerEndpoint, "unix:///var/run/docker.sock");
  assert.deepEqual(
    new Set(fixture.stats.map(([path]) => path)),
    new Set(["/source", "/evidence", "/var/lib/docker"]),
  );
  assert.ok(fixture.stats.every(([, options]) => options.bigint === true));
  assert.doesNotThrow(() => JSON.stringify(receipt));
  assert.ok(
    fixture.calls.every(([, args]) => ["context", "info"].includes(args[0])),
  );
});

test("low available space blocks despite large bfree; threshold equality passes", async () => {
  for (const free of [0n, 15n * GiB - 1n]) {
    const fixture = diskFixture({
      stat: async () => ({ bavail: free, bsize: 1n, bfree: 100n * GiB }),
    });
    await assert.rejects(
      assertComposeDiskSpace(fixture.options),
      /free disk space/i,
    );
  }
  await assertComposeDiskSpace(
    diskFixture({
      stat: async () => ({ bavail: 15n * GiB, bsize: 1n }),
    }).options,
  );
  await assertComposeDiskSpace(
    diskFixture({
      stat: async () => ({ bavail: (15n * GiB) / 4096n, bsize: 4096n }),
    }).options,
  );
  await assert.rejects(
    assertComposeDiskSpace(
      diskFixture({
        stat: async (path) => ({
          bavail: path === "/var/lib/docker" ? 1n : 20n * GiB,
          bsize: 1n,
        }),
      }).options,
    ),
    /for docker/,
  );
});

test("threshold configuration rejects invalid or sub-one-GiB values without Docker commands", async () => {
  for (const value of [
    "0",
    "0.9",
    "-1",
    "NaN",
    "Infinity",
    "",
    "15garbage",
    "1e300",
  ]) {
    const fixture = diskFixture({
      env: { DAEDLO_COMPOSE_MIN_FREE_GIB: value },
    });
    await assert.rejects(
      assertComposeDiskSpace(fixture.options),
      /MIN_FREE_GIB/,
    );
    assert.equal(fixture.calls.length, 0);
  }
  const receipt = await assertComposeDiskSpace(
    diskFixture({
      env: { DAEDLO_COMPOSE_MIN_FREE_GIB: "1.5" },
    }).options,
  );
  assert.equal(receipt.minimumFreeBytes, String((3n * GiB) / 2n));
});

test("Docker context overrides DOCKER_HOST and remote endpoints fail closed", async () => {
  const fixture = diskFixture({
    env: { DOCKER_CONTEXT: "local-test", DOCKER_HOST: "ssh://remote" },
  });
  await assertComposeDiskSpace(fixture.options);
  assert.ok(fixture.calls[0][1].includes("local-test"));
  for (const endpoint of [
    "ssh://remote",
    "tcp://127.0.0.1:2375",
    "",
    "unix://relative",
  ]) {
    const candidate = diskFixture({
      env: { DOCKER_HOST: endpoint },
      run: async () => endpoint,
    });
    await assert.rejects(
      assertComposeDiskSpace(candidate.options),
      /local Docker endpoint/i,
    );
    assert.equal(candidate.stats.length, 0);
  }
});

test("explicit Docker storage overrides defaults; macOS checks Docker.raw's actual filesystem", async () => {
  const mac = diskFixture({ platform: "darwin", home: "/fixture-home" });
  const receipt = await assertComposeDiskSpace(mac.options);
  assert.ok(
    mac.stats.some(
      ([path]) =>
        path ===
        "/fixture-home/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw",
    ),
  );
  assert.match(receipt.scope, /host.*not.*virtual/i);
  const custom = diskFixture({
    platform: "darwin",
    env: {
      DOCKER_HOST: "unix:///local.sock",
      DAEDLO_DOCKER_DISK_PATH: "/Volumes/build/Docker.raw",
    },
    run: () => {
      throw Error(
        "No Docker inspection needed for explicit local endpoint and storage",
      );
    },
  });
  await assertComposeDiskSpace(custom.options);
  assert.ok(
    custom.stats.some(([path]) => path === "/Volumes/build/Docker.raw"),
  );
  await assert.rejects(
    assertComposeDiskSpace(
      diskFixture({
        platform: "darwin",
        run: (_command, args) =>
          args[0] === "context" ? "unix:///local.sock" : "Colima",
      }).options,
    ),
    /Unknown macOS Docker backing storage/,
  );
});

test("Linux Docker Desktop cannot treat a guest DockerRootDir as host storage", async () => {
  const calls = [];
  const desktop = diskFixture({
    run: (_command, args) => {
      calls.push(args);
      if (args[0] === "context")
        return "unix:///fixture-home/.docker/desktop/docker.sock";
      if (args.includes("{{.OperatingSystem}}")) return "Docker Desktop";
      if (args.includes("{{.DockerRootDir}}")) return "/var/lib/docker";
      throw Error("Unexpected command");
    },
  });
  await assert.rejects(
    assertComposeDiskSpace(desktop.options),
    /Docker Desktop.*DAEDLO_DOCKER_DISK_PATH/,
  );
  assert.equal(
    desktop.stats.length,
    0,
    "even an accessible host /var/lib/docker cannot establish VM backing storage",
  );
  assert.equal(
    calls.some((args) => args.includes("{{.DockerRootDir}}")),
    false,
  );

  const explicit = diskFixture({
    env: {
      DOCKER_HOST: "unix:///fixture-home/.docker/desktop/docker.sock",
      DAEDLO_DOCKER_DISK_PATH: "/mnt/docker-desktop/Docker.raw",
    },
    run: () => {
      throw Error(
        "Explicit local storage must not be replaced with the guest root",
      );
    },
  });
  await assertComposeDiskSpace(explicit.options);
  assert.ok(
    explicit.stats.some(([path]) => path === "/mnt/docker-desktop/Docker.raw"),
  );
  assert.equal(
    explicit.stats.some(([path]) => path === "/var/lib/docker"),
    false,
  );
});

test("missing, unreadable or invalid filesystem metadata cannot pass", async () => {
  for (const overrides of [
    {
      resolvePath: async () => {
        throw Error("ENOENT");
      },
    },
    {
      stat: async () => {
        throw Error("EACCES");
      },
    },
    { stat: async () => ({ bavail: -1n, bsize: 4096n }) },
    { stat: async () => ({ bavail: 100n, bsize: 0n }) },
    { stat: async () => ({ bavail: NaN, bsize: 4096 }) },
    { platform: "unknown" },
    {
      run: async (_command, args) =>
        args[0] === "context" ? "unix:///local.sock" : "",
    },
  ]) {
    await assert.rejects(
      assertComposeDiskSpace(diskFixture(overrides).options),
    );
  }
});

function imageFixture({
  inspect = inspected,
  references = () => "",
  onRemove,
} = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, args]);
    if (args[0] === "image" && args[1] === "inspect") {
      const identity = identities.find((entry) => entry.tag === args[2]);
      assert.ok(identity);
      return JSON.stringify(inspect(identity, calls));
    }
    if (args[0] === "ps") return references(args, calls);
    if (args[0] === "image" && args[1] === "rm") {
      onRemove?.(args, calls);
      return "Untagged\n";
    }
    throw Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };
  return {
    run,
    calls,
    removals: () => calls.filter(([, args]) => args[1] === "rm"),
  };
}

test("fixture explicitly labels both built images with the selected project and service", async () => {
  const compose = await readFile(
    new URL("../container/compose.notebook.yaml", import.meta.url),
    "utf8",
  );
  const builds = new Map(
    [
      ...compose.matchAll(/^  ([a-z-]+):\n    build:\n((?: {6}[^\n]*\n)+)/gm),
    ].map(([, service, build]) => [service, build]),
  );
  assert.deepEqual([...builds.keys()].sort(), [...services].sort());
  for (const service of services) {
    const labels = builds
      .get(service)
      .match(/^      labels:\n((?: {8}[^\n]*\n)+)/m)?.[1];
    assert.ok(labels, `${service} must declare image build labels explicitly`);
    assert.match(
      labels,
      /^        io\.daedlo\.compose\.project: \$\{COMPOSE_PROJECT_NAME:\?[^}\n]+\}$/m,
      "ownership must use Compose's selected project, failing if unavailable",
    );
    assert.match(
      labels,
      new RegExp(`^        io\\.daedlo\\.compose\\.service: ${service}$`, "m"),
    );
  }
});

test("cleanup cannot trust missing or implicit Compose labels as owned image proof", async () => {
  for (const labels of [
    () => null,
    () => ({}),
    () => ({ "io.daedlo.compose.project": project }),
    (identity) => ({ "io.daedlo.compose.service": identity.service }),
    (identity) => ({
      "com.docker.compose.project": project,
      "com.docker.compose.service": identity.service,
    }),
  ]) {
    const fixture = imageFixture({
      inspect: (identity) =>
        inspected(identity, { Config: { Labels: labels(identity) } }),
    });
    await assert.rejects(
      captureComposeImages({ project, run: fixture.run }),
      /ownership could not be verified/,
    );
    await assert.rejects(
      removeComposeImages({ project, images: identities, run: fixture.run }),
      /ownership could not be verified/,
    );
    assert.equal(fixture.removals().length, 0);
  }
});

test("freshness rejects an existing exact prospective tag, not a similarly named run", async () => {
  const rows = [
    { Repository: "other-run-daedlo", Tag: "latest" },
    { Repository: `${project}-daedlo-extra`, Tag: "latest" },
  ];
  const run = (_command, args) => {
    assert.deepEqual(args.slice(0, 2), ["image", "ls"]);
    return rows.map((row) => JSON.stringify(row)).join("\n");
  };
  await assertFreshComposeImages({ project, run });
  rows.push({ Repository: `${project}-daedlo`, Tag: "latest" });
  await assert.rejects(
    assertFreshComposeImages({ project, run }),
    /already exists/i,
  );
  await assert.rejects(
    assertFreshComposeImages({ project, run: () => "not json" }),
  );
  await assert.rejects(assertFreshComposeImages({ project: "unrelated", run }));
});

test("capture requires the exact tag and Compose project/service ownership", async () => {
  assert.deepEqual(
    await captureComposeImages({ project, run: imageFixture().run }),
    identities,
  );
  for (const alter of [
    (row) => ({ ...row, Id: "bad-id" }),
    (row) => ({ ...row, RepoTags: ["foreign:latest"] }),
    (row) => ({ ...row, Config: { Labels: {} } }),
    (row) => ({
      ...row,
      Config: {
        Labels: {
          ...row.Config.Labels,
          "io.daedlo.compose.project": "foreign",
        },
      },
    }),
    (row) => ({
      ...row,
      Config: {
        Labels: {
          ...row.Config.Labels,
          "io.daedlo.compose.service": "foreign",
        },
      },
    }),
  ]) {
    const fixture = imageFixture({
      inspect: (entry) => alter(inspected(entry)),
    });
    await assert.rejects(captureComposeImages({ project, run: fixture.run }));
  }
});

test("cleanup validates both images and all container references before any removal", async () => {
  for (const fixture of [
    imageFixture({
      inspect: (entry) =>
        inspected(
          entry,
          entry.service === "daedlo" ? { Id: `sha256:${"f".repeat(64)}` } : {},
        ),
    }),
    imageFixture({
      references: (args) =>
        args.some((arg) => arg.includes(identities[1].id))
          ? "stopped-container-id\n"
          : "",
    }),
  ]) {
    await assert.rejects(
      removeComposeImages({ project, images: identities, run: fixture.run }),
      (error) => {
        assert.deepEqual(error.removedImages, []);
        return true;
      },
    );
    assert.equal(fixture.removals().length, 0);
  }
});

test("successful cleanup removes only run tags and preserves aliases without force or parent pruning", async () => {
  const fixture = imageFixture({
    inspect: (entry) =>
      inspected(entry, { RepoTags: [entry.tag, "keep:baseline"] }),
  });
  assert.deepEqual(
    await removeComposeImages({
      project,
      images: identities,
      run: fixture.run,
    }),
    identities,
  );
  assert.deepEqual(
    fixture.removals().map(([, args]) => args),
    identities.map(({ tag }) => ["image", "rm", "--no-prune", tag]),
  );
  assert.ok(
    fixture.calls.every(
      ([, args]) => !args.includes("--force") && !args.includes("prune"),
    ),
  );
});

test("interruption before or during validation prevents removal", async () => {
  for (const shouldRetain of [
    () => true,
    (() => {
      let n = 0;
      return () => ++n > 2;
    })(),
  ]) {
    const fixture = imageFixture();
    await assert.rejects(
      removeComposeImages({
        project,
        images: identities,
        run: fixture.run,
        shouldRetain,
      }),
      (error) => {
        assert.deepEqual(error.removedImages, []);
        return /retain|interrupt/i.test(error.message);
      },
    );
    assert.equal(fixture.removals().length, 0);
  }
});

test("changed identity at immediate recheck prevents deletion", async () => {
  let inspectedCount = 0;
  const fixture = imageFixture({
    inspect: (entry) =>
      inspected(
        entry,
        ++inspectedCount > 2 ? { Id: `sha256:${"f".repeat(64)}` } : {},
      ),
  });
  await assert.rejects(
    removeComposeImages({ project, images: identities, run: fixture.run }),
    /identity|changed/i,
  );
  assert.equal(fixture.removals().length, 0);
});

test("partial cleanup failures report exactly the tags already removed", async () => {
  let count = 0;
  const fixture = imageFixture({
    onRemove: () => {
      if (++count === 2) throw Error("daemon disconnected");
    },
  });
  await assert.rejects(
    removeComposeImages({ project, images: identities, run: fixture.run }),
    (error) => {
      assert.deepEqual(error.removedImages, [identities[0]]);
      assert.deepEqual(error.possiblyRemovedImages, [identities[1]]);
      return /disconnected/.test(error.message);
    },
  );
  let retained = false;
  const interrupted = imageFixture({
    onRemove: () => {
      retained = true;
    },
  });
  await assert.rejects(
    removeComposeImages({
      project,
      images: identities,
      run: interrupted.run,
      shouldRetain: () => retained,
    }),
    (error) => {
      assert.deepEqual(error.removedImages, [identities[0]]);
      return true;
    },
  );
  assert.equal(interrupted.removals().length, 1);
});

test("missing, duplicate and foreign captured identities cannot trigger cleanup", async () => {
  for (const images of [
    [],
    identities.slice(0, 1),
    [identities[0], identities[0]],
    [{ ...identities[0], tag: "foreign:latest" }, identities[1]],
  ]) {
    const fixture = imageFixture();
    await assert.rejects(
      removeComposeImages({ project, images, run: fixture.run }),
    );
    assert.equal(fixture.calls.length, 0);
  }
});
