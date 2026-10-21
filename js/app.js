import { load, save, clearPlain, importState, newId, DEFAULTS, RULE_PRESETS } from './store.js';
import { hasVault, vaultMeta, createVault, unlockVault, verifyPin, importVault, removeVault, isVaultFile, weakPin } from './vault.js';
import { askPin, hideLock, showMessage } from './lock.js';
import { parseHealthText } from './health.js';
import { buildNotifyConfig, normalizeUrl, pushSupport, enablePush, syncPush, disablePush, testPush, reportDay, fetchInbox, ackInbox, boschStatus, boschStart, boschSync, boschDisconnect } from './push.js';
import { TITLES } from './messages.js';
import { commuteScene, cyclist } from './scene.js';
import { dayChart, savingsChart, weeksChart as weeksChartSvg, cumulativeSavings } from './charts.js';
import { reveal, scrub, slide, runSplash, reducedMotion, formatCount } from './motion.js';
import { midpoint, distanceM, searchAddress, currentPosition, fetchBikeRoute } from './geo.js';
import { mapThumb, simplify } from './map.js';
import { fetchForecast, dayTarget, commuteDone, assessDay, fmtMin, tripMinutes } from './weather.js';
import { FUEL, carCostPerKm, bikeCostPerKm, bikeRangeKm, estimateKcal, summarize } from './costs.js';
import * as strava from './strava.js';

// App-Sperre: Ist sie an, liegen die Daten nur verschlüsselt im Speicher und werden erst nach der PIN geladen.
let locked = hasVault();
let session = null; // nur während die App entsperrt ist
let state = locked ? structuredClone(DEFAULTS) : load();
const view = document.getElementById('view');
const persist = () => {
  const r = session ? session.save(state) : save(state);
  schedulePushSync();
  scheduleDayStatus();
  return r;
};

// ---------- Formatierung ----------

const nf = (d) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const fmt = {
  km: (n) => nf(1).format(n),
  int: (n) => nf(0).format(Math.round(n)),
  eur: (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n),
  ct: (n) => `${nf(1).format(n * 100)} ct`,
  dayLong: (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }),
  dayShort: (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }),
  time: (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => localISO(new Date());

function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - y0) / 864e5 + 1) / 7);
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Icons ----------

const I = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c3.2 4 5.5 7.1 5.5 10a5.5 5.5 0 0 1-11 0c0-2.9 2.3-6 5.5-10z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15a4 4 0 0 1 .5-8 5 5 0 0 1 9.6 1.5A3.5 3.5 0 0 1 17 15H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.3a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.7" r="2.3" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  wheel: '<svg viewBox="0 0 24 24" aria-hidden="true" class="spin"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" stroke-width="1.1" opacity=".8"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14 0 9-4 14-12 14M5 19c3-5 6-8 10-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-.8 2.2-2 3.2-3 3.5.3-2.3-.5-4.6-2.5-6.5C9 7 6 9.6 6 15a6 6 0 0 0 6 6z" fill="currentColor"/></svg>',
};

// ---------- Navigation ----------

const tabs = { heute: renderToday, fahrten: renderRides, bilanz: renderStats, einstellungen: renderSettings };
const currentTab = () => (tabs[location.hash.slice(1)] ? location.hash.slice(1) : 'heute');

const tabOrder = Object.keys(tabs);
let shownTab = null;

function render() {
  if (locked) return;
  const tab = currentTab();
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  document.querySelector('.tabbar')?.style.setProperty('--tab-i', tabOrder.indexOf(tab));
  shownTab = tab;
  tabs[tab]();
  if (tab === 'einstellungen') loadBosch();
  paint(); // auch für die frühen Zustände (Start, Laden, Fehler); schon Gezeigtes bleibt stehen
}
window.addEventListener('hashchange', () => {
  const from = tabOrder.indexOf(shownTab);
  const to = tabOrder.indexOf(currentTab());
  if (from === to || from < 0) {
    render();
    return;
  }
  slide(() => {
    render();
    window.scrollTo(0, 0);
  }, to - from);
});

// ---------- Wetter ----------

const FC_KEY = 'rueckenwind.forecast';
let forecast = null;
let weatherLoading = false;
let weatherError = null;

const locKey = () => {
  const { home, work } = state.route;
  if (!home || !work) return null;
  const m = midpoint(home, work);
  return `${m.lat.toFixed(3)},${m.lon.toFixed(3)}`;
};

try {
  if (locked) localStorage.removeItem(FC_KEY); // der Zwischenspeicher enthielte die Gegend deiner Route
  const cached = locked ? null : JSON.parse(localStorage.getItem(FC_KEY) || 'null');
  if (cached) forecast = cached;
} catch {
  /* kein Cache */
}

async function ensureForecast(force = false) {
  const key = locKey();
  if (!key || weatherLoading) return;
  const fresh = forecast && forecast.key === key && Date.now() - forecast.fetchedAt < 30 * 60e3;
  if ((fresh || weatherError) && !force) return;
  weatherLoading = true;
  weatherError = null;
  if (force && currentTab() === 'heute') document.querySelector('.refresh')?.classList.add('spinning');
  try {
    const { home, work } = state.route;
    forecast = { ...(await fetchForecast(midpoint(home, work))), key };
    try {
      if (!session) localStorage.setItem(FC_KEY, JSON.stringify(forecast));
    } catch {
      /* Speicher voll – egal */
    }
  } catch (e) {
    weatherError = e.message || 'Wetter konnte nicht geladen werden';
  } finally {
    weatherLoading = false;
    if (currentTab() === 'heute') renderToday();
  }
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    session?.flush();
    return;
  }
  if (locked) return;
  if (session && hiddenAt && Date.now() - hiddenAt >= Number(state.security?.autoLockMin ?? 1) * 60000) {
    lockNow();
    return;
  }
  if (document.visibilityState === 'visible') {
    pullInbox();
    if (currentTab() === 'einstellungen') loadBosch({ force: true });
    const r = state.route;
    if (r.home && r.work && !r.distanceManual && r.distanceSource === 'luftlinie' && !distanceBusy) updateRouteDistance();
    weatherError = null;
    if (currentTab() === 'heute') ensureForecast();
  }
});

// ---------- Fahrten ----------

function makeRide({ date, direction, km, minutes = null, kcal = null, source = 'manuell', stravaId = null, name = '' }) {
  const estimated = kcal == null;
  return {
    id: newId(),
    date,
    direction,
    km,
    minutes,
    kcal: estimated ? estimateKcal(km, minutes, state.person, state.route.avgSpeed) : kcal,
    kcalSource: estimated ? 'schätzung' : source,
    source,
    stravaId,
    name,
  };
}

const rideSaving = (r, perKm) => r.km * (perKm.car.total - perKm.bike.total);

