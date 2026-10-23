import { createDriverSession, createViewer } from '@daedlo/runtime';
import { createRootsEditAdapter } from './adapter.mjs';

export async function attachRootsEdit({ page, context, enginePath, identity, viewer = true, ...customer }) {
  const adapter = await createRootsEditAdapter({ page, context, ...customer });
  let session, monitor;
  try {
    session = await createDriverSession({ page, context, enginePath, adapter, identity });
    monitor = viewer ? await createViewer({ page, context, session, port: 0 }) : null;
  } catch (error) {
    if (session) await session.close();
    else await adapter.close();
    throw error;
  }
  return { session, monitor, adapter, async close() {
    await monitor?.close();
    await session.close();
  } };
}
