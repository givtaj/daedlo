import fs from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { attachRoots } from './consumer.mjs';

// This candidate launcher attaches to the explicitly supplied disposable fixture.
// It owns only its browser/session/viewer; the fixture host owns app services.
export async function start() {
  const output = resolve(process.env.ROOTS_CONSUMER_ARTIFACTS || 'artifacts/roots');
  const fixture = JSON.parse(fs.readFileSync(join(output, 'fixture.json')));
  if (!fixture.disposable || fixture.stage !== 'ready') throw Error('An owned ready fixture is required');
  const accounts = JSON.parse(fs.readFileSync(join(fixture.root, 'accounts.json')));
  const browser = await chromium.launch({ headless: true });
  let consumer;
  let stopping = false;
  const close = async () => {
    if (stopping) return;
    stopping = true;
    await consumer?.close();
    await browser.close();
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    const page = await context.newPage();
    await page.goto(fixture.origin);
    consumer = await attachRoots({ page, context,
      snapshotRoot: join(output, 'snapshot'),
      enginePath: join(output, 'engine-target/debug/roots-browser-driver-consumer'),
      account: accounts.customer,
      identity: { rootsSource: fixture.sourceCommit, candidate: JSON.parse(fs.readFileSync(join(output, 'package.json'))) },
    });
    await consumer.adapter.settle();
    console.log(JSON.stringify({ viewerUrl: consumer.monitor.url, pid: process.pid, fixtureAttached: true }));
    const stop = () => close().then(() => process.exit(0), () => process.exit(1));
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  } catch (e) { await close(); throw e; }
}
