import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { releaseLicense } from "../scripts/release/licensing.mjs";

const components = [
  "packages/runtime",
  "crates/browser-driver-engine",
  "skills/browser-driver",
];
const publicNotices = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/Apache-2.0.txt",
  "licenses/MIT-legacy.txt",
];
const packagedNotices = ["LICENSE", "THIRD_PARTY_NOTICES.md", "licenses"];
const mit = await fs.readFile(
  new URL("../licenses/MIT-legacy.txt", import.meta.url),
  "utf8",
);
const apache = await fs.readFile(
  new URL("../licenses/Apache-2.0.txt", import.meta.url),
  "utf8",
);

function canonical(sources, path, text) {
  sources.set(path, text);
  for (const component of components) sources.set(`${component}/${path}`, text);
}

function fixture() {
  const sources = new Map([
    [
      "packages/runtime/package.json",
      JSON.stringify({
        name: "@browser-driver/runtime",
        license: "MIT AND Apache-2.0",
        files: ["src", "README.md", ...packagedNotices],
      }),
    ],
    ["Cargo.toml", '[workspace.package]\nlicense = "MIT AND Apache-2.0"\n'],
    [
      "crates/browser-driver-engine/Cargo.toml",
      '[package]\nname = "browser-driver-engine"\nlicense.workspace = true\n',
    ],
    [
      "skills/browser-driver/SKILL.md",
      "---\nname: browser-driver\nlicense: MIT AND Apache-2.0\n---\n",
    ],
  ]);
  canonical(
    sources,
    "LICENSE",
    `Public preview fixture: existing component rights remain applicable.\nRoots-derived portions retain Apache-2.0; see licenses/Apache-2.0.txt.\n\n${mit}`,
  );
  canonical(
    sources,
    "THIRD_PARTY_NOTICES.md",
    "Roots-derived portions retain Apache-2.0. Earlier MIT notices are preserved.\n",
  );
  canonical(sources, "licenses/Apache-2.0.txt", apache);
  canonical(sources, "licenses/MIT-legacy.txt", mit);
  return sources;
}

function files(sources) {
  return [...sources].map(([path, text]) => ({
    path,
    bytes: Buffer.from(text),
  }));
}

function changeRuntime(sources, change) {
  const runtime = JSON.parse(sources.get("packages/runtime/package.json"));
  change(runtime);
  sources.set("packages/runtime/package.json", JSON.stringify(runtime));
}

function apacheFixture() {
  const sources = fixture();
  changeRuntime(sources, (runtime) => {
    runtime.license = "Apache-2.0";
  });
  sources.set("Cargo.toml", '[workspace.package]\nlicense = "Apache-2.0"\n');
  sources.set(
    "skills/browser-driver/SKILL.md",
    "---\nname: browser-driver\nlicense: Apache-2.0\n---\n",
  );
  canonical(sources, "LICENSE", apache);
  return sources;
}

test("Apache public core retains all four complete notices", () => {
  assert.deepEqual(releaseLicense(files(apacheFixture())), {
    license: "Apache-2.0",
    files: publicNotices,
  });
});

test("Apache public core rejects missing or changed notices at every boundary", () => {
  for (const boundary of ["", ...components]) {
    for (const notice of publicNotices) {
      const path = boundary ? `${boundary}/${notice}` : notice;
      const missing = apacheFixture();
      missing.delete(path);
      assert.throws(
        () => releaseLicense(files(missing)),
        /Required license source is missing/,
      );
      if (boundary) {
        const changed = apacheFixture();
        changed.set(path, `${changed.get(path)}\n`);
        assert.throws(
          () => releaseLicense(files(changed)),
          /Package license source differs/,
        );
      }
    }
  }
});

test("Apache public core refuses truncated Apache or MIT texts even when every copy matches", () => {
  for (const [path, text] of [
    ["LICENSE", "Apache License, Version 2.0\n"],
    ["licenses/Apache-2.0.txt", "Apache License, Version 2.0\n"],
    [
      "licenses/MIT-legacy.txt",
      "MIT License\nCopyright (c) 2026 Aidin Givtaj\n",
    ],
  ]) {
    const sources = apacheFixture();
    canonical(sources, path, text);
    assert.throws(
      () => releaseLicense(files(sources)),
      /Apache public core must preserve complete/,
    );
  }
});

test("Apache public core refuses mixed declarations and evaluation terms", () => {
  for (const path of ["Cargo.toml", "skills/browser-driver/SKILL.md"]) {
    const sources = apacheFixture();
    sources.set(
      path,
      sources.get(path).replace("Apache-2.0", "MIT AND Apache-2.0"),
    );
    assert.throws(
      () => releaseLicense(files(sources)),
      /Public package license declarations must agree/,
    );
  }
  const sources = apacheFixture();
  sources.set("EVALUATION-LICENSE.md", "DRAFT — NOT OPERATIVE\n");
  assert.throws(
    () => releaseLicense(files(sources)),
    /Public packages cannot include evaluation terms/,
  );
});

test("public mixed-notice packages retain all four notices without evaluation terms", () => {
  const sources = fixture();
  let result;
  assert.doesNotThrow(() => {
    result = releaseLicense(files(sources));
  }, "Complete public package notices and declarations must be accepted");
  assert.deepEqual(result, {
    license: "MIT AND Apache-2.0",
    files: publicNotices,
  });
});

