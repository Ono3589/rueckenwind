// Die Pendelszene: Sonne, Skyline in zwei Ebenen, Straße mit laufender Mittellinie, Laternen, Wind und Regen.
// Davor fährt ein Rennradfahrer. Seine Beine pedalieren wirklich (Zwei-Gelenk-Rechnung für Hüfte, Knie und Knöchel),
// die Räder drehen sich im Takt der Straße. Alles ist ein SVG mit CSS-Animationen (Skyline, Straße, Räder) und
// SMIL (Beine). Läuft ohne JavaScript weiter, sobald es gezeichnet ist.

// ---------- Rennrad und Fahrer: Maße in Einheiten, 1 Einheit ≈ 0,56 cm ----------

export const RIG = { hip: [222, 176], bb: [243, 303], crank: 31, thigh: 80, shin: 77, wheelR: 61, rear: [155, 290], front: [366, 290] };
const FRAMES = 24;

// Beinstellung bei Kurbelwinkel theta (0 = Kurbel nach vorn, wächst im Uhrzeigersinn)
export function legPose(theta, rig = RIG) {
  const { hip, bb, crank, thigh, shin } = rig;
  const pedal = [bb[0] + crank * Math.cos(theta), bb[1] + crank * Math.sin(theta)];
  const ankle = [pedal[0] - 6, pedal[1] - 9];
  const dx = ankle[0] - hip[0];
  const dy = ankle[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), thigh + shin - 0.5);
  const along = (thigh * thigh - shin * shin + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, thigh * thigh - along * along));
  const ux = dx / d;
  const uy = dy / d;
  const kneeA = [hip[0] + ux * along - uy * off, hip[1] + uy * along + ux * off];
  const kneeB = [hip[0] + ux * along + uy * off, hip[1] + uy * along - ux * off];
  const knee = kneeA[0] > kneeB[0] ? kneeA : kneeB; // das Knie zeigt nach vorn
  return { hip, knee, ankle, pedal, toe: [ankle[0] + 24, ankle[1] + 7] };
}