function streak() {
  const days = new Set(state.rides.map((r) => r.date));
  const wd = state.route.workdays;
  if (!wd.length) return 0;
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  if (!days.has(localISO(d))) d.setDate(d.getDate() - 1); // heute zählt erst, wenn gefahren
  let n = 0;
  for (let guard = 0; guard < 800; guard++) {
    if (wd.includes(d.getDay())) {
      if (!days.has(localISO(d))) break;
      n++;
    }
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---------- Ansicht: Heute ----------

// Rennradfahrer im Profil als Silhouette, nach einer Fotovorlage vereinfacht. Raster ca. 360 × 360, Boden bei y = 356.
const CYCLIST = `
  <g class="cyclist" stroke-linecap="round" stroke-linejoin="round">
    <g class="bike" fill="none">
      <circle cx="155" cy="290" r="61" stroke-width="11"/>
      <circle cx="366" cy="290" r="61" stroke-width="11"/>
      <path d="M155 290 L243 303 L214 206 Z M214 206 L330 191 L341 224 L243 303 M341 224 L366 290 M214 206 L210 192" stroke-width="9"/>
      <path d="M182 189 Q206 184 233 190" stroke-width="10"/>
      <path d="M330 189 L360 180 Q384 177 386 194 Q387 210 371 209" stroke-width="8"/>
      <path d="M262 271 L224 335" stroke-width="7"/>
      <circle cx="243" cy="303" r="15" class="ring"/>
    </g>
    <g class="rider" stroke-width="2">
      <path d="M192 186 C170 164 170 114 194 97 C222 81 262 71 298 65 C314 63 323 73 319 87 C313 106 292 115 268 124 C250 131 241 152 238 180 Z"/>
      <path d="M300 66 L322 60 L333 79 L312 92 Z"/>
      <circle cx="333" cy="63" r="14"/>
      <ellipse cx="327" cy="45" rx="27" ry="17" transform="rotate(14 327 45)"/>
      <path d="M298 88 L321 146" fill="none" stroke-width="22"/>
      <path d="M321 146 L362 184" fill="none" stroke-width="16"/>
      <path d="M222 150 L283 176" fill="none" stroke-width="36"/>
      <path d="M283 176 L260 263" fill="none" stroke-width="22"/>
      <path d="M258 264 L276 274" fill="none" stroke-width="13"/>
      <path d="M215 158 L248 232" fill="none" stroke-width="32"/>
      <path d="M248 232 L219 302" fill="none" stroke-width="20"/>
      <path d="M216 304 L234 322" fill="none" stroke-width="13"/>
    </g>
  </g>`;

const WIND_WORD = { gegen: 'Gegenwind', rueck: 'Rückenwind', seite: 'Seitenwind' };

function tripCard(label, t, done, canLog, dir, i) {
  if (!t) return `<article class="trip"><h3>${label}</h3><p class="muted">Keine Daten</p></article>`;
  const rot = t.rel ? (t.windDir + 180 - t.bearing + 360) % 360 : null;
  const temp = Math.round(t.temp);
  return `
  <article class="trip sev-${t.sev}" data-reveal style="--i:${i}">
    <header><h3>${label}</h3><span class="when">${fmtMin(t.start)}</span></header>
    <p class="bignum"><span class="num" data-count="${temp}">${fmt.int(t.temp)}</span><sup>°</sup></p>
    <ul class="facts">
      <li>${I.drop}<span><b class="num">${t.rainProb}</b><em>%</em><small>${t.precip > 0.05 ? `${fmt.km(t.precip)} mm Regen` : 'Regenrisiko'}</small></span></li>
      <li class="wind ${t.rel?.kind ?? ''}">${rot == null ? I.wind : `<i style="transform:rotate(${rot}deg)">${I.arrow}</i>`}<span><b class="num">${fmt.int(t.wind)}</b><em>km/h</em><small>${t.rel ? WIND_WORD[t.rel.kind] : 'Wind'}</small></span></li>
    </ul>
    ${
      canLog
        ? `<button class="log" data-action="toggle-ride" data-dir="${dir}" aria-pressed="${done}">${done ? `${I.check}Gefahren` : 'Als gefahren markieren'}</button>`
        : ''
    }
  </article>`;
}

// Die Bühne: Szene mit Sonne, Skyline und Straße, davor der Fahrer. Wind und Regen stammen aus der Vorhersage.
function stage(day, target, rainy, uid = 'hero') {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const trip = target.isToday && day.hin && day.rueck && nowMin > day.hin.end ? day.rueck : (day.hin ?? day.rueck);
  const svg = commuteScene({ status: day.status, score: day.score, rainy, windKmh: trip?.wind ?? 8, headKmh: trip?.rel?.head ?? 0, uid, animated: !reducedMotion() });
  return `<section class="stage ${day.status}" data-reveal>
    <div class="stage-scene">${svg}</div>
    <div class="stage-score"><span class="num" data-count="${day.score}">${day.score}</span><span class="cap">Radwetter<small>von 100</small></span></div>
  </section>`;
}

function onboarding() {
  return `
  <section class="stage go" data-reveal>
    <div class="stage-scene">${commuteScene({ status: 'go', score: 78, uid: 'hero', animated: !reducedMotion() })}</div>
  </section>
  <section class="verdict go intro">
    <h1>Rückenwind</h1>
    <p class="lead">Jeden Morgen eine klare Antwort, ob heute ein Radtag wird. Dazu deine Kilometer, was du gegenüber dem Auto sparst und was du verbrannt hast.</p>
  </section>
  <a class="btn primary wide" href="#einstellungen">Arbeitsweg festlegen</a>`;
}

// Nach jedem Zeichnen: Zahlen und Diagramme laufen an, sobald sie im Bild sind; Wischen zeigt Werte
function paint() {
  reveal(view);
  scrub(view);
}

// Heute oder Morgen: nur diese zwei Tage. Nach dem Rückweg zeigt die App von selbst „Morgen“.
let dayOffset = null;
let dayOffsetFor = '';

function askCard(missing) {
  const km = fmt.km(state.route.distanceKm);
  if (missing.length === 2) {
    return `<section class="card ask" aria-label="Frage zum heutigen Tag">
      <h2>Bist du heute gefahren?</h2>
      <p class="muted">Ein Tipp trägt ${km} km pro Weg ein.</p>
      <div class="ask-buttons">
        <button class="btn primary wide" data-action="ask" data-a="both">Ja, hin und zurück</button>
        <button class="btn" data-action="ask" data-a="hin">Nur Hinweg</button>
        <button class="btn" data-action="ask" data-a="rueck">Nur Rückweg</button>
        <button class="btn ghost wide" data-action="ask" data-a="none">Nein, nicht gefahren</button>
      </div>
    </section>`;
  }
  const dir = missing[0];
  return `<section class="card ask" aria-label="Frage zum heutigen Tag">
    <h2>${dir === 'hin' ? 'Hinweg' : 'Rückweg'} auch gefahren?</h2>
    <p class="muted">Ein Tipp trägt ${km} km ein.</p>
    <div class="ask-buttons">
      <button class="btn primary wide" data-action="ask" data-a="${dir}">Ja, ${dir === 'hin' ? 'Hinweg' : 'Rückweg'}</button>
      <button class="btn ghost wide" data-action="ask" data-a="none">Nein</button>
    </div>
  </section>`;
}

function renderToday() {
  const key = locKey();
  if (!key) {
    view.innerHTML = onboarding();
    return;
  }
  if (!forecast || forecast.key !== key) {
    ensureForecast();
    view.innerHTML = weatherError
      ? `<section class="stage no" data-reveal><div class="stage-scene">${commuteScene({ status: 'no', score: 8, uid: 'hero', animated: !reducedMotion() })}</div></section>
         <section class="verdict no"><h1>Kein Wetter.</h1><p class="lead">${esc(weatherError)}. Prüf deine Verbindung und versuch es noch einmal.</p></section>
         <button class="btn primary wide" data-action="refresh">Erneut versuchen</button>`
      : `<section class="stage caution" data-reveal><div class="stage-scene">${commuteScene({ status: 'caution', score: 35, uid: 'hero', animated: !reducedMotion() })}</div></section>
         <section class="verdict loading"><h1>Blick zum Himmel …</h1></section>`;
    paint();
    return;
  }
  ensureForecast(); // im Hintergrund auffrischen, wenn älter als 30 Minuten

  if (dayOffsetFor !== todayISO()) {
    dayOffsetFor = todayISO();
    dayOffset = commuteDone(state.route) ? 1 : 0;
  }
  const asked = location.hash === '#frage'; // aus der Abendmeldung geöffnet
  if (asked) dayOffset = 0;
  const target = dayTarget(forecast, dayOffset);
  const day = assessDay(forecast, state.route, state.rules, target);
  const rainy = [day.hin, day.rueck].some((t) => t && (t.rainProb >= state.rules.maxRainProb || t.precip > state.rules.maxPrecip));
  const isWorkday = state.route.workdays.includes(new Date(`${target.date}T12:00:00`).getDay());
  const canLog = target.isToday && isWorkday;
  const has = (dir) => state.rides.some((r) => r.date === target.date && r.direction === dir);
  const s = streak();
  const missing = ['hin', 'rueck'].filter((d) => !has(d));
  const showAsk = target.isToday && isWorkday && missing.length > 0 && state.notify.answeredDate !== target.date && (asked || commuteDone(state.route));

  view.innerHTML = `
  <header class="top">
    <p class="date">${fmt.dayLong(target.date)}${isWorkday ? '' : '<span>kein Arbeitstag</span>'}</p>
    ${s ? `<span class="streak" title="${s} Arbeitstage in Folge mit dem Rad">${I.flame}${s}</span>` : ''}
  </header>

  ${showAsk ? askCard(missing) : ''}

  <div class="segmented two" role="tablist" aria-label="Tag">
    <button role="tab" data-action="day" data-d="0" aria-selected="${dayOffset === 0}">Heute</button>
    <button role="tab" data-action="day" data-d="1" aria-selected="${dayOffset === 1}">Morgen</button>
  </div>

  ${stage(day, target, rainy)}

  <section class="verdict ${day.status}">
    <h1>${day.headline}</h1>
    <p class="lead">${esc(day.reason)}</p>
  </section>

  <div class="trips">
    ${tripCard('Hinweg', day.hin, has('hin'), canLog, 'hin', 0)}
    ${tripCard('Rückweg', day.rueck, has('rueck'), canLog, 'rueck', 1)}
  </div>

  ${day.gear.length ? `<ul class="gear" aria-label="Für unterwegs">${day.gear.map((g) => `<li>${I[g.icon]}${esc(g.text)}</li>`).join('')}</ul>` : ''}

  <section class="block chartcard" data-reveal>
    <header class="row"><h2>Tagesverlauf</h2></header>
    ${dayChart(forecast, target.date, day, { nowMin: target.isToday ? new Date().getHours() * 60 + new Date().getMinutes() : null, uid: 'day' })}
    <ul class="legend-row"><li><i class="k temp"></i>Temperatur</li><li><i class="k rain"></i>Regenrisiko</li><li><i class="k ride"></i>deine Fahrten</li></ul>
  </section>

  <footer class="source">
    <span>Open-Meteo · ${fmt.time(forecast.fetchedAt)}</span>
    <button class="refresh${weatherLoading ? ' spinning' : ''}" data-action="refresh" aria-label="Wetter aktualisieren">${I.refresh}</button>
  </footer>`;
  paint();
}

// ---------- Ansicht: Fahrten ----------

// ---------- Von Bosch gelieferte Fahrten ----------

let importPreview = null; // { items, ignored }

const DIR_LABEL = { hin: 'Hinweg', rueck: 'Rückweg' };
let editingRide = null; // Kennung der Fahrt, die gerade bearbeitet wird

// Genauere Werte ersetzen eine von Hand eingetragene Fahrt am selben Tag in derselben Richtung
function addImportedRide(it) {
  state.rides = state.rides.filter((r) => !(r.source === 'manuell' && r.date === it.date && r.direction === it.direction));
  state.rides.push({ ...makeRide({ date: it.date, direction: it.direction, km: it.km, minutes: it.minutes, kcal: it.kcal, source: 'bosch' }), ref: it.ref });
}

// Fahrten, die der Dienst geliefert hat und die nicht zur Strecke passen, warten hier auf deine Entscheidung
function pendingPreview() {
  const items = (state.pendingRides ?? []).map((it) => ({ ...it, dup: state.rides.some((r) => r.ref === it.ref), checked: false, fits: false }));
  return items.length ? { items, ignored: [], fromPending: true } : null;
}

let lastPull = 0;
let pulling = false;

// Holt neue Fahrten vom Dienst. Passende Pendelfahrten werden gleich übernommen, andere warten auf dich.
async function pullInbox({ manual = false } = {}) {
  const n = state.notify;
  const base = normalizeUrl(n.url);
  if (locked || pulling || !base || !n.token) return;
  if (!manual && (n.autoPull === false || Date.now() - lastPull < 60000)) return;
  pulling = true;
  lastPull = Date.now();
  try {
    const { items } = await fetchInbox({ url: base, token: n.token });
    if (!items?.length) {
      if (manual) toast('Keine neuen Fahrten im Dienst');
      return;
    }
    let added = 0;
    let queued = 0;
    for (const entry of items) {
      const { items: rides } = parseHealthText(entry.text, { distanceKm: state.route.distanceKm, today: todayISO() });
      for (const r of rides) {
        if (state.rides.some((x) => x.ref === r.ref) || (state.pendingRides ?? []).some((x) => x.ref === r.ref)) continue;
        if (r.fits) {
          addImportedRide(r);
          added++;
        } else {
          state.pendingRides = [...(state.pendingRides ?? []), { date: r.date, start: r.start, km: r.km, minutes: r.minutes, kcal: r.kcal, direction: r.direction, note: r.note, ref: r.ref }].slice(-50);
          queued++;
        }
      }
    }
    persist();
    if (session) await session.flush(); // erst sicher gespeichert, dann beim Dienst löschen
    await ackInbox({ url: base, token: n.token, ids: items.map((i) => i.id) });
    if (added || queued || manual) toast(added || queued ? `${added ? `${added} ${added === 1 ? 'Fahrt' : 'Fahrten'} übernommen` : ''}${added && queued ? ', ' : ''}${queued ? `${queued} zur Prüfung` : ''}` : 'Nichts Neues, alles schon da');
    if (!locked && ['heute', 'fahrten', 'bilanz'].includes(currentTab())) render();
  } catch (e) {
    console.warn('Fahrten holen fehlgeschlagen:', e.message);
    if (manual) toast(`Holen fehlgeschlagen: ${e.message}`);
  } finally {
    pulling = false;
  }
}

// ---------- Bosch eBike Flow (Data Act) ----------

let boschInfo = null; // Stand vom Dienst: { connected, keyReady, lastCheck, lastRide, lastError, needsLogin } oder { problem }
let boschAt = 0;
let boschBusy = false;

const ago = (iso) => {
  if (!iso) return 'noch nie';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  if (min < 24 * 60) return `vor ${Math.round(min / 60)} Std.`;
  return `vor ${Math.round(min / 1440)} Tagen`;
};

// Was Bosch bei der letzten Abfrage geliefert hat: Anzahl und Feldnamen, nie Inhalte
function boschDiag(i) {
  if (!i) return '';
  const lead = i.fetched === 0 ? 'Bosch hat bei der letzten Abfrage <strong>keine Fahrten</strong> geliefert.' : `Bosch hat bei der letzten Abfrage <strong>${i.fetched} ${i.fetched === 1 ? 'Fahrt' : 'Fahrten'}</strong> geliefert, ${i.imported} neu.`;
  const bad = i.unreadable ? ` Bei ${i.unreadable} fehlt eine lesbare Startzeit.` : '';
  const shape = i.fetched === 0 ? ` Antwort von Bosch: HTTP ${esc(i.http ?? '?')}, Felder: ${i.bodyKeys?.length ? esc(i.bodyKeys.join(', ')) : 'keine'}${i.total != null ? `, Gesamtzahl ${esc(i.total)}` : ''}.` : '';
  let why = '';
  if (i.fetched === 0 && i.bikes) {
    const b = i.bikes;
    why =
      b.count === 0
        ? '<p class="note warn"><strong>Bosch hat für Rückenwind kein Bike freigegeben.</strong> Schalte in der eBike-Flow-App oder auf flow.bosch-ebike.com unter Data Act die Freigabe für „Rückenwind“ <em>an deinem Bike</em> ein (der Schalter gilt pro Bike) und tippe dann auf „Jetzt abfragen“.</p>'
        : b.count > 0
          ? `<p class="note">Bosch kennt ${b.count} ${b.count === 1 ? 'Bike' : 'Bikes'} mit Freigabe, hat aber noch keine Fahrt gespeichert. Öffne die eBike-Flow-App und prüfe, ob die Fahrt dort in der Aktivitätenliste steht. Sie kommt erst bei Bosch an, wenn die Flow-App sie von der Kiox geholt und hochgeladen hat.</p>`
          : `<p class="note warn">Auch die Bike-Liste konnte nicht gelesen werden (HTTP ${esc(b.http ?? '?')}). Prüfe die Freigabe im Data-Act-Portal.</p>`;
  }
  return `<p class="note">${lead}${bad}${shape}</p>${why}${i.fields?.length ? `<details class="diag"><summary>Felder einer Fahrt</summary><code class="codebox">${esc(i.fields.join(', '))}</code></details>` : ''}`;
}

function boschBody() {
  const base = normalizeUrl(state.notify.url);
  const info = boschInfo;
  if (!base || !state.notify.token) {
    return '<p class="note">Dafür brauchst du den Push-Dienst (Adresse und Token stehen unter <a href="#einstellungen" data-scroll="notify">Morgenmeldung</a>). Er fragt Bosch alle 15 Minuten nach neuen Fahrten.</p>';
  }
  if (!info) return '<p class="note">Prüfe die Verbindung …</p>';
  const dir = '~/Documents/GitHub/rueckenwind/rueckenwind/worker';
  if (info.problem) {
    return `<p class="note warn">${esc(info.problem)}</p>
      <p class="note">Ist der Dienst auf dem neuesten Stand? Aktualisieren geht im Terminal:</p>
      <code class="codebox">cd ${dir} &amp;&amp; npx wrangler@4 deploy</code>
      <div class="actions"><button class="btn" data-action="bosch-refresh">Noch einmal prüfen</button></div>`;
  }
  if (info.connected) {
    const bad = info.lastError;
    return `<p class="bosch-state ${bad ? 'bad' : 'ok'}"><i></i><strong>${info.needsLogin ? 'Anmeldung abgelaufen' : bad ? 'Verbunden, letzte Abfrage mit Problem' : 'Verbunden'}</strong></p>
      <p class="note">Letzte Abfrage ${esc(ago(info.lastCheck))}. Letzte Fahrt bei Bosch: ${info.lastRide ? esc(new Date(info.lastRide).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })) : 'noch keine gesehen'}.</p>
      ${bad ? `<p class="note warn">${esc(bad)}</p>` : ''}
      ${boschDiag(info.lastInfo)}
      <p class="note">Neue Fahrten kommen automatisch. Bosch bekommt sie erst, wenn die eBike-Flow-App sie von der Kiox geholt hat, das passiert meist von selbst kurz nach der Fahrt.</p>
      <label class="check"><input type="checkbox" data-path="notify.autoPull" ${state.notify.autoPull !== false ? 'checked' : ''}><span>Neue Fahrten beim Öffnen der App holen</span></label>
      <div class="actions">
        <button class="btn primary" data-action="bosch-sync" ${boschBusy ? 'disabled' : ''}>${I.refresh}Jetzt abfragen</button>
        ${info.needsLogin ? '<button class="btn" data-action="bosch-connect">Neu verbinden</button>' : ''}
        <button class="btn ghost" data-action="bosch-reload">Fahrten neu laden</button>
        <button class="btn ghost" data-action="bosch-disconnect">Trennen</button>
      </div>`;
  }
  if (!info.keyReady) {
    return `<p class="note">Der Dienst braucht einmalig einen Schlüssel, mit dem er deine Bosch-Zugangsdaten verschlüsselt. Im Terminal:</p>
      <code class="codebox">node ${dir}/scripts/setup-secrets.mjs bosch
cd ${dir} &amp;&amp; npx wrangler@4 deploy</code>
      <div class="actions"><button class="btn" data-action="bosch-refresh">Noch einmal prüfen</button></div>`;
  }
  const redirect = `${base}/bosch/callback`;
  const login = `${location.origin}${location.pathname}#einstellungen`;
  return `<p class="note">Fahrten kommen vollautomatisch aus deinem Bosch-Konto. Möglich macht das die offizielle Schnittstelle nach dem EU Data Act. Sie kostet nichts.</p>
    <ol class="steps">
      <li>Im <a href="https://portal.bosch-ebike.com/data-act/app" target="_blank" rel="noopener">Bosch Data-Act-Portal</a> als Datenempfänger eine App anlegen. Name: <code>Rückenwind</code>, „Confidential client“ aus. Login URL: <code class="codebox">${esc(login)}</code> Redirect URI: <code class="codebox">${esc(redirect)}</code></li>
      <li>Warten, bis Bosch die App freigibt (Minuten bis ein paar Tage). Dann im Flow-Portal oder in der eBike-Flow-App unter <strong>Data Act</strong> die Freigabe für „Rückenwind“ <strong>und für dein Bike</strong> einschalten.</li>
      <li>Die Client-ID hier eintragen und verbinden. Danach das Bosch-Fenster mit „Fertig“ schließen.</li>
    </ol>
    <label class="field">Client-ID<span class="input"><input type="text" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="euda-…" data-path="bosch.clientId" value="${esc(state.bosch?.clientId ?? '')}"></span></label>
    <div class="actions"><button class="btn primary" data-action="bosch-connect" ${boschBusy ? 'disabled' : ''}>Mit Bosch verbinden</button></div>`;
}

function paintBosch() {
  const el = view.querySelector('[data-bosch]');
  if (el) el.innerHTML = boschBody();
}

async function loadBosch({ force = false } = {}) {
  const base = normalizeUrl(state.notify.url);
  if (locked || !base || !state.notify.token || (!force && Date.now() - boschAt < 20000)) return;
  boschAt = Date.now();
  try {
    boschInfo = await boschStatus({ url: base, token: state.notify.token });
  } catch (e) {
    boschInfo = { problem: e.message };
  }
  if (currentTab() === 'einstellungen') paintBosch();
}

async function boschAction(fn) {
  const base = normalizeUrl(state.notify.url);
  if (!base || !state.notify.token || boschBusy) return;
  boschBusy = true;
  paintBosch();
  try {
    await fn(base, state.notify.token);
  } catch (e) {
    toast(e.message);
  } finally {
    boschBusy = false;
    boschAt = 0;
    await loadBosch({ force: true });
  }
}

function reviewCard() {
  if (!importPreview) importPreview = pendingPreview();
  if (importPreview) {
    const { items, ignored } = importPreview;
    const n = items.filter((i) => i.checked).length;
    return `<section class="card import">
      <h2>${items.length} ${items.length === 1 ? 'Fahrt' : 'Fahrten'} ${importPreview.fromPending ? 'zur Prüfung' : 'gefunden'}</h2>
      ${importPreview.fromPending ? '<p class="note">Diese Fahrten kamen von Bosch, passen aber nicht zu deiner Pendelstrecke. Wähle aus, welche zählen sollen.</p>' : ''}
      <ul class="import-list">
        ${items
          .map(
            (it, i) => `<li><label>
              <input type="checkbox" data-import="${i}" ${it.checked ? 'checked' : ''} ${it.dup ? 'disabled' : ''}>
              <span><strong>${fmt.dayShort(it.date)} · ${DIR_LABEL[it.direction]}${it.start ? ` · ${it.start}` : ''}</strong>
              <small>${fmt.km(it.km)} km${it.minutes ? ` · ${it.minutes} min` : ''}${it.kcal != null ? ` · ${it.kcal} kcal` : ''}${it.dup ? ' · schon übernommen' : !it.fits ? ' · passt nicht zu deiner Strecke' : ''}${it.note ? ` · ${esc(it.note)}` : ''}</small></span>
            </label></li>`,
          )
          .join('')}
      </ul>
      ${ignored.length ? `<p class="note">${ignored.length} ${ignored.length === 1 ? 'Zeile wurde' : 'Zeilen wurden'} übersprungen (unlesbar oder unplausibel).</p>` : ''}
      <div class="actions"><button class="btn primary" data-action="review-apply" ${n ? '' : 'disabled'}>${n} übernehmen</button><button class="btn ghost" data-action="review-discard">Verwerfen</button></div>
    </section>`;
  }
  return '';
}

// Eine Fahrt nachträglich ändern: Datum, Richtung, Strecke, Dauer, Kalorien. Leere Kalorien werden wieder geschätzt.
function editRideForm(r) {
  const estimated = r.kcalSource === 'schätzung';
  return `<li class="editing"><form class="edit-form" data-form="edit-ride" data-id="${r.id}">
    <label>Datum<input type="date" name="date" value="${r.date}" max="${todayISO()}" required></label>
    <label>Richtung<select name="direction"><option value="hin" ${r.direction === 'hin' ? 'selected' : ''}>Hinweg</option><option value="rueck" ${r.direction === 'rueck' ? 'selected' : ''}>Rückweg</option></select></label>
    <label>Strecke in km<input type="number" name="km" inputmode="decimal" step="0.1" min="0.1" value="${r.km}" required></label>
    <label><span>Minuten <small>optional</small></span><input type="number" name="minutes" inputmode="numeric" min="1" value="${r.minutes ?? ''}"></label>
    <label class="wide"><span>Kalorien <small>leer lassen = schätzen</small></span><input type="number" name="kcal" inputmode="numeric" min="0" value="${estimated ? '' : r.kcal}" placeholder="${fmt.int(r.kcal)}"></label>
    <div class="actions wide"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-action="edit-cancel">Abbrechen</button></div>
  </form></li>`;
}

function renderRides() {
  const perKm = summarize([], state).perKm;
  const rides = [...state.rides].sort((a, b) => (a.date === b.date ? (a.direction === 'hin' ? 1 : -1) : a.date < b.date ? 1 : -1));
  const groups = new Map();
  for (const r of rides) {
    const d = new Date(`${r.date}T12:00:00`);
    const k = `${d.getFullYear()}-${isoWeek(d)}`;
    if (!groups.has(k)) groups.set(k, { label: `Woche ${isoWeek(d)}`, monday: startOfWeek(d), from: startOfWeek(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }), rides: [] });
    groups.get(k).rides.push(r);
  }
  const s = state.strava;
  const connected = !!s.refreshToken;

  view.innerHTML = `
  <header class="page"><h1>Fahrten</h1>${
    rides.length
      ? `<p class="mega-line" data-reveal><span class="num" data-count="${rides.reduce((a, r) => a + r.km, 0)}" data-dec="1">${fmt.km(rides.reduce((a, r) => a + r.km, 0))}</span><small>km in ${rides.length} Fahrten</small></p>`
      : '<p class="muted">Noch keine Fahrten. Trag deine erste unten ein.</p>'
  }</header>

  ${reviewCard()}
  ${
    connected
      ? `<section class="card strava">
          <div><strong>Strava verbunden</strong><p class="muted">${s.lastSync ? `Zuletzt abgeglichen ${new Date(s.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : 'Noch nicht abgeglichen'}</p></div>
          <button class="btn" data-action="sync">${I.refresh}Abgleichen</button>
        </section>`
      : ''
  }

  <details class="card add" ${rides.length ? '' : 'open'}>
    <summary>Fahrt eintragen</summary>
    <form data-form="add-ride">
      <label>Datum<input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required></label>
      <label>Strecke<select name="direction"><option value="beide">Hin & zurück</option><option value="hin">Nur Hinweg</option><option value="rueck">Nur Rückweg</option></select></label>
      <label>km pro Weg<input type="number" name="km" inputmode="decimal" step="0.1" min="0.1" value="${state.route.distanceKm}" required></label>
      <label>Minuten <small>optional</small><input type="number" name="minutes" inputmode="numeric" min="1" placeholder="${tripMinutes(state.route)}"></label>
      <button class="btn primary" type="submit">Eintragen</button>
    </form>
  </details>

  ${[...groups.values()]
    .map(
      (g) => `
    <section class="week">
      <h2><span class="wk">${g.label}<small>ab ${g.from}</small></span><span class="wkm"><span class="num">${fmt.km(g.rides.reduce((a, r) => a + r.km, 0))}</span><small>km</small></span></h2>
      ${weekStrip(g.monday)}
      <ul class="rides">
        ${g.rides
          .map(
            (r) => `
          ${r.id === editingRide ? editRideForm(r) : `<li>
            <span class="dir ${r.direction}" aria-hidden="true">${I.arrow}</span>
            <div class="what">
              <strong>${fmt.dayShort(r.date)} · ${r.direction === 'hin' ? 'Hinweg' : 'Rückweg'}</strong>
              <span>${{ strava: 'Strava', bosch: 'Bosch', health: 'Importiert' }[r.source] ?? 'Manuell'}${r.minutes ? ` · ${r.minutes} min` : ''} · ${fmt.int(r.kcal)} kcal${r.kcalSource === 'schätzung' ? '*' : ''}</span>
            </div>
            <div class="nums"><strong><span class="num">${fmt.km(r.km)}</span><small>km</small></strong><span class="save">+${fmt.eur(rideSaving(r, perKm))}</span></div>
            <button class="icon-btn edit" data-action="edit-ride" data-id="${r.id}" aria-label="Fahrt bearbeiten">${I.edit}</button>
            <button class="icon-btn" data-action="delete-ride" data-id="${r.id}" aria-label="Fahrt löschen">${I.trash}</button>
          </li>`}`,
          )
          .join('')}
      </ul>
    </section>`,
    )
    .join('')}
  ${rides.some((r) => r.kcalSource === 'schätzung') ? '<p class="footnote">* Geschätzt aus Gewicht und Fahrtdauer. Mit Daten von Bosch wird es genauer.</p>' : ''}`;
  paint();
}

// Mo bis Fr (deine Arbeitstage) als Punkte: ganz gefüllt = hin und zurück, halb = ein Weg, leer = nicht gefahren
function weekStrip(monday) {
  const names = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const todayKey = todayISO();
  const days = names.map((n, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return { n, iso: localISO(d), dow: (i + 1) % 7 };
  }).filter((d) => state.route.workdays.includes(d.dow));
  return `<div class="weekstrip" role="img" aria-label="Fahrten dieser Woche">${days
    .map((d, i) => {
      const r = state.rides.filter((x) => x.date === d.iso);
      const hin = r.some((x) => x.direction === 'hin');
      const rueck = r.some((x) => x.direction === 'rueck');
      const kind = hin && rueck ? 'full' : hin || rueck ? 'half' : d.iso > todayKey ? 'future' : 'none';
      return `<span class="wd ${kind}" style="--i:${i}"><i></i><b>${d.n}</b></span>`;
    })
    .join('')}</div>`;
}

// ---------- Ansicht: Bilanz ----------

let period = 'monat';

function periodRange(p, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (p === 'woche') return { from: localISO(startOfWeek(d)), lead: 'Diese Woche' };
  if (p === 'monat') return { from: localISO(new Date(d.getFullYear(), d.getMonth(), 1)), lead: `Im ${d.toLocaleDateString('de-DE', { month: 'long' })}` };
  if (p === 'jahr') return { from: `${d.getFullYear()}-01-01`, lead: `${d.getFullYear()}` };
  return { from: '0000-00-00', lead: 'Insgesamt' };
}

const cyclistGlyph = () => cyclist({ animated: false });

function weekData() {
  const now = new Date();
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const start = startOfWeek(now);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const a = localISO(start);
    const b = localISO(end);
    weeks.push({ label: String(isoWeek(start)), km: state.rides.filter((r) => r.date >= a && r.date < b).reduce((s, r) => s + r.km, 0), current: i === 0 });
  }
  return weeks;
}

// Zwei Spuren: Auto und E-Bike. Der Balken wächst, das Fahrzeug fährt an seiner Spitze mit.
const CAR_GLYPH = '<svg viewBox="0 0 48 22" aria-hidden="true"><path d="M2 15.5v-3.4l4.6-1.1 4.4-5.1c.6-.7 1.4-1 2.2-1h13c1 0 1.9.4 2.6 1.1l4.5 4.2 6.3 1.2c1.2.2 2.1 1.3 2.1 2.5v1.6h-2.6a4.7 4.7 0 0 0-9.4 0H16.6a4.7 4.7 0 0 0-9.4 0H2z"/><circle cx="11.9" cy="16" r="3" class="hub"/><circle cx="36.1" cy="16" r="3" class="hub"/></svg>';
const BIKE_GLYPH = `<svg viewBox="100 38 300 320" aria-hidden="true" class="cy-mini">${cyclistGlyph()}</svg>`;

function laneHtml(kind, label, value, ratio, glyph) {
  return `<div class="lane ${kind}"><span class="who">${label}</span>
    <div class="track" style="--w:${Math.max(3, ratio * 100)}%"><i></i><span class="run"><span class="glyph">${glyph}</span></span></div>
    <strong class="num" data-count="${value * 100}" data-dec="1">${fmt.km(value * 100)}<small>ct</small></strong></div>`;
}

function renderStats() {
  const range = periodRange(period);
  const rides = state.rides.filter((r) => r.date >= range.from);
  const sum = summarize(rides, state);
  const yearRides = state.rides.filter((r) => r.date.startsWith(String(new Date().getFullYear())));
  const year = summarize(yearRides, state);
  const car = state.car;
  const fuel = FUEL[car.fuel] ?? FUEL.benzin;
  const diff = sum.perKm.car.total - sum.perKm.bike.total;
  const maxPerKm = Math.max(sum.perKm.car.total, sum.perKm.bike.total, 0.01);
  const profile = cumulativeSavings(rides, diff, car.parkingPerDay || 0);
  const goal = Math.round(state.route.distanceKm * 10);
  const tile = (i, ico, label, value, dec, unit, sub) => `<div class="figtile" data-reveal style="--i:${i}"><i class="ico">${ico}</i><dt>${label}</dt><dd><span class="num" data-count="${value}" data-dec="${dec}">${formatCount(value, { dec })}</span><small>${unit}</small></dd><em>${sub}</em></div>`;
  const n = streak();

  view.innerHTML = `
  <header class="page"><h1>Bilanz</h1></header>
  <div class="segmented" role="tablist" aria-label="Zeitraum">
    ${['woche', 'monat', 'jahr', 'gesamt'].map((p) => `<button role="tab" data-action="period" data-p="${p}" aria-selected="${p === period}">${{ woche: 'Woche', monat: 'Monat', jahr: 'Jahr', gesamt: 'Gesamt' }[p]}</button>`).join('')}
  </div>

  ${
    sum.rides
      ? `<section class="mega-hero" data-reveal>
          <p class="cap">${range.lead} gespart</p>
          <p class="mega"><span class="num" data-count="${sum.saved}" data-dec="2" data-cur>${fmt.eur(sum.saved)}</span></p>
          <p class="muted">Gegenüber deinem ${esc(car.name || 'Auto')}, ${car.mode === 'voll' ? 'mit Vollkosten' : 'nur laufende Kosten'} gerechnet.</p>
        </section>
        <section class="block chartcard" data-reveal>
          <header class="row"><h2>Ersparnis-Profil</h2><span class="legend"><i class="k go"></i>laufende Summe</span></header>
          ${savingsChart(profile, { uid: 'sv' })}
        </section>
        <dl class="bigfigs">
          ${tile(0, I.wheel, 'Strecke', sum.km, 1, 'km', `${sum.rides} ${sum.rides === 1 ? 'Fahrt' : 'Fahrten'} an ${sum.days} ${sum.days === 1 ? 'Tag' : 'Tagen'}`)}
          ${tile(1, I.flame, 'Verbrannt', sum.kcal, 0, 'kcal', `etwa ${fmt.int(sum.kcal / 230)} Laugenbrezeln`)}
          ${tile(2, I.leaf, 'CO₂ vermieden', sum.co2Kg, 1, 'kg', `${fmt.km(sum.fuelSaved)} ${fuel.unit} ${car.fuel === 'elektro' ? 'Strom' : fuel.label} gespart`)}
          ${tile(3, I.arrow, 'Serie', n, 0, n === 1 ? 'Tag' : 'Tage', 'Arbeitstage in Folge')}
        </dl>`
      : `<section class="statement empty">
          <p>${range.lead} bist du noch nicht gefahren.</p>
          <p class="muted">Trag deine erste Fahrt ein oder verbinde Bosch in den Einstellungen, dann füllt sich die Bilanz.</p>
          <a class="btn" href="#fahrten">Fahrt eintragen</a>
        </section>`
  }

  <section class="block chartcard" data-reveal>
    <header class="row"><h2>Letzte 12 Wochen</h2><span class="legend"><i class="k goal"></i>${goal} km Ziel</span></header>
    ${weeksChartSvg(weekData(), goal, { uid: 'wk' })}
  </section>

  <section class="block race" data-reveal>
    <h2>Kosten pro Kilometer</h2>
    ${laneHtml('car', 'Auto', sum.perKm.car.total, sum.perKm.car.total / maxPerKm, CAR_GLYPH)}
    ${laneHtml('bike', 'E-Bike', sum.perKm.bike.total, sum.perKm.bike.total / maxPerKm, BIKE_GLYPH)}
    <p class="note">Jeder Radkilometer spart ${fmt.ct(diff)}${car.parkingPerDay ? `, dazu ${fmt.eur(car.parkingPerDay)} Parken pro Arbeitstag` : ''}. Die Werte stellst du unter <a href="#einstellungen">Einstellungen</a> ein.</p>
  </section>

  <section class="block tax" data-reveal>
    <h2>Entfernungspauschale ${new Date().getFullYear()}</h2>
    <p class="mega small"><span class="num" data-count="${year.taxAmount}" data-dec="2" data-cur>${fmt.eur(year.taxAmount)}</span></p>
    <p class="formula">${year.days} Tage × ${fmt.km(state.route.distanceKm)} km × ${fmt.eur(state.tax.ratePerKm)}</p>
    <p class="note">Werbungskosten für die Steuererklärung, gilt auch fürs Rad. Den Satz vor der Abgabe prüfen.</p>
    <button class="btn" data-action="export-csv">Fahrten als CSV exportieren</button>
  </section>`;
  paint();
}

// ---------- Ansicht: Einstellungen ----------

const num = (path, label, { unit = '', step = 'any', min = 0, max, hint = '' } = {}) => {
  const v = path.split('.').reduce((o, k) => o[k], state);
  return `<label class="field">${label}${hint ? `<small>${hint}</small>` : ''}
    <span class="input"><input type="number" inputmode="decimal" data-path="${path}" value="${v}" step="${step}" min="${min}" ${max != null ? `max="${max}"` : ''}>${unit ? `<em>${unit}</em>` : ''}</span></label>`;
};
const range = (path, label, min, max, step, unit) => {
  const v = path.split('.').reduce((o, k) => o[k], state);
  return `<label class="field slider">${label}<output data-out="${path}">${String(v).replace('.', ',')} ${unit}</output>
    <input type="range" data-path="${path}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
};

let distanceBusy = false;

// Distanz zwischen Zuhause und Arbeit selbst berechnen: Radroute, ersatzweise Luftlinie × 1,3
async function updateRouteDistance() {
  const r = state.route;
  if (!r.home || !r.work) return;
  distanceBusy = true;
  if (currentTab() === 'einstellungen') renderSettings();
  let km;
  let path;
  let source = 'route';
  try {
    // ein zweiter Versuch fängt kurze Aussetzer des öffentlichen Dienstes ab
    try {
      ({ km, path } = await fetchBikeRoute(r.home, r.work));
    } catch {
      await new Promise((res) => setTimeout(res, 800));
      ({ km, path } = await fetchBikeRoute(r.home, r.work));
    }
    path = simplify(path);
  } catch {
    km = (distanceM(r.home, r.work) / 1000) * 1.3;
    path = [[r.home.lat, r.home.lon], [r.work.lat, r.work.lon]];
    source = 'luftlinie';
  }
  distanceBusy = false;
  state.route.path = path;
  if (!state.route.distanceManual) {
    state.route.distanceKm = Math.max(0.1, Math.round(km * 10) / 10);
    state.route.distanceSource = source;
    weatherError = null;
  }
  persist();
  if (currentTab() === 'einstellungen') renderSettings();
}

function routeMap() {
  const r = state.route;
  if (!r.home || !r.work) return '';
  if (distanceBusy || !r.path?.length) {
    return `<figure class="map-thumb"><div class="map-frame is-loading" aria-busy="true"><span>Karte wird geladen …</span></div></figure>`;
  }
  const straight = r.distanceSource === 'luftlinie';
  return `<figure class="map-thumb${straight ? ' is-straight' : ''}">
    <div class="map-frame" role="img" aria-label="Karte mit der Route von Zuhause zur Arbeit">
      ${mapThumb(r.path, { width: 480, height: 230, pad: 30 })}
      <small class="osm">© OpenStreetMap</small>
    </div>
    <figcaption><span class="dot start"></span>${esc(r.home.label.split(',')[0])}<span class="arrow">→</span><span class="dot end"></span>${esc(r.work.label.split(',')[0])}${straight ? '<em>Luftlinie</em>' : ''}</figcaption>
  </figure>`;
}

function distanceBlock() {
  const r = state.route;
  const ready = r.home && r.work;
  if (r.distanceManual) {
    return `${num('route.distanceKm', 'Distanz pro Weg', { unit: 'km', step: 0.1 })}
      <button type="button" class="linkbtn" data-action="distance-auto">Automatisch berechnen lassen</button>`;
  }
  let value;
  let note;
  if (!ready) {
    value = '–';
    note = 'Wird berechnet, sobald Zuhause und Arbeit festgelegt sind.';
  } else if (distanceBusy) {
    value = '…';
    note = 'Radroute wird berechnet';
  } else {
    value = `${fmt.km(r.distanceKm)} km`;
    note =
      r.distanceSource === 'route'
        ? `Radroute, automatisch berechnet · Fahrtzeit ≈ ${tripMinutes(r)} min`
        : `Nur geschätzt aus der Luftlinie, die Radroute war nicht erreichbar · Fahrtzeit ≈ ${tripMinutes(r)} min <button type="button" class="linkbtn inline" data-action="distance-retry">Erneut berechnen</button>`;
  }
  return `<div class="field distance">Distanz pro Weg
      <div class="distance-row"><strong class="distance-value">${value}</strong>${ready && !distanceBusy ? `<button type="button" class="linkbtn" data-action="distance-manual">Selbst eintragen</button>` : ''}</div>
      <small>${note}</small>
    </div>`;
}

const editingPlace = { home: false, work: false };
const moreOpen = { auto: false, car: false, fine: false, strava: false, rules: false, notify: false, msgs: false };

const more = (id, title, hint, body) => `
    <details class="more" data-more="${id}" ${moreOpen[id] ? 'open' : ''}>
      <summary><span>${title}<small>${hint}</small></span></summary>
      <div class="more-body">${body}</div>
    </details>`;

function placeBlock(which, label) {
  const p = state.route[which];
  const editing = !p || editingPlace[which];
  return `
  <div class="place" data-place="${which}">
    <span class="plabel">${I.pin}${label}</span>
    ${
      p
        ? `<div class="place-row"><p class="current">${esc(p.label)}</p>${editing ? '' : `<button type="button" class="btn ghost small" data-action="edit-place" data-which="${which}">Ändern</button>`}</div>`
        : ''
    }
    ${
      editing
        ? `<form class="search" data-form="search" data-which="${which}">
            <input type="search" name="q" placeholder="Adresse suchen" autocomplete="street-address" enterkeyhint="search" aria-label="${label}: Adresse suchen">
            <button class="btn" type="submit">Suchen</button>
            <button class="btn ghost" type="button" data-action="locate" data-which="${which}" aria-label="Aktuellen Standort verwenden">${I.pin}</button>
          </form>
          <ul class="results" data-results="${which}"></ul>`
        : ''
    }
  </div>`;
}

function calcLines() {
  const c = carCostPerKm(state.car);
  const b = bikeCostPerKm(state.bike);
  return {
    car: `= ${fmt.ct(c.total)} pro km <span class="muted">(Energie ${fmt.ct(c.energy)} · Verschleiß ${fmt.ct(c.wear)}${state.car.mode === 'voll' ? ` · Fixkosten ${fmt.ct(c.fixed)}` : ''})</span>`,
    bike: `= ${fmt.ct(b.total)} pro km <span class="muted">(Strom ${fmt.ct(b.energy)} · Verschleiß ${fmt.ct(b.wear)}) · Reichweite ≈ ${fmt.int(bikeRangeKm(state.bike))} km</span>`,
  };
}

// ---------- Radwetter-Profile ----------

const RULE_KEYS = ['minTemp', 'maxTemp', 'maxRainProb', 'maxPrecip', 'maxWind', 'maxGust'];
const sameRules = (a, b) => RULE_KEYS.every((k) => Number(a[k]) === Number(b[k]));

function allPresets() {
  return [
    ...Object.entries(RULE_PRESETS).map(([id, p]) => ({ id, ...p, builtin: true })),
    ...(state.customPresets || []).map((p) => ({ ...p, builtin: false })),
  ];
}

function activePresetId() {
  const hit = allPresets().find((p) => sameRules(p.rules, state.rules));
  return hit ? hit.id : 'eigene';
}

// ---------- Profil-Karten ----------
// Jede Szene wird aus den Schwellen des Profils erzeugt: Wer auch bei Kälte fährt, bekommt einen kalten Mond statt
// einer warmen Sonne; höheres Regenrisiko bringt Wolken und Regen, mehr Wind bringt Windstreifen und schrägen Regen.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
function mixHex(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function sceneFor(r, uid) {
  const warm = clamp01((r.minTemp + 5) / 15);
  const wet = clamp01(r.maxRainProb / 70);
  const windy = clamp01((r.maxWind - 15) / 30);
  const H = 84; // Horizont
  const cy = 60 - warm * 14;
  const skyTop = mixHex('16223d', '231c3a', warm);
  const skyLow = mixHex('5b7196', 'ff9a68', warm);
  const discIn = mixHex('eef3fb', 'fff2cf', warm);
  const discOut = mixHex('94a6c4', 'ff8a52', warm);

  // Wolkenbänder ziehen mit wachsendem Regenrisiko über die Scheibe
  const clouds = [];
  if (wet > 0.3) clouds.push(`<rect x="${18 + (1 - wet) * 40}" y="${cy - 6}" width="${70 + wet * 40}" height="9" rx="4.5" fill="${mixHex('c9d3e6', 'ffe1c8', warm)}" opacity="${0.35 + wet * 0.3}"/>`);
  if (wet > 0.5) clouds.push(`<rect x="${70 - wet * 30}" y="${cy + 6}" width="${60 + wet * 50}" height="7" rx="3.5" fill="${mixHex('aab6cc', 'f6c9a8', warm)}" opacity="${0.3 + wet * 0.3}"/>`);
  if (wet > 0.75) clouds.push(`<rect x="-6" y="${cy - 20}" width="120" height="12" rx="6" fill="#2a3452" opacity=".85"/>`);

  // Regen: Dichte nach Regenrisiko, Neigung nach Wind
  const rain = [];
  const drops = wet > 0.45 ? Math.round((wet - 0.4) * 30) : 0;
  const slant = 3 + windy * 9;
  for (let i = 0; i < drops; i++) {
    const x = 10 + ((i * 47) % 150);
    const y = 6 + ((i * 29) % 52);
    rain.push(`<line x1="${x}" y1="${y}" x2="${x - slant}" y2="${y + 11}"/>`);
  }

  // Windstreifen von vorn auf den Fahrer zu
  const wind = [];
  const streaks = Math.floor(windy * 3.6);
  for (let i = 0; i < streaks; i++) {
    const y = 44 + i * 10;
    const x = 112 + (i % 2) * 12;
    wind.push(`<path d="M${x} ${y} h${30 - i * 4}" /><path d="M${x + 36 - i * 4} ${y} h6" />`);
  }

  return `
  <svg class="scene-art" viewBox="0 0 160 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient>
      <radialGradient id="disc-${uid}" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${discIn}"/><stop offset="1" stop-color="${discOut}"/></radialGradient>
      <radialGradient id="halo-${uid}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${discOut}" stop-opacity=".45"/><stop offset="1" stop-color="${discOut}" stop-opacity="0"/></radialGradient>
      <clipPath id="clip-${uid}"><rect width="160" height="${H}"/></clipPath>
    </defs>
    <rect width="160" height="${H}" fill="url(#sky-${uid})"/>
    <g clip-path="url(#clip-${uid})">
      <ellipse cx="80" cy="${cy}" rx="76" ry="50" fill="url(#halo-${uid})"/>
      <circle cx="80" cy="${cy}" r="28" fill="url(#disc-${uid})"/>
      ${clouds.join('')}
      <g class="rain">${rain.join('')}</g>
      <g class="streaks">${wind.join('')}</g>
    </g>
    <rect y="${H}" width="160" height="${100 - H}" fill="#070b14"/>
    <line x1="0" y1="${H + 0.5}" x2="160" y2="${H + 0.5}" stroke="${skyLow}" stroke-opacity=".45"/>
    <g class="cy" transform="translate(41 30.6) scale(0.15)">${CYCLIST}</g>
  </svg>`;
}

function presetCard(p, active, uid) {
  const r = p.rules;
  const checked = p.id === active;
  return `
  <div class="pcard-wrap">
    <button type="button" role="radio" class="pcard" data-action="preset" data-id="${p.id}" aria-checked="${checked}">
      ${sceneFor(r, uid)}
      <span class="pbody">
        <strong>${esc(p.label)}</strong>
        <span class="phint">${esc(p.hint || 'Dein gespeichertes Profil.')}</span>
        <span class="pmeta"><span>ab ${r.minTemp} °C</span><span>${I.drop}${r.maxRainProb} %</span><span>${I.wind}${r.maxWind} km/h</span></span>
      </span>
      <span class="pcheck" aria-hidden="true">${I.check}</span>
    </button>
    ${p.builtin ? '' : `<button type="button" class="pdel" data-action="preset-delete" data-id="${p.id}" aria-label="Profil ${esc(p.label)} löschen">×</button>`}
  </div>`;
}

function presetBlock() {
  const active = activePresetId();
  const cards = allPresets().map((p, i) => presetCard(p, active, `p${i}`)).join('');
  const r = state.rules;
  const draft =
    active === 'eigene'
      ? `<div class="pcard-wrap">
          <div class="pcard is-draft" aria-current="true">
            ${sceneFor(r, 'draft')}
            <span class="pbody">
              <strong>Eigene</strong>
              <span class="phint">Gerade angepasst und noch nicht gespeichert.</span>
              <span class="pmeta"><span>ab ${r.minTemp} °C</span><span>${I.drop}${r.maxRainProb} %</span><span>${I.wind}${r.maxWind} km/h</span></span>
            </span>
          </div>
        </div>`
      : '';
  return `
  <div class="prow" role="radiogroup" aria-label="Radwetter-Profil">${cards}${draft}</div>
  ${
    active === 'eigene'
      ? `<form class="save-preset" data-form="save-preset">
          <input type="text" name="name" maxlength="24" placeholder="Als Profil speichern, z. B. Winter" aria-label="Name des Profils" required>
          <button class="btn" type="submit">Speichern</button>
        </form>`
      : ''
  }`;
}

// Beim Ziehen der Regler: Karten neu zeichnen, damit die Szene live mitgeht
function refreshPresets() {
  const el = view.querySelector('[data-presets]');
  if (el) el.innerHTML = presetBlock();
}

function renderSettings() {
  const r = state.route;
  const fuel = FUEL[state.car.fuel] ?? FUEL.benzin;
  const calc = calcLines();
  const s = state.strava;
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  view.innerHTML = `
  <header class="page"><h1>Einstellungen</h1><p class="muted">Alles bleibt auf diesem Gerät gespeichert.</p></header>

  <section class="group"><h2>Arbeitsweg</h2><div class="card settings">
    ${placeBlock('home', 'Zuhause')}
    ${placeBlock('work', 'Arbeit')}
    ${distanceBlock()}
    ${routeMap()}
    <div class="two">
      <label class="field">Abfahrt Hinweg<span class="input"><input type="time" data-path="route.departHin" value="${r.departHin}"></span></label>
      <label class="field">Abfahrt Rückweg<span class="input"><input type="time" data-path="route.departRueck" value="${r.departRueck}"></span></label>
    </div>
    <div class="field">Arbeitstage
      <div class="chips">${days.map((d, i) => { const dow = (i + 1) % 7; return `<button type="button" class="chip" data-action="workday" data-dow="${dow}" aria-pressed="${r.workdays.includes(dow)}">${d}</button>`; }).join('')}</div>
    </div>
  </div></section>

  <section class="group"><h2>Mein Radwetter</h2><div class="card settings">
    <div class="radwetter-head"><h3>Wie viel verträgst du?</h3></div>
    <div data-presets>${presetBlock()}</div>
    <div class="rules-bar">
      <p class="note">Die Schwellen gelten für Hin- und Rückweg.</p>
      <button type="button" class="btn ghost small" data-action="toggle-rules" aria-expanded="${moreOpen.rules}" aria-controls="rules-sliders">${I.edit}<span>${moreOpen.rules ? 'Fertig' : 'Anpassen'}</span></button>
    </div>
    <div id="rules-sliders" class="rules-sliders" ${moreOpen.rules ? '' : 'hidden'}>
      ${range('rules.minTemp', 'Mindestens', -10, 15, 1, '°C')}
      ${range('rules.maxTemp', 'Höchstens', 20, 40, 1, '°C')}
      ${range('rules.maxRainProb', 'Regenrisiko bis', 0, 100, 5, '%')}
      ${range('rules.maxPrecip', 'Regenmenge bis', 0, 5, 0.1, 'mm')}
      ${range('rules.maxWind', 'Wind bis', 10, 60, 1, 'km/h')}
      ${range('rules.maxGust', 'Böen bis', 20, 90, 5, 'km/h')}
    </div>
  </div></section>

  ${notifyGroup()}

  <section class="group"><h2>Mein Auto</h2><div class="card settings">
    <label class="field">Antrieb<span class="input"><select data-path="car.fuel" data-rerender>${Object.entries(FUEL).map(([k, f]) => `<option value="${k}" ${k === state.car.fuel ? 'selected' : ''}>${f.label}</option>`).join('')}</select></span></label>
    <div class="two">
      ${num('car.consumption', 'Verbrauch', { unit: `${fuel.unit}/100 km`, step: 0.1 })}
      ${num('car.energyPrice', fuel.unit === 'l' ? 'Spritpreis' : 'Strompreis', { unit: `€/${fuel.unit}`, step: 0.01 })}
    </div>
    <p class="calc" data-calc="car">${calc.car}</p>
    ${more(
      'car',
      'Genauer rechnen',
      'Name, Fixkosten, Parken, Vollkosten',
      `<label class="field">Bezeichnung<span class="input"><input type="text" data-path="car.name" value="${esc(state.car.name)}" placeholder="z. B. VW Golf"></span></label>
      ${num('car.annualKm', 'Fahrleistung pro Jahr', { unit: 'km', step: 500 })}
      <div class="two">
        ${num('car.maintenance', 'Wartung & Reparatur', { unit: '€/Jahr', step: 10 })}
        ${num('car.tires', 'Reifen', { unit: '€/Jahr', step: 10 })}
        ${num('car.insurance', 'Versicherung', { unit: '€/Jahr', step: 10 })}
        ${num('car.tax', 'Kfz-Steuer', { unit: '€/Jahr', step: 10 })}
        ${num('car.depreciation', 'Wertverlust', { unit: '€/Jahr', step: 100 })}
        ${num('car.parkingPerDay', 'Parken am Arbeitsort', { unit: '€/Tag', step: 0.5 })}
      </div>
      <div class="field">Was zählt als Ersparnis?
        <div class="radio">
          <label><input type="radio" name="mode" data-path="car.mode" value="laufend" ${state.car.mode !== 'voll' ? 'checked' : ''}><span><strong>Laufende Kosten</strong><small>Energie und Verschleiß – du behältst dein Auto.</small></span></label>
          <label><input type="radio" name="mode" data-path="car.mode" value="voll" ${state.car.mode === 'voll' ? 'checked' : ''}><span><strong>Vollkosten</strong><small>Inkl. Versicherung, Steuer, Wertverlust – falls das Rad das Auto ersetzt.</small></span></label>
        </div>
      </div>`,
    )}
  </div></section>

  <section class="group"><div class="card settings">
    ${more(
      'fine',
      'Feinabstimmung',
      'E-Bike, Gewicht, Steuer, Tempo',
      `<div class="sub"><h3>E-Bike</h3>
        <label class="field">Bezeichnung<span class="input"><input type="text" data-path="bike.name" value="${esc(state.bike.name)}"></span></label>
        <div class="two">
          <label class="field">Akku<span class="input"><input type="number" list="batteries" inputmode="numeric" data-path="bike.batteryWh" value="${state.bike.batteryWh}" step="1" min="100"><em>Wh</em></span></label>
          ${num('bike.whPerKm', 'Verbrauch', { unit: 'Wh/km', step: 0.5, hint: 'typisch 6–12' })}
          ${num('bike.electricityPrice', 'Strompreis', { unit: '€/kWh', step: 0.01 })}
          ${num('bike.maintenance', 'Wartung', { unit: '€/Jahr', step: 10 })}
        </div>
        ${num('bike.annualKm', 'Fahrleistung pro Jahr', { unit: 'km', step: 100 })}
        <datalist id="batteries"><option value="400"><option value="500"><option value="545"><option value="625"><option value="725"><option value="750"><option value="800"></datalist>
        <p class="calc" data-calc="bike">${calc.bike}</p>
      </div>
      <div class="sub"><h3>Kalorien, Steuer & CO₂</h3>
        <div class="two">
          ${num('person.weightKg', 'Körpergewicht', { unit: 'kg', step: 1, min: 30 })}
          ${num('person.met', 'Belastung (MET)', { step: 0.1, min: 1, hint: 'E-Bike ≈ 4–6' })}
          ${num('tax.ratePerKm', 'Entfernungspauschale', { unit: '€/km', step: 0.01 })}
          ${num('co2.gridGPerKWh', 'Strommix', { unit: 'g CO₂/kWh', step: 10 })}
        </div>
        <p class="note">Kalorien kommen bevorzugt von der Kiox über Strava. Ohne diese Daten schätzt die App aus Gewicht × MET × Fahrtdauer.</p>
      </div>
      <div class="sub"><h3>Fahrtdauer</h3>
        ${num('route.avgSpeed', 'Ø Geschwindigkeit', { unit: 'km/h', step: 1, min: 5, hint: `Fahrtzeit ≈ ${tripMinutes(r)} min` })}
      </div>`,
    )}
  </div></section>

  <section class="group" id="bosch"><h2>Bosch eBike Flow</h2><div class="card settings" data-bosch>${boschBody()}</div></section>

  <section class="group" id="strava"><h2>Weitere Quellen</h2><div class="card settings">
    ${more(
      'strava',
      'Strava',
      'nur mit Strava-Abo, die Schnittstelle ist kostenpflichtig',
      s.refreshToken
        ? `<p>Strava verbunden${s.athleteName ? ` als <strong>${esc(s.athleteName)}</strong>` : ''}.</p>
           <div class="actions"><button class="btn primary" data-action="sync">${I.refresh}Jetzt abgleichen</button><button class="btn ghost" data-action="strava-disconnect">Trennen</button></div>`
        : `<ol class="steps">
            <li>In der <strong>eBike Flow</strong>-App Strava verbinden. Optional auch komoot mit Strava verbinden.</li>
            <li>Auf <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> eine eigene API-App anlegen. Strava verlangt dafür ein Abonnement. Als „Authorization Callback Domain“ eintragen: <code>${esc(location.hostname)}</code></li>
            <li>Client-ID und Client-Secret hier eintragen und verbinden.</li>
          </ol>
          <label class="field">Client-ID<span class="input"><input type="text" inputmode="numeric" data-path="strava.clientId" value="${esc(s.clientId)}" autocomplete="off"></span></label>
          <label class="field">Client-Secret<span class="input"><input type="password" data-path="strava.clientSecret" value="${esc(s.clientSecret)}" autocomplete="off"></span></label>
          <button class="btn primary wide" data-action="strava-connect">Mit Strava verbinden</button>
          <p class="note">Das Secret bleibt nur in diesem Browser. Erkannt werden Fahrten, die bis ${state.route.matchRadiusM} m von Zuhause bzw. Arbeit starten und enden.</p>`,
    )}
  </div></section>

  <section class="group"><h2>Sicherheit</h2><div class="card settings">
    ${
      session
        ? `<p class="sec-status">${I.lock}App-Sperre ist an · ${session.len}-stellige PIN</p>
          <label class="field">Automatisch sperren<span class="input"><select data-path="security.autoLockMin">${[[0, 'Sofort beim Verlassen der App'], [1, 'Nach 1 Minute'], [5, 'Nach 5 Minuten'], [15, 'Nach 15 Minuten']].map(([v, l]) => `<option value="${v}" ${Number(state.security?.autoLockMin ?? 1) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></span></label>
          <div class="actions"><button class="btn primary" data-action="lock-now">Jetzt sperren</button><button class="btn" data-action="lock-change">PIN ändern</button><button class="btn ghost" data-action="lock-disable">Ausschalten</button></div>
          <p class="sec-note">Fahrten, Adressen und Strava-Zugangsdaten sind auf diesem Gerät verschlüsselt. Vergisst du die PIN, gibt es keinen Weg zurück. Sicherungen sind ebenfalls verschlüsselt und brauchen dieselbe PIN.</p>`
        : `<p class="sec-note">Schützt Fahrten, Adressen und Strava-Zugangsdaten mit einer PIN. Die Daten werden auf dem Gerät verschlüsselt, nichts davon geht an einen Server.</p>
          <div class="pinlen"><span>PIN-Länge</span><div class="chips" role="group" aria-label="PIN-Länge">${[6, 8, 10].map((n) => `<button type="button" class="chip" data-action="pin-len" data-len="${n}" aria-pressed="${pinLenChoice === n}">${n}</button>`).join('')}</div></div>
          <button class="btn primary" data-action="lock-enable">App-Sperre einschalten</button>
          <p class="sec-note">Länger ist sicherer: Eine kurze PIN ließe sich bei einer kopierten Datei durchprobieren. 8 oder mehr Ziffern sind deutlich besser.</p>`
    }
  </div></section>

  <section class="group"><h2>Daten</h2><div class="card settings">
    <div class="actions">
      <button class="btn" data-action="export-json">Sichern</button>
      <label class="btn">Wiederherstellen<input type="file" accept="application/json" data-action="import-json" hidden></label>
      <button class="btn danger" data-action="reset">Alles löschen</button>
    </div>
    <p class="sec-note">${session ? 'Die Sicherung ist verschlüsselt und lässt sich nur mit deiner PIN wieder öffnen.' : 'Die Sicherung ist eine Klartext-Datei. Bewahre sie sicher auf oder schalte die App-Sperre ein.'}</p>
  </div></section>
  <p class="footnote">Rückenwind v0.16 · Wetter: Open-Meteo · Adressen: © OpenStreetMap</p>`;

  if (sessionStorage.getItem('scrollTo')) {
    document.getElementById(sessionStorage.getItem('scrollTo'))?.scrollIntoView();
    sessionStorage.removeItem('scrollTo');
  }
}

function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const obj = keys.reduce((o, k) => o[k], state);
  obj[last] = value;
}

function updateCalcs() {
  const c = calcLines();
  const carEl = view.querySelector('[data-calc="car"]');
  const bikeEl = view.querySelector('[data-calc="bike"]');
  if (carEl) carEl.innerHTML = c.car;
  if (bikeEl) bikeEl.innerHTML = c.bike;
}

// ---------- Interaktion ----------

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.type === 'range') {
    const v = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }
  return el.value;
}

view.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.path || el.tagName === 'SELECT' || el.type === 'radio') return; // die laufen über 'change'
  if (el.type === 'range') {
    const out = view.querySelector(`[data-out="${el.dataset.path}"]`);
    if (out) out.textContent = `${el.value.replace('.', ',')} ${el.dataset.unit}`;
  }
  const v = readInput(el);
  if (v === null) return;
  setPath(el.dataset.path, v);
  updateCalcs();
  if (el.dataset.path.startsWith('rules.')) refreshPresets();
});

view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.action === 'import-json') return importJson(el);
  if (el.dataset.import !== undefined && importPreview) {
    importPreview.items[+el.dataset.import].checked = el.checked;
    const n = importPreview.items.filter((i) => i.checked && !i.dup).length;
    const btn = view.querySelector('[data-action="review-apply"]');
    if (btn) {
      btn.textContent = `${n} übernehmen`;
      btn.disabled = n === 0;
    }
    return;
  }
  if (!el.dataset.path) return;
  const v = readInput(el);
  if (v === null) return;
  if (el.dataset.path === 'car.fuel' && FUEL[v].unit !== (FUEL[state.car.fuel] ?? FUEL.benzin).unit) {
    // Einheit wechselt (l ↔ kWh): Startwerte passend zum Antrieb setzen
    Object.assign(state.car, v === 'elektro' ? { consumption: 17, energyPrice: 0.35 } : { consumption: 6.5, energyPrice: 1.75 });
  }
  setPath(el.dataset.path, v);
  if (el.dataset.path.startsWith('route.') || el.dataset.path.startsWith('rules.')) weatherError = null;
  persist();
  if ('rerender' in el.dataset) renderSettings();
  else updateCalcs();
});

// <details> merken, ob offen – sonst klappen sie beim Neuzeichnen der Einstellungen wieder zu
view.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.dataset?.more) moreOpen[d.dataset.more] = d.open;
}, true);

view.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.form === 'edit-ride') {
    const r = state.rides.find((x) => x.id === form.dataset.id);
    if (!r) return;
    const fd = new FormData(form);
    const km = parseFloat(String(fd.get('km')).replace(',', '.'));
    if (!Number.isFinite(km) || km <= 0) return toast('Bitte eine Strecke größer als 0 eintragen');
    const date = String(fd.get('date'));
    const direction = fd.get('direction') === 'rueck' ? 'rueck' : 'hin';
    if (state.rides.some((x) => x.id !== r.id && x.date === date && x.direction === direction)) return toast('Für diesen Tag und diese Richtung gibt es schon eine Fahrt');
    const minutes = parseInt(fd.get('minutes'), 10) || null;
    const kcalRaw = String(fd.get('kcal')).trim();
    const kcal = kcalRaw === '' ? null : Number(kcalRaw);
    // ref bleibt stehen: so wird die Fahrt beim erneuten Laden von Bosch nicht noch einmal angelegt
    Object.assign(r, { date, direction, km: Math.round(km * 100) / 100, minutes }, kcal === null || !Number.isFinite(kcal) ? { kcal: estimateKcal(km, minutes, state.person, state.route.avgSpeed), kcalSource: 'schätzung' } : { kcal: Math.round(kcal), kcalSource: 'manuell' });
    editingRide = null;
    persist();
    toast('Fahrt gespeichert');
    renderRides();
    return;
  }
  if (form.dataset.form === 'add-ride') {
    const fd = new FormData(form);
    const km = parseFloat(String(fd.get('km')).replace(',', '.'));
    const minutes = parseInt(fd.get('minutes'), 10) || null;
    const date = fd.get('date');
    const dirs = fd.get('direction') === 'beide' ? ['hin', 'rueck'] : [fd.get('direction')];
    let added = 0;
    for (const direction of dirs) {
      if (state.rides.some((r) => r.date === date && r.direction === direction)) continue;
      state.rides.push(makeRide({ date, direction, km, minutes }));
      added++;
    }
    persist();
    toast(added ? `${added === 2 ? 'Hin- und Rückweg' : '1 Fahrt'} eingetragen` : 'Für diesen Tag schon eingetragen');
    renderRides();
  }
  if (form.dataset.form === 'save-preset') {
    const label = new FormData(form).get('name').trim();
    if (!label) return;
    state.customPresets = [...(state.customPresets || []), { id: newId(), label, rules: { ...state.rules } }];
    persist();
    renderSettings();
    toast(`Profil „${label}“ gespeichert`);
    return;
  }
  if (form.dataset.form === 'search') {
    const which = form.dataset.which;
    const q = new FormData(form).get('q').trim();
    const list = view.querySelector(`[data-results="${which}"]`);
    if (!q) return;
    list.innerHTML = '<li class="muted">Suche …</li>';
    try {
      const results = await searchAddress(q);
      list.innerHTML = results.length
        ? results.map((r, i) => `<li><button type="button" data-action="pick-place" data-which="${which}" data-i="${i}">${esc(r.label)}</button></li>`).join('')
        : '<li class="muted">Nichts gefunden – versuch es mit Straße, Ort.</li>';
      list._results = results;
    } catch (err) {
      list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
    }
  }
});

function setPlace(which, place) {
  state.route[which] = { lat: place.lat, lon: place.lon, label: shortLabel(place.label) };
  editingPlace[which] = false;
  state.route.path = [];
  weatherError = null;
  persist();
  renderSettings();
  updateRouteDistance();
  toast(which === 'home' ? 'Zuhause gespeichert' : 'Arbeitsort gespeichert');
}

const shortLabel = (label) => label.split(',').slice(0, 3).join(',').trim();

const actions = {
  'bosch-refresh': () => loadBosch({ force: true }),
  'bosch-connect': () => {
    const id = String(state.bosch?.clientId ?? '').trim();
    if (!/^euda-[\w-]{4,80}$/.test(id)) return toast('Die Client-ID beginnt mit „euda-“. Kopiere sie aus dem Bosch-Portal.');
    state.bosch.clientId = id;
    persist();
    return boschAction(async (url, token) => {
      const { url: login } = await boschStart({ url, token, clientId: id });
      location.href = login;
    });
  },
  'bosch-sync': () =>
    boschAction(async (url, token) => {
      const r = await boschSync({ url, token });
      if (r.error) return toast(r.error);
      await pullInbox({ manual: true });
      if (!r.imported) toast(r.fetched ? `Bosch lieferte ${r.fetched} ${r.fetched === 1 ? 'Fahrt' : 'Fahrten'}, nichts Neues` : 'Bosch hat keine Fahrten geliefert');
    }),
  'bosch-reload': () => {
    if (!confirm('Die Fahrten der letzten 14 Tage noch einmal von Bosch holen? Was schon in der App steht, wird nicht doppelt eingetragen.')) return;
    return boschAction(async (url, token) => {
      const r = await boschSync({ url, token, reset: true });
      if (r.error) return toast(r.error);
      await pullInbox({ manual: true });
    });
  },
  'bosch-disconnect': () => {
    if (!confirm('Verbindung zu Bosch trennen? Schon übernommene Fahrten bleiben.')) return;
    return boschAction(async (url, token) => {
      await boschDisconnect({ url, token });
      toast('Von Bosch getrennt');
    });
  },
  'notify-test-evening': () => testNotify('abend'),
  ask: (el) => {
    const a = el.dataset.a;
    const date = todayISO();
    const legs = a === 'both' ? ['hin', 'rueck'] : a === 'none' ? [] : [a];
    for (const direction of legs) {
      if (!state.rides.some((r) => r.date === date && r.direction === direction)) state.rides.push(makeRide({ date, direction, km: state.route.distanceKm }));
    }
    state.notify.answeredDate = date;
    persist();
    if (location.hash === '#frage') history.replaceState(null, '', `${location.pathname}${location.search}#heute`);
    toast(
      a === 'none' ? 'Notiert: heute nicht gefahren.' : a === 'both' ? `Hin- und Rückweg gespeichert: ${fmt.km(state.route.distanceKm * 2)} km` : `${a === 'hin' ? 'Hinweg' : 'Rückweg'} gespeichert: ${fmt.km(state.route.distanceKm)} km`,
    );
    renderToday();
  },
  'notify-enable': () => enableNotify(),
  'notify-disable': () => disableNotify(),
  'notify-test': () => testNotify(),
  day: (el) => {
    dayOffset = +el.dataset.d;
    renderToday();
  },
  'review-discard': () => {
    if (importPreview?.fromPending) {
      state.pendingRides = [];
      persist();
    }
    importPreview = null;
    renderRides();
  },
  'review-apply': () => {
    const chosen = (importPreview?.items ?? []).filter((i) => i.checked && !i.dup);
    for (const it of chosen) addImportedRide(it);
    if (importPreview?.fromPending) state.pendingRides = (state.pendingRides ?? []).filter((p) => !chosen.some((c) => c.ref === p.ref));
    importPreview = null;
    persist();
    toast(`${chosen.length} ${chosen.length === 1 ? 'Fahrt' : 'Fahrten'} übernommen`);
    renderRides();
  },
  'pin-len': (el) => {
    pinLenChoice = +el.dataset.len;
    view.querySelectorAll('[data-action="pin-len"]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.len === pinLenChoice)));
  },
  'lock-enable': () => enableLock(),
  'lock-now': () => lockNow(),
  'lock-change': () => changePin(),
  'lock-disable': () => disableLock(),
  'distance-retry': () => updateRouteDistance(),
  'distance-manual': () => {
    state.route.distanceManual = true;
    persist();
    renderSettings();
    view.querySelector('[data-path="route.distanceKm"]')?.focus();
  },
  'distance-auto': () => {
    state.route.distanceManual = false;
    persist();
    updateRouteDistance();
  },
  'toggle-rules': (el) => {
    moreOpen.rules = !moreOpen.rules;
    el.setAttribute('aria-expanded', String(moreOpen.rules));
    el.querySelector('span').textContent = moreOpen.rules ? 'Fertig' : 'Anpassen';
    document.getElementById('rules-sliders').hidden = !moreOpen.rules;
  },
  'edit-place': (el) => {
    editingPlace[el.dataset.which] = true;
    renderSettings();
    view.querySelector(`[data-place="${el.dataset.which}"] input[type=search]`)?.focus();
  },
  preset: (el) => {
    const p = allPresets().find((x) => x.id === el.dataset.id);
    if (!p) return;
    state.rules = { ...state.rules, ...p.rules };
    weatherError = null;
    persist();
    renderSettings();
    toast(`Profil „${p.label}“ gesetzt`);
  },
  'preset-delete': (el) => {
    const p = (state.customPresets || []).find((x) => x.id === el.dataset.id);
    if (!p || !confirm(`Profil „${p.label}“ löschen?`)) return;
    state.customPresets = state.customPresets.filter((x) => x.id !== p.id);
    persist();
    renderSettings();
  },
  'toggle-ride': (el) => {
    const dir = el.dataset.dir;
    const date = todayISO();
    const idx = state.rides.findIndex((r) => r.date === date && r.direction === dir);
    if (idx >= 0) state.rides.splice(idx, 1);
    else state.rides.push(makeRide({ date, direction: dir, km: state.route.distanceKm }));
    persist();
    if (idx < 0) toast(`${dir === 'hin' ? 'Hinweg' : 'Rückweg'} gespeichert – ${fmt.km(state.route.distanceKm)} km`);
    renderToday();
  },
  refresh: () => {
    weatherError = null;
    ensureForecast(true);
  },
  'edit-ride': (el) => {
    editingRide = el.dataset.id;
    renderRides();
    view.querySelector('.edit-form input[name="km"]')?.focus({ preventScroll: true });
  },
  'edit-cancel': () => {
    editingRide = null;
    renderRides();
  },
  'delete-ride': (el) => {
    if (!confirm('Diese Fahrt löschen?')) return;
    state.rides = state.rides.filter((r) => r.id !== el.dataset.id);
    persist();
    renderRides();
  },
  period: (el) => {
    period = el.dataset.p;
    renderStats();
  },
  workday: (el) => {
    const dow = +el.dataset.dow;
    const wd = state.route.workdays;
    state.route.workdays = wd.includes(dow) ? wd.filter((d) => d !== dow) : [...wd, dow].sort();
    el.setAttribute('aria-pressed', String(state.route.workdays.includes(dow)));
    persist();
  },
  'pick-place': (el) => {
    const list = el.closest('[data-results]');
    setPlace(el.dataset.which, list._results[+el.dataset.i]);
  },
  locate: async (el) => {
    try {
      const pos = await currentPosition();
      setPlace(el.dataset.which, { ...pos, label: `Standort (${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)})` });
    } catch (e) {
      toast(e.message);
    }
  },
  'strava-connect': () => {
    const s = state.strava;
    if (!s.clientId || !s.clientSecret) return toast('Bitte Client-ID und Secret eintragen');
    persist();
    location.href = strava.authorizeUrl(s.clientId);
  },
  'strava-disconnect': () => {
    Object.assign(state.strava, { accessToken: '', refreshToken: '', expiresAt: 0, athleteName: '' });
    persist();
    renderSettings();
  },
  sync: () => syncStrava(),
  'export-csv': () => {
    const perKm = summarize([], state).perKm;
    const rows = [['Datum', 'Richtung', 'km', 'Minuten', 'kcal', 'Kalorienquelle', 'Quelle', 'Ersparnis €']];
    for (const r of [...state.rides].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      rows.push([r.date, r.direction === 'hin' ? 'Hinweg' : 'Rückweg', fmt.km(r.km), r.minutes ?? '', r.kcal, r.kcalSource, r.source, rideSaving(r, perKm).toFixed(2).replace('.', ',')]);
    }
    download(`rueckenwind-fahrten-${todayISO()}.csv`, '﻿' + rows.map((r) => r.join(';')).join('\n'), 'text/csv');
  },
  'export-json': async () => {
    if (session) download(`rueckenwind-backup-verschluesselt-${todayISO()}.json`, JSON.stringify(await session.record()), 'application/json');
    else download(`rueckenwind-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  },
  reset: () => {
    if (!confirm('Wirklich alle Einstellungen und Fahrten löschen?')) return;
    resetEverything();
    location.hash = '#heute';
    render();
  },
};

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && el.tagName !== 'INPUT' && actions[el.dataset.action]) {
    e.preventDefault();
    // Die Aktion läuft sofort im Tipp. Nur so erlaubt iOS Nachfragen wie „Mitteilungen erlauben“.
    // Fehler asynchroner Aktionen dürfen nicht stumm bleiben.
    const fail = (err) => {
      hideLock();
      toast(`Das hat nicht geklappt: ${err?.message || err}`);
    };
    try {
      Promise.resolve(actions[el.dataset.action](el)).catch(fail);
    } catch (err) {
      fail(err);
    }
    return;
  }
  const scroll = e.target.closest('[data-scroll]');
  if (scroll) sessionStorage.setItem('scrollTo', scroll.dataset.scroll);
});

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importJson(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (isVaultFile(obj)) {
      if (!Number.isInteger(obj.len) || obj.len < 4 || obj.len > 16) throw new Error('ungültig');
      let error = '';
      for (;;) {
        const pin = await askPin({ title: 'Sicherung öffnen', hint: 'PIN, mit der sie erstellt wurde', len: obj.len, error, cancelable: true, logo: false });
        if (pin === null) return hideLock();
        try {
          const r = await importVault(text, pin);
          state = importState(JSON.stringify(r.state));
          session = r.session;
          locked = false;
          clearPlain();
          localStorage.removeItem(FC_KEY);
          hideLock();
          toast('Daten wiederhergestellt');
          render();
          return;
        } catch {
          error = 'Falsche PIN oder beschädigte Datei';
        }
      }
    }
    state = importState(text);
    persist();
    toast('Daten wiederhergestellt');
    render();
  } catch {
    hideLock();
    toast('Datei konnte nicht gelesen werden');
  }
}

// ---------- Morgenmeldung ----------

let lastPushConfig = '';
let pushTimer = 0;
let notifyBusy = false;

// Ändern sich Strecke, Zeiten oder Schwellen, bekommt der Push-Dienst die neuen Werte (gebündelt, nach kurzer Ruhe)
function schedulePushSync() {
  if (!state.notify?.enabled || locked) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const config = buildNotifyConfig(state);
    const base = normalizeUrl(state.notify.url);
    if (!config || !base) return;
    const sig = JSON.stringify(config);
    if (sig === lastPushConfig) return;
    try {
      await syncPush({ url: base, token: state.notify.token, config });
      lastPushConfig = sig;
    } catch (e) {
      console.warn('Abgleich mit dem Push-Dienst fehlgeschlagen:', e.message);
    }
  }, 2500);
}

// Die App sagt dem Dienst, ob der heutige Tag erledigt ist. Dann fragt er abends nicht mehr.
let dayStatusTimer = 0;
let lastDayStatus = '';

function todayComplete(date = todayISO()) {
  const logged = (d) => state.rides.some((r) => r.date === date && r.direction === d);
  return state.notify.answeredDate === date || (logged('hin') && logged('rueck'));
}

function scheduleDayStatus() {
  if (!state.notify?.enabled || !state.notify.eveningOn || locked) return;
  clearTimeout(dayStatusTimer);
  dayStatusTimer = setTimeout(async () => {
    const date = todayISO();
    const complete = todayComplete(date);
    const sig = `${date}:${complete}`;
    const base = normalizeUrl(state.notify.url);
    if (sig === lastDayStatus || !base) return;
    try {
      await reportDay({ url: base, token: state.notify.token, date, complete });
      lastDayStatus = sig;
    } catch (e) {
      console.warn('Tagesstatus konnte nicht gemeldet werden:', e.message);
    }
  }, 1500);
}

async function enableNotify() {
  // Gleich als Erstes: Die Nachfrage „Mitteilungen erlauben“ darf nur direkt nach dem Tipp kommen
  const n = state.notify;
  const support = pushSupport();
  if (!support.ok) return toast(support.reason);
  const base = normalizeUrl(n.url);
  if (!base) return toast('Trag die https-Adresse deines Push-Dienstes ein.');
  if (!n.token.trim()) return toast('Trag das Token deines Push-Dienstes ein.');
  const config = buildNotifyConfig(state);
  if (!config) return toast('Lege zuerst Zuhause und Arbeit fest.');
  notifyBusy = true;
  renderSettings();
  try {
    await enablePush({ url: base, token: n.token.trim(), config });
    n.url = base;
    n.token = n.token.trim();
    n.enabled = true;
    lastPushConfig = JSON.stringify(config);
    persist();
    toast('Morgenmeldung ist an. Tippe auf „Test senden“, um sie zu prüfen.');
  } finally {
    notifyBusy = false;
    renderSettings();
  }
}

async function disableNotify() {
  const base = normalizeUrl(state.notify.url);
  await disablePush({ url: base, token: state.notify.token });
  state.notify.enabled = false;
  lastPushConfig = '';
  persist();
  renderSettings();
  toast('Morgenmeldung ist aus');
}

async function testNotify(kind = 'morgen') {
  notifyBusy = true;
  renderSettings();
  try {
    const r = await testPush({ url: normalizeUrl(state.notify.url), token: state.notify.token, kind });
    toast(`Gesendet: „${r.title}“. Sie sollte gleich erscheinen.`);
  } finally {
    notifyBusy = false;
    renderSettings();
  }
}

function eveningFields() {
  const n = state.notify;
  return `<label class="check"><input type="checkbox" data-path="notify.eveningOn" data-rerender ${n.eveningOn ? 'checked' : ''}><span>Abends fragen, ob du gefahren bist</span></label>
    ${n.eveningOn ? `<label class="field">Uhrzeit abends<span class="input"><input type="time" data-path="notify.eveningAt" value="${esc(n.eveningAt)}"></span></label>` : ''}`;
}

function notifyGroup() {
  const n = state.notify;
  const support = pushSupport();
  const samples = ['go', 'caution', 'no'].map((k) => `<p class="sec-note"><strong>${{ go: 'Passt', caution: 'Machbar', no: 'Passt nicht' }[k]}</strong><br>${TITLES[k].map(esc).join(' · ')}</p>`).join('');
  const steps = `<ol class="steps">
      <li>Lege ein kostenloses Konto bei <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">Cloudflare</a> an.</li>
      <li>Öffne im Projektordner das Terminal und folge der Anleitung im Abschnitt „Morgenmeldung“ der Datei <code>README.md</code>. Am Ende erhältst du eine Adresse wie <code>https://rueckenwind-push.name.workers.dev</code> und ein Token.</li>
      <li>Trage beides hier ein und tippe auf „Einschalten“.</li>
    </ol>
    <p class="sec-note">Der Dienst speichert nur die Push-Adresse deines Geräts, den Mittelpunkt deiner Strecke (auf etwa 1 km gerundet), den Fahrtkurs, deine Zeiten und Schwellen. Deine genauen Adressen bleiben auf dem Gerät.</p>`;
  return `
  <section class="group" id="morgen"><h2>Morgenmeldung</h2><div class="card settings">
    ${
      n.enabled
        ? `<p class="sec-status">${I.check}Aktiv, jeden Arbeitstag ab ${esc(n.time)} Uhr${n.eveningOn ? `, abends ab ${esc(n.eveningAt)} Uhr` : ''}</p>
          <label class="field">Uhrzeit morgens<span class="input"><input type="time" data-path="notify.time" value="${esc(n.time)}"></span></label>
          ${eveningFields()}
          <div class="actions"><button class="btn primary" data-action="notify-test" ${notifyBusy ? 'disabled' : ''}>Test: Morgen</button>${n.eveningOn ? `<button class="btn" data-action="notify-test-evening" ${notifyBusy ? 'disabled' : ''}>Test: Abend</button>` : ''}<button class="btn ghost" data-action="notify-disable" ${notifyBusy ? 'disabled' : ''}>Ausschalten</button></div>`
        : `<p class="sec-note">Jeden Arbeitstag eine Meldung, ob das Rad heute drankommt, etwa „Jetzt losfahren!“ oder „Nimm lieber das Auto“. Dafür läuft ein kleiner eigener Dienst bei Cloudflare, kostenlos und einmalig einzurichten.</p>
          ${support.ok ? '' : `<p class="sec-note warn">${esc(support.reason)}</p>`}
          <label class="field">Uhrzeit morgens<span class="input"><input type="time" data-path="notify.time" value="${esc(n.time)}"></span></label>
          ${eveningFields()}
          <label class="field">Adresse deines Push-Dienstes<span class="input"><input type="url" inputmode="url" data-path="notify.url" value="${esc(n.url)}" placeholder="https://rueckenwind-push.name.workers.dev" autocomplete="off" autocapitalize="off"></span></label>
          <label class="field">Token<span class="input"><input type="password" data-path="notify.token" value="${esc(n.token)}" autocomplete="off"></span></label>
          <button class="btn primary" data-action="notify-enable" ${notifyBusy ? 'disabled' : ''}>${notifyBusy ? 'Einen Moment …' : 'Einschalten'}</button>`
    }
    ${more('notify', 'Dienst einrichten', 'einmalig, etwa 15 Minuten', steps)}
    ${more('msgs', 'Meldungen ansehen', 'so klingen sie, täglich wechselnd', samples)}
  </div></section>
`;
}

// ---------- App-Sperre ----------

let pinLenChoice = 6;
let failCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORGOT = '__forgot';

function resetEverything() {
  removeVault();
  clearPlain();
  localStorage.removeItem(FC_KEY);
  session = null;
  locked = false;
  state = structuredClone(DEFAULTS);
  forecast = null;
}

async function unlockFlow() {
  const meta = vaultMeta();
  if (!meta) {
    if (confirm('Die verschlüsselten Daten sind beschädigt und lassen sich nicht öffnen. Zurücksetzen und neu starten?')) resetEverything();
    hideLock();
    return;
  }
  let error = '';
  for (;;) {
    if (failCount >= 5) {
      const wait = Math.min(60, 5 * 2 ** (failCount - 5));
      for (let s = wait; s > 0; s--) {
        showMessage({ title: 'Zu viele Versuche', text: `Bitte warte ${s} Sekunden.` });
        await sleep(1000);
      }
    }
    const pin = await askPin({ title: 'Rückenwind', hint: 'PIN eingeben', len: meta.len, error, links: [{ label: 'PIN vergessen?', value: FORGOT }] });
    if (pin === FORGOT) {
      if (confirm('Alle Daten auf diesem Gerät löschen und neu starten? Ohne PIN lassen sie sich nicht wiederherstellen. Eine verschlüsselte Sicherung kannst du danach mit ihrer PIN wieder einspielen.')) {
        resetEverything();
        hideLock();
        return;
      }
      continue;
    }
    try {
      const r = await unlockVault(pin);
      state = importState(JSON.stringify(r.state));
      session = r.session;
      locked = false;
      failCount = 0;
      hideLock();
      return;
    } catch {
      failCount++;
      error = 'Falsche PIN';
    }
  }
}

async function lockNow() {
  if (!session) return;
  await session.flush();
  session = null;
  locked = true;
  state = structuredClone(DEFAULTS);
  forecast = null;
  view.innerHTML = '';
  await unlockFlow();
  boot();
}

// Neue PIN zweimal abfragen. Gibt null zurück, wenn abgebrochen wurde.
async function askNewPin(len) {
  let error = '';
  for (;;) {
    const p1 = await askPin({ title: 'PIN festlegen', hint: `${len} Ziffern, die du dir gut merken kannst`, len, error, cancelable: true, logo: false });
    if (p1 === null) return null;
    if (weakPin(p1)) {
      error = 'Zu einfach: keine Zahlenfolge, nicht lauter gleiche Ziffern';
      continue;
    }
    const p2 = await askPin({ title: 'PIN wiederholen', hint: 'Zur Sicherheit noch einmal', len, cancelable: true, logo: false });
    if (p2 === null) return null;
    if (p1 === p2) return p1;
    error = 'Die beiden PINs waren nicht gleich';
  }
}

async function confirmPin(title, hint) {
  let error = '';
  for (;;) {
    const pin = await askPin({ title, hint, len: session.len, error, cancelable: true, logo: false });
    if (pin === null) return null;
    if (await verifyPin(pin)) return pin;
    error = 'Falsche PIN';
  }
}

async function enableLock() {
  if (!globalThis.crypto?.subtle) {
    toast('Verschlüsselung braucht eine sichere Verbindung (https)');
    return;
  }
  const pin = await askNewPin(pinLenChoice);
  if (pin === null) {
    hideLock();
    return;
  }
  try {
    session = await createVault(pin, state);
    clearPlain();
    localStorage.removeItem(FC_KEY);
    toast('App-Sperre ist an');
  } catch {
    toast('Verschlüsselung ist fehlgeschlagen');
  }
  hideLock();
  renderSettings();
}

async function changePin() {
  const old = await confirmPin('Aktuelle PIN', 'Zum Ändern der PIN');
  if (old === null) return hideLock();
  const next = await askNewPin(session.len);
  if (next === null) return hideLock();
  try {
    await session.changePin(old, next);
    toast('PIN geändert');
  } catch {
    toast('PIN konnte nicht geändert werden');
  }
  hideLock();
  renderSettings();
}

async function disableLock() {
  const pin = await confirmPin('PIN eingeben', 'Zum Ausschalten der App-Sperre');
  if (pin === null) return hideLock();
  await session.flush();
  save(state);
  removeVault();
  session = null;
  hideLock();
  renderSettings();
  toast('App-Sperre ist aus. Die Daten liegen wieder unverschlüsselt auf dem Gerät.');
}

// ---------- Strava-Abgleich ----------

async function syncStrava() {
  toast('Gleiche mit Strava ab …');
  try {
    const known = new Set(state.rides.filter((r) => r.stravaId).map((r) => r.stravaId));
    const found = await strava.fetchCommutes(state.strava, state.route, known);
    for (const f of found) {
      // Strava-Daten ersetzen eine manuell eingetragene Fahrt am selben Tag und in derselben Richtung
      state.rides = state.rides.filter((r) => !(r.source === 'manuell' && r.date === f.date && r.direction === f.direction));
      state.rides.push(makeRide({ ...f, source: 'strava' }));
    }
    persist();
    toast(found.length ? `${found.length} neue Pendelfahrten übernommen` : 'Keine neuen Pendelfahrten gefunden');
  } catch (e) {
    persist();
    toast(e.message);
  }
  render();
}

async function handleOAuthReturn() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return;
  history.replaceState(null, '', location.pathname + '#einstellungen');
  if (p.has('error')) return toast('Strava-Verbindung abgebrochen');
  try {
    await strava.exchangeCode(state.strava, p.get('code'));
    persist();
    toast('Mit Strava verbunden');
    await syncStrava();
  } catch (e) {
    toast(e.message);
    render();
  }
}

// ---------- Start ----------

// Rückkehr von der Bosch-Anmeldung: der Dienst hängt ?bosch=ok oder ?bosch=fehler an die Adresse
function handleBoschReturn() {
  const q = new URLSearchParams(location.search);
  const outcome = q.get('bosch');
  if (!outcome) return;
  const reason = q.get('grund');
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  toast(outcome === 'ok' ? 'Mit Bosch verbunden. Neue Fahrten kommen jetzt automatisch.' : `Verbindung zu Bosch fehlgeschlagen${reason ? `: ${reason}` : ''}`);
  loadBosch({ force: true }).then(() => outcome === 'ok' && pullInbox({ manual: true }));
}

function boot() {
  handleBoschReturn();
  render();
  pullInbox();
  schedulePushSync();
  scheduleDayStatus();
  handleOAuthReturn();
  if (state.route.home && state.route.work && ((!state.route.distanceManual && !state.route.distanceSource) || !state.route.path?.length)) updateRouteDistance();
}

// Kein Zoomen per Aufziehen: iOS beachtet user-scalable=no nicht überall, Safaris Gesten-Ereignisse schon
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.touches.length > 1 && e.preventDefault(), { passive: false });

document.documentElement.classList.toggle('motion', !reducedMotion());
runSplash({ onLeave: () => (locked ? unlockFlow().then(boot) : boot()) });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
