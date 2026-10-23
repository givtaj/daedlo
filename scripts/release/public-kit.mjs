import { releaseNames } from "./names.mjs";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sha256, verifyBundle } from "./manifest.mjs";

const notices = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/Apache-2.0.txt",
  "licenses/MIT-legacy.txt",
];
// Historical public kits retain their original combined declaration. New core
// releases use Apache-2.0 while keeping the same legacy notice inventory.
const publicLicenses = new Set(["MIT AND Apache-2.0", "Apache-2.0"]);
const templateNames = ["START_HERE.md", "AGENT_START.md"];
const digestPattern = /^[a-f0-9]{64}$/;
const archiveLimit = 64 * 1024 * 1024;
const draftPattern =
  /DRAFT[^\n]*NOT OPERATIVE|NOT FOR CUSTOMER DISTRIBUTION|evaluation (?:candidate|packaging|review|agreement)/i;

async function regularPath(input, kind) {
  if (typeof input !== "string" || !input)
    throw TypeError("Public kit paths must be explicit nonempty strings.");
  const absolute = resolve(input);
  let current = parse(absolute).root;
  const parts = absolute.slice(current.length).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink())
      throw Error(
        "Public kit inputs and output parents must not contain symlinks.",
      );
    const directory = index < parts.length - 1 || kind === "directory";
    if (directory ? !stat.isDirectory() : !stat.isFile())
      throw Error("Public kit paths must be regular files and directories.");
  }
  return absolute;
}

async function readRegular(path, maximum) {
  await regularPath(path, "file");
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum)
      throw Error("Public kit input is not a bounded regular file.");
    const bytes = await handle.readFile();
    if (bytes.length > maximum)
      throw Error("Public kit input exceeds its size limit.");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function exactDirectory(directory, names) {
  if (
    !isDeepStrictEqual((await fs.readdir(directory)).sort(), [...names].sort())
  )
    throw Error(
      "Public kit input inventory contains missing or unexpected files.",
    );
  const files = new Map();
  for (const name of [...names].sort())
    files.set(name, await readRegular(join(directory, name), archiveLimit));
  return files;
}

function json(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw Error(`Invalid public kit ${label} JSON.`);
  }
}

function same(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) throw Error(message);
}

function publicText(bytes, label) {
  const text = bytes.toString("utf8");
  // Public instructions explicitly distinguish this release from timed evaluation.
  // Ignore only that denial; affirmative draft/evaluation language still fails.
  const checked = text.replace(
    /\bno time-limited evaluation agreement\b/gi,
    "",
  );
  if (draftPattern.test(checked))
    throw Error(`Public kit ${label} contains draft evaluation material.`);
  return text;
}

