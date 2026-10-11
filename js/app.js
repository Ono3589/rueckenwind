import { load, save, clearPlain, importState, newId, DEFAULTS, RULE_PRESETS } from './store.js';
import { hasVault, vaultMeta, createVault, unlockVault, verifyPin, importVault, removeVault, isVaultFile, weakPin } from './vault.js';
import { askPin, hideLock, showMessage } from './lock.js';
import { parseHealthText } from './health.js';
import { midpoint, distanceM, searchAddress, currentPosition, fetchBikeRoute } from './geo.js';
import { mapThumb, simplify } from './map.js';
import { fetchForecast, pickTargetDate, assessDay, fmtMin, tripMinutes } from './weather.js';
import { FUEL, carCostPerKm, bikeCostPerKm, bikeRangeKm, estimateKcal, summarize } from './costs.js';
import * as strava from './strava.js';

// App-Sperre: Ist sie an, liegen die Daten nur verschlüsselt im Speicher und werden erst nach der PIN geladen.
let locked = hasVault();
let session = null; // nur während die App entsperrt ist
let state = locked ? structuredClone(DEFAULTS) : load();
const view = document.getElementById('view');
const persist = () => (session ? session.save(state) : save(state));

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
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.3a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="9.7" r="2.3" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flame: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8.5-.8 2.2-2 3.2-3 3.5.3-2.3-.5-4.6-2.5-6.5C9 7 6 9.6 6 15a6 6 0 0 0 6 6z" fill="currentColor"/></svg>',
};

// ---------- Navigation ----------

const tabs = { heute: renderToday, fahrten: renderRides, bilanz: renderStats, einstellungen: renderSettings };
const currentTab = () => (tabs[location.hash.slice(1)] ? location.hash.slice(1) : 'heute');

function render() {
  if (locked) return;
  const tab = currentTab();
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  tabs[tab]();
}
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
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

function horizon(status, score, rainy) {
  // Die Sonne steht umso höher, je besser das Radwetter ist. Davor fährt der Radler auf der Straße.
  const R = 46;
  const y = 130 - (score / 100) * 62;
  const rise = 118 + R - y + 6;
  const drops = rainy
    ? Array.from({ length: 12 }, (_, i) => {
        const x = 30 + i * 23 + (i % 3) * 5;
        const y0 = 6 + ((i * 37) % 60);
        return `<line class="drop" style="--d:${(i % 5) * 0.23}s" x1="${x}" y1="${y0}" x2="${x - 3}" y2="${y0 + 9}"/>`;
      }).join('')
    : '';
  return `
  <svg class="horizon ${status}" viewBox="0 0 320 140" role="img" aria-label="Radwetter ${score} von 100">
    <defs>
      <radialGradient id="glow" cx="50%" cy="${(y / 140) * 100}%" r="66%">
        <stop offset="0" class="glow-a"/><stop offset=".5" class="glow-b"/><stop offset="1" class="glow-c"/>
      </radialGradient>
      <radialGradient id="sun" cx="50%" cy="38%" r="70%"><stop offset="0" class="sun-a"/><stop offset="1" class="sun-b"/></radialGradient>
      <clipPath id="sky"><rect width="320" height="118"/></clipPath>
    </defs>
    <rect width="320" height="140" fill="url(#glow)"/>
    <g clip-path="url(#sky)">
      <circle class="sun" style="--rise:${rise}px" cx="160" cy="${y}" r="${R}" fill="url(#sun)"/>
      <g class="rain">${drops}</g>
    </g>
    <line class="line" x1="0" y1="118.5" x2="320" y2="118.5"/>
    <g transform="translate(118.4 61) scale(0.16)">${CYCLIST}</g>
  </svg>`;
}

const WIND_WORD = { gegen: 'Gegenwind', rueck: 'Rückenwind', seite: 'Seitenwind' };

