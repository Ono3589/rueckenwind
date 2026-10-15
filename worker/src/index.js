// Rückenwind-Push: Ein winziger Dienst, der morgens prüft, ob heute Radwetter ist, und eine Meldung ans iPhone schickt.
// Er speichert pro Gerät nur: die Push-Adresse, den Mittelpunkt deiner Strecke (auf ca. 1 km gerundet), den Fahrtkurs,
// deine Zeiten und Wetter-Schwellen. Deine genauen Adressen kennt er nicht.

import { fetchForecast, assessDay } from '../../js/weather.js';
import { buildNotification } from '../../js/messages.js';
import { sendPush } from './webpush.js';

const PREFIX = 'sub:';
const WINDOW_MIN = 180; // so lange nach der Wunschzeit wird noch nachgeholt, falls ein Lauf ausfällt

// ---------- Hilfen ----------

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function validConfig(c) {
  try {
    if (!c || typeof c !== 'object') return false;
    new Intl.DateTimeFormat('de-DE', { timeZone: c.tz });
    return (
      typeof c.tz === 'string' &&
      c.tz.length < 64 &&
      inRange(c.mid?.lat, -90, 90) &&
      inRange(c.mid?.lon, -180, 180) &&
      inRange(c.bearing, 0, 360) &&
      inRange(c.distanceKm, 0.1, 200) &&
      inRange(c.avgSpeed, 5, 60) &&
      isTime(c.departHin) &&
      isTime(c.departRueck) &&
      isTime(c.notifyAt) &&
      Array.isArray(c.workdays) &&
      c.workdays.length <= 7 &&
      c.workdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
      inRange(c.rules?.minTemp, -40, 50) &&
      inRange(c.rules?.maxTemp, -40, 60) &&
      inRange(c.rules?.maxRainProb, 0, 100) &&
      inRange(c.rules?.maxPrecip, 0, 100) &&
      inRange(c.rules?.maxWind, 0, 200) &&
      inRange(c.rules?.maxGust, 0, 300)
    );
  } catch {
    return false;
  }
}

function validSubscription(s) {
  try {
    return (
      typeof s?.endpoint === 'string' &&
      s.endpoint.length < 600 &&
      new URL(s.endpoint).protocol === 'https:' &&
      typeof s.keys?.p256dh === 'string' &&
      typeof s.keys?.auth === 'string'
    );
  } catch {
    return false;
  }
}

const sha256hex = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Gleichzeitiger Vergleich ohne frühen Abbruch, damit die Antwortzeit nichts über das Token verrät
async function sameToken(a, b) {
  const [x, y] = await Promise.all([sha256hex(a), sha256hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// Ortszeit des Nutzers: Datum, Minuten seit Mitternacht, Wochentag (0 = Sonntag)
export function localParts(now, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

const vapidFrom = (env) => ({ subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK) });

// ---------- Meldung berechnen und senden ----------

export async function buildMessage(config, now = new Date(), forecastFor = fetchForecast) {
  const local = localParts(now, config.tz);
  const forecast = await forecastFor(config.mid);
  const index = forecast.daily.time.indexOf(local.date);
  if (index < 0) throw new Error('Vorhersage enthält den heutigen Tag nicht');
  const route = { departHin: config.departHin, departRueck: config.departRueck, distanceKm: config.distanceKm, avgSpeed: config.avgSpeed, workdays: config.workdays, bearing: config.bearing };
  const day = assessDay(forecast, route, config.rules, { date: local.date, index, isToday: index === 0 });
  return { ...buildNotification(day, local.date), status: day.status, date: local.date };
}

async function deliver(env, record, message) {
  return sendPush(
    record.subscription,
    { title: message.title, body: message.body, tag: 'morgen', url: './#heute' },
    vapidFrom(env),
    { ttl: 4 * 3600, fetchImpl: env.fetchImpl ?? fetch },
  );
}

export async function runSchedule(env, now = new Date(), forecastFor = fetchForecast) {
  const results = [];
  const cache = new Map();
  const cached = (mid) => {
    const k = `${mid.lat},${mid.lon}`;
    if (!cache.has(k)) cache.set(k, forecastFor(mid));
    return cache.get(k);
  };
  const { keys } = await env.SUBS.list({ prefix: PREFIX });
  for (const { name } of keys) {
    const record = await env.SUBS.get(name, 'json');
    if (!record || !validConfig(record.config)) continue;
    const c = record.config;
    const local = localParts(now, c.tz);
    const due = c.workdays.includes(local.dow) && local.minutes >= toMin(c.notifyAt) && local.minutes < toMin(c.notifyAt) + WINDOW_MIN && record.lastSent !== local.date;
    if (!due) continue;
    try {
      const message = await buildMessage(c, now, cached);
      const res = await deliver(env, record, message);
      if (res.status === 404 || res.status === 410) {
        await env.SUBS.delete(name); // Gerät hat sich abgemeldet oder die Adresse ist abgelaufen
        results.push({ name, sent: false, gone: true });
      } else if (res.ok) {
        await env.SUBS.put(name, JSON.stringify({ ...record, lastSent: local.date }));
        results.push({ name, sent: true, status: message.status });
      } else {
        results.push({ name, sent: false, httpStatus: res.status }); // beim nächsten Lauf erneut
      }
    } catch (e) {
      results.push({ name, sent: false, error: String(e?.message ?? e) });
    }
  }
  return results;
}

// ---------- HTTP ----------

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const reply = (req, env, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, env) } });

