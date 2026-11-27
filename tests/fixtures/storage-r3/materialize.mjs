import fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const hash = (value) => createHash("sha256").update(value).digest("hex");
/** Materialize literal public v1 data, independently of production writers. */
export async function materializeV1(base) {
  const retained = JSON.parse(
    await fs.readFile(new URL("fixture-v1.json", import.meta.url)),
  );
  const schema = await fs.readFile(
    new URL("schema-v1.sql", import.meta.url),
    "utf8",
  );
  const journal = await fs.readFile(
    new URL("retained-run-v1.jsonl", import.meta.url),
  );
  if (
    hash(schema) !== retained.schemaSha256 ||
    hash(journal) !== retained.run.journalSha256
  )
    throw Error("Frozen fixture changed");
  const root = join(base, "workspace");
  const paths = {
    "@store": join(base, "store"),
    "@source": join(base, "source"),
    "@config": join(base, "config.json"),
  };
  const revisions = retained.revisions.map((row) => ({
    revision: row.revision,
    registration: {
      ...row.registration,
      store: paths[row.registration.store],
      sourceRoot: paths[row.registration.sourceRoot],
      configPath: paths[row.registration.configPath],
    },
  }));
  const current = revisions.at(-1);
  const journalRoot = join(
    root,
    "projects",
    current.registration.projectId,
    "run-journals",
  );
  await fs.mkdir(journalRoot, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    join(root, "workspace.json"),
    JSON.stringify(retained.workspace) + "\n",
    { mode: 0o600 },
  );
  const journalPath = join(journalRoot, retained.run.runId + ".jsonl");
  await fs.writeFile(journalPath, journal, { mode: 0o600 });
  const source = await fs.stat(journalPath, { bigint: true });
  const path = join(root, "workspace.sqlite");
  await (await fs.open(path, "wx", 0o600)).close();
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA page_size=4096; PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE",
    );
    db.exec(schema);
    db.exec(
      `PRAGMA application_id=${retained.applicationId}; PRAGMA user_version=1`,
    );
    db.prepare("INSERT INTO catalog_meta VALUES(1,?,?,?,?,?)").run(
      retained.catalogFormat,
      1,
      1,
      retained.workspace.workspaceId,
      retained.catalogId,
    );
    db.prepare("INSERT INTO catalog_migrations VALUES(1,?)").run(
      retained.schemaSha256,
    );
    db.prepare("INSERT INTO targets VALUES(?,?,?,?,?,?)").run(
      current.registration.id,
      current.registration.projectId,
      current.registration.store,
      current.registration.authProfileRef,
      current.revision,
      JSON.stringify(current.registration),
    );
    for (const row of revisions)
      db.prepare("INSERT INTO target_revisions VALUES(?,?,?)").run(
        row.registration.id,
        row.revision,
        JSON.stringify(row.registration),
      );
    db.prepare("INSERT INTO history_state VALUES(?,?,?)").run(
      current.registration.id,
      retained.historyState.generation,
      retained.historyState.indexedAt,
    );
    db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      current.registration.id,
      retained.run.runId,
      retained.run.summary.startedAt,
      JSON.stringify(retained.run.summary),
      String(source.dev),
      String(source.ino),
      journal.length,
      retained.run.journalSha256,
      retained.run.checkpointOffset,
      retained.run.journalSha256,
      retained.run.checkpointSequence,
    );
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  const identity = await fs.stat(path, { bigint: true });
  const bytes = await fs.readFile(path);
  const owner = {
    format: "daedlo-universal-owner/1",
    workspaceId: retained.workspace.workspaceId,
    catalogId: retained.catalogId,
    catalogVersion: 1,
    projectionVersion: 1,
    database: { dev: String(identity.dev), ino: String(identity.ino) },
    metadataPage: {
      offset: 4096,
      size: 4096,
      sha256: hash(bytes.subarray(4096, 8192)),
    },
  };
  await fs.writeFile(path + ".owner.json", JSON.stringify(owner) + "\n", {
    mode: 0o600,
  });
  return {
    root,
    path,
    journalPath,
    retained,
    current: current.registration,
    revisions,
  };
}