function tripCard(label, t, done, canLog, dir) {
  if (!t) return `<article class="trip"><h3>${label}</h3><p class="muted">Keine Daten</p></article>`;
  const rot = t.rel ? (t.windDir + 180 - t.bearing + 360) % 360 : null;
  return `
  <article class="trip sev-${t.sev}">
    <header><h3>${label}</h3><span class="when">${fmtMin(t.start)}</span></header>
    <p class="temp">${fmt.int(t.temp)}°</p>
    <ul class="facts">
      <li>${I.drop}<span>${t.rainProb} %<small>${t.precip > 0.05 ? `${fmt.km(t.precip)} mm Regen` : 'Regenrisiko'}</small></span></li>
      <li class="wind ${t.rel?.kind ?? ''}">${rot == null ? I.wind : `<i style="transform:rotate(${rot}deg)">${I.arrow}</i>`}<span>${fmt.int(t.wind)} km/h<small>${t.rel ? WIND_WORD[t.rel.kind] : 'Wind'}</small></span></li>
    </ul>
    ${
      canLog
        ? `<button class="log" data-action="toggle-ride" data-dir="${dir}" aria-pressed="${done}">${done ? `${I.check}Gefahren` : 'Als gefahren markieren'}</button>`
        : ''
    }
  </article>`;
}

function timeline(date, day) {
  const H = forecast.hourly;
  const inWin = (h, t) => t && h >= Math.floor(t.start / 60) && h <= Math.floor((t.end - 1) / 60);
  const cols = [];
  for (let h = 5; h <= 21; h++) {
    const i = H.time.indexOf(`${date}T${String(h).padStart(2, '0')}:00`);
    if (i < 0) continue;
    const p = H.precipitation_probability[i] ?? 0;
    const mm = H.precipitation[i] ?? 0;
    const win = inWin(h, day.hin) || inWin(h, day.rueck);
    cols.push(`
      <div class="hr${win ? ' win' : ''}" title="${h} Uhr: ${p} % Regenrisiko, ${fmt.km(mm)} mm, ${fmt.int(H.temperature_2m[i])} °C">
        <span class="bar" style="--p:${Math.max(6, p)}%"></span>
        <span class="h">${h % 3 === 0 || win ? h : ''}</span>
      </div>`);
  }
  return `<section class="block timeline" aria-label="Regenrisiko im Tagesverlauf">
    <header class="row"><h2>Regen über den Tag</h2><span class="legend"><i></i>deine Fahrten</span></header>
    <div class="hours">${cols.join('')}</div>
  </section>`;
}

