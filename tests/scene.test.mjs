// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { legPose, RIG, skyline, commuteScene, cyclist } from '../js/scene.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('Beine behalten bei jedem Kurbelwinkel ihre Länge und greifen nie ins Leere', () => {
  for (let i = 0; i < 72; i++) {
    const s = legPose((i / 72) * Math.PI * 2);
    assert.ok(Math.abs(dist(s.hip, s.knee) - RIG.thigh) < 0.01, `Oberschenkel bei ${i}`);
    assert.ok(Math.abs(dist(s.knee, s.ankle) - RIG.shin) < 0.01, `Unterschenkel bei ${i}`);
    assert.ok(s.knee[0] > s.hip[0] - 5, `Knie zeigt nach vorn bei ${i}`);
    assert.ok(Math.abs(dist(s.pedal, RIG.bb) - RIG.crank) < 0.01, 'Pedal läuft auf dem Kurbelkreis');
  }
});

test('Der Tritt hat oben und unten die richtige Beugung', () => {
  const bottom = legPose(Math.PI / 2); // Pedal unten
  const top = legPose((3 * Math.PI) / 2); // Pedal oben
  assert.ok(bottom.ankle[1] > top.ankle[1] + 40);
  const bend = (s) => dist(s.hip, s.ankle);
  assert.ok(bend(bottom) > bend(top) + 40, 'unten gestreckt, oben stark gebeugt');
  assert.ok(bend(bottom) < RIG.thigh + RIG.shin, 'unten nie ganz durchgestreckt');
});

test('Die Skyline schließt nahtlos, damit sie endlos laufen kann', () => {
  for (const seed of [1, 11, 29, 77]) {
    const { d } = skyline(seed, { base: 172, min: 20, max: 60 });
    const start = /^M0 172V([\d.]+)/.exec(d)[1];
    const end = /V([\d.]+)H400/.exec(d) ?? /H400V([\d.]+)/.exec(d);
    assert.ok(d.includes('H400'), `reicht bis zum Rand, Seed ${seed}`);
    assert.ok(end, 'letztes Stück endet am rechten Rand');
    assert.equal(/H(\d+)V([\d.]+)H400/.exec(d)?.[2] ?? start, start, `Randhöhe gleich, Seed ${seed}`);
  }
});

// Mini-Prüfung: jedes geöffnete Element wird wieder geschlossen
function wellFormed(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), name, `schließt ${name}`);
    else stack.push(name);
  }
  assert.deepEqual(stack, []);
}

test('Die Szene ist gültiges SVG und ändert sich mit Wetter und Wind', () => {
  for (const status of ['go', 'caution', 'no']) {
    const svg = commuteScene({ status, score: status === 'go' ? 92 : 30, rainy: status === 'no', windKmh: 22, headKmh: 12, uid: status });
    wellFormed(svg);
    assert.ok(svg.includes(`class="scene ${status}`));
    assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
  }
  const calm = commuteScene({ windKmh: 4, uid: 'a' });
  const gale = commuteScene({ windKmh: 40, uid: 'b' });
  const count = (s) => (s.match(/class="streak"/g) ?? []).length;
  assert.ok(count(gale) > count(calm));
  assert.equal((commuteScene({ rainy: false, uid: 'c' }).match(/class="drop"/g) ?? []).length, 0);
  assert.ok((commuteScene({ rainy: true, status: 'no', uid: 'd' }).match(/class="drop"/g) ?? []).length >= 20);
});

test('Hohes Radwetter hebt die Sonne, Wind von vorn macht die Luft schneller', () => {
  const sunY = (svg) => Number(/class="sunrise"[^>]*><circle cx="200" cy="([\d.]+)"/.exec(svg)[1]);
  assert.ok(sunY(commuteScene({ score: 95, uid: 'a' })) < sunY(commuteScene({ score: 10, uid: 'b' })));
  const airDur = (svg) => Number(/class="streak"[^>]*animation-duration:([\d.]+)s/.exec(svg)[1]);
  assert.ok(airDur(commuteScene({ headKmh: 20, windKmh: 20, uid: 'a' })) < airDur(commuteScene({ headKmh: -20, windKmh: 20, uid: 'b' })));
});

test('Ohne Animation steht der Fahrer still und das SVG enthält keine Animationen', () => {
  const still = cyclist({ animated: false });
  assert.ok(!still.includes('<animate'));
  assert.ok(cyclist({ animated: true }).includes('<animate'));
  wellFormed(commuteScene({ animated: false, uid: 'x' }));
  assert.ok(commuteScene({ animated: false, uid: 'x' }).includes('static'));
});
