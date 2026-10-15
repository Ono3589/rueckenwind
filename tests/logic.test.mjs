// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { windRelation, assessTrip, dayTarget, commuteDone, assessDay } from '../js/weather.js';
import { carCostPerKm, bikeCostPerKm, summarize } from '../js/costs.js';
import { DEFAULTS } from '../js/store.js';
import { bearing, distanceM } from '../js/geo.js';

const rules = DEFAULTS.rules;

function fakeForecast(date, overrides = {}) {
  const time = [];
  const h = { temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], weather_code: [] };
  for (let i = 0; i < 24; i++) {
    time.push(`${date}T${String(i).padStart(2, '0')}:00`);
    h.temperature_2m.push(12);
    h.apparent_temperature.push(10);
    h.precipitation_probability.push(5);
    h.precipitation.push(0);
    h.wind_speed_10m.push(10);
    h.wind_direction_10m.push(270);
    h.wind_gusts_10m.push(20);
    h.weather_code.push(1);
  }
  for (const [k, byHour] of Object.entries(overrides)) for (const [hr, v] of Object.entries(byHour)) h[k][+hr] = v;
  return { hourly: { time, ...h }, daily: { time: [date], sunrise: [`${date}T07:20`], sunset: [`${date}T18:40`] } };
}

test('Wind von hinten wird als Rückenwind erkannt', () => {
  // Fahrt nach Osten (90°), Wind kommt aus Westen (270°)
  const r = windRelation(270, 90, 20);
  assert.equal(r.kind, 'rueck');
  assert.ok(r.head < -19);
  assert.equal(windRelation(90, 90, 20).kind, 'gegen');
  assert.equal(windRelation(0, 90, 20).kind, 'seite');
});

test('Gutes Wetter ergibt keine Warnungen', () => {
  const fc = fakeForecast('2026-10-12');
  const t = assessTrip(fc, '2026-10-12', '07:30', 27, 90, rules);
  assert.equal(t.sev, 0);
  assert.equal(t.rel.kind, 'rueck');
});

test('Regen in der Fahrtzeit wird hart gewertet, Regen außerhalb nicht', () => {
  const fc = fakeForecast('2026-10-12', { precipitation_probability: { 17: 80 }, precipitation: { 17: 2.4 } });
  assert.equal(assessTrip(fc, '2026-10-12', '07:30', 27, 90, rules).sev, 0);
  assert.equal(assessTrip(fc, '2026-10-12', '17:00', 27, 270, rules).sev, 2);
});

test('Fahrt über die Stundengrenze nimmt beide Stunden mit', () => {
  const fc = fakeForecast('2026-10-12', { temperature_2m: { 8: 1 } });
  const t = assessTrip(fc, '2026-10-12', '07:45', 27, 90, rules);
  assert.equal(t.temp, 1);
  assert.equal(t.sev, 2);
});

test('Heute und Morgen: genau diese zwei Tage, nicht mehr', () => {
  const fc = { daily: { time: ['2026-10-09', '2026-10-10', '2026-10-11'] } }; // Fr, Sa, So
  assert.deepEqual(dayTarget(fc, 0), { date: '2026-10-09', index: 0, isToday: true });
  assert.deepEqual(dayTarget(fc, 1), { date: '2026-10-10', index: 1, isToday: false }); // morgen = Samstag, kein Überspringen
  assert.equal(dayTarget(fc, 99).date, '2026-10-11'); // nie über die Vorhersage hinaus
});

test('Nach dem Rückweg ist „Morgen“ die Voreinstellung', () => {
  const route = DEFAULTS.route; // Rückweg 17:00 + ca. 27 min
  assert.equal(commuteDone(route, new Date('2026-10-09T19:00:00')), true);
  assert.equal(commuteDone(route, new Date('2026-10-09T06:30:00')), false);
  assert.equal(commuteDone(route, new Date('2026-10-09T17:20:00')), false);
});

test('Ein fertiger Kurs ersetzt Zuhause/Arbeit (für den Push-Dienst)', () => {
  const fc = fakeForecast('2026-10-12');
  const route = { ...DEFAULTS.route, bearing: 90 };
  const day = assessDay(fc, route, rules, { date: '2026-10-12', index: 0, isToday: true });
  assert.equal(day.hin.rel.kind, 'rueck'); // Fahrt nach Osten, Wind aus Westen
  assert.equal(day.rueck.rel.kind, 'gegen');
});

test('Kosten pro km aus Fahrzeugdaten', () => {
  const car = { ...DEFAULTS.car, consumption: 6, energyPrice: 1.8, maintenance: 600, tires: 0, annualKm: 12000, mode: 'laufend' };
  const c = carCostPerKm(car);
  assert.ok(Math.abs(c.energy - 0.108) < 1e-9);
  assert.ok(Math.abs(c.total - 0.158) < 1e-9);
  const voll = carCostPerKm({ ...car, mode: 'voll' });
  assert.ok(voll.total > c.total);
  const b = bikeCostPerKm({ ...DEFAULTS.bike, annualKm: 0 });
  assert.equal(b.wear, 0); // keine Division durch null
});

test('Bilanz zählt Parken pro Tag und Pauschale pro Tag', () => {
  const state = structuredClone(DEFAULTS);
  state.car.parkingPerDay = 3;
  const rides = [
    { date: '2026-10-05', direction: 'hin', km: 10, kcal: 200 },
    { date: '2026-10-05', direction: 'rueck', km: 10, kcal: 200 },
    { date: '2026-10-06', direction: 'hin', km: 10, kcal: 200 },
  ];
  const s = summarize(rides, state);
  assert.equal(s.km, 30);
  assert.equal(s.days, 2);
  assert.equal(s.parking, 6);
  assert.equal(s.taxKm, 20);
  assert.equal(s.kcal, 600);
});

test('Geodaten: Kurs und Distanz', () => {
  const a = { lat: 48.0, lon: 11.0 };
  const b = { lat: 48.0, lon: 11.1 };
  assert.ok(Math.abs(bearing(a, b) - 90) < 0.1);
  assert.ok(Math.abs(distanceM(a, b) - 7440) < 30);
});

import { simplify, mapThumb } from '../js/map.js';

test('Routenlinie wird ausgedünnt, Start und Ziel bleiben', () => {
  const line = Array.from({ length: 200 }, (_, i) => [48 + i * 0.0003, 11 + i * 0.0003]); // gerade Linie
  const s = simplify(line);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], line[0]);
  assert.deepEqual(s[1], line[199]);
  const bent = [[48, 11], [48.01, 11], [48.01, 11.01]];
  assert.equal(simplify(bent).length, 3);
});

test('Kartenvorschau passt die Route ins Bild', () => {
  const html = mapThumb([[48.0667, 11.6152], [48.1, 11.6], [48.1374, 11.5755]], { width: 480, height: 230, pad: 30 });
  assert.match(html, /tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/);
  const pts = [...html.matchAll(/class="(?:start|end)" cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => [+m[1], +m[2]]);
  assert.equal(pts.length, 2);
  for (const [x, y] of pts) assert.ok(x >= 30 && x <= 450 && y >= 30 && y <= 200);
  assert.equal(mapThumb([[48, 11]]), '');
});