function onboarding() {
  return `
  <section class="hero">
    ${horizon('go', 70, false)}
    <h1>Rückenwind</h1>
    <p class="lead">Jeden Morgen eine klare Antwort, ob heute ein Radtag wird. Dazu deine Kilometer, was du gegenüber dem Auto sparst und was du verbrannt hast.</p>
  </section>
  <a class="btn primary wide" href="#einstellungen">Arbeitsweg festlegen</a>`;
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
      ? `<section class="hero no">${horizon('no', 8, false)}<h1>Kein Wetter.</h1><p class="lead">${esc(weatherError)}. Prüf deine Verbindung und versuch es noch einmal.</p></section>
         <button class="btn primary wide" data-action="refresh">Erneut versuchen</button>`
      : `<section class="hero loading">${horizon('caution', 35, false)}<h1>Blick zum Himmel …</h1></section>`;
    return;
  }
  ensureForecast(); // im Hintergrund auffrischen, wenn älter als 30 Minuten

  const target = pickTargetDate(forecast, state.route);
  const day = assessDay(forecast, state.route, state.rules, target);
  const rainy = [day.hin, day.rueck].some((t) => t && (t.rainProb >= state.rules.maxRainProb || t.precip > state.rules.maxPrecip));
  const isWorkday = state.route.workdays.includes(new Date(`${target.date}T12:00:00`).getDay());
  const canLog = target.isToday && isWorkday;
  const has = (dir) => state.rides.some((r) => r.date === target.date && r.direction === dir);
  const s = streak();

  view.innerHTML = `
  <header class="top">
    <p class="date">${fmt.dayLong(target.date)}${target.isToday ? '' : '<span>nächster Arbeitstag</span>'}</p>
    ${s ? `<span class="streak" title="${s} Arbeitstage in Folge mit dem Rad">${I.flame}${s}</span>` : ''}
  </header>

  <section class="hero ${day.status}">
    ${horizon(day.status, day.score, rainy)}
    <h1>${day.headline}</h1>
    <p class="lead">${esc(day.reason)}</p>
  </section>

  <div class="trips">
    ${tripCard('Hinweg', day.hin, has('hin'), canLog, 'hin')}
    ${tripCard('Rückweg', day.rueck, has('rueck'), canLog, 'rueck')}
  </div>

  ${day.gear.length ? `<ul class="gear" aria-label="Für unterwegs">${day.gear.map((g) => `<li>${I[g.icon]}${esc(g.text)}</li>`).join('')}</ul>` : ''}

  ${timeline(target.date, day)}

  <footer class="source">
    <span>Open-Meteo · ${fmt.time(forecast.fetchedAt)}</span>
    <button class="refresh${weatherLoading ? ' spinning' : ''}" data-action="refresh" aria-label="Wetter aktualisieren">${I.refresh}</button>
  </footer>`;
}

// ---------- Ansicht: Fahrten ----------

// ---------- Fahrten aus Apple Health ----------

let importPreview = null; // { items, ignored }

const DIR_LABEL = { hin: 'Hinweg', rueck: 'Rückweg' };

function shortcutHelp() {
  return `<ol class="steps">
    <li>In der <strong>eBike Flow</strong>-App die Verbindung zu <strong>Apple Health</strong> einschalten. In der Health-App unter „Teilen“ prüfen, dass eBike Flow Trainings (Radfahren) schreibt.</li>
    <li>In der <strong>Kurzbefehle</strong>-App einen neuen Kurzbefehl „Rückenwind“ anlegen:
      <ol>
        <li><em>Health-Samples suchen</em>: Typ <strong>Trainings</strong>, Aktivität Radfahren, Startdatum in den letzten 2 Tagen.</li>
        <li><em>Für jedes Element wiederholen</em>: darin einen <strong>Text</strong> aus Startdatum (Format <code>yyyy-MM-dd</code>), <code>;</code>, Startdatum (Format <code>HH:mm</code>), <code>;</code>, Strecke in km, <code>;</code>, Dauer in Minuten, <code>;</code>, aktive Energie in kcal bauen.</li>
        <li>Danach <em>Text kombinieren</em> (neue Zeile) und <em>In die Zwischenablage kopieren</em>.</li>
      </ol>
    </li>
    <li>Optional als <strong>Automation</strong>: Persönliche Automation, Tageszeit 18:30, den Kurzbefehl ohne Nachfrage ausführen.</li>
    <li>Hier auf <strong>Einfügen</strong> tippen und die gefundenen Fahrten bestätigen.</li>
  </ol>
  <p class="note">Eine Zeile pro Fahrt, zum Beispiel:</p>
  <code class="codebox">2026-10-12;07:31;10,4;27;186</code>
  <p class="note">Start, Dauer und Kalorien dürfen fehlen. Gibt es keine Trainings, reicht auch die Tagessumme der Raddistanz als <code>2026-10-12;;20,8</code>. Die App verteilt sie auf Hin- und Rückweg. Die Bezeichnungen der Aktionen können je nach iOS-Version leicht abweichen.</p>`;
}

