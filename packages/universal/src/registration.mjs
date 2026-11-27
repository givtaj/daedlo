import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { loadTools } from "./tools.mjs";

const fail = (code, message) => {
  throw Object.assign(Error(message), { code });
};
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const text = (value, limit) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= limit &&
  !/[\x00-\x1f\x7f-\x9f]/.test(value);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

export async function captureTargetRegistration({
  configPath,
  id,
  label,
  environment,
  authProfileRef,
}) {
  if (
    !validMetadata({ id, label, environment, authProfileRef }) ||
    typeof configPath !== "string" ||
    !configPath
  )
    fail(
      "target_invalid",
      "Target identity, name, environment and authentication-profile reference are required.",
    );
  configPath = resolve(configPath);
  const { journalFilesystem } = await loadTools("run-journal");
  await journalFilesystem.directory(dirname(configPath));
  const { bytes } = await journalFilesystem.smallFile(configPath, 1024 * 1024);
  const config = JSON.parse(bytes);
  if (config.schemaVersion !== 2 || config.workspace?.journal !== 1)
    fail(
      "universal_journal_required",
      "Universal requires an explicit journal workspace. Existing basic configurations stay unchanged.",
    );
  const { workspaceConfiguration } = await loadTools("workspace");
  const workspace = workspaceConfiguration(config);
  const { frontendConfiguration } = await loadTools("native-session");
  const frontend = frontendConfiguration(config.frontend);
  if (!frontend)
    fail(
      "target_invalid",
      "Universal targets require an explicit frontend origin.",
    );
  const { snapshotProject } = await loadTools("ninja-installation");
  const source = await snapshotProject(config.registration);
  // Only identities are retained. Customer settings and source bytes stay in
  // their original files; their fingerprints remain private catalog metadata.
  return {
    config,
    workspace,
    target: {
      id,
      label,
      environment,
      authProfileRef,
      configPath,
      projectId: config.registration.projectId,
      sourceRoot: config.registration.sourceRoot,
      store: resolve(config.store),
      origin: frontend.targetOrigin,
      model: structuredClone(config.registration.model),
      configSha256: hash(config),
      sourceSha256: source.sha256,
    },
  };
}

function validMetadata(value) {
  return (
    id(value.id) &&
    id(value.authProfileRef) &&
    text(value.label, 120) &&
    text(value.environment, 80)
  );
}

/** Refuse configuration/source drift before starting an existing target. */
export async function assertTargetRegistration(target, root) {
  let captured;
  try {
    captured = await captureTargetRegistration(target);
  } catch {
    fail(
      "target_changed",
      "The registered target configuration or authored integration is unavailable or changed. Preserve its history and review the binding.",
    );
  }
  const expected = { ...target };
  delete expected.revision;
  if (
    captured.workspace.root !== resolve(root) ||
    !isDeepStrictEqual(captured.target, expected)
  )
    fail(
      "target_changed",
      "The registered target configuration or authored integration changed. Preserve its history and review the binding.",
    );
  return captured;
}