// Read archive bytes in memory; no package code is executed or extracted.
function readArchive(bytes, prefix) {
  let output;
  try {
    output = execFileSync(
      "python3",
      [
        "-c",
        `import base64,io,json,sys,tarfile
p=json.load(sys.stdin)
root=p['prefix']; result=[]; names=set(); total=0
with tarfile.open(fileobj=io.BytesIO(base64.b64decode(p['data'])),mode='r:gz') as t:
 for i in t:
  n=i.name.rstrip('/') if i.isdir() else i.name
  if not n or '\\\\' in n or any(ord(c)<32 or ord(c)==127 for c in n) or n.startswith('/') or any(c in ('','.','..') for c in n.split('/')):
   raise ValueError('Unsafe archive path')
  if n!=root and not n.startswith(root+'/'): raise ValueError('Wrong archive root')
  if n in names: raise ValueError('Duplicate archive path')
  names.add(n)
  if len(names)>4096: raise ValueError('Too many archive entries')
  if i.isdir(): continue
  if not i.isfile() or n==root or i.size<0: raise ValueError('Archive entry is not a regular file')
  total+=i.size
  if total>67108864: raise ValueError('Archive exceeds expanded size limit')
  data=t.extractfile(i).read()
  if len(data)!=i.size: raise ValueError('Incomplete archive entry')
  result.append({'file':n[len(root)+1:],'mode':i.mode&0o777,'data':base64.b64encode(data).decode()})
print(json.dumps(result))`,
      ],
      {
        input: JSON.stringify({ prefix, data: bytes.toString("base64") }),
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 100 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (cause) {
    throw new Error(
      "Invalid public package archive: require safe bounded regular files, without links.",
      { cause },
    );
  }
  return new Map(
    JSON.parse(output).map(({ file, mode, data }) => [
      file,
      { bytes: Buffer.from(data, "base64"), mode },
    ]),
  );
}

function archiveNotices(files, canonical, label) {
  for (const path of files.keys()) {
    if (/(^|\/)EVALUATION-LICENSE\.md$/i.test(path))
      throw Error(`${label} contains an evaluation license.`);
    if (/\.md$/i.test(path) || /(^|\/)LICENSE$/.test(path))
      publicText(files.get(path).bytes, `${label} instructions or notice`);
  }
  for (const [file, bytes] of canonical)
    if (!files.get(file)?.bytes.equals(bytes))
      throw Error(
        `${label} license/notice does not match the canonical public notice: ${file}.`,
      );
}

function packageIdentity(files, name, version) {
  const bytes = files.get("package.json")?.bytes;
  if (!bytes) throw Error("Public package is missing package.json.");
  const pkg = json(bytes, "package");
  if (pkg.name !== name || pkg.version !== version)
    throw Error("Public package identity does not match the selected version.");
  if (!publicLicenses.has(pkg.license))
    throw Error(
      "Public package license must be Apache-2.0 or MIT AND Apache-2.0.",
    );
  return pkg.license;
}

// Cargo emits these explicit strings in the normalized Cargo.toml in a .crate.
// Refuse unsupported/inherited forms instead of guessing workspace values.
function engineIdentity(files, version, names) {
  const bytes = files.get("Cargo.toml")?.bytes;
  if (!bytes) throw Error("Engine archive is missing Cargo.toml.");
  const fields = new Map();
  let inPackage = false;
  let packageSections = 0;
  for (const line of bytes.toString("utf8").split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inPackage = /^\s*\[package\]\s*(?:#.*)?$/.test(line);
      if (inPackage) packageSections++;
      continue;
    }
    if (!inPackage) continue;
    const match = line.match(
      /^\s*(name|version|license)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/,
    );
    if (!match) continue;
    if (fields.has(match[1]))
      throw Error("Engine package identity has duplicate fields.");
    fields.set(
      match[1],
      match[2].startsWith('"')
        ? json(Buffer.from(match[2]), "Cargo package string")
        : match[2].slice(1, -1),
    );
  }
  if (
    packageSections !== 1 ||
    fields.get("name") !== names.engine ||
    fields.get("version") !== version
  )
    throw Error(
      "Engine package identity/version must match the selected release.",
    );
  const license = fields.get("license");
  if (!publicLicenses.has(license))
    throw Error(
      "Engine package license must be Apache-2.0 or MIT AND Apache-2.0.",
    );
  return license;
}

function verifyTools(files, source, version, expectedToolsSha256, names) {
  const archiveFile = `${names.prefix}-tools-${version}.tgz`;
  const bytes = files.get(archiveFile);
  if (sha256(bytes) !== expectedToolsSha256)
    throw Error(
      "Public tools archive digest does not match the trusted digest.",
    );
  const receiptBytes = files.get("TOOLS_VERIFICATION.json");
  const receipt = json(receiptBytes, "tools receipt");
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "browser-driver-release-tools" ||
    receipt.name !== names.tools ||
    receipt.version !== version
  )
    throw Error("Tools receipt identity does not match the public kit.");
  same(
    receipt.source,
    source,
    "Tools and bundle source provenance must match exactly.",
  );
  same(
    receipt.archive,
    { file: archiveFile, sha256: expectedToolsSha256, bytes: bytes.length },
    "Tools archive receipt does not match its exact bytes.",
  );
  if (
    files.get("TOOLS_SHA256SUMS").toString("utf8") !==
    `${expectedToolsSha256}  ${archiveFile}\n${sha256(receiptBytes)}  TOOLS_VERIFICATION.json\n`
  )
    throw Error("Tools checksum inventory does not match its receipt.");
  const payload = readArchive(bytes, "package");
  if (
    !Array.isArray(receipt.files) ||
    receipt.fileCount !== receipt.files.length + 1
  )
    throw Error("Tools payload inventory has an invalid file count.");
  const seen = new Set();
  for (const entry of receipt.files) {
    if (
      typeof entry?.file !== "string" ||
      entry.file === "SOURCE.json" ||
      seen.has(entry.file)
    )
      throw Error(
        "Tools payload inventory contains an invalid or duplicate entry.",
      );
    seen.add(entry.file);
    const actual = payload.get(entry.file);
    if (
      !actual ||
      entry.bytes !== actual.bytes.length ||
      entry.sha256 !== sha256(actual.bytes) ||
      entry.mode !== actual.mode
    )
      throw Error("Tools payload inventory does not match archive bytes.");
  }
  same(
    [...payload.keys()].sort(),
    [...seen, "SOURCE.json"].sort(),
    "Tools archive contains files outside its SOURCE inventory.",
  );
  const sourceReceipt = json(
    payload.get("SOURCE.json").bytes,
    "SOURCE receipt",
  );
  const { archive, fileCount, ...expectedSource } = receipt;
  same(
    sourceReceipt,
    expectedSource,
    "Tools SOURCE receipt does not match external verification.",
  );
  return {
    payload,
    license: packageIdentity(payload, names.tools, version),
  };
}

function zip(entries) {
  try {
    return execFileSync(
      "python3",
      [
        "-c",
        `import base64,io,json,stat,sys,zipfile
p=json.load(sys.stdin); out=io.BytesIO()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as z:
 for f in p:
  i=zipfile.ZipInfo(f['file'],date_time=(1980,1,1,0,0,0)); i.create_system=3; i.external_attr=(stat.S_IFREG|0o644)<<16
  z.writestr(i,base64.b64decode(f['data']))
with zipfile.ZipFile(io.BytesIO(out.getvalue())) as z:
 if z.namelist()!=[f['file'] for f in p]: raise ValueError('ZIP inventory mismatch')
 for i,f in zip(z.infolist(),p):
  if i.date_time!=(1980,1,1,0,0,0) or i.external_attr>>16!=(stat.S_IFREG|0o644) or z.read(i)!=base64.b64decode(f['data']): raise ValueError('ZIP content mismatch')
sys.stdout.buffer.write(out.getvalue())`,
      ],
      {
        input: JSON.stringify(
          entries.map(([file, bytes]) => ({
            file,
            data: bytes.toString("base64"),
          })),
        ),
        maxBuffer: 256 * 1024 * 1024,
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (cause) {
    throw new Error(
      "Deterministic public ZIP creation or inventory verification failed; Python 3 is required.",
      { cause },
    );
  }
}

/** Assemble immutable public downloads from exact preverified package pairs. */
export async function buildPublicKit({
  bundle,
  tools,
  repoRoot,
  output,
  expectedManifestSha256,
  expectedToolsSha256,
}) {
  if (
    !digestPattern.test(expectedManifestSha256 ?? "") ||
    !digestPattern.test(expectedToolsSha256 ?? "")
  )
    throw Error(
      "Public kit requires trusted manifest and tools SHA-256 digests.",
    );
  bundle = await regularPath(bundle, "directory");
  tools = await regularPath(tools, "directory");
  repoRoot = await regularPath(repoRoot, "directory");
  if (typeof output !== "string" || !output)
    throw TypeError("A fresh public kit output path is required.");
  output = resolve(output);
  await regularPath(dirname(output), "directory");
  try {
    await fs.lstat(output);
    throw Error("Public kit output already exists.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const verified = await verifyBundle(bundle, { expectedManifestSha256 });
  const { manifest } = verified;
  const { version, source, artifacts } = manifest;
  const names = releaseNames(artifacts);
  if (/(?:^|[-.])eval(?:uation)?(?:[.-]|$)/i.test(version))
    throw Error("Evaluation versions cannot become public download kits.");
  const bundleFiles = await exactDirectory(bundle, [
    "manifest.json",
    "SHA256SUMS",
    artifacts.runtime.file,
    artifacts.engine.file,
  ]);
  // Bind the captured bytes too: verification must not bless a later replacement.
  if (sha256(bundleFiles.get("manifest.json")) !== expectedManifestSha256)
    throw Error("Bundle manifest digest changed during public packaging.");
  for (const artifact of Object.values(artifacts)) {
    const bytes = bundleFiles.get(artifact.file);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256)
      throw Error("Bundle artifact digest changed during public packaging.");
  }
  if (
    bundleFiles.get("SHA256SUMS").toString("utf8") !==
    `${artifacts.runtime.sha256}  ${artifacts.runtime.file}\n${artifacts.engine.sha256}  ${artifacts.engine.file}\n${expectedManifestSha256}  manifest.json\n`
  )
    throw Error("Bundle checksum inventory changed during public packaging.");
  const toolsFile = `${names.prefix}-tools-${version}.tgz`;
  const toolsFiles = await exactDirectory(tools, [
    toolsFile,
    "TOOLS_SHA256SUMS",
    "TOOLS_VERIFICATION.json",
  ]);
  const { payload: toolPayload, license: toolsLicense } = verifyTools(
    toolsFiles,
    source,
    version,
    expectedToolsSha256,
    names,
  );
  const canonical = new Map();
  for (const file of notices) {
    const bytes = await readRegular(join(repoRoot, file), 1024 * 1024);
    publicText(bytes, file);
    canonical.set(file, bytes);
  }
  const runtimePayload = readArchive(
    bundleFiles.get(artifacts.runtime.file),
    "package",
  );
  const enginePayload = readArchive(
    bundleFiles.get(artifacts.engine.file),
    `${names.engine}-${version}`,
  );
  archiveNotices(runtimePayload, canonical, "Runtime");
  archiveNotices(enginePayload, canonical, "Engine");
  archiveNotices(toolPayload, canonical, "Tools");
  const runtimeLicense = packageIdentity(
    runtimePayload,
    names.runtime,
    version,
  );
  const engineLicense = engineIdentity(enginePayload, version, names);
  if (runtimeLicense !== engineLicense || runtimeLicense !== toolsLicense)
    throw Error(
      "Public runtime, engine and tools license declarations must agree.",
    );
  const contents = new Map(canonical);
  const substitutions = {
    VERSION: version,
    PACKAGE_PREFIX: names.prefix,
    RUNTIME_NAME: names.runtime,
    ENGINE_NAME: names.engine,
    TOOLS_NAME: names.tools,
    SKILL_NAME: names.skill,
    MANIFEST_SHA256: expectedManifestSha256,
    TOOLS_SHA256: expectedToolsSha256,
  };
  for (const file of templateNames) {
    const bytes = await readRegular(
      join(repoRoot, "docs/public-downloads", file),
      256 * 1024,
    );
    let text = publicText(bytes, file);
    for (const [key, value] of Object.entries(substitutions))
      text = text.replaceAll(`{{${key}}}`, value);
    if (text.includes("{{") || text.includes("}}"))
      throw Error("Public kit template contains an unresolved placeholder.");
    contents.set(file, Buffer.from(text));
  }
  for (const [prefix, files] of [
    ["bundle", bundleFiles],
    ["tools", toolsFiles],
  ])
    for (const [file, bytes] of files) contents.set(`${prefix}/${file}`, bytes);
  const entries = [...contents]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, bytes]) => [`daedlo-${version}/${file}`, bytes]);
  const archive = zip(entries);
  const archiveFile = `daedlo-${version}.zip`;
  const release = {
    schemaVersion: 1,
    kind: "daedlo-public-kit",
    version,
    archive: {
      file: archiveFile,
      bytes: archive.length,
      sha256: sha256(archive),
    },
    source,
    bundle: {
      manifest: "bundle/manifest.json",
      manifestSha256: expectedManifestSha256,
      artifacts,
    },
    tools: {
      file: `tools/${toolsFile}`,
      bytes: toolsFiles.get(toolsFile).length,
      sha256: expectedToolsSha256,
    },
    license: {
      terms: "See included per-component LICENSE and THIRD_PARTY_NOTICES.md",
      files: [...canonical].map(([file, bytes]) => ({
        file,
        sha256: sha256(bytes),
      })),
    },
    files: entries.map(([file, bytes]) => ({
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
    })),
  };
  await fs.mkdir(output); // Exclusive ownership; never adopt existing output.
  const owned = await fs.lstat(output);
  try {
    await fs.writeFile(join(output, archiveFile), archive, { flag: "wx" });
    await fs.writeFile(
      join(output, "SHA256SUMS"),
      `${release.archive.sha256}  ${archiveFile}\n`,
      { flag: "wx" },
    );
    await fs.writeFile(
      join(output, "release.json"),
      JSON.stringify(release, null, 2) + "\n",
      { flag: "wx" },
    );
  } catch (error) {
    try {
      const current = await fs.lstat(output);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== owned.dev ||
        current.ino !== owned.ino
      )
        throw Error("Owned public output was replaced.");
      await fs.rm(output, { recursive: true });
    } catch {
      error.cleanupFailed = true;
      error.retainedOwnedDirectories = [output];
    }
    throw error;
  }
  return { ...release, output, archivePath: join(output, archiveFile) };
}