function loadImportPreview(text) {
  const { items, ignored } = parseHealthText(text, { distanceKm: state.route.distanceKm, today: todayISO() });
  for (const it of items) {
    it.dup = state.rides.some((r) => r.ref === it.ref);
    it.checked = it.fits && !it.dup;
  }
  importPreview = items.length ? { items, ignored } : null;
  if (!items.length) {
    moreOpen.paste = true;
    toast(ignored.length ? 'Die Zeilen konnten nicht gelesen werden. Format: Datum;Start;km;Minuten;kcal' : 'In der Zwischenablage stehen keine Fahrten');
  }
  renderRides();
}

function healthCard() {
  if (importPreview) {
    const { items, ignored } = importPreview;
    const n = items.filter((i) => i.checked).length;
    return `<section class="card import">
      <h2>${items.length} ${items.length === 1 ? 'Fahrt' : 'Fahrten'} gefunden</h2>
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
      <div class="actions"><button class="btn primary" data-action="health-apply" ${n ? '' : 'disabled'}>${n} übernehmen</button><button class="btn ghost" data-action="health-discard">Verwerfen</button></div>
    </section>`;
  }
  return `<section class="card health">
    <div class="health-head">
      <div><strong>Fahrten aus Apple Health</strong><p class="muted">Kurzbefehl ausführen, dann hier einfügen.</p></div>
      <button class="btn primary" data-action="health-paste">Einfügen</button>
    </div>
    ${more('paste', 'Text selbst einfügen', 'falls die Zwischenablage nicht freigegeben wird', `<form class="paste-form" data-form="health-text"><textarea name="t" rows="4" placeholder="2026-10-12;07:31;10,4;27;186" aria-label="Fahrten als Text" required></textarea><button class="btn" type="submit">Lesen</button></form>`)}
    ${more('health', 'Kurzbefehl einrichten', 'einmalig, etwa 5 Minuten', shortcutHelp())}
  </section>`;
}

function renderRides() {
  const perKm = summarize([], state).perKm;
  const rides = [...state.rides].sort((a, b) => (a.date === b.date ? (a.direction === 'hin' ? 1 : -1) : a.date < b.date ? 1 : -1));
  const groups = new Map();
  for (const r of rides) {
    const d = new Date(`${r.date}T12:00:00`);
    const k = `${d.getFullYear()}-${isoWeek(d)}`;
    if (!groups.has(k)) groups.set(k, { label: `Woche ${isoWeek(d)}`, from: startOfWeek(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }), rides: [] });
    groups.get(k).rides.push(r);
  }
  const s = state.strava;
  const connected = !!s.refreshToken;

  view.innerHTML = `
  <header class="page"><h1>Fahrten</h1><p class="muted">${rides.length ? `${rides.length} Fahrten · ${fmt.km(rides.reduce((a, r) => a + r.km, 0))} km` : 'Noch keine Fahrten. Trag deine erste unten ein.'}</p></header>

  ${healthCard()}
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
      <h2>${g.label}<small>ab ${g.from}</small><span>${fmt.km(g.rides.reduce((a, r) => a + r.km, 0))} km</span></h2>
      <ul class="rides">
        ${g.rides
          .map(
            (r) => `
          <li>
            <span class="dir ${r.direction}" aria-hidden="true">${I.arrow}</span>
            <div class="what">
              <strong>${fmt.dayShort(r.date)} · ${r.direction === 'hin' ? 'Hinweg' : 'Rückweg'}</strong>
              <span>${{ strava: 'Strava', health: 'Apple Health' }[r.source] ?? 'Manuell'}${r.minutes ? ` · ${r.minutes} min` : ''} · ${fmt.int(r.kcal)} kcal${r.kcalSource === 'schätzung' ? '*' : ''}</span>
            </div>
            <div class="nums"><strong>${fmt.km(r.km)} km</strong><span class="save">+${fmt.eur(rideSaving(r, perKm))}</span></div>
            <button class="icon-btn" data-action="delete-ride" data-id="${r.id}" aria-label="Fahrt löschen">${I.trash}</button>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`,
    )
    .join('')}
  ${rides.some((r) => r.kcalSource === 'schätzung') ? '<p class="footnote">* Geschätzt aus Gewicht und Fahrtdauer. Mit den Kiox-Daten über Strava wird es genauer.</p>' : ''}`;
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

