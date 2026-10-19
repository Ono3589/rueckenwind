// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifyConfig, normalizeUrl } from '../js/push.js';
import { DEFAULTS } from '../js/store.js';
import { validConfig } from '../worker/src/index.js';

const state = () => {
  const s = structuredClone(DEFAULTS);
  s.route.home = { lat: 48.06671, lon: 11.61524, label: 'Zuhause' };
  s.route.work = { lat: 48.13742, lon: 11.57551, label: 'Arbeit' };
  return s;
};

test('Ohne Zuhause und Arbeit gibt es keine Konfiguration', () => {
  assert.equal(buildNotifyConfig(structuredClone(DEFAULTS)), null);
});

test('Die Konfiguration enthält keine genauen Adressen und ist für den Dienst gültig', () => {
  const cfg = buildNotifyConfig(state());
  const json = JSON.stringify(cfg);
  for (const secret of ['48.06671', '11.61524', '48.13742', '11.57551', 'Zuhause', 'Arbeit']) assert.ok(!json.includes(secret), secret);
  assert.deepEqual(cfg.mid, { lat: 48.1, lon: 11.6 }); // auf 2 Stellen gerundet
  assert.ok(cfg.bearing >= 0 && cfg.bearing <= 360);
  assert.equal(validConfig(cfg), true);
});

test('Fahrtkurs: Arbeit im Nordwesten ergibt einen Kurs um 330 Grad', () => {
  const cfg = buildNotifyConfig(state());
  assert.ok(cfg.bearing > 320 && cfg.bearing < 340, cfg.bearing);
});

test('Nur https-Adressen sind erlaubt (außer localhost)', () => {
  assert.equal(normalizeUrl(' https://rueckenwind-push.name.workers.dev/ '), 'https://rueckenwind-push.name.workers.dev');
  assert.equal(normalizeUrl('http://example.org'), null);
  assert.equal(normalizeUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeUrl('quatsch'), null);
});

test('Die Konfiguration enthält die Abendfrage und bleibt für den Dienst gültig', () => {
  const st = state();
  const cfg = buildNotifyConfig(st);
  assert.equal(cfg.eveningOn, true);
  assert.equal(cfg.eveningAt, '18:30');
  st.notify.eveningOn = false;
  st.notify.eveningAt = '19:15';
  const off = buildNotifyConfig(st);
  assert.equal(off.eveningOn, false);
  assert.equal(off.eveningAt, '19:15');
  assert.equal(validConfig(off), true);
});
