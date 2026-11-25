import { readSelectedCases } from "./select.mjs";

const { acceptance, health, live } = await readSelectedCases();
console.log(
  JSON.stringify({
    schemaVersion: 1,
    acceptance,
    health,
    live: { selectedCase: live },
  }),
);
