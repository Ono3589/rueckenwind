// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, runBoschSync, localParts } from '../worker/src/index.js';
import { activityLine, parseStart, validClientId } from '../worker/src/bosch.js';
import { parseHealthText } from '../js/health.js';

class FakeKV {
  m = new Map();
  async get(k, type) { const v = this.m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; }
}

const CLIENT = 'euda-4cc48156-05a2-45d9-aac7-084f9f82b4d9';
const NOW = new Date('2026-10-15T07:50:00Z'); // 09:50 in Berlin
const ride = (id, startTime, distance = 10400, extra = {}) => ({ id, startTime, distance, durationWithoutStops: 1620, caloriesBurned: 186, ...extra });

// Ein Bosch, das Tokens ausgibt und Fahrten liefert; zählt die Aufrufe
function fakeBosch({ activities = [], status = 200, tokenStatus = 200 } = {}) {
  const calls = { token: [], api: [] };
  const impl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/openid-connect/token')) {
      const body = Object.fromEntries(new URLSearchParams(init.body));
      calls.token.push(body);
      if (tokenStatus !== 200) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: tokenStatus });
      return new Response(JSON.stringify({ access_token: `acc-${calls.token.length}`, refresh_token: `ref-${calls.token.length}`, expires_in: 300 }), { status: 200 });
    }
    calls.api.push({ url: u, auth: init.headers?.Authorization });
    return new Response(JSON.stringify({ activitySummaries: activities }), { status });
  };
  return { impl, calls };
}

