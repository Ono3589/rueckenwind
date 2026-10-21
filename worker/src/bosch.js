// Bosch eBike Flow über die Data-Act-Schnittstelle: Der Dienst fragt regelmäßig neue Fahrten ab und legt sie in den Eingang,
// aus dem die App sie abholt (derselbe Weg wie beim Kurzbefehl). Angemeldet wird mit OAuth 2.0 + PKCE als öffentlicher Client,
// es gibt also kein Client-Geheimnis. Die Bosch-Tokens liegen nur verschlüsselt (AES-256-GCM, Schlüssel BOSCH_KEY) im KV.

import { b64u } from './webpush.js';

export const AUTH_URL = 'https://p9.authz.bosch.com/auth/realms/obc/protocol/openid-connect/auth';
export const TOKEN_URL = 'https://p9.authz.bosch.com/auth/realms/obc/protocol/openid-connect/token';
export const API_BASE = 'https://api.bosch-ebike.com';
export const ACTIVITIES_PATH = '/activity/smart-system/v1/activities';
export const BIKES_PATH = '/bike-profile/smart-system/v1/bikes';

const CONN = 'bosch:conn';
const STATE = 'boschstate:';
const STATE_TTL = 600;
const LOOKBACK_DAYS = 14; // so weit zurück werden Fahrten beim Abfragen berücksichtigt
const MAX_SEEN = 300;
const MIN_KM = 0.2;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const validClientId = (v) => typeof v === 'string' && /^euda-[\w-]{4,80}$/.test(v);

// ---------- Verschlüsselung der Tokens ----------

