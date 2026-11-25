import { readSelectedCases } from "./select.mjs";

const cases = await readSelectedCases();
console.log(JSON.stringify({ schemaVersion: 1, ...cases }));
