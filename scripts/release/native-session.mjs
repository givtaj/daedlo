import { join } from "node:path";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, limit) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= limit &&
  !/[\x00-\x1f\x7f-\x9f]/.test(v);
export function frontendConfiguration(value) {
  if (value === undefined) return null;
  if (
    !object(value) ||
    Object.keys(value).sort().join(",") !== "name,targetOrigin" ||
    !text(value.name, 120)
  )
    throw Object.assign(
      Error(
        "Frontend requires a static name and an explicit canonical HTTP(S) target origin.",
      ),
      { code: "invalid_frontend" },
    );
  let url;
  try {
    url = new URL(value.targetOrigin);
  } catch {}
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== value.targetOrigin ||
    url.username ||
    url.password
  )
    throw Object.assign(
      Error(
        "Frontend targetOrigin must be a canonical HTTP(S) origin without path, credentials, query or fragment.",
      ),
      { code: "invalid_frontend" },
    );
  return { name: value.name, targetOrigin: url.origin };
}
export function frontendIdentity(config) {
  const explicit = frontendConfiguration(config.frontend);
  return {
    name:
      explicit?.name ??
      config.registration.label ??
      config.registration.projectId,
    targetOrigin: explicit?.targetOrigin ?? null,
    model: config.registration.model ?? {
      id: "unspecified",
      version: "unspecified",
    },
    evidenceLocation: join(config.store, "supervisor", "run-reports"),
    ownership: {
      browser: "unknown",
      context: "unknown",
      application: "unknown",
    },
  };
}
export function safeFrontend(value) {
  if (
    !object(value) ||
    !text(value.name, 120) ||
    !text(value.model?.id, 256) ||
    !text(value.model?.version, 256) ||
    !text(value.evidenceLocation, 1024)
  )
    throw Error("Invalid frontend identity");
  if (value.targetOrigin !== null)
    frontendConfiguration({
      name: value.name,
      targetOrigin: value.targetOrigin,
    });
  const ownership = {};
  for (const key of ["browser", "context", "application"]) {
    const choices =
      key === "application"
        ? ["owned", "attached", "unknown"]
        : ["owned", "attached", "unknown"];
    if (!choices.includes(value.ownership?.[key]))
      throw Error("Invalid frontend ownership");
    ownership[key] = value.ownership[key];
  }
  return {
    name: value.name,
    targetOrigin: value.targetOrigin,
    model: { id: value.model.id, version: value.model.version },
    evidenceLocation: value.evidenceLocation,
    ownership,
  };
}
const observationMessages = {
  observation_failed:
    "Application observation failed. Current safety state is unconfirmed.",
  invalid_observation:
    "The adapter did not provide a valid application observation.",
  disconnected: "The application page or model connection is unavailable.",
  unknown_state:
    "The model did not recognize the currently observed application state.",
  engine_disconnected: "The model engine connection is unavailable.",
  engine_timeout: "The model engine did not respond before the deadline.",
  target_mismatch:
    "The controlled page does not match this frontend's registered target.",
  draft_observation_failed: "Current draft safety could not be observed.",
  draft_unknown:
    "Current draft safety is unknown. Obtain a fresh measurement before cleanup.",
  child_unreachable:
    "The owned child cannot be reached. Preserve its ownership and recovery records.",
  child_timeout:
    "The owned child did not respond before the deadline. Current safety state is unknown.",
  child_exited:
    "The owned child exited without confirmed resource cleanup. Preserve its recovery records.",
};
export function safeObservation(value) {
  if (value === undefined) return undefined;
  const status = [
    "available",
    "failed",
    "unreachable",
    "not_running",
    "starting",
  ].includes(value?.status)
    ? value.status
    : "failed";
  if (!["failed", "unreachable"].includes(status)) return { status };
  const raw = value?.error?.code ?? value?.error?.error_code;
  const code = Object.hasOwn(observationMessages, raw)
    ? raw
    : status === "unreachable"
      ? "child_unreachable"
      : "observation_failed";
  return { status, error: { code, message: observationMessages[code] } };
}
const messages = {
  startup_cancelled:
    "Startup was cancelled. Readiness was not established; review owned cleanup below.",
  invalid_model:
    "The model descriptor is invalid. Correct its declaration and validate the real engine handshake.",
  invalid_descriptor:
    "The engine descriptor is invalid. Review its declarations.",
  invalid_frontend:
    "Frontend configuration is invalid. Use a static name and canonical HTTP(S) target origin.",
  target_mismatch:
    "The controlled page or browser does not match this frontend's registered target.",
  boot_failed: "The selected runtime and model did not pass readiness checks.",
  browser_changed:
    "The browser does not match the accepted executable and version.",
  cleanup_incomplete:
    "Owned cleanup is incomplete. Keep this runner and repair the retained cleanup handles.",
  engine_unavailable: "The selected model engine could not start.",
  engine_timeout:
    "The selected model engine did not respond before the deadline.",
  engine_disconnected:
    "The selected model engine disconnected before startup completed.",
  setup_required:
    "Run setup with a reviewed version before starting this frontend.",
  stale_source:
    "Authored source changed. Refresh and validate it before starting.",
  migration_review_required:
    "Prepare and inspect this descriptor migration before activation.",
  migration_review_changed:
    "The reviewed migration identity changed. Inspect the candidate again before activation.",
  migration_scope_changed:
    "Descriptor migration cannot change other registration settings.",
  migration_not_required:
    "The descriptor is unchanged. Use ordinary source refresh.",
  stale_operation:
    "The candidate no longer matches the selected installation. Prepare and review it again.",
  native_failed:
    "Startup failed. Review the launcher locally; no readiness was established.",
};
const diagnosticRules = new Set([
  "must not be empty",
  "must contain at least one state",
  "must be unique among states",
  "state parents must not form a cycle",
  "must reference a declared state",
  "must be unique among commands",
  "must be finite",
  "only permitted for number parameters",
  "must not exceed maximum",
  "select parameters must contain at least one option",
  "only permitted for select parameters",
  "maxLength (Rust max_length) is only permitted for text parameters",
  "maxLength (Rust max_length) is only permitted for text parameters or password parameters",
  "must match the parameter type and constraints",
  "must be unique among options",
  "must contain at least one step",
  "must be unique among recipes",
  "must reference a declared command",
  "Command parameters must be an object",
  "Command contains undeclared parameters",
  "Parameter value does not match its descriptor",
  "A required command parameter is missing",
]);
function safeModelDiagnostic(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 512) return null;
  const match =
    /^Invalid model at (descriptor(?:(?:\.(?:id|version|label|states|parent|commands|params|name|minimum|maximum|options|maxLength|default|value|recipes|steps|command))|(?:\[\d+\]))*): (.+?)\.( Parameter indexes are zero-based in sorted name order\.)?$/.exec(
      value,
    );
  if (
    !match ||
    !diagnosticRules.has(match[2]) ||
    Boolean(match[3]) !== match[1].includes(".params[")
  )
    return null;
  return value;
}
export function startupError(error) {
  const code = Object.hasOwn(messages, error?.code)
    ? error.code
    : "native_failed";
  return {
    code,
    message:
      code === "invalid_model"
        ? (safeModelDiagnostic(error.message) ?? messages[code])
        : messages[code],
  };
}
export const startupPhases = [
  "bootstrap",
  "model_validation",
  "target_attachment",
  "ready",
  "failed",
  "cleanup",
  "stopped",
];
export function safeStartup(value) {
  if (!object(value) || !startupPhases.includes(value.phase))
    throw Error("Invalid startup phase");
  return {
    phase: value.phase,
    ...(Array.isArray(value.history)
      ? {
          history: value.history
            .filter((p) => startupPhases.includes(p))
            .slice(0, 32),
        }
      : {}),
    cleanup: ["pending", "complete", "incomplete"].includes(value.cleanup)
      ? value.cleanup
      : "pending",
    ...(value.error ? { error: startupError(value.error) } : {}),
  };
}
