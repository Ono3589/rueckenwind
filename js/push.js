// Morgenmeldung: Die App meldet dein Gerät bei deinem eigenen kleinen Push-Dienst an (Cloudflare Worker, siehe worker/).
// Dorthin gehen nur: die Push-Adresse deines Geräts, der Mittelpunkt der Strecke (auf ca. 1 km gerundet),
// der Fahrtkurs, deine Zeiten und Wetter-Schwellen. Deine genauen Adressen verlassen das Gerät dafür nicht.

import { bearing } from './geo.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Alles, was der Dienst zur Bewertung braucht. null, solange Zuhause oder Arbeit fehlen.
export function buildNotifyConfig(state) {
  const { home, work } = state.route;
  if (!home || !work) return null;
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    mid: { lat: round2((home.lat + work.lat) / 2), lon: round2((home.lon + work.lon) / 2) },
    bearing: Math.round(bearing(home, work)),
    distanceKm: state.route.distanceKm,
    avgSpeed: state.route.avgSpeed,
    departHin: state.route.departHin,
    departRueck: state.route.departRueck,
    workdays: state.route.workdays,
    notifyAt: state.notify.time,
    eveningOn: state.notify.eveningOn !== false,
    eveningAt: state.notify.eveningAt || '18:30',
    rules: {
      minTemp: state.rules.minTemp,
      maxTemp: state.rules.maxTemp,
      maxRainProb: state.rules.maxRainProb,
      maxPrecip: state.rules.maxPrecip,
      maxWind: state.rules.maxWind,
      maxGust: state.rules.maxGust,
    },
  };
}

export function normalizeUrl(input) {
  try {
    const u = new URL(String(input).trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === 'localhost')) return null;
    return u.origin;
  } catch {
    return null;
  }
}

// Auf dem iPhone funktionieren Mitteilungen nur in der zum Home-Bildschirm hinzugefügten App (iOS 16.4 oder neuer)
export function pushSupport() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!window.isSecureContext) return { ok: false, reason: 'Mitteilungen brauchen eine sichere Verbindung (https).' };
  if (ios && !standalone) return { ok: false, reason: 'Füge die App zuerst zum Home-Bildschirm hinzu (Teilen → Zum Home-Bildschirm) und öffne sie von dort.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'Dieses Gerät oder dieser Browser unterstützt keine Mitteilungen von Webseiten (iOS 16.4 oder neuer nötig).' };
  return { ok: true };
}

async function call(base, token, path, body) {
  let res;
  try {
    res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Der Push-Dienst ist nicht erreichbar. Stimmt die Adresse?');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Das Token passt nicht zum Push-Dienst.');
  if (!res.ok) throw new Error(data.error || `Push-Dienst meldet Fehler ${res.status}`);
  return data;
}

const b64uToBytes = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// Muss direkt aus einem Tipp heraus aufgerufen werden, sonst verweigert iOS die Nachfrage
export async function enablePush({ url, token, config }) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Mitteilungen sind nicht erlaubt. Erlaube sie in den iOS-Einstellungen unter Mitteilungen → Rückenwind.');
  const { publicKey } = await call(url, null, '/vapid');
  if (!publicKey) throw new Error('Der Push-Dienst ist noch nicht fertig eingerichtet (Schlüssel fehlt).');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) }));
  await call(url, token, '/subscribe', { subscription: sub.toJSON(), config });
  return sub.endpoint;
}

export async function currentEndpoint() {
  const reg = await navigator.serviceWorker?.ready;
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

export async function syncPush({ url, token, config }) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Dieses Gerät ist nicht mehr für Mitteilungen angemeldet.');
  await call(url, token, '/subscribe', { subscription: sub.toJSON(), config });
}

export async function disablePush({ url, token }) {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  try {
    await call(url, token, '/unsubscribe', { endpoint: sub.endpoint });
  } catch {
    /* Dienst nicht erreichbar: lokal trotzdem abmelden */
  }
  await sub.unsubscribe();
}

export async function testPush({ url, token, kind = 'morgen' }) {
  const endpoint = await currentEndpoint();
  if (!endpoint) throw new Error('Dieses Gerät ist nicht angemeldet.');
  return call(url, token, '/test', { endpoint, kind });
}

// Meldet dem Dienst, ob der heutige Tag erledigt ist (Fahrten eingetragen oder beantwortet). Dann entfällt die Abendfrage.
export async function reportDay({ url, token, date, complete }) {
  const endpoint = await currentEndpoint();
  if (!endpoint) return;
  await call(url, token, '/logged', { endpoint, date, complete });
}

// Fahrten, die ein Kurzbefehl aus Apple Health an den Dienst geschickt hat
export async function fetchInbox({ url, token }) {
  return call(url, token, '/inbox');
}

export async function ackInbox({ url, token, ids }) {
  if (ids.length) await call(url, token, '/inbox/ack', { ids });
}
