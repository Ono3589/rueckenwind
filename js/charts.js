// Diagramme als SVG-Text: Tagesverlauf (Regen und Temperatur), Ersparnis-Profil und Kilometer pro Woche.
// Jedes Diagramm trägt `data-scrub` mit den Werten pro Stelle, damit motion.js beim Wischen eine Anzeige einblenden kann.
// Gezeichnet wird erst sichtbar (CSS), wenn das Diagramm in den Blick kommt (Klasse .in).

const de = (d) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });
const eur = (v) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(v);
const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Sanfte Kurve durch alle Punkte ohne Überschwingen (monotone kubische Interpolation nach Fritsch und Carlson)
export function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0] || 1e-6);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r1(pts[i][0] + h)} ${r1(pts[i][1] + t[i] * h)} ${r1(pts[i + 1][0] - h)} ${r1(pts[i + 1][1] - t[i + 1] * h)} ${r1(pts[i + 1][0])} ${r1(pts[i + 1][1])}`;
  }
  return d;
}

const scrubAttr = (series) => esc(JSON.stringify(series));

// ---------- Tagesverlauf ----------

const DW = 360;
const DH = 196;
const X0 = 14;
const X1 = 346;
const FROM = 5;
const TO = 21;

// forecast: Open-Meteo-Antwort, date: 'YYYY-MM-DD', day: Ergebnis von assessDay, nowMin: Minuten seit Mitternacht (nur heute)
export function dayChart(forecast, date, day, { nowMin = null, uid = 'd' } = {}) {
  const H = forecast.hourly;
  const hours = [];
  for (let h = FROM; h <= TO; h++) {
    const i = H.time.indexOf(`${date}T${String(h).padStart(2, '0')}:00`);
    if (i < 0) continue;
    hours.push({ h, temp: H.temperature_2m[i], rain: H.precipitation_probability[i] ?? 0, mm: H.precipitation[i] ?? 0, wind: H.wind_speed_10m[i] ?? 0 });
  }
  if (hours.length < 3) return '';
  const x = (hour) => X0 + ((hour - FROM) / (TO - FROM)) * (X1 - X0);
  const tmin = Math.floor(Math.min(...hours.map((p) => p.temp))) - 2;
  const tmax = Math.ceil(Math.max(...hours.map((p) => p.temp))) + 1;
  const yT = (t) => 52 + ((tmax - t) / (tmax - tmin)) * 58;
  const base = 152;
  const yR = (p) => base - (p / 100) * 46;

  const tempPts = hours.map((p) => [x(p.h), yT(p.temp)]);
  const rainPts = hours.map((p) => [x(p.h), yR(p.rain)]);
  const tempD = monotonePath(tempPts);
  const rainLine = monotonePath(rainPts);
  const rainArea = `${rainLine}L${r1(rainPts.at(-1)[0])} ${base}L${r1(rainPts[0][0])} ${base}Z`;

  const wins = [
    ['Hin', day.hin],
    ['Rück', day.rueck],
  ]
    .filter(([, t]) => t)
    .map(([label, t], k) => {
      const a = x(t.start / 60);
      const b = x(t.end / 60);
      const mid = (a + b) / 2;
      const near = hours.reduce((best, p) => (Math.abs(p.h - mid) < Math.abs(best.h - mid) ? p : best), hours[0]);
      const sev = ['ok', 'warn', 'bad'][t.sev];
      return `<g class="win-band ${sev}" style="--i:${k}">
        <rect x="${r1(a)}" y="16" width="${r1(Math.max(6, b - a))}" height="${base - 16}" rx="6"/>
        <text x="${r1(mid)}" y="30" class="win-label">${label}</text>
        <circle cx="${r1(mid)}" cy="${r1(yT(near.temp))}" r="4.6" class="dot"/>
        <text x="${r1(mid)}" y="${r1(yT(near.temp) - 11)}" class="temp-label">${Math.round(t.temp)}°</text>
      </g>`;
    })
    .join('');

  const axis = [6, 9, 12, 15, 18, 21].map((h) => `<text x="${r1(x(h))}" y="${base + 20}" class="axis">${h}</text>`).join('');
  const nowX = nowMin != null && nowMin >= FROM * 60 && nowMin <= TO * 60 ? x(nowMin / 60) : null;
  const now = nowX == null ? '' : `<g class="now"><line x1="${r1(nowX)}" x2="${r1(nowX)}" y1="38" y2="${base}"/><circle cx="${r1(nowX)}" cy="38" r="3.4"/></g>`;
  const rainMax = Math.max(...hours.map((p) => p.rain));

  const series = hours.map((p) => ({ x: r1(x(p.h)), y: r1(yT(p.temp)), title: `${p.h} Uhr`, lines: [`${Math.round(p.temp)} °C`, `${p.rain} % Regenrisiko${p.mm > 0.05 ? `, ${de(1).format(p.mm)} mm` : ''}`, `Wind ${Math.round(p.wind)} km/h`] }));

  return `<div class="chart day" data-chart data-scrub="${scrubAttr(series)}" data-vw="${DW}">
    <svg viewBox="0 0 ${DW} ${DH}" role="img" aria-label="Tagesverlauf von Temperatur und Regenrisiko, Spitze ${rainMax} Prozent Regen" focusable="false">
      <defs>
        <linearGradient id="rain-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sky)" stop-opacity=".55"/><stop offset="1" stop-color="var(--sky)" stop-opacity="0"/></linearGradient>
        <linearGradient id="temp-${uid}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--sky)"/><stop offset=".5" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--dawn)"/></linearGradient>
        <clipPath id="reveal-${uid}"><rect class="reveal" x="0" y="0" width="${DW}" height="${DH}"/></clipPath>
      </defs>
      <line x1="${X0}" x2="${X1}" y1="${base}" y2="${base}" class="baseline"/>
      ${[25, 50, 75].map((p) => `<line x1="${X0}" x2="${X1}" y1="${r1(yR(p))}" y2="${r1(yR(p))}" class="grid"/>`).join('')}
      ${wins}
      <g clip-path="url(#reveal-${uid})">
        <path d="${rainArea}" fill="url(#rain-${uid})"/>
        <path d="${rainLine}" class="rain-line" pathLength="1"/>
      </g>
      <path d="${tempD}" class="temp-line" stroke="url(#temp-${uid})" pathLength="1"/>
      ${now}
      ${axis}
      <g class="guide" hidden><line y1="16" y2="${base}"/><circle r="4.5"/></g>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}

