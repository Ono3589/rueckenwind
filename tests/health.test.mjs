// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHealthText } from '../js/health.js';

const opts = { distanceKm: 10, today: '2026-10-12' };

test('Zeilen aus dem Kurzbefehl werden gelesen, Komma und Punkt sind gleich', () => {
  const { items, ignored } = parseHealthText('2026-10-12;07:31;10,4;27;186\n2026-10-12;17:05;10.2;26;181', opts);
  assert.equal(ignored.length, 0);
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].direction, items[0].km, items[0].minutes, items[0].kcal], ['hin', 10.4, 27, 186]);
  assert.deepEqual([items[1].direction, items[1].km], ['rueck', 10.2]);
});

test('Richtung folgt der Startzeit, auch deutsche Datumsangaben gehen', () => {
  const { items } = parseHealthText('12.10.2026;11:59;9,8;;\n12.10.2026;12:00;9,9;;', opts);
  assert.deepEqual(items.map((i) => i.direction), ['hin', 'rueck']);
  assert.equal(items[0].date, '2026-10-12');
  assert.equal(items[0].minutes, null);
  assert.equal(items[0].kcal, null);
});

test('Tagessumme ohne Startzeit wird auf Hin- und Rückweg verteilt', () => {
  const { items } = parseHealthText('2026-10-12;;20,8;54;372', opts);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => [i.direction, i.km, i.minutes, i.kcal]), [['hin', 10.4, 27, 186], ['rueck', 10.4, 27, 186]]);
  assert.ok(items.every((i) => i.fits));
});

test('Ohne Startzeit und mit passender Einzelstrecke: erst Hinweg, dann Rückweg', () => {
  const { items } = parseHealthText('2026-10-12;;10,1\n2026-10-12;;10,3', opts);
  assert.deepEqual(items.map((i) => i.direction), ['hin', 'rueck']);
});

test('Kaputte oder unplausible Zeilen werden gemeldet und nicht übernommen', () => {
  const text = ['RW;Fahrten', 'abc;07:30;10;20;100', '2026-02-30;07:30;10;20;100', '2026-10-12;07:30;0;20;100', '2026-10-12;07:30;900;20;100', '2026-10-12;07:30;10;0;100', '2026-10-12;07:30;10;20;99999', '2027-01-01;07:30;10;20;100', '', '# Kommentar', '2026-10-12;07:30;10,0;20;100'].join('\n');
  const { items, ignored } = parseHealthText(text, opts);
  assert.equal(items.length, 1);
  assert.equal(ignored.length, 7);
});

test('Fahrten, die nicht zur Pendelstrecke passen, sind nicht vorgewählt', () => {
  const { items } = parseHealthText('2026-10-11;10:00;42,0;120;900\n2026-10-12;07:30;10,2;27;180', opts);
  assert.equal(items.find((i) => i.km === 42).fits, false);
  assert.equal(items.find((i) => i.km === 10.2).fits, true);
});

test('Doppelte Zeilen zählen nur einmal, Zeilenzahl ist begrenzt', () => {
  const dup = '2026-10-12;07:30;10,2;27;180';
  assert.equal(parseHealthText(`${dup}\n${dup}`, opts).items.length, 1);
  const many = Array.from({ length: 800 }, (_, i) => `2026-10-12;07:30;${(5 + i / 100).toFixed(2)};20;100`).join('\n');
  assert.ok(parseHealthText(many, opts).items.length <= 500);
});

test('Leerer Text und Unsinn ergeben nichts', () => {
  assert.deepEqual(parseHealthText('', opts), { items: [], ignored: [] });
  assert.equal(parseHealthText('<script>alert(1)</script>', opts).items.length, 0);
});
