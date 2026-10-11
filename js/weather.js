// Wetterdaten von Open-Meteo (kostenlos, ohne API-Key) und die Entscheidung „Heute Rad?".

import { bearing } from './geo.js';

const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
];

export async function fetchForecast({ lat, lon }) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=${HOURLY.join(',')}&daily=sunrise,sunset&timezone=auto&forecast_days=7&wind_speed_unit=kmh`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wetterdienst nicht erreichbar (${res.status})`);
  const data = await res.json();
  return { ...data, fetchedAt: Date.now() };
}

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const pad = (n) => String(n).padStart(2, '0');
export const fmtMin = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

export function tripMinutes(route) {
  return Math.max(10, Math.round((route.distanceKm / (route.avgSpeed || 20)) * 60));
}

// Welcher Tag soll bewertet werden? Heute, solange der Rückweg noch bevorsteht – sonst der nächste Arbeitstag.
export function pickTargetDate(forecast, route, now = new Date()) {
  const days = forecast.daily.time; // 'YYYY-MM-DD' in Ortszeit
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const doneToday = nowMin > toMin(route.departRueck) + tripMinutes(route);
  for (let i = doneToday ? 1 : 0; i < days.length; i++) {
    const dow = new Date(`${days[i]}T12:00:00`).getDay();
    if (route.workdays.includes(dow)) return { date: days[i], index: i, isToday: i === 0 };
  }
  return { date: days[doneToday ? 1 : 0], index: doneToday ? 1 : 0, isToday: !doneToday };
}

function hourIndex(forecast, date, hour) {
  return forecast.hourly.time.indexOf(`${date}T${pad(hour)}:00`);
}

// Wind relativ zur Fahrtrichtung. windFrom = Richtung, aus der der Wind kommt.
export function windRelation(windFromDeg, travelBearing, speed) {
  let diff = Math.abs(((windFromDeg - travelBearing + 540) % 360) - 180); // 0 = genau von vorn
  const head = speed * Math.cos((diff * Math.PI) / 180); // + Gegenwind, − Rückenwind
  const kind = diff < 45 ? 'gegen' : diff > 135 ? 'rueck' : 'seite';
  return { kind, head, diff };
}

const SEV = { ok: 0, warn: 1, bad: 2 };

export function assessTrip(forecast, date, departHHMM, minutes, travelBearing, rules) {
  const start = toMin(departHHMM);
  const end = start + minutes;
  const hours = [];
  for (let h = Math.floor(start / 60); h <= Math.floor((end - 1) / 60); h++) {
    const i = hourIndex(forecast, date, h);
    if (i >= 0) hours.push(i);
  }
  if (!hours.length) return null;

  const H = forecast.hourly;
  const pick = (k) => hours.map((i) => H[k][i] ?? 0);
  const temp = Math.min(...pick('temperature_2m'));
  const tempMax = Math.max(...pick('temperature_2m'));
  const feels = Math.min(...pick('apparent_temperature'));
  const rainProb = Math.max(...pick('precipitation_probability'));
  const precip = pick('precipitation').reduce((a, b) => a + b, 0);
  const wind = Math.max(...pick('wind_speed_10m'));
  const gust = Math.max(...pick('wind_gusts_10m'));
  const windDir = H.wind_direction_10m[hours[0]];
  const code = Math.max(...pick('weather_code'));
  const rel = travelBearing == null ? null : windRelation(windDir, travelBearing, wind);

  const checks = [];
  const add = (key, sev, text) => checks.push({ key, sev, text });

  if (temp < rules.minTemp) add('temp', SEV.bad, `${Math.round(temp)} °C – kälter als deine ${rules.minTemp} °C`);
  else if (temp < rules.minTemp + 2) add('temp', SEV.warn, `knapp ${Math.round(temp)} °C`);
  if (tempMax > rules.maxTemp) add('hot', SEV.bad, `${Math.round(tempMax)} °C – zu heiß`);
  else if (tempMax > rules.maxTemp - 3) add('hot', SEV.warn, `warm, ${Math.round(tempMax)} °C`);

  if (rainProb > rules.maxRainProb && precip > rules.maxPrecip) add('rain', SEV.bad, `${rainProb} % Regenrisiko, ${precip.toFixed(1)} mm`);
  else if (rainProb > rules.maxRainProb) add('rain', SEV.warn, `${rainProb} % Regenrisiko, aber kaum Menge`);
  else if (precip > rules.maxPrecip) add('rain', SEV.warn, `${precip.toFixed(1)} mm Regen möglich`);
  else if (rainProb >= rules.maxRainProb * 0.75) add('rain', SEV.warn, `${rainProb} % Regenrisiko`);

  if (wind > rules.maxWind) add('wind', SEV.bad, `Wind ${Math.round(wind)} km/h`);
  else if (wind > rules.maxWind * 0.8) add('wind', SEV.warn, `kräftiger Wind, ${Math.round(wind)} km/h`);
  if (gust > rules.maxGust) add('gust', SEV.bad, `Böen bis ${Math.round(gust)} km/h`);
  else if (gust > rules.maxGust * 0.8) add('gust', SEV.warn, `Böen bis ${Math.round(gust)} km/h`);
  if (rel && rel.kind === 'gegen' && rel.head > 18 && !checks.some((c) => c.key === 'wind')) {
    add('head', SEV.warn, `Gegenwind ${Math.round(rel.head)} km/h – Akku einplanen`);
  }
  if ([95, 96, 99].includes(code)) add('storm', SEV.bad, 'Gewittergefahr');
  if ([56, 57, 66, 67].includes(code)) add('ice', SEV.bad, 'gefrierender Regen – Glättegefahr');
  if ([71, 73, 75, 77, 85, 86].includes(code)) add('snow', SEV.bad, 'Schneefall');

  const sev = checks.reduce((m, c) => Math.max(m, c.sev), 0);
  return { start, end, bearing: travelBearing, temp, tempMax, feels, rainProb, precip, wind, gust, windDir, rel, code, checks, sev };
}