function weeksChart() {
  const now = new Date();
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const start = startOfWeek(now);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const a = localISO(start);
    const b = localISO(end);
    weeks.push({ label: isoWeek(start), km: state.rides.filter((r) => r.date >= a && r.date < b).reduce((s, r) => s + r.km, 0), current: i === 0 });
  }
  const max = Math.max(state.route.distanceKm * 10, ...weeks.map((w) => w.km));
  const W = 320;
  const bw = W / weeks.length;
  const bars = weeks
    .map((w, i) => {
      const h = (w.km / max) * 100;
      return `<g><title>KW ${w.label}: ${fmt.km(w.km)} km</title>
        <rect class="${w.current ? 'cur' : ''}" x="${i * bw + 7}" y="${112 - h}" width="${bw - 14}" height="${Math.max(h, 3)}" rx="4"/>
        <text x="${i * bw + bw / 2}" y="130">${w.label}</text></g>`;
    })
    .join('');
  const goal = 112 - ((state.route.distanceKm * 10) / max) * 100;
  return `<svg class="chart" viewBox="0 0 ${W} 136" role="img" aria-label="Kilometer der letzten 12 Wochen">
    <line class="goal" x1="0" x2="${W}" y1="${goal}" y2="${goal}"/>
    ${bars}
  </svg>`;
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

  view.innerHTML = `
  <header class="page"><h1>Bilanz</h1></header>
  <div class="segmented" role="tablist" aria-label="Zeitraum">
    ${['woche', 'monat', 'jahr', 'gesamt'].map((p) => `<button role="tab" data-action="period" data-p="${p}" aria-selected="${p === period}">${{ woche: 'Woche', monat: 'Monat', jahr: 'Jahr', gesamt: 'Gesamt' }[p]}</button>`).join('')}
  </div>

  ${
    sum.rides
      ? `<section class="statement">
          <p>${range.lead} hast du <strong>${fmt.eur(sum.saved)}</strong> gespart.</p>
          <p class="muted">Gegenüber deinem ${esc(car.name || 'Auto')}, ${car.mode === 'voll' ? 'mit Vollkosten' : 'nur laufende Kosten'} gerechnet.</p>
        </section>
        <dl class="figures">
          <div><dt>Strecke</dt><dd>${fmt.km(sum.km)} km<small>${sum.rides} ${sum.rides === 1 ? 'Fahrt' : 'Fahrten'} an ${sum.days} ${sum.days === 1 ? 'Tag' : 'Tagen'}</small></dd></div>
          <div><dt>Verbrannt</dt><dd>${fmt.int(sum.kcal)} kcal<small>etwa ${fmt.int(sum.kcal / 230)} Laugenbrezeln</small></dd></div>
          <div><dt>CO₂ vermieden</dt><dd>${fmt.km(sum.co2Kg)} kg<small>${fmt.km(sum.fuelSaved)} ${fuel.unit} ${car.fuel === 'elektro' ? 'Strom' : fuel.label} nicht verbraucht</small></dd></div>
          <div><dt>Serie</dt><dd>${streak()} ${streak() === 1 ? 'Arbeitstag' : 'Arbeitstage'}<small>in Folge mit dem Rad</small></dd></div>
        </dl>`
      : `<section class="statement empty">
          <p>${range.lead} bist du noch nicht gefahren.</p>
          <p class="muted">Trag deine erste Fahrt ein oder verbinde Strava, dann füllt sich die Bilanz.</p>
          <a class="btn" href="#fahrten">Fahrt eintragen</a>
        </section>`
  }

  <section class="block">
    <header class="row"><h2>Letzte 12 Wochen</h2><span class="legend goal"><i></i>${fmt.int(state.route.distanceKm * 10)} km Ziel</span></header>
    ${weeksChart()}
  </section>

  <section class="block perkm">
    <h2>Kosten pro Kilometer</h2>
    <div class="cmp"><span>Auto</span><div class="track"><i class="car" style="width:${(sum.perKm.car.total / maxPerKm) * 100}%"></i></div><strong>${fmt.ct(sum.perKm.car.total)}</strong></div>
    <div class="cmp"><span>E-Bike</span><div class="track"><i class="bike" style="width:${(sum.perKm.bike.total / maxPerKm) * 100}%"></i></div><strong>${fmt.ct(sum.perKm.bike.total)}</strong></div>
    <p class="note">Jeder Radkilometer spart ${fmt.ct(diff)}${car.parkingPerDay ? `, dazu ${fmt.eur(car.parkingPerDay)} Parken pro Arbeitstag` : ''}. Die Werte stellst du unter <a href="#einstellungen">Einstellungen</a> ein.</p>
  </section>

  <section class="block tax">
    <h2>Entfernungspauschale ${new Date().getFullYear()}</h2>
    <p class="formula">${year.days} Tage × ${fmt.km(state.route.distanceKm)} km × ${fmt.eur(state.tax.ratePerKm)} = <strong>${fmt.eur(year.taxAmount)}</strong></p>
    <p class="note">Werbungskosten für die Steuererklärung, gilt auch fürs Rad. Den Satz vor der Abgabe prüfen.</p>
    <button class="btn" data-action="export-csv">Fahrten als CSV exportieren</button>
  </section>`;
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
const moreOpen = { car: false, fine: false, strava: false, rules: false, health: false, paste: false };

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

  <section class="group" id="strava"><h2>Kiox-Fahrten</h2><div class="card settings">
    <p class="note">Deine Fahrten kommen über <strong>Apple Health</strong> in die App: Ein Kurzbefehl legt sie in die Zwischenablage, auf „Fahrten“ übernimmst du sie mit einem Tipp. Ohne das trägst du sie von Hand ein.</p>
    <a class="btn" href="#fahrten" data-scroll="health">Zu den Fahrten</a>
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
  <p class="footnote">Rückenwind v0.9 · Wetter: Open-Meteo · Adressen: © OpenStreetMap</p>`;

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
    const btn = view.querySelector('[data-action="health-apply"]');
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
  if (form.dataset.form === 'health-text') {
    loadImportPreview(new FormData(form).get('t'));
    return;
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
  'health-paste': async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      moreOpen.paste = true;
      renderRides();
      toast('Die Zwischenablage ist nicht freigegeben. Füge den Text unten ein.');
      return;
    }
    loadImportPreview(text);
  },
  'health-discard': () => {
    importPreview = null;
    renderRides();
  },
  'health-apply': () => {
    const chosen = (importPreview?.items ?? []).filter((i) => i.checked && !i.dup);
    for (const it of chosen) {
      // Genauere Werte ersetzen eine von Hand eingetragene Fahrt am selben Tag in derselben Richtung
      state.rides = state.rides.filter((r) => !(r.source === 'manuell' && r.date === it.date && r.direction === it.direction));
      state.rides.push({ ...makeRide({ date: it.date, direction: it.direction, km: it.km, minutes: it.minutes, kcal: it.kcal, source: 'health' }), ref: it.ref });
    }
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
    // Asynchrone Aktionen dürfen nicht stumm scheitern: Fehler als Meldung zeigen
    Promise.resolve()
      .then(() => actions[el.dataset.action](el))
      .catch((err) => {
        hideLock();
        toast(`Das hat nicht geklappt: ${err?.message || err}`);
      });
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

function boot() {
  render();
  handleOAuthReturn();
  if (state.route.home && state.route.work && ((!state.route.distanceManual && !state.route.distanceSource) || !state.route.path?.length)) updateRouteDistance();
}

if (locked) unlockFlow().then(boot);
else boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
