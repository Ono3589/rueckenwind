// Rückenwind-Push: Ein winziger Dienst, der morgens prüft, ob heute Radwetter ist, und eine Meldung ans iPhone schickt.
// Er speichert pro Gerät nur: die Push-Adresse, den Mittelpunkt deiner Strecke (auf ca. 1 km gerundet), den Fahrtkurs,
// deine Zeiten und Wetter-Schwellen. Deine genauen Adressen kennt er nicht.

import { fetchForecast, assessDay } from '../../js/weather.js';
import { buildNotification, buildEveningNotification } from '../../js/messages.js';
import { sendPush } from './webpush.js';
import { parseHealthText } from '../../js/health.js';

const PREFIX = 'sub:';
const INBOX = 'inbox:'; // Fahrten, die ein Kurzbefehl aus Apple Health geschickt hat und die die App noch abholt
const INBOX_TTL = 30 * 24 * 3600; // nicht abgeholte Fahrten verfallen nach 30 Tagen
const MAX_RIDES_TEXT = 16384;
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
      (c.eveningAt === undefined || isTime(c.eveningAt)) &&
      (c.eveningOn === undefined || typeof c.eveningOn === 'boolean') &&
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

export async function buildMessage(config, now = new Date(), forecastFor = fetchForecast, kind = 'morgen') {
  const local = localParts(now, config.tz);
  const forecast = await forecastFor(config.mid);
  const index = forecast.daily.time.indexOf(local.date);
  if (index < 0) throw new Error('Vorhersage enthält den heutigen Tag nicht');
  const route = { departHin: config.departHin, departRueck: config.departRueck, distanceKm: config.distanceKm, avgSpeed: config.avgSpeed, workdays: config.workdays, bearing: config.bearing };
  const day = assessDay(forecast, route, config.rules, { date: local.date, index, isToday: index === 0 });
  const text = kind === 'abend' ? buildEveningNotification(day, local.date) : buildNotification(day, local.date);
  return { ...text, status: day.status, date: local.date, kind };
}

