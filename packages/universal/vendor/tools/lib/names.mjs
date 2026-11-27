// Names are package identities, not schema versions. Historical signatures, reports
// and stores retain their original identifiers. Accept only one complete family.
export const releaseFamilies = Object.freeze(["daedlo", "browser-driver"]);
export function packageNames(prefix = "daedlo") {
  if (!releaseFamilies.includes(prefix))
    throw Error("Unknown release name family");
  return Object.freeze({
    prefix,
    runtime: `@${prefix}/runtime`,
    engine: `${prefix}-engine`,
    tools: `@${prefix}/release-tools`,
    skill: prefix,
  });
}
export function releaseNames(artifacts) {
  const prefix = releaseFamilies.find(
    (value) => artifacts?.runtime?.name === packageNames(value).runtime,
  );
  const names = prefix && packageNames(prefix);
  if (!names || artifacts?.engine?.name !== names.engine)
    throw Error("Artifact name family mismatch");
  return names;
}
export function runtimeNames(name) {
  const prefix = releaseFamilies.find(
    (value) => name === packageNames(value).runtime,
  );
  if (!prefix) throw Error("Unknown runtime package identity");
  return packageNames(prefix);
}
