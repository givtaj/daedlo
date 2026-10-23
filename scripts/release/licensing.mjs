// Maintainer-only validation: package boundaries must retain their own notices.
import { createHash } from "node:crypto";

// Reviewed, unmodified upstream Apache text and the original Browser Driver MIT grant.
const preservedLicenseDigests = {
  "licenses/Apache-2.0.txt":
    "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  "licenses/MIT-legacy.txt":
    "940e838e3a280f3304236ed74b5a630535e1bc663034041116ae6556b2dc7248",
};
export const noticeFiles = [
  "LICENSE",
  "EVALUATION-LICENSE.md",
  "THIRD_PARTY_NOTICES.md",
  "licenses/Apache-2.0.txt",
  "licenses/MIT-legacy.txt",
];

export function releaseLicense(files) {
  const sources = new Map(files.map(({ path, bytes }) => [path, bytes]));
  const read = (path) => {
    const bytes = sources.get(path);
    if (!bytes) throw Error(`Required license source is missing: ${path}.`);
    return bytes.toString("utf8");
  };
  const runtime = JSON.parse(read("packages/runtime/package.json"));
  if (
    ![
      "MIT",
      "MIT AND Apache-2.0",
      "Apache-2.0",
      "SEE LICENSE IN LICENSE",
    ].includes(runtime.license)
  )
    throw Error("Unsupported or missing release license declaration.");
  if (runtime.license === "MIT") return { license: "MIT", files: ["LICENSE"] };
  const apacheCore = runtime.license === "Apache-2.0";
  const publicPreview = apacheCore || runtime.license === "MIT AND Apache-2.0";
  const required = publicPreview
    ? noticeFiles.filter((path) => path !== "EVALUATION-LICENSE.md")
    : noticeFiles;
  for (const path of required) {
    const canonical = read(path);
    for (const component of [
      "packages/runtime",
      "crates/browser-driver-engine",
      "skills/browser-driver",
    ])
      if (read(`${component}/${path}`) !== canonical)
        throw Error(`Package license source differs: ${component}/${path}.`);
  }
  if (publicPreview) {
    const license = read("LICENSE");
    if (apacheCore) {
      if (
        license !== read("licenses/Apache-2.0.txt") ||
        Object.entries(preservedLicenseDigests).some(
          ([path, digest]) =>
            createHash("sha256").update(read(path)).digest("hex") !== digest,
        )
      )
        throw Error(
          "Apache public core must preserve complete Apache and legacy MIT texts.",
        );
    } else if (
      !/MIT License/.test(license) ||
      !/Apache-2\.0/.test(license) ||
      /DRAFT|NOT OPERATIVE/.test(license)
    )
      throw Error(
        "Public preview must include operative MIT and Apache-2.0 notices.",
      );
    for (const boundary of [
      "",
      "packages/runtime/",
      "crates/browser-driver-engine/",
      "skills/browser-driver/",
    ])
      if (sources.has(`${boundary}EVALUATION-LICENSE.md`))
        throw Error("Public packages cannot include evaluation terms.");
    if (
      !read("Cargo.toml")
        .split(/\r?\n/)
        .includes(`license = "${runtime.license}"`) ||
      !/^license\.workspace = true$/m.test(
        read("crates/browser-driver-engine/Cargo.toml"),
      ) ||
      !read("skills/browser-driver/SKILL.md")
        .split(/\r?\n/)
        .includes(`license: ${runtime.license}`)
    )
      throw Error("Public package license declarations must agree.");
    for (const path of ["LICENSE", "THIRD_PARTY_NOTICES.md", "licenses"])
      if (!runtime.files?.includes(path))
        throw Error(`Runtime package must include ${path}.`);
    if (runtime.files.includes("EVALUATION-LICENSE.md"))
      throw Error("Public package file list cannot request evaluation terms.");
    return { license: runtime.license, files: required };
  }
  if (!/DRAFT.*NOT OPERATIVE/.test(read("LICENSE")))
    throw Error(
      "Evaluation candidate must disclose its non-operative draft status.",
    );
  if (
    read("EVALUATION-LICENSE.md") !==
    read("docs/evaluation/ALPHA-EVALUATION-LICENSE.md")
  )
    throw Error("Evaluation terms must match the reviewed draft source.");
  if (
    !/^license-file = "LICENSE"$/m.test(read("Cargo.toml")) ||
    !/^license-file.workspace = true$/m.test(
      read("crates/browser-driver-engine/Cargo.toml"),
    )
  )
    throw Error("Engine must refer to its included license file.");
  if (!/^license: See LICENSE/m.test(read("skills/browser-driver/SKILL.md")))
    throw Error("Skill must refer to its included license file.");
  for (const path of [
    "LICENSE",
    "EVALUATION-LICENSE.md",
    "THIRD_PARTY_NOTICES.md",
    "licenses",
  ])
    if (!runtime.files?.includes(path))
      throw Error(`Runtime package must include ${path}.`);
  return { license: runtime.license, files: noticeFiles };
}
