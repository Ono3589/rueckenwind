// Web Push ohne Bibliothek: Verschlüsselung nach RFC 8291 (aes128gcm) und Absender-Ausweis nach RFC 8292 (VAPID).
// Läuft in Cloudflare Workers und in Node 20+ (nur WebCrypto, keine Abhängigkeiten).

const enc = new TextEncoder();

export const b64u = {
  encode(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// subscription.keys: { p256dh, auth } wie vom Browser geliefert. asKeys/salt nur für Tests mit festen Werten.
export async function encryptPayload(payload, keys, { asKeys, salt } = {}) {
  const bytes = typeof payload === 'string' ? enc.encode(payload) : payload;
  const uaPublic = b64u.decode(keys.p256dh);
  const authSecret = b64u.decode(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length < 16) throw new Error('Ungültige Push-Schlüssel');

  const ephemeral = asKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(bytes, new Uint8Array([2]))));
  const header = concat(s, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic); // Record-Größe 4096
  return concat(header, ciphertext);
}

// VAPID: Der Push-Dienst (z. B. Apple) erfährt so, wer sendet. publicKey: unkomprimierter Punkt, base64url.
export async function vapidAuthorization(endpoint, { subject, publicKey, privateJwk }, now = Date.now()) {
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject };
  const input = `${b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))}.${b64u.encode(enc.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)); // 64 Byte r||s, wie JWT es verlangt
  return `vapid t=${input}.${b64u.encode(sig)}, k=${publicKey}`;
}

export async function sendPush(subscription, payload, vapid, { ttl = 6 * 3600, urgency = 'normal', fetchImpl = fetch } = {}) {
  const body = await encryptPayload(JSON.stringify(payload), subscription.keys);
  return fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
}