const r1 = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${r1(p[0])} ${r1(p[1])}`;

// d-Werte aller Bildphasen für ein Segment, damit SMIL sie abspielen kann
function legFrames(phase) {
  const out = { thigh: [], shin: [], foot: [], crank: [] };
  for (let i = 0; i <= FRAMES; i++) {
    const s = legPose(((i / FRAMES) * 2 + phase) * Math.PI);
    out.thigh.push(`M${pt(s.hip)}L${pt(s.knee)}`);
    out.shin.push(`M${pt(s.knee)}L${pt(s.ankle)}`);
    out.foot.push(`M${pt(s.ankle)}L${pt(s.toe)}`);
    out.crank.push(`M${pt(RIG.bb)}L${pt(s.pedal)}`);
  }
  return out;
}

const anim = (values, dur, begin = 0, animated = true) =>
  animated ? `<animate attributeName="d" values="${values.join(';')}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite" calcMode="linear"/>` : '';

function wheel([cx, cy], dur, animated) {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return `M${cx} ${cy}L${r1(cx + Math.cos(a) * 55)} ${r1(cy + Math.sin(a) * 55)}`;
  }).join('');
  return `<g class="wheel"${animated ? ` style="animation-duration:${dur}s"` : ''}>
    <circle cx="${cx}" cy="${cy}" r="58" fill="none" stroke-width="9"/>
    <path d="${spokes}" fill="none" stroke-width="1.8"/>
    <circle cx="${cx}" cy="${cy}" r="6" class="fill"/>
    <circle cx="${cx + 47}" cy="${cy}" r="3.4" class="fill valve"/>
  </g>`;
}

// Der Fahrer im Profil, nach rechts fahrend. dur: Dauer einer Kurbelumdrehung, wheelDur: einer Radumdrehung
export function cyclist({ animated = true, dur = 1.2, wheelDur = 0.9 } = {}) {
  const near = legFrames(0);
  const far = legFrames(1); // das andere Bein ist um eine halbe Umdrehung versetzt
  const still = (f) => `d="${f[0]}"`;
  const leg = (f, begin, cls) => `<g class="${cls}" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path class="thigh" stroke-width="32" ${still(f.thigh)}>${anim(f.thigh, dur, begin, animated)}</path>
      <path class="shin" stroke-width="22" ${still(f.shin)}>${anim(f.shin, dur, begin, animated)}</path>
      <path class="foot" stroke-width="15" ${still(f.foot)}>${anim(f.foot, dur, begin, animated)}</path>
    </g>`;
  return `<g class="cy">
    <g class="bike" fill="none" stroke-linecap="round" stroke-linejoin="round">
      ${wheel(RIG.rear, wheelDur, animated)}
      ${wheel(RIG.front, wheelDur, animated)}
      <path d="M155 290L243 303L214 206Z M214 206L330 191L341 224L243 303 M341 224L366 290 M214 206L210 192" stroke-width="8"/>
      <path d="M182 189Q206 184 233 190" stroke-width="10"/>
      <path d="M330 189L360 180Q384 177 386 194Q387 210 371 209" stroke-width="8"/>
      <path class="crank" stroke-width="7" ${still(near.crank)}>${anim(near.crank, dur, 0, animated)}</path>
      <path class="crank" stroke-width="7" opacity=".8" ${still(far.crank)}>${anim(far.crank, dur, 0, animated)}</path>
      <circle cx="243" cy="303" r="11" class="fill"/>
    </g>
    ${leg(far, 0, 'leg far')}
    <g class="rider">
      <path d="M192 186C170 164 170 114 194 97C222 81 262 71 298 65C314 63 323 73 319 87C313 106 292 115 268 124C250 131 241 152 238 180Z"/>
      <path d="M300 66L322 60L333 79L312 92Z"/>
      <circle cx="333" cy="63" r="14"/>
      <ellipse cx="327" cy="45" rx="27" ry="17" transform="rotate(14 327 45)"/>
      <path d="M298 88L321 146" fill="none" stroke-width="22" stroke-linecap="round"/>
      <path d="M321 146L362 184" fill="none" stroke-width="16" stroke-linecap="round"/>
    </g>
    ${leg(near, 0, 'leg near')}
  </g>`;
}

// ---------- Skyline ----------

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Gebäudelinie über 400 Einheiten, links und rechts gleich hoch, damit sie nahtlos wiederholt werden kann
export function skyline(seed, { base, min, max, tower = true }) {
  const rand = rng(seed);
  const edge = base - (min + max) / 2;
  let x = 0;
  let d = `M0 ${base}V${r1(edge)}`;
  const lights = [];
  while (x < 400) {
    const w = Math.min(400 - x, 16 + Math.round(rand() * 22));
    const h = base - (min + rand() * (max - min));
    const last = x + w >= 400;
    const top = last ? edge : h;
    d += `H${x}V${r1(top)}H${x + w}`;
    if (!last && tower && rand() < 0.16) d += `L${x + w / 2} ${r1(top - 14 - rand() * 10)}L${x} ${r1(top)}`;
    if (w > 20 && rand() < 0.55) lights.push([x + 4 + Math.round(rand() * (w - 12)), r1(top + 8 + rand() * 18), Math.round(rand() * 5)]);
    x += w;
  }
  return { d: `${d}V${base}Z`, lights };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- Die Szene ----------
// status: 'go' | 'caution' | 'no'; score 0–100 bestimmt die Höhe der Sonne; windKmh und headKmh (positiv = Gegenwind)
export function commuteScene({ status = 'go', score = 70, rainy = false, windKmh = 8, headKmh = 0, uid = 's', variant = 'hero', animated = true, label = '' } = {}) {
  const slow = status === 'no' ? 1.35 : status === 'caution' ? 1.1 : 1;
  const wheelDur = r1(0.9 * slow);
  const dur = r1(1.2 * slow);
  const scale = 0.3;
  const speed = (2 * Math.PI * RIG.wheelR * scale) / wheelDur; // Einheiten pro Sekunde, genau so schnell rollt das Rad
  const sunY = r1(172 - clamp(score, 0, 100) * 1.02);
  const far = skyline(11, { base: 172, min: 18, max: 46, tower: false });
  const near = skyline(29, { base: 172, min: 26, max: 70 });
  const farId = `far-${uid}`;
  const nearId = `near-${uid}`;
  const t = (period, factor) => r1(period / (speed * factor));

  const posts = Array.from({ length: 4 }, (_, i) => `<g transform="translate(${i * 130 + 20} 0)"><path d="M0 172V120q0-6 6-6h12" stroke-width="2.4" fill="none"/><circle cx="19" cy="115" r="2.6" class="lamp"/><rect x="-1.5" y="168" width="3" height="6"/></g>`).join('');
  const blades = Array.from({ length: 9 }, (_, i) => {
    const x = i * 58 + (i % 3) * 9;
    return `<path d="M${x} 240q4-${22 + (i % 4) * 7} 9-${30 + (i % 3) * 6}q-2 ${14 + (i % 2) * 5} 3 ${30 + (i % 3) * 6}z"/>`;
  }).join('');

  const streakCount = clamp(Math.round(windKmh / 7), 1, 6);
  const airFactor = clamp(1 + headKmh / 28, 0.35, 2.2); // Gegenwind: Luft strömt schneller an dir vorbei, Rückenwind langsamer
  const streaks = Array.from({ length: streakCount }, (_, i) => {
    const y = 92 + ((i * 37) % 96);
    const len = 26 + ((i * 19) % 34);
    const delay = -((i * 0.73) % 3);
    return `<path class="streak" d="M0 ${y}h${len}" style="animation-duration:${r1(520 / (speed * airFactor))}s;animation-delay:${r1(delay)}s"/>`;
  }).join('');

  const slant = clamp(4 + windKmh * 0.35 * (headKmh >= 0 ? 1 : -0.5), -14, 22);
  const dropCount = rainy ? (status === 'no' ? 26 : 14) : 0;
  const drops = Array.from({ length: dropCount }, (_, i) => {
    const x = 12 + ((i * 41) % 380);
    const y = 4 + ((i * 29) % 120);
    return `<path d="M${x} ${y}l${-r1(slant * 0.4)} 10" class="drop" style="animation-delay:${r1(-((i % 6) * 0.17))}s"/>`;
  }).join('');

  const clouds = status === 'go' ? '' : `<g class="clouds">${[
    [30, 52, 120, 17], [170, 38, 150, 20], [290, 62, 110, 15], [-70, 30, 130, 18],
  ].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`).join('')}</g>`;

  const windows = near.lights.map(([x, y, k]) => `<rect class="win w${k}" x="${x}" y="${y}" width="3" height="4"/>`).join('');
  const sr = animated ? '' : ' static';

  return `<svg class="scene ${status}${sr} scene-${variant}" viewBox="0 0 400 240" preserveAspectRatio="${variant === 'splash' ? 'xMidYMax slice' : 'xMidYMax meet'}" role="img" aria-label="${label || `Radwetter ${score} von 100`}" focusable="false">
  <defs>
    <linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sky1"/><stop offset=".75" class="sky2"/></linearGradient>
    <radialGradient id="sun-${uid}" cx="50%" cy="36%" r="70%"><stop offset="0" class="sun1"/><stop offset="1" class="sun2"/></radialGradient>
    <radialGradient id="glow-${uid}" cx="50%" cy="50%" r="50%"><stop offset="0" class="glow" stop-opacity=".6"/><stop offset="1" class="glow" stop-opacity="0"/></radialGradient>
    <clipPath id="clip-${uid}"><rect width="400" height="172"/></clipPath>
    <path id="${farId}" d="${far.d}"/>
    <path id="${nearId}" d="${near.d}"/>
  </defs>
  <rect width="400" height="172" fill="url(#sky-${uid})"/>
  <g clip-path="url(#clip-${uid})">
    <ellipse cx="200" cy="${sunY}" rx="190" ry="110" fill="url(#glow-${uid})" class="halo"/>
    <g class="sunrise" style="--rise:${r1(172 - sunY + 52)}px"><circle cx="200" cy="${sunY}" r="46" fill="url(#sun-${uid})"/></g>
    ${clouds}
    <g class="sky-far" style="animation-duration:${t(400, 0.06)}s"><use href="#${farId}" class="far"/><use href="#${farId}" x="400" class="far"/></g>
    <g class="sky-near" style="animation-duration:${t(400, 0.18)}s"><use href="#${nearId}" class="nearfill"/><use href="#${nearId}" x="400" class="nearfill"/><g class="wins">${windows}</g><g class="wins" transform="translate(400 0)">${windows}</g></g>
    <g class="rain">${drops}</g>
  </g>
  <rect y="172" width="400" height="68" class="road"/>
  <line x1="0" x2="400" y1="172.5" y2="172.5" class="horizon"/>
  <line class="dash" x1="-60" x2="470" y1="219" y2="219" style="animation-duration:${t(48, 1)}s"/>
  <g class="lamps" style="animation-duration:${t(520, 1)}s"><g>${posts}</g><g transform="translate(520 0)">${posts}</g></g>
  <g class="streaks">${streaks}</g>
  <g class="enter"><g transform="translate(${r1(200 - 230 * scale)} ${r1(214 - 352 * scale)}) scale(${scale})">${cyclist({ animated, dur, wheelDur })}</g></g>
  <g class="blades" style="animation-duration:${t(522, 1.7)}s"><g>${blades}</g><g transform="translate(522 0)">${blades}</g></g>
</svg>`;
}
