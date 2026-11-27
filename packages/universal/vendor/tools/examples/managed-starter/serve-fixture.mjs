import { createStarterFixture } from "../starter/fixture.mjs";
const fixture = await createStarterFixture();
console.log(
  JSON.stringify({
    origin: fixture.url,
    scope: "Disposable synthetic starter, owned by this foreground process",
  }),
);
let closing;
const close = () => (closing ??= fixture.close());
process.once("SIGINT", close);
process.once("SIGTERM", close);
