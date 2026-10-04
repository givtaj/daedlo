// Starts only the web server; the enclosing fixture owns this child process.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
const [appRootArg, cacheDirArg, portArg] = process.argv.slice(2);
if (!portArg) throw Error('Usage: fixture-web.mjs APP_ROOT OWNED_CACHE_DIR PORT');
const appRoot = resolve(appRootArg), cacheDir = resolve(cacheDirArg);
const requireFromApp = createRequire(join(appRoot, 'package.json'));
const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href);
const server = await createServer({ root: appRoot, cacheDir, configLoader: 'runner',
  server: { host: '127.0.0.1', port: Number(portArg), strictPort: true },
});
await server.listen();
console.log('FIXTURE_WEB_READY');
let stopping = false;
const close = async () => {
  if (stopping) return;
  stopping = true;
  try { await server.close(); }
  catch { process.exitCode = 1; }
};
process.once('SIGTERM', close);
process.once('SIGINT', close);