test("public packages refuse every missing canonical or independently shipped notice", () => {
  for (const boundary of ["", ...components]) {
    for (const notice of publicNotices) {
      const sources = fixture();
      const path = boundary ? `${boundary}/${notice}` : notice;
      sources.delete(path);
      assert.throws(
        () => releaseLicense(files(sources)),
        `Missing ${path} must prevent distribution`,
      );
    }
  }
});

test("public packages refuse independently shipped notices that differ from canonical bytes", () => {
  for (const component of components) {
    for (const notice of publicNotices) {
      const sources = fixture();
      const path = `${component}/${notice}`;
      sources.set(path, `${sources.get(path)}\n`);
      assert.throws(
        () => releaseLicense(files(sources)),
        `${path} must exactly preserve the canonical notice`,
      );
    }
  }
});

test("public package boundaries never include proposed evaluation terms", () => {
  for (const boundary of ["", ...components]) {
    const sources = fixture();
    const path = boundary
      ? `${boundary}/EVALUATION-LICENSE.md`
      : "EVALUATION-LICENSE.md";
    sources.set(path, "DRAFT — NOT OPERATIVE. Proposed evaluation terms.\n");
    assert.throws(
      () => releaseLicense(files(sources)),
      `Evaluation terms at ${path} must not accompany a public package`,
    );
  }
});

test("public root notices identify both licenses and cannot retain draft status", () => {
  for (const text of [
    "Apache-2.0 portions are preserved, but the MIT notice is absent.\n",
    mit,
    `DRAFT\nApache-2.0 applies to Roots-derived portions.\n${mit}`,
    `NOT OPERATIVE\nApache-2.0 applies to Roots-derived portions.\n${mit}`,
  ]) {
    const sources = fixture();
    canonical(sources, "LICENSE", text);
    assert.throws(
      () => releaseLicense(files(sources)),
      "Matching component copies do not make an incomplete or draft root notice public",
    );
  }
});

test("public npm file selection includes notices and excludes evaluation terms", () => {
  for (const omitted of packagedNotices) {
    const sources = fixture();
    changeRuntime(sources, (runtime) => {
      runtime.files = runtime.files.filter((path) => path !== omitted);
    });
    assert.throws(
      () => releaseLicense(files(sources)),
      `npm packing must retain ${omitted}`,
    );
  }
  const sources = fixture();
  changeRuntime(sources, (runtime) => {
    runtime.files.push("EVALUATION-LICENSE.md");
  });
  assert.throws(
    () => releaseLicense(files(sources)),
    "A public file selection must not request evaluation terms even when absent",
  );
});

test("public Cargo and skill declarations must agree with the selected component licenses", () => {
  for (const [path, replacement] of [
    ["Cargo.toml", '[workspace.package]\nlicense = "MIT"\n'],
    ["Cargo.toml", '[workspace.package]\nlicense-file = "LICENSE"\n'],
    [
      "crates/browser-driver-engine/Cargo.toml",
      "[package]\nlicense-file.workspace = true\n",
    ],
    [
      "crates/browser-driver-engine/Cargo.toml",
      '[package]\nlicense = "MIT AND Apache-2.0"\n',
    ],
    [
      "skills/browser-driver/SKILL.md",
      "---\nname: browser-driver\nlicense: See LICENSE\n---\n",
    ],
    [
      "skills/browser-driver/SKILL.md",
      "---\nname: browser-driver\nlicense: MIT\n---\n",
    ],
  ]) {
    const sources = fixture();
    sources.set(path, replacement);
    assert.throws(
      () => releaseLicense(files(sources)),
      `${path} must agree with the public packaging contract`,
    );
  }
});

test("legacy MIT release declarations retain their existing result", () => {
  const sources = new Map([
    ["packages/runtime/package.json", JSON.stringify({ license: "MIT" })],
    ["LICENSE", mit],
  ]);
  assert.deepEqual(releaseLicense(files(sources)), {
    license: "MIT",
    files: ["LICENSE"],
  });
});

test("the existing evaluation mode remains explicitly draft with its five notices", () => {
  const sources = fixture();
  changeRuntime(sources, (runtime) => {
    runtime.license = "SEE LICENSE IN LICENSE";
    runtime.files.push("EVALUATION-LICENSE.md");
  });
  canonical(sources, "LICENSE", `DRAFT — NOT OPERATIVE\nApache-2.0\n${mit}`);
  const terms = "DRAFT — NOT OPERATIVE. Proposed evaluation terms.\n";
  canonical(sources, "EVALUATION-LICENSE.md", terms);
  sources.set("docs/evaluation/ALPHA-EVALUATION-LICENSE.md", terms);
  sources.set("Cargo.toml", '[workspace.package]\nlicense-file = "LICENSE"\n');
  sources.set(
    "crates/browser-driver-engine/Cargo.toml",
    "[package]\nlicense-file.workspace = true\n",
  );
  sources.set(
    "skills/browser-driver/SKILL.md",
    "---\nname: browser-driver\nlicense: See LICENSE\n---\n",
  );
  assert.deepEqual(releaseLicense(files(sources)), {
    license: "SEE LICENSE IN LICENSE",
    files: [
      "LICENSE",
      "EVALUATION-LICENSE.md",
      "THIRD_PARTY_NOTICES.md",
      "licenses/Apache-2.0.txt",
      "licenses/MIT-legacy.txt",
    ],
  });
});