export async function handleRequest(req, env, now = new Date(), forecastFor = fetchForecast) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (req.method === 'GET' && url.pathname === '/health') return reply(req, env, { ok: true });
  if (req.method === 'GET' && url.pathname === '/vapid') return reply(req, env, { publicKey: env.VAPID_PUBLIC ?? '' });
  if (req.method !== 'POST') return reply(req, env, { error: 'nicht gefunden' }, 404);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.API_TOKEN || !token || !(await sameToken(token, env.API_TOKEN))) return reply(req, env, { error: 'Token falsch' }, 401);

  const raw = await req.text();
  if (raw.length > 8192) return reply(req, env, { error: 'zu groß' }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(req, env, { error: 'kein JSON' }, 400);
  }
  const endpoint = body?.subscription?.endpoint ?? body?.endpoint;
  if (typeof endpoint !== 'string') return reply(req, env, { error: 'Push-Adresse fehlt' }, 400);
  const key = PREFIX + (await sha256hex(endpoint));

  if (url.pathname === '/subscribe') {
    if (!validSubscription(body.subscription) || !validConfig(body.config)) return reply(req, env, { error: 'Angaben unvollständig oder ungültig' }, 400);
    const old = await env.SUBS.get(key, 'json');
    await env.SUBS.put(key, JSON.stringify({ subscription: body.subscription, config: body.config, lastSent: old?.lastSent ?? null, updated: now.toISOString() }));
    return reply(req, env, { ok: true });
  }
  if (url.pathname === '/unsubscribe') {
    await env.SUBS.delete(key);
    return reply(req, env, { ok: true });
  }
  if (url.pathname === '/test') {
    const record = await env.SUBS.get(key, 'json');
    if (!record) return reply(req, env, { error: 'Gerät ist nicht angemeldet' }, 404);
    try {
      const message = await buildMessage(record.config, now, forecastFor);
      const res = await deliver(env, record, message);
      return reply(req, env, { ok: res.ok, pushStatus: res.status, title: message.title, body: message.body }, res.ok ? 200 : 502);
    } catch (e) {
      return reply(req, env, { error: String(e?.message ?? e) }, 502);
    }
  }
  return reply(req, env, { error: 'nicht gefunden' }, 404);
}

export default {
  fetch: (req, env) => handleRequest(req, env),
  scheduled: (_event, env, ctx) => ctx.waitUntil(runSchedule(env)),
};
