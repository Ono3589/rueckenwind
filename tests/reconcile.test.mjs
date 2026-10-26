// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyIncoming, staleConflicts, replaceInSlot, slotOf } from '../js/reconcile.js';

const bosch = (date, direction, km = 10.4, extra = {}) => ({ date, direction, km, minutes: 27, kcal: 186, start: direction === 'hin' ? '07:31' : '17:05', fits: true, ref: `${date}|${direction}|${km}`, ...extra });
const manual = (id, date, direction, km = 10.4) => ({ id, date, direction, km, minutes: null, kcal: 160, kcalSource: 'schätzung', source: 'manuell' });

test('Freie Plätze werden übernommen, belegte werden zum Konflikt statt still überschrieben', () => {
  const rides = [manual('m1', '2026-10-21', 'hin')];
  const out = classifyIncoming([bosch('2026-10-21', 'hin', 10.8), bosch('2026-10-21', 'rueck')], { rides });
  assert.deepEqual(out.add.map(slotOf), ['2026-10-21|rueck']);
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].existingId, 'm1');
  assert.equal(out.conflicts[0].km, 10.8);
  assert.deepEqual(out.pending, []);
});

test('Auch Strava- und ältere Bosch-Fahrten am selben Platz werden nicht ohne Nachfrage ersetzt', () => {
  const rides = [{ ...manual('s1', '2026-10-20', 'hin'), source: 'strava' }, { ...manual('b1', '2026-10-20', 'rueck'), source: 'bosch', ref: 'alt' }];
  const out = classifyIncoming([bosch('2026-10-20', 'hin'), bosch('2026-10-20', 'rueck', 10.6)], { rides });
  assert.deepEqual(out.conflicts.map((c) => c.existingId), ['s1', 'b1']);
  assert.deepEqual(out.add, []);
});

test('Bekannte, behaltene und doppelt gelieferte Fahrten erscheinen kein zweites Mal', () => {
  const a = bosch('2026-10-22', 'hin');
  const rides = [{ ...manual('x', '2026-10-22', 'hin'), source: 'bosch', ref: a.ref }];
  assert.deepEqual(classifyIncoming([a], { rides }), { add: [], pending: [], conflicts: [] });
  const b = bosch('2026-10-23', 'hin');
  assert.deepEqual(classifyIncoming([b], { rides: [manual('m', '2026-10-23', 'hin')], kept: [b.ref] }).conflicts, []);
  const c = bosch('2026-10-24', 'hin');
  assert.equal(classifyIncoming([c], { conflicts: [{ ...c, existingId: 'm' }] }).conflicts.length, 0);
  assert.equal(classifyIncoming([c, { ...c }]).add.length, 1);
});

test('Was nicht zur Strecke passt oder einen schon vergebenen Platz will, geht zur Prüfung', () => {
  const tour = bosch('2026-10-25', 'hin', 42, { fits: false });
  const one = bosch('2026-10-26', 'hin');
  const two = bosch('2026-10-26', 'hin', 10.9);
  const out = classifyIncoming([tour, one, two]);
  assert.deepEqual(out.add, [one]);
  assert.deepEqual(out.pending, [tour, two]);
  // Kollidiert eine unpassende Fahrt mit einem belegten Platz, entscheidet der Abgleich
  const clash = classifyIncoming([tour], { rides: [manual('m', '2026-10-25', 'hin')] });
  assert.equal(clash.conflicts.length, 1);
});

test('Konflikte ohne Gegenstück lösen sich auf, Bestätigung ersetzt den ganzen Platz', () => {
  const c = { ...bosch('2026-10-21', 'hin', 10.8), existingId: 'm1' };
  assert.deepEqual(staleConflicts([c], [manual('m1', '2026-10-21', 'hin')]), []);
  assert.deepEqual(staleConflicts([c], []), [c]);
  const rides = [manual('m1', '2026-10-21', 'hin'), manual('m2', '2026-10-21', 'rueck')];
  const next = replaceInSlot(rides, c, { id: 'n', date: '2026-10-21', direction: 'hin', km: 10.8, source: 'bosch', ref: c.ref });
  assert.deepEqual(next.map((r) => r.id), ['m2', 'n']);
});