async function deliver(env, record, message) {
  const evening = message.kind === 'abend';
  return sendPush(
    record.subscription,
    { title: message.title, body: message.body, tag: evening ? 'abend' : 'morgen', url: evening ? './#frage' : './#heute' },
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
    let record = await env.SUBS.get(name, 'json');
    if (!record || !validConfig(record.config)) continue;
    const c = record.config;
    const local = localParts(now, c.tz);
    const inWindow = (at) => c.workdays.includes(local.dow) && local.minutes >= toMin(at) && local.minutes < toMin(at) + WINDOW_MIN;
    const due = [];
    if (inWindow(c.notifyAt) && record.lastSent !== local.date) due.push('morgen');
    // Abends nur fragen, wenn der Tag nicht schon erledigt ist (die App meldet über /logged, dass alles eingetragen oder beantwortet ist)
    if (c.eveningOn === true && inWindow(c.eveningAt ?? '18:30') && record.lastEvening !== local.date && record.completeFor !== local.date) due.push('abend');

    for (const kind of due) {
      try {
        const message = await buildMessage(c, now, cached, kind);
        const res = await deliver(env, record, message);
        if (res.status === 404 || res.status === 410) {
          await env.SUBS.delete(name); // Gerät hat sich abgemeldet oder die Adresse ist abgelaufen
          results.push({ name, kind, sent: false, gone: true });
          break;
        } else if (res.ok) {
          record = { ...record, [kind === 'abend' ? 'lastEvening' : 'lastSent']: local.date };
          await env.SUBS.put(name, JSON.stringify(record));
          results.push({ name, kind, sent: true, status: message.status });
        } else {
          results.push({ name, kind, sent: false, httpStatus: res.status }); // beim nächsten Lauf erneut
        }
      } catch (e) {
        results.push({ name, kind, sent: false, error: String(e?.message ?? e) });
      }
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

const isoDate = (d) => d.toISOString().slice(0, 10);
const newInboxId = (now) => `${now.getTime()}-${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export async function handleRequest(req, env, now = new Date(), forecastFor = fetchForecast) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
  if (req.method === 'GET' && url.pathname === '/health') return reply(req, env, { ok: true });
  if (req.method === 'GET' && url.pathname === '/vapid') return reply(req, env, { publicKey: env.VAPID_PUBLIC ?? '' });

  // Zwei Schlüssel: API_TOKEN darf alles, INGEST_TOKEN (im Kurzbefehl) darf nur Fahrten abliefern
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const isMain = !!env.API_TOKEN && !!token && (await sameToken(token, env.API_TOKEN));
  const isIngest = !!env.INGEST_TOKEN && !!token && (await sameToken(token, env.INGEST_TOKEN));

  if (req.method === 'GET' && url.pathname === '/inbox') {
    if (!isMain) return reply(req, env, { error: 'Token falsch' }, 401);
    const { keys } = await env.SUBS.list({ prefix: INBOX });
    const items = [];
    for (const { name } of keys.slice(-50)) {
      const v = await env.SUBS.get(name, 'json');
      if (v) items.push({ id: name.slice(INBOX.length), text: v.text, received: v.received });
    }
    return reply(req, env, { items });
  }
  if (req.method !== 'POST') return reply(req, env, { error: 'nicht gefunden' }, 404);

  if (url.pathname === '/rides') {
    // Vom Kurzbefehl: Text mit einer Fahrt pro Zeile, als JSON {"text": "…"} oder als reiner Text
    if (!isMain && !isIngest) return reply(req, env, { error: 'Token falsch' }, 401);
    const raw = await req.text();
    if (raw.length > MAX_RIDES_TEXT) return reply(req, env, { error: 'zu groß' }, 413);
    let text = raw;
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') text = typeof j.text === 'string' ? j.text : '';
    } catch {
      /* reiner Text */
    }
    const { items, ignored } = parseHealthText(text, { distanceKm: 0, today: isoDate(now) });
    if (!items.length) return reply(req, env, { ok: true, accepted: 0, ignored: ignored.length });
    await env.SUBS.put(INBOX + newInboxId(now), JSON.stringify({ text: text.trim(), received: now.toISOString() }), { expirationTtl: INBOX_TTL });
    return reply(req, env, { ok: true, accepted: items.length, ignored: ignored.length });
  }

  if (!isMain) return reply(req, env, { error: 'Token falsch' }, 401);
  const raw = await req.text();
  if (raw.length > 8192) return reply(req, env, { error: 'zu groß' }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(req, env, { error: 'kein JSON' }, 400);
  }

  if (url.pathname === '/inbox/ack') {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((i) => typeof i === 'string' && /^[\w-]{1,40}$/.test(i)).slice(0, 50) : [];
    for (const id of ids) await env.SUBS.delete(INBOX + id);
    return reply(req, env, { ok: true, removed: ids.length });
  }

  const endpoint = body?.subscription?.endpoint ?? body?.endpoint;
  if (typeof endpoint !== 'string') return reply(req, env, { error: 'Push-Adresse fehlt' }, 400);
  const key = PREFIX + (await sha256hex(endpoint));

  if (url.pathname === '/subscribe') {
    if (!validSubscription(body.subscription) || !validConfig(body.config)) return reply(req, env, { error: 'Angaben unvollständig oder ungültig' }, 400);
    const old = await env.SUBS.get(key, 'json');
    await env.SUBS.put(key, JSON.stringify({ subscription: body.subscription, config: body.config, lastSent: old?.lastSent ?? null, lastEvening: old?.lastEvening ?? null, completeFor: old?.completeFor ?? null, updated: now.toISOString() }));
    return reply(req, env, { ok: true });
  }
  if (url.pathname === '/unsubscribe') {
    await env.SUBS.delete(key);
    return reply(req, env, { ok: true });
  }
  if (url.pathname === '/logged') {
    // Die App meldet: Heute ist erledigt (Fahrten eingetragen oder beantwortet). Dann entfällt die Abendfrage.
    const record = await env.SUBS.get(key, 'json');
    if (!record) return reply(req, env, { error: 'Gerät ist nicht angemeldet' }, 404);
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return reply(req, env, { error: 'Datum fehlt' }, 400);
    await env.SUBS.put(key, JSON.stringify({ ...record, completeFor: body.complete === true ? body.date : record.completeFor === body.date ? null : record.completeFor }));
    return reply(req, env, { ok: true });
  }
  if (url.pathname === '/test') {
    const record = await env.SUBS.get(key, 'json');
    if (!record) return reply(req, env, { error: 'Gerät ist nicht angemeldet' }, 404);
    try {
      const message = await buildMessage(record.config, now, forecastFor, body.kind === 'abend' ? 'abend' : 'morgen');
      const res = await deliver(env, record, message);
      return reply(req, env, { ok: res.ok, pushStatus: res.status, title: message.title, body: message.body, kind: message.kind }, res.ok ? 200 : 502);
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
