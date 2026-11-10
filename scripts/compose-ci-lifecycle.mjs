// Only the caller's isolated project is touched. Failed/incomplete runs keep
// containers, images and the evidence volume for an explicit later decision.
export async function finalizeComposeRun({
  passed,
  owned,
  interrupted = () => false,
  compose,
  finalReport,
  persist,
  removeImages,
  results,
}) {
  let archived = false;
  let imageCleanup;
  const record = (name, status, error) =>
    results.push({ name, status, ...(error ? { error: error.message } : {}) });
  const save = (phase) => persist({ phase, imageCleanup });

  if (owned) {
    const failures = [];
    // Stop first so clean-shutdown reports can be copied. A failed stop or
    // export is evidence uncertainty, never permission to delete the volume.
    // Application state may be in memory. Keep it alive until evidence export
    // and persistence succeed, including when finalization itself fails.
    for (const args of [
      ["stop", "-t", "30", "daedlo"],
      ["logs", "--no-color"],
      ["cp", "daedlo:/evidence/session.json", finalReport],
    ]) {
      try {
        await compose(...args);
      } catch (error) {
        failures.push(error);
      }
    }
    archived = failures.length === 0;
    record(
      "final Compose evidence archived",
      archived ? "PASS" : "FAIL",
      failures[0],
    );
  } else {
    record("final Compose evidence archived", "BLOCKED");
  }

  // Persist and flush evidence before any destructive operation. A write error
  // propagates immediately, retaining all Docker resources.
  await save("resources-retained");
  if (!owned || !passed || !archived || interrupted()) {
    record("owned Compose resources cleaned", "BLOCKED");
    record("owned Compose test images cleaned", "BLOCKED");
    await save("resources-retained");
    return false;
  }

  try {
    await compose("down", "--volumes", "--timeout", "30");
    record("owned Compose resources cleaned", "PASS");
  } catch (error) {
    record("owned Compose resources cleaned", "FAIL", error);
    record("owned Compose test images cleaned", "BLOCKED");
    await save("teardown-incomplete");
    return false;
  }
  await save("images-retained");
  if (interrupted()) {
    record("owned Compose test images cleaned", "BLOCKED");
    await save("images-retained");
    return false;
  }
  try {
    imageCleanup = await removeImages();
    record("owned Compose test images cleaned", "PASS");
  } catch (error) {
    imageCleanup = {
      removed: error.removedImages ?? [],
      possiblyRemoved: error.possiblyRemovedImages ?? [],
    };
    record("owned Compose test images cleaned", "FAIL", error);
    await save("images-retained");
    return false;
  }
  await save("complete");
  return true;
}