// ---------- Ersparnis-Profil ----------

// Laufende Summe der Ersparnis pro Fahrtag, sortiert. perKmGain: Euro pro Kilometer (Auto minus Rad)
export function cumulativeSavings(rides, perKmGain, parkingPerDay = 0) {
  const byDay = new Map();
  for (const r of rides) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.km * perKmGain);
  let sum = 0;
  return [...byDay.keys()]
    .sort()
    .map((date) => {
      sum += byDay.get(date) + parkingPerDay;
      return { date, value: sum };
    });
}

const SW = 360;
const SH = 176;

export function savingsChart(points, { uid = 's', startLabel = '', endLabel = '' } = {}) {
  if (points.length < 1) return '';
  const pts = points.length === 1 ? [{ date: points[0].date, value: 0 }, points[0]] : [{ date: points[0].date, value: 0 }, ...points];
  const max = Math.max(...pts.map((p) => p.value), 0.01);
  const t0 = Date.parse(`${pts[0].date}T12:00:00Z`);
  const t1 = Date.parse(`${pts.at(-1).date}T12:00:00Z`);
  const span = Math.max(t1 - t0, 864e5);
  const xs = (d) => 14 + ((Date.parse(`${d}T12:00:00Z`) - t0) / span) * (SW - 40);
  const ys = (v) => 142 - (v / max) * 100;
  const xy = pts.map((p) => [xs(p.date), ys(p.value)]);
  const line = monotonePath(xy);
  const area = `${line}L${r1(xy.at(-1)[0])} 142L${r1(xy[0][0])} 142Z`;
  const [ex, ey] = xy.at(-1);
  const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  const series = pts.slice(1).map((p, i) => ({ x: r1(xs(p.date)), y: r1(ys(p.value)), title: fmtDay(p.date), lines: [`${eur(p.value)} gespart`, `${i + 1}. Fahrtag`] }));
  return `<div class="chart savings" data-chart data-scrub="${scrubAttr(series)}" data-vw="${SW}">
    <svg viewBox="0 0 ${SW} ${SH}" role="img" aria-label="Verlauf der Ersparnis, insgesamt ${eur(pts.at(-1).value)}" focusable="false">
      <defs>
        <linearGradient id="sa-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--go)" stop-opacity=".5"/><stop offset="1" stop-color="var(--go)" stop-opacity="0"/></linearGradient>
        <clipPath id="sr-${uid}"><rect class="reveal" x="0" y="0" width="${SW}" height="${SH}"/></clipPath>
      </defs>
      ${[0.33, 0.66, 1].map((f) => `<line x1="14" x2="${SW - 26}" y1="${r1(142 - f * 100)}" y2="${r1(142 - f * 100)}" class="grid"/>`).join('')}
      <line x1="14" x2="${SW - 26}" y1="142" y2="142" class="baseline"/>
      <g clip-path="url(#sr-${uid})"><path d="${area}" fill="url(#sa-${uid})"/></g>
      <path d="${line}" class="save-line" pathLength="1"/>
      <g class="endpoint"><circle cx="${r1(ex)}" cy="${r1(ey)}" r="11" class="pulse"/><circle cx="${r1(ex)}" cy="${r1(ey)}" r="5.5" class="dot"/></g>
      <text x="14" y="164" class="axis" text-anchor="start">${esc(startLabel || fmtDay(pts[0].date))}</text>
      <text x="${SW - 26}" y="164" class="axis" text-anchor="end">${esc(endLabel || fmtDay(pts.at(-1).date))}</text>
      <g class="guide" hidden><line y1="30" y2="142"/><circle r="4.5"/></g>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}

// ---------- Kilometer pro Woche ----------

const WW = 360;
const WH = 178;

// weeks: [{ label: '41', km, current }], goal: Wochenziel in km
export function weeksChart(weeks, goal, { uid = 'w' } = {}) {
  const max = Math.max(goal * 1.15, ...weeks.map((w) => w.km), 1);
  const n = weeks.length;
  const slot = (WW - 24) / n;
  const bw = Math.min(18, slot - 7);
  const ys = (v) => 142 - (v / max) * 108;
  const bars = weeks
    .map((w, i) => {
      const cx = 12 + slot * i + slot / 2;
      const top = ys(w.km);
      const h = Math.max(w.km > 0 ? 4 : 2, 142 - top);
      const rx = bw / 2;
      const d = `M${r1(cx - bw / 2)} 142V${r1(142 - h + rx)}a${rx} ${rx} 0 0 1 ${bw} 0V142Z`;
      return `<g class="bar${w.current ? ' cur' : ''}${w.km >= goal ? ' hit' : ''}${w.km === 0 ? ' zero' : ''}" style="--i:${i}"><path d="${d}"/>${w.current && w.km > 0 ? `<path d="${d}" class="speed"/>` : ''}</g>
        ${i % 2 === (n - 1) % 2 ? `<text x="${r1(cx)}" y="164" class="axis">${esc(w.label)}</text>` : ''}`;
    })
    .join('');
  const gy = r1(ys(goal));
  const cur = weeks.at(-1);
  const series = weeks.map((w, i) => ({ x: r1(12 + slot * i + slot / 2), title: `KW ${w.label}`, lines: [`${de(1).format(w.km)} km`, w.km >= goal ? 'Ziel erreicht' : `${de(0).format(Math.max(0, goal - w.km))} km bis zum Ziel`] }));
  return `<div class="chart weeks" data-chart data-scrub="${scrubAttr(series)}" data-vw="${WW}">
    <svg viewBox="0 0 ${WW} ${WH}" role="img" aria-label="Kilometer der letzten ${n} Wochen, aktuell ${de(1).format(cur.km)} Kilometer, Ziel ${de(0).format(goal)}" focusable="false">
      <defs>
        <linearGradient id="bar-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--dawn)"/></linearGradient>
        <pattern id="speed-${uid}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="3" height="8" fill="#fff" opacity=".28"/></pattern>
      </defs>
      <line x1="12" x2="${WW - 12}" y1="142" y2="142" class="baseline"/>
      <line x1="12" x2="${WW - 12}" y1="${gy}" y2="${gy}" class="goal-line"/>
      <text x="${WW - 12}" y="${gy - 6}" class="goal-label" text-anchor="end">Ziel ${de(0).format(goal)} km</text>
      <g class="bars" style="--grad:url(#bar-${uid});--speed:url(#speed-${uid})">${bars}</g>
      <g class="guide" hidden><line y1="20" y2="142"/></g>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}
