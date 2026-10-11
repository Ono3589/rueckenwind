// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { createVault, unlockVault, verifyPin, importVault, hasVault, removeVault, vaultMeta, weakPin, isVaultFile } = await import('../js/vault.js');

const state = { route: { home: { lat: 48.0667, lon: 11.6152, label: 'Zuhause' } }, rides: [{ km: 10 }], strava: { clientSecret: 'geheim' } };

test('Gespeicherte Daten sind verschlüsselt und enthalten keinen Klartext', async () => {
  store.clear();
  await createVault('482916', state);
  const raw = localStorage.getItem('rueckenwind.lock.v1');
  assert.ok(hasVault());
  assert.equal(vaultMeta().len, 6);
  for (const secret of ['geheim', 'Zuhause', '48.0667']) assert.ok(!raw.includes(secret), `Klartext gefunden: ${secret}`);
});

test('Richtige PIN entsperrt, falsche nicht', async () => {
  const { state: s } = await unlockVault('482916');
  assert.deepEqual(s, state);
  await assert.rejects(unlockVault('482917'));
  assert.equal(await verifyPin('482916'), true);
  assert.equal(await verifyPin('000000'), false);
});

test('Speichern verschlüsselt neu und bleibt in Reihenfolge', async () => {
  const { session } = await unlockVault('482916');
  session.save({ ...state, rides: [{ km: 1 }] });
  session.save({ ...state, rides: [{ km: 1 }, { km: 2 }] });
  await session.flush();
  const { state: s } = await unlockVault('482916');
  assert.equal(s.rides.length, 2);
  assert.ok(!localStorage.getItem('rueckenwind.lock.v1').includes('geheim'));
});

test('PIN ändern: neue PIN gilt, alte nicht, Daten bleiben', async () => {
  const { session } = await unlockVault('482916');
  await assert.rejects(session.changePin('111111', '73915028'));
  await session.changePin('482916', '73915028');
  assert.equal(vaultMeta().len, 8);
  assert.equal(await verifyPin('482916'), false);
  const { state: s } = await unlockVault('73915028');
  assert.equal(s.rides.length, 2);
});

test('Sicherung wiederherstellen braucht die richtige PIN', async () => {
  const { session } = await unlockVault('73915028');
  const backup = JSON.stringify(await session.record());
  assert.ok(isVaultFile(JSON.parse(backup)));
  removeVault();
  assert.equal(hasVault(), false);
  await assert.rejects(importVault(backup, '00000000'));
  assert.equal(hasVault(), false); // bei falscher PIN wird nichts übernommen
  const { state: s } = await importVault(backup, '73915028');
  assert.equal(s.rides.length, 2);
  assert.ok(hasVault());
});

test('Präparierte Dateien werden abgelehnt', async () => {
  const bad = { v: 1, iter: 999999999, len: 6, salt: 'AA', wrapIv: 'AA', wrapped: 'AA', iv: 'AA', data: 'AA' };
  await assert.rejects(importVault(JSON.stringify(bad), '123456'));
  await assert.rejects(importVault('{"x":1}', '123456'));
});

test('Zu einfache PINs werden erkannt', () => {
  for (const p of ['000000', '111111', '123456', '654321', '12345678']) assert.ok(weakPin(p), p);
  for (const p of ['482916', '135790', '121212']) assert.ok(!weakPin(p), p);
});
