// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, runSchedule, buildMessage, localParts, validConfig } from '../worker/src/index.js';
import { b64u } from '../worker/src/webpush.js';
import { TITLES, EVENING } from '../js/messages.js';

class FakeKV {
  m = new Map();
  async get(k, type) { const v = this.m.get(k); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, v); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) { return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; }
}

function forecastOn(dates, { temp = 12, rain = 5, wind = 10 } = {}) {
  const time = [], h = { temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], weather_code: [] };
  for (const d of dates) for (let i = 0; i < 24; i++) {
    time.push(`${d}T${String(i).padStart(2, '0')}:00`);
    h.temperature_2m.push(temp); h.apparent_temperature.push(temp - 2); h.precipitation_probability.push(rain);
    h.precipitation.push(rain > 50 ? 2 : 0); h.wind_speed_10m.push(wind); h.wind_direction_10m.push(270); h.wind_gusts_10m.push(wind + 10); h.weather_code.push(rain > 50 ? 63 : 1);
  }
  return { hourly: { time, ...h }, daily: { time: dates, sunrise: dates.map((d) => `${d}T07:20`), sunset: dates.map((d) => `${d}T18:40`) } };
}
const DATES = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const nice = async () => forecastOn(DATES);
const stormy = async () => forecastOn(DATES, { temp: 1, rain: 90, wind: 45 });

const config = {
  tz: 'Europe/Berlin', mid: { lat: 48.1, lon: 11.6 }, bearing: 90, distanceKm: 10, avgSpeed: 22,
  departHin: '07:30', departRueck: '17:00', notifyAt: '06:30', workdays: [1, 2, 3, 4, 5],
  rules: { minTemp: 3, maxTemp: 32, maxRainProb: 40, maxPrecip: 0.5, maxWind: 30, maxGust: 50 },
};

