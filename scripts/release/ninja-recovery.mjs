import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ninjaDirectory } from "./ninja-manager.mjs";

// Captured bytes never change on retry. Failed temporary cleanup stays owned.
export function createRecoveryArchive(root) {
  const retained = new Map();
  async function removeTemporary(item) {
    if (!item.temporary) return;
    const stat = await fs.lstat(item.temporary).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (
      stat &&
      (!stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.dev !== item.stat.dev ||
        stat.ino !== item.stat.ino)
    )
      throw Error("Recovery temporary file ownership changed.");
    if (stat) await fs.unlink(item.temporary);
    item.temporary = null;
  }
  const api = {
    status: () => ({
      pending: [...retained.values()].filter((item) => item.pending).length,
    }),
    async retry() {
      for (const [name, item] of retained)
        if (item.pending) await api.write(name, JSON.parse(item.bytes));
    },
    async write(name, value) {
      if (!/^[A-Za-z0-9.-]+$/.test(name))
        throw Error("Invalid recovery record name.");
      const bytes = JSON.stringify(value, null, 2) + "\n";
      let item = retained.get(name);
      if (item && item.bytes !== bytes)
        throw Error("Recovery evidence changed.");
      if (!item) {
        item = { bytes, pending: true };
        retained.set(name, item);
      }
      item.pending = true;
      await ninjaDirectory(root, { create: true });
      await removeTemporary(item);
      item.temporary = join(root, `.${name}.${randomUUID()}.tmp`);
      const handle = await fs.open(item.temporary, "wx", 0o600);
      item.stat = await handle.stat();
      try {
        await handle.writeFile(item.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const destination = join(root, name);
      try {
        await fs.link(item.temporary, destination);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const stat = await fs.lstat(destination);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          (stat.mode & 0o077) !== 0 ||
          (await fs.readFile(destination, "utf8")) !== item.bytes
        )
          throw Error("Recovery evidence conflicts with existing bytes.");
      }
      const directory = await fs.open(root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      await removeTemporary(item);
      item.pending = false;
    },
  };
  return api;
}