export function assessDay(forecast, route, rules, target) {
  const minutes = tripMinutes(route);
  const b = route.home && route.work ? bearingOf(route) : null;
  const hin = assessTrip(forecast, target.date, route.departHin, minutes, b, rules);
  const rueck = assessTrip(forecast, target.date, route.departRueck, minutes, b == null ? null : (b + 180) % 360, rules);
  const trips = [hin, rueck].filter(Boolean);
  const sev = trips.reduce((m, t) => Math.max(m, t.sev), 0);

  let score = 100;
  for (const t of trips) for (const c of t.checks) score -= c.sev === 2 ? 30 : 10;
  score = Math.max(4, Math.min(100, score));
  if (sev === 2) score = Math.min(score, 35);
  else if (sev === 1) score = Math.min(score, 75);

  const status = ['go', 'caution', 'no'][sev];
  const { gear, sunrise, sunset } = gearFor(forecast, target, hin, rueck);
  return { status, score, hin, rueck, minutes, gear, sunrise, sunset, headline: headline(status), reason: reason(status, hin, rueck) };
}

function bearingOf(route) {
  return bearing(route.home, route.work);
}

function headline(status) {
  return { go: 'Ja, rollen!', caution: 'Machbar.', no: 'Heute lieber nicht.' }[status];
}

function reason(status, hin, rueck) {
  const trips = [
    ['Hinweg', hin],
    ['Rückweg', rueck],
  ].filter(([, t]) => t);
  if (status === 'go') {
    const dry = trips.every(([, t]) => t.rainProb < 20) ? 'Trocken' : 'Kaum Regenrisiko';
    const temps = trips.map(([, t]) => Math.round(t.temp));
    const tr = temps.length === 2 && temps[0] !== temps[1] ? `${temps[0]} → ${temps[1]} °C` : `${temps[0]} °C`;
    const tail = hin?.rel?.kind === 'rueck' ? ', Rückenwind am Morgen' : rueck?.rel?.kind === 'rueck' ? ', Rückenwind nach Hause' : '';
    return `${dry}, ${tr}${tail}.`;
  }
  const worst = trips
    .flatMap(([name, t]) => t.checks.map((c) => ({ ...c, name })))
    .sort((a, b) => b.sev - a.sev)
    .slice(0, 2)
    .map((c) => `${c.name}: ${c.text}`);
  return worst.join(' · ');
}

function gearFor(forecast, target, hin, rueck) {
  const gear = [];
  const sunrise = forecast.daily.sunrise[target.index];
  const sunset = forecast.daily.sunset[target.index];
  const m = (iso) => (iso ? toMin(iso.slice(11, 16)) : null);
  const sr = m(sunrise);
  const ss = m(sunset);
  const trips = [hin, rueck].filter(Boolean);
  if ((hin && sr != null && hin.start < sr + 15) || (rueck && ss != null && rueck.end > ss - 15)) gear.push({ icon: 'light', text: 'Licht an' });
  if (trips.some((t) => t.rainProb >= 30 || t.precip > 0.1)) gear.push({ icon: 'rain', text: 'Regenjacke' });
  const cold = Math.min(...trips.map((t) => t.feels));
  if (cold < 2) gear.push({ icon: 'cold', text: 'Handschuhe & Mütze' });
  else if (cold < 7) gear.push({ icon: 'cold', text: 'Handschuhe' });
  if (trips.some((t) => t.rel?.kind === 'gegen' && t.rel.head > 12)) gear.push({ icon: 'wind', text: 'Mehr Unterstützung einplanen' });
  return { gear, sunrise, sunset };
}
