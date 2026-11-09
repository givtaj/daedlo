import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createSwaggerSession, validateSwaggerPolicy } from "./session.mjs";
import {
  buildCatalog,
  getOperation,
} from "../../packages/runtime/src/swagger/catalog.mjs";

const schemaLimit = 2 * 1024 * 1024;
function configuredUrl(value) {
  if (typeof value !== "string" || !value || value !== value.trim())
    throw Error("Use an explicit HTTP(S) URL without credentials or fragment.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error("Use an explicit HTTP(S) URL without credentials or fragment.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("Use an explicit HTTP(S) URL without credentials or fragment.");
  return url.href;
}

async function loadDocument(schemaUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response,
    reader,
    finished = false;
  try {
    try {
      response = await fetch(schemaUrl, {
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw Error("The configured OpenAPI document is unavailable.");
    }
    if (!response.ok || !response.body)
      throw Error("The configured OpenAPI document is unavailable.");
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        throw Error("The OpenAPI document could not be read completely.");
      }
      if (chunk.done) {
        finished = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > schemaLimit)
        throw Error("OpenAPI document exceeds supported size.");
      chunks.push(chunk.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    } catch {
      throw Error("The OpenAPI document must contain valid JSON.");
    }
  } finally {
    clearTimeout(timer);
    try {
      if (!finished) {
        // Cancel before abandoning a failed/oversized body; no trailing data is
        // consumed after the limit. Abort also covers fetch failures.
        if (reader) await reader.cancel();
        else if (response?.body) await response.body.cancel();
      }
    } catch {
      throw Object.assign(Error("OpenAPI response cleanup is incomplete."), {
        code: "cleanup_incomplete",
      });
    } finally {
      reader?.releaseLock();
      controller.abort();
    }
  }
}

// One project profile, reusable runtime/model. Credentials remain in the browser
// or a trusted customer fixture; never put them in this static profile.
export async function createProject() {
  const path = process.env.DAEDLO_SWAGGER_PROFILE;
  if (!path)
    throw Error(
      "Set DAEDLO_SWAGGER_PROFILE to a local project profile JSON file.",
    );
  let profile;
  try {
    profile = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw Error("Swagger project profile must be a readable JSON object.");
  }
  const keys = [
    "docsUrl",
    "schemaUrl",
    "enginePath",
    "allowOperations",
    "allowWrites",
  ];
  if (!profile || typeof profile !== "object" || Array.isArray(profile))
    throw Error("Swagger project profile must be a JSON object.");
  if (Object.keys(profile).some((key) => !keys.includes(key)))
    throw Error("Unknown Swagger profile field.");
  const docsUrl = configuredUrl(profile.docsUrl),
    schemaUrl = configuredUrl(profile.schemaUrl);
  if (new URL(docsUrl).origin !== new URL(schemaUrl).origin)
    throw Error("Docs and schema must share an origin.");
  if (
    typeof profile.enginePath !== "string" ||
    !profile.enginePath.trim() ||
    /[\u0000\r\n]/.test(profile.enginePath)
  )
    throw Error("An explicit Swagger engine path is required.");
  const policy = validateSwaggerPolicy(
    profile.allowOperations,
    profile.allowWrites,
  );
  const enginePath = resolve(dirname(resolve(path)), profile.enginePath);
  const document = await loadDocument(schemaUrl);
  const catalog = buildCatalog(document);
  for (const key of [...policy.allowOperations, ...policy.allowWrites])
    getOperation(catalog, key);
  return {
    url: docsUrl,
    async createSession({ page, context }) {
      await page
        .locator(".swagger-ui .opblock")
        .first()
        .waitFor({ timeout: 10000 });
      return (
        await createSwaggerSession({
          page,
          context,
          enginePath,
          document,
          // Relative API servers resolve against the document's retrieval URL.
          baseUrl: schemaUrl,
          docsUrl,
          ...policy,
        })
      ).session;
    },
  };
}
