// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotification, TITLES } from '../js/messages.js';

const day = (status, extra = {}) => ({ status, reason: 'Trocken, 12 °C.', gear: [], ...extra });

test('Jede Bewertung hat mehrere Varianten', () => {
  for (const k of ['go', 'caution', 'no']) assert.ok(TITLES[k].length >= 6, k);
});

test('Gut: Überschrift aus dem Gut-Vorrat, Grund steht im Text', () => {
  const n = buildNotification(day('go'), '2026-10-15');
  assert.ok(TITLES.go.includes(n.title));
  assert.equal(n.body, 'Trocken, 12 °C.');
});

test('Schlecht: Auto-Empfehlung ohne Ausrüstungstipps', () => {
  const n = buildNotification(day('no', { gear: [{ text: 'Licht an' }] }), '2026-10-15');
  assert.ok(TITLES.no.includes(n.title));
  assert.ok(!n.body.includes('Denk an'));
});

test('Machbar: Ausrüstungstipps werden angehängt', () => {
  const n = buildNotification(day('caution', { gear: [{ text: 'Regenjacke' }, { text: 'Licht an' }] }), '2026-10-15');
  assert.ok(n.body.endsWith('Denk an: Regenjacke, Licht an.'));
});

test('An zwei aufeinanderfolgenden Tagen kommt nie dieselbe Überschrift', () => {
  for (const status of ['go', 'caution', 'no']) {
    let prev = null;
    for (let d = 1; d <= 60; d++) {
      const date = new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10);
      const { title } = buildNotification(day(status), date);
      assert.notEqual(title, prev, `${status} ${date}`);
      prev = title;
    }
  }
});

test('Gleicher Tag, gleiche Meldung', () => {
  assert.deepEqual(buildNotification(day('go'), '2026-10-15'), buildNotification(day('go'), '2026-10-15'));
});

test('Rückenwind auf dem Hinweg erweitert die Auswahl', () => {
  const titles = new Set();
  for (let d = 1; d <= 30; d++) {
    const date = new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10);
    titles.add(buildNotification(day('go', { hin: { rel: { kind: 'rueck' } } }), date).title);
  }
  assert.ok([...titles].some((t) => !TITLES.go.includes(t)));
});