async function setup() {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const pushes = [];
  let pushStatus = 201;
  const env = {
    SUBS: new FakeKV(), API_TOKEN: 'geheimes-token', ALLOWED_ORIGINS: 'https://ono3589.github.io', VAPID_SUBJECT: 'https://example.org/',
    VAPID_PUBLIC: b64u.encode(await crypto.subtle.exportKey('raw', vapid.publicKey)), VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', vapid.privateKey)),
    fetchImpl: async (url, init) => { pushes.push({ url, init }); return new Response(null, { status: pushStatus }); },
  };
  const subscription = { endpoint: 'https://web.push.example/abc123', keys: { p256dh: b64u.encode(uaPub), auth: b64u.encode(auth) } };
  const post = (path, body, token = env.API_TOKEN, origin = 'https://ono3589.github.io', now, forecast) =>
    handleRequest(new Request(`https://w.example${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin }, body: JSON.stringify(body) }), env, now, forecast);
  const decryptLast = async () => {
    const msg = pushes.at(-1).init.body;
    const salt = msg.slice(0, 16), asPub = msg.slice(21, 21 + msg[20]), ct = msg.slice(21 + msg[20]);
    const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, ua.privateKey, 256));
    const te = new TextEncoder();
    const ikm = await hk(auth, ecdh, Uint8Array.from([...te.encode('WebPush: info\0'), ...uaPub, ...asPub]), 32);
    const key = await crypto.subtle.importKey('raw', await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12) }, key, ct));
    return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
  };
  return { env, subscription, pushes, post, decryptLast, setStatus: (s) => (pushStatus = s) };
}

test('Anmelden braucht das Token und gültige Angaben', async () => {
  const { env, subscription, post } = await setup();
  assert.equal((await post('/subscribe', { subscription, config }, 'falsch')).status, 401);
  assert.equal((await post('/subscribe', { subscription, config: { ...config, notifyAt: '6:30' } })).status, 400);
  assert.equal((await post('/subscribe', { subscription: { endpoint: 'http://unsicher', keys: {} }, config })).status, 400);
  assert.equal((await post('/subscribe', { subscription, config })).status, 200);
  assert.equal((await env.SUBS.list({ prefix: 'sub:' })).keys.length, 1);
  assert.equal(validConfig({ ...config, tz: 'Mars/Olympus' }), false);
});

test('CORS: nur die eigene Webseite darf zugreifen', async () => {
  const { subscription, post } = await setup();
  const ok = await post('/subscribe', { subscription, config });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://ono3589.github.io');
  const fremd = await post('/subscribe', { subscription, config }, undefined, 'https://boese.example');
  assert.equal(fremd.headers.get('Access-Control-Allow-Origin'), null);
});

test('Vor der Wunschzeit passiert nichts, danach genau eine Meldung pro Tag', async () => {
  const { env, subscription, pushes, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config });
  const t = (iso) => new Date(iso); // 06:30 Ortszeit = 04:30 UTC (Sommerzeit)
  assert.deepEqual(await runSchedule(env, t('2026-10-15T04:15:00Z'), nice), []); // 06:15
  const first = await runSchedule(env, t('2026-10-15T04:30:00Z'), nice);
  assert.equal(first[0].sent, true);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, subscription.endpoint);
  const msg = await decryptLast();
  assert.ok(TITLES.go.includes(msg.title), msg.title);
  assert.match(msg.body, /Trocken/);
  assert.equal(msg.url, './#heute');
  assert.deepEqual(await runSchedule(env, t('2026-10-15T04:45:00Z'), nice), []); // gleicher Tag
  assert.equal(pushes.length, 1);
  assert.equal((await runSchedule(env, t('2026-10-16T04:30:00Z'), nice))[0].sent, true); // nächster Tag
  assert.equal(pushes.length, 2);
});

test('Schlechtes Wetter: Auto-Empfehlung', async () => {
  const { env, subscription, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config });
  await runSchedule(env, new Date('2026-10-15T04:30:00Z'), stormy);
  const msg = await decryptLast();
  assert.ok(TITLES.no.includes(msg.title), msg.title);
});

test('Wochenende und zu späte Läufe werden übersprungen', async () => {
  const { env, subscription, post, pushes } = await setup();
  await post('/subscribe', { subscription, config });
  assert.deepEqual(await runSchedule(env, new Date('2026-10-17T04:30:00Z'), nice), []); // Samstag
  assert.deepEqual(await runSchedule(env, new Date('2026-10-15T08:00:00Z'), nice), []); // 10:00, mehr als 3 h nach 06:30
  assert.equal(pushes.length, 0);
});

test('Abgemeldetes Gerät (410) wird gelöscht, Serverfehler wird später wiederholt', async () => {
  const { env, subscription, post, setStatus, pushes } = await setup();
  await post('/subscribe', { subscription, config });
  setStatus(503);
  const r1 = await runSchedule(env, new Date('2026-10-15T04:30:00Z'), nice);
  assert.equal(r1[0].sent, false);
  assert.equal((await env.SUBS.list({ prefix: 'sub:' })).keys.length, 1);
  setStatus(201);
  assert.equal((await runSchedule(env, new Date('2026-10-15T04:45:00Z'), nice))[0].sent, true); // zweiter Versuch gelingt
  assert.equal(pushes.length, 2);
  setStatus(410);
  await runSchedule(env, new Date('2026-10-16T04:30:00Z'), nice);
  assert.equal((await env.SUBS.list({ prefix: 'sub:' })).keys.length, 0);
});

test('Test-Knopf sendet sofort die echte Meldung', async () => {
  const { subscription, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config });
  const res = await post('/test', { endpoint: subscription.endpoint }, undefined, undefined, new Date('2026-10-15T10:00:00Z'), nice);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(TITLES.go.includes(body.title));
  assert.equal((await decryptLast()).title, body.title);
  const unknown = await post('/test', { endpoint: 'https://web.push.example/anders' }, undefined, undefined, new Date(), nice);
  assert.equal(unknown.status, 404);
});

test('Abmelden löscht alles', async () => {
  const { env, subscription, post } = await setup();
  await post('/subscribe', { subscription, config });
  await post('/unsubscribe', { endpoint: subscription.endpoint });
  assert.equal((await env.SUBS.list({ prefix: 'sub:' })).keys.length, 0);
});

test('Ortszeit folgt Zeitzone und Sommerzeit', () => {
  assert.deepEqual(localParts(new Date('2026-10-15T04:40:00Z'), 'Europe/Berlin'), { date: '2026-10-15', minutes: 6 * 60 + 40, dow: 4 });
  assert.deepEqual(localParts(new Date('2026-12-15T05:40:00Z'), 'Europe/Berlin'), { date: '2026-12-15', minutes: 6 * 60 + 40, dow: 2 });
  assert.equal(localParts(new Date('2026-10-15T23:30:00Z'), 'Europe/Berlin').date, '2026-10-16');
});

test('buildMessage nutzt den Fahrtkurs: Rückenwind auf dem Hinweg', async () => {
  const m = await buildMessage(config, new Date('2026-10-15T04:30:00Z'), nice);
  assert.equal(m.status, 'go');
  assert.match(m.body, /Rückenwind/);
});

// ---------- Abendfrage ----------

const evening = { ...config, eveningOn: true, eveningAt: '18:30' };
const EVENING_NOW = new Date('2026-10-15T16:30:00Z'); // 18:30 Ortszeit

test('Abends kommt die Frage mit eigenem Ziel, einmal pro Tag', async () => {
  const { env, subscription, pushes, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config: evening });
  assert.deepEqual(await runSchedule(env, new Date('2026-10-15T16:15:00Z'), nice), []); // 18:15, noch zu früh
  const r = await runSchedule(env, EVENING_NOW, nice);
  assert.deepEqual(r.map((x) => [x.kind, x.sent]), [['abend', true]]);
  const msg = await decryptLast();
  assert.equal(msg.tag, 'abend');
  assert.equal(msg.url, './#frage');
  assert.ok(EVENING.go.some((e) => e.title === msg.title && e.body === msg.body), msg.title);
  assert.deepEqual(await runSchedule(env, new Date('2026-10-15T16:45:00Z'), nice), []); // gleicher Tag
  assert.equal(pushes.length, 1);
  assert.equal((await runSchedule(env, new Date('2026-10-16T16:30:00Z'), nice))[0].kind, 'abend'); // nächster Tag
});

test('Morgens und abends sind unabhängig voneinander', async () => {
  const { env, subscription, pushes, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config: evening });
  assert.deepEqual((await runSchedule(env, new Date('2026-10-15T04:30:00Z'), nice)).map((x) => x.kind), ['morgen']);
  assert.equal((await decryptLast()).tag, 'morgen');
  assert.deepEqual((await runSchedule(env, EVENING_NOW, nice)).map((x) => x.kind), ['abend']);
  assert.equal(pushes.length, 2);
});

test('Der Text der Abendfrage passt zum Wetter', async () => {
  const { env, subscription, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config: evening });
  await runSchedule(env, EVENING_NOW, stormy);
  const msg = await decryptLast();
  assert.ok(EVENING.no.some((e) => e.title === msg.title), msg.title);
});

test('Ist der Tag erledigt, entfällt die Frage; „nicht erledigt“ stellt sie wieder her', async () => {
  const { env, subscription, pushes, post } = await setup();
  await post('/subscribe', { subscription, config: evening });
  assert.equal((await post('/logged', { endpoint: subscription.endpoint, date: '2026-10-15', complete: true })).status, 200);
  assert.deepEqual(await runSchedule(env, EVENING_NOW, nice), []);
  assert.equal(pushes.length, 0);
  await post('/logged', { endpoint: subscription.endpoint, date: '2026-10-15', complete: false }); // Fahrt wieder gelöscht
  assert.equal((await runSchedule(env, EVENING_NOW, nice))[0].sent, true);
  // Erledigt für einen anderen Tag zählt nicht
  const other = await setup();
  await other.post('/subscribe', { subscription: other.subscription, config: evening });
  await other.post('/logged', { endpoint: other.subscription.endpoint, date: '2026-10-14', complete: true });
  assert.equal((await runSchedule(other.env, EVENING_NOW, nice))[0].sent, true);
});

test('Das Anmelden behält den Stand von heute', async () => {
  const { env, subscription, pushes, post } = await setup();
  await post('/subscribe', { subscription, config: evening });
  await post('/logged', { endpoint: subscription.endpoint, date: '2026-10-15', complete: true });
  await post('/subscribe', { subscription, config: { ...evening, eveningAt: '19:00' } }); // Einstellungen geändert
  assert.deepEqual(await runSchedule(env, new Date('2026-10-15T17:00:00Z'), nice), []);
  assert.equal(pushes.length, 0);
});

test('Ohne Abendfrage in den Einstellungen oder ohne die Angabe kommt abends nichts', async () => {
  const off = await setup();
  await off.post('/subscribe', { subscription: off.subscription, config: { ...evening, eveningOn: false } });
  assert.deepEqual(await runSchedule(off.env, EVENING_NOW, nice), []);
  const legacy = await setup();
  await legacy.post('/subscribe', { subscription: legacy.subscription, config }); // alte Konfiguration ohne Abendfelder
  assert.deepEqual(await runSchedule(legacy.env, EVENING_NOW, nice), []);
});

test('Am Wochenende fragt der Dienst nicht', async () => {
  const { env, subscription, post } = await setup();
  await post('/subscribe', { subscription, config: evening });
  assert.deepEqual(await runSchedule(env, new Date('2026-10-17T16:30:00Z'), nice), []); // Samstag
});

test('Test-Knopf kann auch die Abendfrage senden; ungültige Angaben werden abgelehnt', async () => {
  const { subscription, post, decryptLast } = await setup();
  await post('/subscribe', { subscription, config: evening });
  const res = await post('/test', { endpoint: subscription.endpoint, kind: 'abend' }, undefined, undefined, EVENING_NOW, nice);
  const body = await res.json();
  assert.equal(body.kind, 'abend');
  assert.equal((await decryptLast()).tag, 'abend');
  assert.equal((await post('/logged', { endpoint: subscription.endpoint, date: 'gestern', complete: true })).status, 400);
  assert.equal((await post('/subscribe', { subscription, config: { ...evening, eveningAt: '25:00' } })).status, 400);
  assert.equal((await post('/subscribe', { subscription, config: { ...evening, eveningOn: 'ja' } })).status, 400);
});

// ---------- Eingang für Fahrten (Bosch-Abfrage → Dienst → App) ----------

const getInbox = async (env, token = env.API_TOKEN, origin = 'https://ono3589.github.io') =>
  handleRequest(new Request('https://w.example/inbox', { headers: { Authorization: `Bearer ${token}`, Origin: origin } }), env, new Date('2026-10-15T20:00:00Z'));

const RIDES = '2026-10-15;07:31;10.40;27;186;08:00\n2026-10-15;17:05;10.20;26;181;17:31';
let seq = 0;
const fillInbox = (env, text) => env.SUBS.put(`inbox:${Date.now()}-${(seq += 1)}`, JSON.stringify({ text, received: '2026-10-15T20:00:00Z' }));

test('Die App holt Fahrten aus dem Eingang und bestätigt sie', async () => {
  const { env } = await setup();
  await fillInbox(env, RIDES);
  const inbox = await (await getInbox(env)).json();
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].text, RIDES);
  assert.match(inbox.items[0].id, /^[\w-]+$/);

  const ack = await handleRequest(new Request('https://w.example/inbox/ack', { method: 'POST', headers: { Authorization: `Bearer ${env.API_TOKEN}` }, body: JSON.stringify({ ids: [inbox.items[0].id] }) }), env);
  assert.deepEqual(await ack.json(), { ok: true, removed: 1 });
  assert.deepEqual((await (await getInbox(env)).json()).items, []);
});

test('Der Eingang ist nur mit Token und nur für die eigene Webseite lesbar, von außen kann niemand Fahrten abliefern', async () => {
  const { env } = await setup();
  assert.equal((await getInbox(env, 'falsch')).status, 401);
  assert.equal((await getInbox(env)).headers.get('Access-Control-Allow-Origin'), 'https://ono3589.github.io');
  assert.equal((await getInbox(env, undefined, 'https://boese.example')).headers.get('Access-Control-Allow-Origin'), null);
  // Die frühere Abliefer-Route gibt es nicht mehr
  for (const token of [env.API_TOKEN, 'egal']) {
    const r = await handleRequest(new Request('https://w.example/rides', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ text: RIDES }) }), env, new Date('2026-10-15T20:00:00Z'));
    assert.notEqual(r.status, 200);
  }
  assert.deepEqual((await (await getInbox(env)).json()).items, []);
});

test('Nicht bestätigte Fahrten bleiben liegen, Löschen kennt nur gültige Kennungen', async () => {
  const { env } = await setup();
  await fillInbox(env, RIDES);
  await fillInbox(env, '2026-10-16;07:30;10.30;27;180;');
  const items = (await (await getInbox(env)).json()).items;
  assert.equal(items.length, 2);
  const ack = await handleRequest(new Request('https://w.example/inbox/ack', { method: 'POST', headers: { Authorization: `Bearer ${env.API_TOKEN}` }, body: JSON.stringify({ ids: [items[0].id, '../sub:alles', 42] }) }), env);
  assert.equal((await ack.json()).removed, 1); // ungültige Kennungen werden ignoriert
  assert.equal((await (await getInbox(env)).json()).items.length, 1);
});
