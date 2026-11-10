// Internal shared validation: reject an invalid listener configuration before
// project startup effects or browser capture. This does not authorize remote use.
export function viewerAddress(host, publicOrigin) {
  if (!["127.0.0.1", "0.0.0.0"].includes(host))
    throw new TypeError("Invalid viewer host");
  if (publicOrigin === undefined) {
    if (host !== "127.0.0.1")
      throw new TypeError(
        "A loopback public origin is required for this viewer host",
      );
    return null;
  }
  const invalid = () => {
    throw new TypeError("Invalid viewer public origin");
  };
  if (typeof publicOrigin !== "string") invalid();
  let origin;
  try {
    origin = new URL(publicOrigin);
  } catch {
    invalid();
  }
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    !origin.port ||
    Number(origin.port) < 1 ||
    origin.username ||
    origin.password ||
    origin.origin !== publicOrigin
  )
    invalid();
  return origin;
}