async function aesKey(env) {
  if (!env.BOSCH_KEY) throw new BoschError('Im Dienst fehlt das Bosch-Geheimnis. Führe `node worker/scripts/setup-secrets.mjs bosch` aus.', 'setup');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`rueckenwind-bosch|${env.BOSCH_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(obj))));
  return `${b64u.encode(iv)}.${b64u.encode(ct)}`;
}

async function unseal(env, text) {
  const [iv, ct] = String(text).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.decode(iv) }, await aesKey(env), b64u.decode(ct));
  return JSON.parse(dec.decode(plain));
}

export class BoschError extends Error {
  constructor(message, code = 'api') {
    super(message);
    this.code = code; // 'setup' | 'login' | 'access' | 'api'
  }
}

// ---------- Anmelden (Autorisierungscode mit PKCE) ----------

export async function startLogin(env, { origin, clientId }, now = new Date()) {
  if (!validClientId(clientId)) throw new BoschError('Die Client-ID sieht nicht richtig aus. Sie beginnt mit „euda-“.', 'login');
  await aesKey(env); // früh melden, falls das Geheimnis fehlt
  const verifier = b64u.encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64u.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  const state = b64u.encode(crypto.getRandomValues(new Uint8Array(18)));
  const redirectUri = `${origin}/bosch/callback`;
  await env.SUBS.put(STATE + state, JSON.stringify({ verifier, clientId, redirectUri, at: now.toISOString() }), { expirationTtl: STATE_TTL });
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', scope: 'openid', state });
  return { url: `${AUTH_URL}?${q}`, redirectUri };
}

async function tokenRequest(fetchImpl, params) {
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  } catch {
    throw new BoschError('Bosch ist gerade nicht erreichbar.', 'api');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const gone = data.error === 'invalid_grant' || res.status === 400 || res.status === 401;
    throw new BoschError(gone ? 'Die Anmeldung bei Bosch ist abgelaufen. Verbinde dich bitte neu.' : `Bosch meldet Fehler ${res.status}.`, gone ? 'login' : 'api');
  }
  return data;
}

const expiryOf = (data, now) => now.getTime() + Math.max(60, Number(data.expires_in) || 300) * 1000;

// Rückkehr von Bosch: Code gegen Tokens tauschen und verschlüsselt ablegen
export async function finishLogin(env, { code, state }, now = new Date(), fetchImpl = fetch) {
  if (!code || !state || !/^[\w-]{10,64}$/.test(state)) throw new BoschError('Die Rückkehr von Bosch war unvollständig.', 'login');
  const pending = await env.SUBS.get(STATE + state, 'json');
  if (!pending) throw new BoschError('Die Anmeldung ist abgelaufen oder wurde schon benutzt. Starte sie in der App neu.', 'login');
  await env.SUBS.delete(STATE + state); // nur einmal gültig
  const data = await tokenRequest(fetchImpl, { grant_type: 'authorization_code', client_id: pending.clientId, code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
  const conn = {
    clientId: pending.clientId,
    tokens: await seal(env, { access: data.access_token, refresh: data.refresh_token ?? null }),
    expiresAt: expiryOf(data, now),
    connected: now.toISOString(),
    lastCheck: null,
    lastRide: null,
    lastError: null,
    seen: [],
  };
  await env.SUBS.put(CONN, JSON.stringify(conn));
  return { ok: true };
}

// ---------- Abfragen ----------

async function freshAccess(env, conn, now, fetchImpl, { force = false } = {}) {
  const t = await unseal(env, conn.tokens);
  if (!force && conn.expiresAt - 60000 > now.getTime()) return { access: t.access, conn };
  if (!t.refresh) throw new BoschError('Die Anmeldung bei Bosch ist abgelaufen. Verbinde dich bitte neu.', 'login');
  const data = await tokenRequest(fetchImpl, { grant_type: 'refresh_token', client_id: conn.clientId, refresh_token: t.refresh });
  const next = { ...conn, tokens: await seal(env, { access: data.access_token, refresh: data.refresh_token ?? t.refresh }), expiresAt: expiryOf(data, now) };
  await env.SUBS.put(CONN, JSON.stringify(next)); // Bosch kann das Refresh-Token tauschen, das neue sofort sichern
  return { access: data.access_token, conn: next };
}

async function getActivities(env, conn, now, fetchImpl) {
  let auth = await freshAccess(env, conn, now, fetchImpl);
  const url = `${API_BASE}${ACTIVITIES_PATH}?limit=20&sort=-startTime`;
  const call = (token) => fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }).catch(() => {
    throw new BoschError('Bosch ist gerade nicht erreichbar.', 'api');
  });
  let res = await call(auth.access);
  if (res.status === 401) {
    auth = await freshAccess(env, auth.conn, now, fetchImpl, { force: true });
    res = await call(auth.access);
  }
  if (res.status === 403) throw new BoschError('Bosch verweigert den Zugriff. Schalte die Freigabe für Rückenwind und für dein Bike im Flow-Portal ein (Data Act).', 'access');
  if (res.status === 429) throw new BoschError('Bosch bremst gerade ab (zu viele Anfragen). Das nächste Mal klappt es wieder.', 'api');
  if (!res.ok) throw new BoschError(`Bosch meldet Fehler ${res.status}.`, 'api');
  const body = await res.json().catch(() => null);
  // Bekannter Name zuerst, sonst die erste Liste in der Antwort: so geht keine Fahrt verloren, falls Bosch das Feld anders nennt
  const named = body?.activitySummaries ?? body?.activities ?? body?.items;
  const list = Array.isArray(named) ? named : Array.isArray(body) ? body : Object.values(body && typeof body === 'object' ? body : {}).find(Array.isArray) ?? [];
  return { activities: list, conn: auth.conn, access: auth.access, shape: { http: res.status, bodyKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [], total: body?.pagination?.total ?? null } };
}

// Wie viele Bikes hat Bosch für diese App freigegeben? Unterscheidet „Freigabe am Bike fehlt“ von „Fahrten noch nicht bei Bosch“.
async function countBikes(auth, fetchImpl) {
  try {
    const res = await fetchImpl(`${API_BASE}${BIKES_PATH}`, { headers: { Authorization: `Bearer ${auth.access}`, Accept: 'application/json' } });
    if (!res.ok) return { http: res.status, count: null };
    const body = await res.json().catch(() => null);
    const list = Array.isArray(body?.bikes) ? body.bikes : Array.isArray(body) ? body : [];
    return { http: res.status, count: list.length };
  } catch {
    return { http: 0, count: null };
  }
}

// ---------- Umrechnen in die Zeilen, die die App versteht ----------

export function parseStart(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e11 ? v * 1000 : v);
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(/^\d+$/.test(v.trim()) ? Number(v) : v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

const num = (o, ...path) => {
  let v = o;
  for (const k of path) v = v?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

// Eine Fahrt wird zu „datum;start;km;minuten;kcal“. localParts kommt vom Aufrufer (Ortszeit des Nutzers).
export function activityLine(a, tz, localParts) {
  const start = parseStart(a?.startTime);
  const meters = num(a, 'distance');
  if (!start || meters === null || meters / 1000 < MIN_KM) return null;
  const { date, minutes } = localParts(start, tz);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const sec = num(a, 'durationWithoutStops');
  const kcal = num(a, 'caloriesBurned');
  return `${date};${hh}:${mm};${(meters / 1000).toFixed(2)};${sec === null ? '' : Math.round(sec / 60)};${kcal === null ? '' : Math.round(kcal)}`;
}

const activityId = (a) => String(a?.id ?? a?.startTime ?? '');

// putInbox(text) legt die Zeilen in den Eingang der App. Rückgabe: was passiert ist.
export async function syncBosch(env, now, { tz, localParts, putInbox, fetchImpl = fetch }) {
  const conn = await env.SUBS.get(CONN, 'json');
  if (!conn) return { connected: false };
  let current = conn;
  try {
    const { activities, conn: updated, shape, access } = await getActivities(env, conn, now, fetchImpl);
    current = updated;
    const seen = new Set(current.seen ?? []);
    const since = now.getTime() - LOOKBACK_DAYS * 86400000;
    const fresh = activities.filter((a) => {
      const id = activityId(a);
      const t = parseStart(a?.startTime)?.getTime();
      return id && !seen.has(id) && t !== undefined && t !== null && t >= since;
    });
    const lines = [];
    for (const a of fresh) {
      const line = activityLine(a, tz, localParts);
      if (line) lines.push(line);
      seen.add(activityId(a)); // auch zu kurze oder unvollständige Fahrten nicht jedes Mal neu ansehen
    }
    if (lines.length) await putInbox(lines.join('\n'));
    const newest = activities.map((a) => parseStart(a?.startTime)).filter(Boolean).sort((x, y) => y - x)[0];
    // Nur Feldnamen und Anzahlen, nie Werte: damit sich prüfen lässt, ob Bosch das erwartete Format liefert
    const first = activities[0];
    const fields = first && typeof first === 'object' ? Object.keys(first).slice(0, 30) : [];
    const unreadable = activities.filter((a) => !parseStart(a?.startTime)).length;
    const bikes = activities.length === 0 ? await countBikes({ access }, fetchImpl) : null;
    const lastInfo = { ...shape, fetched: activities.length, imported: lines.length, unreadable, fields, ...(bikes ? { bikes } : {}) };
    const saved = { ...current, seen: [...seen].slice(-MAX_SEEN), lastCheck: now.toISOString(), lastError: null, lastInfo, lastRide: newest ? newest.toISOString() : current.lastRide };
    await env.SUBS.put(CONN, JSON.stringify(saved));
    return { connected: true, fetched: activities.length, imported: lines.length, fields, lastInfo };
  } catch (e) {
    const err = e instanceof BoschError ? e : new BoschError(String(e?.message ?? e), 'api');
    await env.SUBS.put(CONN, JSON.stringify({ ...current, lastCheck: now.toISOString(), lastError: err.message, needsLogin: err.code === 'login' }));
    return { connected: true, error: err.message, code: err.code };
  }
}

export async function boschStatus(env) {
  const c = await env.SUBS.get(CONN, 'json');
  const keyReady = !!env.BOSCH_KEY;
  if (!c) return { connected: false, keyReady };
  return { connected: true, keyReady, clientId: c.clientId, since: c.connected, lastCheck: c.lastCheck, lastRide: c.lastRide, lastError: c.lastError ?? null, needsLogin: !!c.needsLogin, lastInfo: c.lastInfo ?? null };
}

export async function boschDisconnect(env) {
  await env.SUBS.delete(CONN);
  return { ok: true };
}
