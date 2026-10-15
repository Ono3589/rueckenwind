// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { b64u, encryptPayload, vapidAuthorization, sendPush } from '../worker/src/webpush.js';

// Testwerte aus RFC 8291, Anhang A
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

async function ecKeysFromRaw(privateB64, publicB64) {
  const pub = b64u.decode(publicB64);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)) };
  const privateKey = await crypto.subtle.importKey('jwk', { ...jwk, d: privateB64 }, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey };
}

// Entschlüsselung wie im Browser, nur für den Test
async function decrypt(message, uaPrivateKey, uaPublic, authSecret) {
  const salt = message.slice(0, 16);
  const idLen = message[20];
  const asPublic = message.slice(21, 21 + idLen);
  const ct = message.slice(21 + idLen);
  const hkdf = async (s, ikm, info, n) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivateKey, 256));
  const te = new TextEncoder();
  const join = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
  const ikm = await hkdf(authSecret, ecdh, join(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(padded.at(-1), 2); // Endmarker des einzigen Blocks
  return new TextDecoder().decode(padded.slice(0, -1));
}

test('RFC 8291: Verschlüsselung liefert exakt die Werte aus dem Standard', async () => {
  const asKeys = await ecKeysFromRaw(RFC.asPrivate, RFC.asPublic);
  const out = await encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { asKeys, salt: b64u.decode(RFC.salt) });
  assert.equal(b64u.encode(out.slice(0, 86)), RFC.header);
  assert.equal(b64u.encode(out.slice(86)), RFC.ciphertext);
});

test('Der Empfänger kann eine zufällig verschlüsselte Nachricht lesen', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const msg = JSON.stringify({ title: 'Jetzt losfahren!', body: 'Trocken, 12 °C, Rückenwind.' });
  const out = await encryptPayload(msg, { p256dh: b64u.encode(uaPublic), auth: b64u.encode(auth) });
  assert.equal(await decrypt(out, ua.privateKey, uaPublic, auth), msg);
  // Zweiter Versand hat anderes Salz und anderen Schlüssel
  const again = await encryptPayload(msg, { p256dh: b64u.encode(uaPublic), auth: b64u.encode(auth) });
  assert.notEqual(b64u.encode(out), b64u.encode(again));
});

test('Ungültige Empfängerschlüssel werden abgelehnt', async () => {
  await assert.rejects(encryptPayload('x', { p256dh: 'AAAA', auth: 'AAAAAAAAAAAAAAAAAAAAAA' }));
});

async function vapidPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { pair, publicKey: b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

test('VAPID: gültig signiertes Token mit richtigem Empfänger und Ablauf', async () => {
  const { pair, publicKey, privateJwk } = await vapidPair();
  const now = Date.UTC(2026, 9, 15, 4, 30);
  const header = await vapidAuthorization('https://web.push.apple.com/abc/def', { subject: 'https://example.org/', publicKey, privateJwk }, now);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], publicKey);
  const claims = JSON.parse(new TextDecoder().decode(b64u.decode(m[2])));
  assert.deepEqual(claims, { aud: 'https://web.push.apple.com', exp: Math.floor(now / 1000) + 43200, sub: 'https://example.org/' });
  assert.ok(claims.exp - Math.floor(now / 1000) <= 24 * 3600); // Apple lehnt längere Laufzeiten ab
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64u.decode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(ok, true);
});

test('sendPush schickt verschlüsselt mit den richtigen Kopfzeilen', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const { publicKey, privateJwk } = await vapidPair();
  let seen;
  const res = await sendPush(
    { endpoint: 'https://web.push.apple.com/xyz', keys: { p256dh: b64u.encode(uaPublic), auth: b64u.encode(auth) } },
    { title: 'Nimm lieber das Auto', body: 'Regen' },
    { subject: 'https://example.org/', publicKey, privateJwk },
    { fetchImpl: async (url, init) => ((seen = { url, init }), new Response(null, { status: 201 })) },
  );
  assert.equal(res.status, 201);
  assert.equal(seen.url, 'https://web.push.apple.com/xyz');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, String(6 * 3600));
  assert.match(seen.init.headers.Authorization, /^vapid t=.+, k=.+$/);
  assert.deepEqual(JSON.parse(await decrypt(seen.init.body, ua.privateKey, uaPublic, auth)), { title: 'Nimm lieber das Auto', body: 'Regen' });
});
