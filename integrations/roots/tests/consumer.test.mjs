import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
test('Roots consumer has public-package entrypoint and independently mapped handlers', () => {
  const entry = new URL('consumer.mjs', root);
  assert.ok(fs.existsSync(entry), 'Roots has no external browser-driver consumer entrypoint');
  const source = fs.readFileSync(entry, 'utf8');
  assert.match(source, /from ['"]@browser-driver\/runtime['"]/);
  assert.doesNotMatch(source, /live-qa\/src\/execution|live-qa\/src\/engine-client/);
  const adapter = fs.readFileSync(new URL('adapter.mjs', root), 'utf8');
  assert.match(adapter, /handlers/);
  assert.doesNotMatch(adapter, /createDriver\(/);
});
