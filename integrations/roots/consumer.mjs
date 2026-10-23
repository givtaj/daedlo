import { createDriverSession, createViewer } from '@daedlo/runtime';
import { createRootsAdapter } from './adapter.mjs';

export async function attachRoots({ page, context, snapshotRoot, enginePath, account, identity, viewer = true }) {
  const adapter = await createRootsAdapter({ page, context, snapshotRoot, account });
  const session = await createDriverSession({ page, context, enginePath, adapter, identity });
  const monitor = viewer ? await createViewer({ page, context, session, port: 0 }) : null;
  return { session, monitor, adapter, async close() {
    await monitor?.close();
    await session.close();
  } };
}
