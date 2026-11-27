const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const types = new Set([
  "text/plain",
  "application/json",
  "image/png",
  "image/jpeg",
  "application/pdf",
]);
const fail = (code = "invalid_request") => {
  throw Object.assign(Error(), { code });
};
const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
const decode = (value) => {
  let result;
  try {
    result = decodeURIComponent(value);
  } catch {
    fail();
  }
  if (!id(result) || encodeURIComponent(result) !== value) fail();
  return result;
};
export function knowledgeRoute(requestUrl, origin) {
  const match =
    /^\/api\/targets\/([^/]+)\/(records|evidence|summary)(?:\/([^/?]+))?(?:\/(review|revise|retry|content))?$/.exec(
      requestUrl.split("?")[0],
    );
  if (!match) return null;
  const [_, rawTarget, resource, rawId, action] = match;
  if (
    (resource === "summary" && (rawId || action)) ||
    (action && !rawId) ||
    (resource === "records" &&
      action &&
      !["review", "revise"].includes(action)) ||
    (resource === "evidence" &&
      action &&
      !["retry", "content"].includes(action))
  )
    fail();
  const query = new URL(requestUrl, origin).searchParams,
    keys = [...query.keys()];
  const allowed =
    resource === "records"
      ? rawId
        ? ["revision"]
        : ["kind", "limit", "cursor"]
      : resource === "evidence" && !rawId
        ? ["runId", "limit", "cursor"]
        : [];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key) => !allowed.includes(key))
  )
    fail();
  const result = {
    extended: true,
    kind: resource + (rawId ? "-detail" : "") + (action ? "-" + action : ""),
    targetId: decode(rawTarget),
    resource,
    ...(rawId ? { itemId: decode(rawId) } : {}),
    action,
  };
  for (const key of keys) {
    const value = query.get(key);
    if (key === "revision" || key === "limit") {
      if (
        !/^[1-9][0-9]*$/.test(value) ||
        !integer(Number(value)) ||
        (key === "limit" && Number(value) > 100)
      )
        fail();
      result[key] = Number(value);
    } else if (key === "runId") {
      if (!id(value)) fail();
      result[key] = value;
    } else if (key === "kind") {
      if (!["finding", "knowledge"].includes(value)) fail();
      result.recordKind = value;
    } else {
      if (!value || value.length > 4096) fail();
      result.cursor = value;
    }
  }
  return result;
}
export function knowledgeBodyLimit(route) {
  return route.resource === "evidence" && !route.itemId
    ? 24 * 1024 * 1024
    : 64 * 1024;
}
export function validateKnowledgeBody(value, route) {
  if (
    route.resource === "summary" ||
    (route.itemId && !["review", "revise", "retry"].includes(route.action))
  )
    fail("not_found");
  if (!object(value) || !integer(value.revision)) fail();
  const allowed =
    route.resource === "evidence"
      ? route.action === "retry"
        ? ["revision"]
        : ["revision", "runId", "eventSequence", "label", "mediaType", "base64"]
      : route.action === "review"
        ? ["revision", "expectedRevision", "decision", "note"]
        : [
            "revision",
            ...(route.itemId ? ["expectedRevision"] : ["kind"]),
            "title",
            "body",
            "refs",
          ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
  if (route.resource === "evidence") {
    if (route.itemId) {
      if (route.action !== "retry") fail();
      return value;
    }
    if (
      !id(value.runId) ||
      !(value.eventSequence == null || integer(value.eventSequence)) ||
      typeof value.label !== "string" ||
      !value.label.trim() ||
      value.label.length > 200 ||
      !types.has(value.mediaType) ||
      typeof value.base64 !== "string" ||
      value.base64.length > Math.ceil((16 * 1024 * 1024) / 3) * 4
    )
      fail();
    const bytes = Buffer.from(value.base64, "base64");
    if (
      bytes.length > 16 * 1024 * 1024 ||
      bytes.toString("base64") !== value.base64
    )
      fail();
    return { ...value, bytes };
  }
  if (route.itemId && !integer(value.expectedRevision)) fail();
  if (route.action === "review") {
    if (
      !["accepted", "rejected"].includes(value.decision) ||
      (value.note !== undefined &&
        (typeof value.note !== "string" || value.note.length > 2000))
    )
      fail();
  } else if (
    (route.itemId && route.action !== "revise") ||
    (!route.itemId && !["finding", "knowledge"].includes(value.kind)) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 160 ||
    typeof value.body !== "string" ||
    !value.body.trim() ||
    value.body.length > 12000 ||
    !Array.isArray(value.refs) ||
    !value.refs.length ||
    value.refs.length > 8 ||
    value.refs.some(
      (ref) =>
        !object(ref) ||
        !id(ref.runId) ||
        Object.keys(ref).some(
          (key) => !["runId", "eventSequence", "evidenceId"].includes(key),
        ) ||
        !(ref.eventSequence == null || integer(ref.eventSequence)) ||
        !(ref.evidenceId == null || id(ref.evidenceId)),
    )
  )
    fail();
  return value;
}
const publicModel = (value) =>
  object(value) ? pick(value, ["id", "version"]) : {};
const publicInstallation = (value) => ({
  ...pick(value, ["id", "version", "sourceSha256"]),
  model: publicModel(value.model),
});
export function publicEvidence(value, targetId, evidenceId) {
  if (
    !object(value) ||
    value.targetId !== targetId ||
    !id(value.id) ||
    (evidenceId && value.id !== evidenceId) ||
    !id(value.runId) ||
    !types.has(value.mediaType) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 ||
    value.bytes > 16 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !["available", "missing", "corrupt"].includes(value.integrity)
  )
    fail("invalid_response");
  return {
    ...pick(value, [
      "id",
      "targetId",
      "runId",
      "eventSequence",
      "eventId",
      "label",
      "mediaType",
      "sha256",
      "bytes",
      "createdAt",
      "integrity",
    ]),
    provenance: {
      ...pick(value.provenance ?? {}, [
        "installationId",
        "runtimeVersion",
        "sourceSha256",
      ]),
      model: publicModel(value.provenance?.model),
    },
  };
}
export function publicRecord(value, targetId, recordId) {
  if (
    !object(value) ||
    value.targetId !== targetId ||
    !id(value.id) ||
    (recordId && value.id !== recordId) ||
    !integer(value.revision) ||
    !["finding", "knowledge"].includes(value.kind) ||
    !["proposed", "accepted", "rejected", "superseded"].includes(value.state) ||
    !Array.isArray(value.refs) ||
    value.refs.length > 8 ||
    !["valid", "stale", "unavailable"].includes(value.validation?.status)
  )
    fail("invalid_response");
  return {
    ...pick(value, [
      "id",
      "targetId",
      "kind",
      "revision",
      "headRevision",
      "title",
      "body",
      "state",
      "createdAt",
      "reviewedAt",
      "needsRevalidation",
    ]),
    integration: {
      ...pick(value.integration ?? {}, [
        "revision",
        "sourceSha256",
        "configSha256",
      ]),
      model: publicModel(value.integration?.model),
    },
    refs: value.refs.map((ref) => ({
      ...pick(ref, [
        "runId",
        "eventSequence",
        "evidenceId",
        "throughSequence",
        "eventId",
        "journalPrefixSha256",
        "evidenceSha256",
      ]),
      ...(ref.installation
        ? { installation: publicInstallation(ref.installation) }
        : {}),
    })),
    validation: {
      status: value.validation.status,
      reasons: (Array.isArray(value.validation.reasons)
        ? value.validation.reasons
        : []
      ).filter((reason) =>
        [
          "integration_changed",
          "historical_integration",
          "reference_changed",
          "reference_unavailable",
          "verification_limit",
        ].includes(reason),
      ),
    },
    reviews: (value.reviews ?? []).map((review) =>
      pick(review, ["sequence", "state", "note", "reviewedAt"]),
    ),
    revisions: (value.revisions ?? []).map((revision) =>
      pick(revision, ["revision", "title", "state", "createdAt", "reviewedAt"]),
    ),
  };
}
function supported(catalog) {
  if (![2, 3, 4].includes(catalog.catalogVersion))
    fail("catalog_upgrade_required");
}
export async function readKnowledgeRoute(route, { catalog, evidence }) {
  supported(catalog);
  const { targetId, itemId } = route;
  if (route.resource === "records") {
    if (route.action) fail("not_found");
    if (itemId)
      return {
        json: {
          record: publicRecord(
            await catalog.getRecord({
              targetId,
              recordId: itemId,
              revision: route.revision,
            }),
            targetId,
            itemId,
          ),
        },
      };
    const value = await catalog.listRecords({
      targetId,
      kind: route.recordKind,
      limit: route.limit ?? 25,
      cursor: route.cursor ?? null,
    });
    if (
      value.targetId !== targetId ||
      !Array.isArray(value.records) ||
      value.records.length > (route.limit ?? 25)
    )
      fail("invalid_response");
    return {
      json: {
        targetId,
        records: value.records.map((record) => publicRecord(record, targetId)),
        nextCursor: value.nextCursor,
      },
    };
  }
  if (route.resource === "summary") {
    const value = await catalog.getTargetSummary({ targetId });
    if (
      value.targetId !== targetId ||
      !Array.isArray(value.items) ||
      value.items.length > 25
    )
      fail("invalid_response");
    return {
      json: {
        targetId,
        targetRevision: value.targetRevision,
        items: value.items.map((record) => publicRecord(record, targetId)),
        excluded: (value.excluded ?? []).map((item) =>
          pick(item, ["id", "reason"]),
        ),
        historicalOnly: true,
      },
    };
  }
  if (!evidence) fail("operation_failed");
  if (itemId) {
    if (route.action === "content") {
      const value = await evidence.read({ targetId, evidenceId: itemId }),
        metadata = publicEvidence(
          { ...value.metadata, integrity: "available" },
          targetId,
          itemId,
        );
      if (
        !(value.bytes instanceof Uint8Array) ||
        value.bytes.length !== metadata.bytes
      )
        fail("invalid_response");
      return {
        binary: value.bytes,
        mediaType: metadata.mediaType,
        filename: itemId,
      };
    }
    if (route.action) fail("not_found");
    return {
      json: {
        evidence: publicEvidence(
          await evidence.inspect({ targetId, evidenceId: itemId }),
          targetId,
          itemId,
        ),
      },
    };
  }
  const value = await catalog.listEvidence({
    targetId,
    runId: route.runId,
    limit: route.limit ?? 25,
    cursor: route.cursor ?? null,
  });
  if (
    value.targetId !== targetId ||
    !Array.isArray(value.items) ||
    value.items.length > (route.limit ?? 25)
  )
    fail("invalid_response");
  const items = [];
  let bytes = 0;
  for (const item of value.items) {
    bytes += item.bytes;
    if (bytes > 128 * 1024 * 1024) fail("evidence_limit");
    items.push(
      publicEvidence(
        await evidence.inspect({ targetId, evidenceId: item.id }),
        targetId,
        item.id,
      ),
    );
  }
  const pending = await evidence.listPending({ targetId });
  return {
    json: {
      targetId,
      evidence: items,
      nextCursor: value.nextCursor,
      pending: pending.map((item) =>
        pick(item, [
          "id",
          "evidenceId",
          "targetId",
          "runId",
          "label",
          "state",
          "integrity",
          "reason",
        ]),
      ),
    },
  };
}
export async function writeKnowledgeRoute(route, input, { catalog, evidence }) {
  supported(catalog);
  const { targetId, itemId } = route;
  const options = { targetId, expectedTargetRevision: input.revision };
  if (route.resource === "records") {
    const record =
      route.action === "review"
        ? await catalog.reviewRecord({
            ...options,
            recordId: itemId,
            expectedRevision: input.expectedRevision,
            decision: input.decision,
            note: input.note,
          })
        : route.action === "revise"
          ? await catalog.reviseRecord({
              ...options,
              recordId: itemId,
              expectedRevision: input.expectedRevision,
              title: input.title,
              body: input.body,
              refs: input.refs,
            })
          : await catalog.createRecord({
              ...options,
              kind: input.kind,
              title: input.title,
              body: input.body,
              refs: input.refs,
            });
    return { ok: true, record: publicRecord(record, targetId, itemId) };
  }
  if (route.resource !== "evidence" || !evidence) fail("not_found");
  const value =
    route.action === "retry"
      ? await evidence.retry({ ...options, evidenceId: itemId })
      : await evidence.put({
          ...options,
          runId: input.runId,
          eventSequence: input.eventSequence ?? null,
          label: input.label,
          mediaType: input.mediaType,
          bytes: input.bytes,
        });
  return { ok: true, evidence: publicEvidence(value, targetId, itemId) };
}
