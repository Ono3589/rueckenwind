// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { monotonePath, cumulativeSavings, dayChart, savingsChart, weeksChart } from '../js/charts.js';

const nums = (d) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

test('Die Kurve geht durch alle Punkte und überschwingt nicht', () => {
  const pts = [[0, 100], [10, 100], [20, 40], [30, 40], [40, 10]];
  const d = monotonePath(pts);
  assert.ok(!d.includes('NaN'));
  const ys = nums(d.replace(/[MC]/g, ' ')).filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) >= 10 - 0.1 && Math.max(...ys) <= 100 + 0.1, 'bleibt zwischen den Werten');
  for (const [x, y] of pts) assert.ok(d.includes(`${x} ${y}`), `Punkt ${x}/${y}`);
  assert.equal(monotonePath([]), '');
  assert.ok(monotonePath([[5, 5]]).startsWith('M5 5'));
});

test('Laufende Ersparnis summiert pro Tag, auch bei unsortierten Fahrten', () => {
  const rides = [
    { date: '2026-10-06', km: 10 },
    { date: '2026-10-05', km: 10 },
    { date: '2026-10-05', km: 10 },
  ];
  const c = cumulativeSavings(rides, 0.09, 2);
  assert.deepEqual(c.map((p) => p.date), ['2026-10-05', '2026-10-06']);
  assert.ok(Math.abs(c[0].value - (20 * 0.09 + 2)) < 1e-9);
  assert.ok(Math.abs(c[1].value - (30 * 0.09 + 4)) < 1e-9);
  assert.deepEqual(cumulativeSavings([], 0.09), []);
});

const forecast = (date) => {
  const time = [], t = [], p = [], mm = [], w = [];
  for (let h = 0; h < 24; h++) {
    time.push(`${date}T${String(h).padStart(2, '0')}:00`);
    t.push(6 + Math.sin((h - 9) / 4) * 6);
    p.push(h === 16 ? 70 : 8);
    mm.push(h === 16 ? 1.4 : 0);
    w.push(10 + h / 3);
  }
  return { hourly: { time, temperature_2m: t, precipitation_probability: p, precipitation: mm, wind_speed_10m: w } };
};
const day = { hin: { start: 450, end: 477, temp: 6, sev: 0 }, rueck: { start: 1020, end: 1047, temp: 13, sev: 1 } };

test('Der Tagesverlauf zeigt beide Fahrten, bleibt im Bild und liefert Wischwerte', () => {
  const html = dayChart(forecast('2026-10-15'), '2026-10-15', day, { nowMin: 600, uid: 't' });
  assert.ok(html.includes('win-band ok') && html.includes('win-band warn'));
  assert.ok(html.includes('class="now"'));
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
  const series = JSON.parse(/data-scrub="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.equal(series.length, 17); // 5 bis 21 Uhr
  assert.ok(series.every((s) => s.x >= 14 && s.x <= 346 && s.lines.length === 3));
  assert.ok(series.find((s) => s.title === '16 Uhr').lines[1].startsWith('70 %'));
  assert.equal(dayChart({ hourly: { time: [] } }, '2026-10-15', day), '');
  assert.ok(!dayChart(forecast('2026-10-15'), '2026-10-15', day, { nowMin: null }).includes('class="now"'));
});

test('Ersparnis-Profil: ein einzelner Tag und viele Tage ergeben sinnvolle Diagramme', () => {
  assert.equal(savingsChart([]), '');
  const one = savingsChart([{ date: '2026-10-05', value: 1.8 }]);
  assert.ok(one.includes('class="save-line"') && !one.includes('NaN'));
  const many = cumulativeSavings(Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), km: 20 })), 0.09);
  const html = savingsChart(many, { uid: 'm' });
  assert.ok(!html.includes('NaN'));
  const series = JSON.parse(/data-scrub="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"'));
  assert.equal(series.length, 40);
  assert.ok(series.every((s, i) => i === 0 || s.x > series[i - 1].x), 'x wächst mit der Zeit');
});

test('Wochenbalken: Ziel, aktuelle Woche und leere Wochen', () => {
  const weeks = Array.from({ length: 12 }, (_, i) => ({ label: String(30 + i), km: i < 3 ? 0 : i === 11 ? 61 : 102, current: i === 11 }));
  const html = weeksChart(weeks, 100, { uid: 'w' });
  assert.equal((html.match(/class="bar(?: |")/g) ?? []).length, 12);
  assert.ok(html.includes('bar cur') && html.includes('bar hit') && html.includes('bar zero'));
  assert.ok(html.includes('Ziel 100 km'));
  assert.ok(!html.includes('NaN'));
  const series = JSON.parse(/data-scrub="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"'));
  assert.equal(series[11].lines[1], '39 km bis zum Ziel');
  assert.equal(series[5].lines[1], 'Ziel erreicht');
});