const makeEnv = (fetchImpl) => ({ SUBS: new FakeKV(), API_TOKEN: 'main-token', BOSCH_KEY: 'k'.repeat(64), ALLOWED_ORIGINS: 'https://app.example', APP_URL: 'https://app.example/rueckenwind/', fetchImpl });
const post = (env, path, body, token = env.API_TOKEN) => handleRequest(new Request(`https://w.example${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body ?? {}) }), env, NOW);
const get = (env, path, token = env.API_TOKEN) => handleRequest(new Request(`https://w.example${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }), env, NOW);

// Komplette Anmeldung durchspielen
async function connect(env) {
  const start = await (await post(env, '/bosch/start', { clientId: CLIENT })).json();
  const url = new URL(start.url);
  const cb = await get(env, `/bosch/callback?code=abc&state=${url.searchParams.get('state')}`, null);
  return { start, url, cb };
}

test('Client-ID wird geprüft', () => {
  assert.ok(validClientId(CLIENT));
  for (const bad of ['', 'abc', 'euda-', 'euda-<script>', 42, null]) assert.equal(validClientId(bad), false);
});

test('Eine Bosch-Fahrt wird zur Zeile, die die App versteht (Ortszeit, km, Minuten, kcal)', () => {
  const line = activityLine(ride('1', '2026-10-15T05:31:00Z'), 'Europe/Berlin', localParts);
  assert.equal(line, '2026-10-15;07:31;10.40;27;186');
  const { items } = parseHealthText(line, { distanceKm: 10.4, today: '2026-10-15' });
  assert.equal(items.length, 1);
  assert.equal(items[0].direction, 'hin');
  assert.equal(items[0].fits, true);
  assert.equal(items[0].km, 10.4);
  // fehlende Felder sind in Ordnung, zu kurze oder kaputte Fahrten fallen weg
  assert.match(activityLine({ id: 'x', startTime: '2026-10-15T15:00:00Z', distance: 8000 }, 'Europe/Berlin', localParts), /^2026-10-15;17:00;8\.00;;$/);
  assert.equal(activityLine(ride('2', '2026-10-15T05:31:00Z', 50), 'Europe/Berlin', localParts), null);
  assert.equal(activityLine({ id: '3', distance: 9000 }, 'Europe/Berlin', localParts), null);
  assert.equal(activityLine(null, 'Europe/Berlin', localParts), null);
});

test('Startzeit als Text, Millisekunden oder Sekunden', () => {
  const iso = new Date('2026-10-15T05:31:00Z').getTime();
  assert.equal(parseStart('2026-10-15T05:31:00Z').getTime(), iso);
  assert.equal(parseStart(iso).getTime(), iso);
  assert.equal(parseStart(iso / 1000).getTime(), iso);
  assert.equal(parseStart('kaputt'), null);
  assert.equal(parseStart(undefined), null);
});

test('Anmeldung: Start nur mit Token, PKCE-Adresse, einmaliger state, Tokens landen verschlüsselt im KV', async () => {
  const bosch = fakeBosch({ activities: [ride('a1', '2026-10-15T05:31:00Z')] });
  const env = makeEnv(bosch.impl);
  assert.equal((await post(env, '/bosch/start', { clientId: CLIENT }, 'falsch')).status, 401);
  assert.equal((await post(env, '/bosch/start', { clientId: 'quatsch' })).status, 400);

  const { start, url, cb } = await connect(env);
  assert.equal(start.redirectUri, 'https://w.example/bosch/callback');
  assert.equal(url.origin + url.pathname, 'https://p9.authz.bosch.com/auth/realms/obc/protocol/openid-connect/auth');
  assert.equal(url.searchParams.get('client_id'), CLIENT);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://w.example/bosch/callback');
  assert.ok(url.searchParams.get('code_challenge').length >= 40);

  assert.equal(cb.status, 302);
  assert.equal(new URL(cb.headers.get('Location')).searchParams.get('bosch'), 'ok');
  assert.equal(new URL(cb.headers.get('Location')).hash, '#einstellungen');

  // Der Tausch nutzt den Verifier, nie ein Geheimnis
  assert.equal(bosch.calls.token[0].grant_type, 'authorization_code');
  assert.ok(bosch.calls.token[0].code_verifier.length >= 40);
  assert.equal(bosch.calls.token[0].client_secret, undefined);

  // Im KV steht nichts im Klartext
  const stored = env.SUBS.m.get('bosch:conn');
  assert.ok(!stored.includes('acc-1') && !stored.includes('ref-1'));

  // Der state gilt nur einmal
  const again = await get(env, `/bosch/callback?code=abc&state=${url.searchParams.get('state')}`, null);
  assert.equal(new URL(again.headers.get('Location')).searchParams.get('bosch'), 'fehler');
});

test('Rückkehr mit Fehler oder erfundenem state führt nie zu einer Verbindung', async () => {
  const env = makeEnv(fakeBosch().impl);
  const denied = await get(env, '/bosch/callback?error=access_denied', null);
  assert.equal(new URL(denied.headers.get('Location')).searchParams.get('bosch'), 'fehler');
  const forged = await get(env, '/bosch/callback?code=abc&state=AAAAAAAAAAAAAAAAAAAAAAAA', null);
  assert.equal(new URL(forged.headers.get('Location')).searchParams.get('bosch'), 'fehler');
  assert.equal((await (await get(env, '/bosch/status')).json()).connected, false);
});

test('Ohne BOSCH_KEY meldet der Dienst, was fehlt', async () => {
  const env = makeEnv(fakeBosch().impl);
  delete env.BOSCH_KEY;
  const r = await post(env, '/bosch/start', { clientId: CLIENT });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /setup-secrets/);
});

test('Abfrage: neue Fahrten kommen genau einmal in den Eingang, ältere und doppelte nicht', async () => {
  const bosch = fakeBosch({ activities: [
    ride('a2', '2026-10-15T15:05:00Z', 10200, { durationWithoutStops: 1560, caloriesBurned: 181 }), // 17:05 Berlin
    ride('a1', '2026-10-15T05:31:00Z'),
    ride('old', '2026-08-01T05:31:00Z'), // außerhalb der 14 Tage
    ride('tiny', '2026-10-15T06:00:00Z', 40),
  ] });
  const env = makeEnv(bosch.impl);
  await connect(env); // holt schon beim Verbinden
  const inbox = () => [...env.SUBS.m.keys()].filter((k) => k.startsWith('inbox:'));
  assert.equal(inbox().length, 1);
  const text = JSON.parse(env.SUBS.m.get(inbox()[0])).text;
  assert.equal(text.split('\n').length, 2);
  const { items } = parseHealthText(text, { distanceKm: 10.4, today: '2026-10-15' });
  assert.deepEqual(items.map((i) => i.direction).sort(), ['hin', 'rueck']);

  const second = await runBoschSync(env, NOW);
  assert.equal(second.imported, 0);
  assert.equal(inbox().length, 1, 'nichts doppelt');

  // eine neue Fahrt später
  bosch.calls.api.length = 0;
  const bosch2 = fakeBosch({ activities: [ride('a3', '2026-10-16T05:30:00Z'), ride('a2', '2026-10-15T15:05:00Z')] });
  env.fetchImpl = bosch2.impl;
  const third = await runBoschSync(env, new Date('2026-10-16T06:00:00Z'));
  assert.equal(third.imported, 1);
  assert.equal(inbox().length, 2);
});

test('Das Zugriffstoken wird bei Ablauf erneuert, das neue Refresh-Token gespeichert', async () => {
  const bosch = fakeBosch({ activities: [] });
  const env = makeEnv(bosch.impl);
  await connect(env);
  const before = bosch.calls.token.length;
  await runBoschSync(env, new Date(NOW.getTime() + 10 * 60000)); // Token lief nach 5 Minuten ab
  assert.equal(bosch.calls.token.length, before + 1);
  assert.equal(bosch.calls.token.at(-1).grant_type, 'refresh_token');
  assert.equal(bosch.calls.token.at(-1).refresh_token, `ref-${before}`);
  await runBoschSync(env, new Date(NOW.getTime() + 11 * 60000));
  assert.equal(bosch.calls.token.length, before + 1, 'noch gültig, kein erneuter Tausch');
  assert.equal(bosch.calls.api.at(-1).auth, `Bearer acc-${before + 1}`);
});

test('Fehler werden verständlich gemeldet und gespeichert, ohne zu stürzen', async () => {
  const env = makeEnv(fakeBosch({ activities: [] }).impl);
  await connect(env);
  env.fetchImpl = fakeBosch({ status: 403 }).impl;
  const denied = await runBoschSync(env, new Date(NOW.getTime() + 1000));
  assert.equal(denied.code, 'access');
  assert.match(denied.error, /Freigabe/);
  let status = await (await get(env, '/bosch/status')).json();
  assert.match(status.lastError, /Freigabe/);
  assert.equal(status.needsLogin, false);

  env.fetchImpl = fakeBosch({ tokenStatus: 400 }).impl;
  const expired = await runBoschSync(env, new Date(NOW.getTime() + 3600000)); // Token abgelaufen, Refresh scheitert
  assert.equal(expired.code, 'login');
  status = await (await get(env, '/bosch/status')).json();
  assert.equal(status.needsLogin, true);
  assert.ok(!JSON.stringify(status).includes('ref-'), 'Status enthält keine Tokens');
});

test('Trennen löscht die Verbindung, der Status verlangt das Token', async () => {
  const env = makeEnv(fakeBosch().impl);
  await connect(env);
  assert.equal((await get(env, '/bosch/status', 'falsch')).status, 401);
  assert.equal((await (await get(env, '/bosch/status')).json()).connected, true);
  await post(env, '/bosch/disconnect');
  assert.equal((await (await get(env, '/bosch/status')).json()).connected, false);
  assert.equal(env.SUBS.m.has('bosch:conn'), false);
  assert.deepEqual(await runBoschSync(env, NOW), { connected: false });
});

test('Diagnose: Anzahl und Feldnamen der Bosch-Antwort werden im Status gezeigt, nie Werte', async () => {
  const bosch = fakeBosch({ activities: [ride('a1', '2026-10-15T05:31:00Z')] });
  const env = makeEnv(bosch.impl);
  await connect(env);
  const status = await (await get(env, '/bosch/status')).json();
  assert.equal(status.lastInfo.fetched, 1);
  assert.equal(status.lastInfo.imported, 1);
  assert.deepEqual(status.lastInfo.bodyKeys, ['activitySummaries']);
  assert.ok(status.lastInfo.fields.includes('distance'));
  assert.ok(!JSON.stringify(status).includes('10400'), 'keine Messwerte im Status');
});

test('Liefert Bosch die Liste unter einem anderen Namen, wird sie trotzdem gefunden', async () => {
  const env = makeEnv(async (url, init) => {
    if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 300 }));
    return new Response(JSON.stringify({ data: [ride('z1', '2026-10-15T05:31:00Z')], pagination: { total: 1 } }));
  });
  await connect(env);
  const status = await (await get(env, '/bosch/status')).json();
  assert.equal(status.lastInfo.fetched, 1);
  assert.equal(status.lastInfo.total, 1);
  assert.ok([...env.SUBS.m.keys()].some((k) => k.startsWith('inbox:')));
});

test('Leere Antwort: der Status sagt, was Bosch geschickt hat', async () => {
  const env = makeEnv(async (url) => (String(url).includes('/token') ? new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 300 })) : new Response(JSON.stringify({ activitySummaries: [], pagination: { total: 0 } }))));
  await connect(env);
  const { lastInfo } = await (await get(env, '/bosch/status')).json();
  assert.equal(lastInfo.fetched, 0);
  assert.deepEqual(lastInfo.bodyKeys, ['activitySummaries', 'pagination']);
  assert.equal(lastInfo.http, 200);
  assert.equal(lastInfo.total, 0);
});
