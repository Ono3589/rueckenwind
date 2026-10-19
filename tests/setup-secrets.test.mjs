// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { b64u } from '../worker/src/webpush.js';

test('Das Skript legt passende Geheimnisse ab und zeigt nur das Token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'));
  const fake = join(dir, 'fake.sh');
  writeFileSync(fake, `#!/bin/sh\necho "$(pwd)" > "${dir}/cwd.txt"\ncat > "${dir}/$3.val"\n`);
  chmodSync(fake, 0o755);
  // Aus einem fremden Ordner gestartet: das Skript muss trotzdem in worker/ arbeiten
  const r = spawnSync('node', [join(process.cwd(), 'worker/scripts/setup-secrets.mjs')], { cwd: tmpdir(), env: { ...process.env, WRANGLER_CMD: fake }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(join(dir, 'cwd.txt'), 'utf8').trim().endsWith('/worker'));
  const pub = readFileSync(join(dir, 'VAPID_PUBLIC.val'), 'utf8');
  const jwk = JSON.parse(readFileSync(join(dir, 'VAPID_PRIVATE_JWK.val'), 'utf8'));
  const token = readFileSync(join(dir, 'API_TOKEN.val'), 'utf8');
  // Öffentlicher und privater Schlüssel gehören zusammen: Punkt = 0x04 || x || y
  const raw = b64u.decode(pub);
  assert.equal(raw.length, 65);
  assert.equal(b64u.encode(raw.slice(1, 33)), jwk.x);
  assert.equal(b64u.encode(raw.slice(33)), jwk.y);
  // Der private Schlüssel kann signieren, und die Signatur passt zum öffentlichen Schlüssel
  const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, new TextEncoder().encode('x'));
  const pubKey = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sig, new TextEncoder().encode('x')), true);
  assert.match(token, /^[0-9a-f]{48}$/);
  // Ausgabe enthält das Token, aber nie den privaten Schlüssel
  assert.ok(r.stdout.includes(token));
  assert.ok(!r.stdout.includes(jwk.d) && !r.stderr.includes(jwk.d));
});

test('Schlägt ein Schritt fehl, bricht das Skript mit Hinweis ab', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'));
  const fake = join(dir, 'fail.sh');
  writeFileSync(fake, '#!/bin/sh\nexit 1\n');
  chmodSync(fake, 0o755);
  const r = spawnSync('node', ['worker/scripts/setup-secrets.mjs'], { env: { ...process.env, WRANGLER_CMD: fake }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /noch einmal/);
  assert.ok(!r.stdout.includes('Fertig'));
});

test('Mit „ingest“ wird nur der Abliefer-Schlüssel gesetzt, die anderen bleiben unberührt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rw-'));
  const fake = join(dir, 'fake.sh');
  writeFileSync(fake, `#!/bin/sh\necho "$3" >> "${dir}/names.txt"\ncat > "${dir}/$3.val"\n`);
  chmodSync(fake, 0o755);
  const r = spawnSync('node', [join(process.cwd(), 'worker/scripts/setup-secrets.mjs'), 'ingest'], { env: { ...process.env, WRANGLER_CMD: fake }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(dir, 'names.txt'), 'utf8').trim(), 'INGEST_TOKEN');
  const token = readFileSync(join(dir, 'INGEST_TOKEN.val'), 'utf8');
  assert.match(token, /^[0-9a-f]{48}$/);
  assert.ok(r.stdout.includes(token));
});
