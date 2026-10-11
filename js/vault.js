// App-Sperre: Alle Daten werden mit einem zufälligen Schlüssel (AES-256-GCM) verschlüsselt. Dieser Schlüssel wird
// mit einem Schlüssel aus deiner PIN (PBKDF2-SHA-256) verpackt. Ohne die PIN sind Fahrten, Adressen und
// Strava-Zugangsdaten im Browserspeicher nur Zufallsdaten. Die PIN selbst wird nirgends gespeichert.
//
// Grenzen: Eine PIN hat nur wenige Kombinationen. Wer die verschlüsselte Datei kopiert, kann sie offline durchprobieren,
// auch wenn PBKDF2 das bremst. Längere PINs helfen deutlich.

const LOCK_KEY = 'rueckenwind.lock.v1';
const ITER = 600000; // OWASP-Empfehlung für PBKDF2-SHA-256
const MIN_ITER = 100000;
const MAX_ITER = 3000000; // schützt vor präparierten Importdateien, die den Browser lahmlegen

const te = new TextEncoder();
const td = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

const toB64 = (buf) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKek(pin, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function wrapDek(dek, kek) {
  const iv = rand(12);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { wrapIv: toB64(iv), wrapped: toB64(wrapped) };
}

function unwrapDek(rec, kek, extractable = false) {
  return crypto.subtle.unwrapKey('raw', fromB64(rec.wrapped), kek, { name: 'AES-GCM', iv: fromB64(rec.wrapIv) }, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

async function encryptJson(dek, json) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, te.encode(json));
  return { iv: toB64(iv), data: toB64(ct) };
}

async function decryptJson(dek, rec) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, dek, fromB64(rec.data));
  return td.decode(pt);
}

function validRecord(rec) {
  return (
    rec &&
    rec.v === 1 &&
    ['salt', 'wrapIv', 'wrapped', 'iv', 'data'].every((k) => typeof rec[k] === 'string' && rec[k].length > 0) &&
    Number.isInteger(rec.iter) &&
    rec.iter >= MIN_ITER &&
    rec.iter <= MAX_ITER &&
    Number.isInteger(rec.len) &&
    rec.len >= 4 &&
    rec.len <= 16
  );
}

function readRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    return validRecord(rec) ? rec : null;
  } catch {
    return null;
  }
}

export const hasVault = () => localStorage.getItem(LOCK_KEY) !== null;
export const vaultMeta = () => {
  const rec = readRecord();
  return rec ? { len: rec.len } : null;
};
export const removeVault = () => localStorage.removeItem(LOCK_KEY);

// Eine Sitzung gibt es nur, solange die App entsperrt ist. Gespeichert wird immer in der richtigen Reihenfolge.
function makeSession(record, dek) {
  let rec = record;
  let chain = Promise.resolve();
  const commit = () => localStorage.setItem(LOCK_KEY, JSON.stringify(rec));
  return {
    get len() {
      return rec.len;
    },
    save(state) {
      const json = JSON.stringify(state); // sofort festhalten, bevor sich der Zustand weiter ändert
      chain = chain
        .then(async () => {
          rec = { ...rec, ...(await encryptJson(dek, json)) };
          commit();
        })
        .catch(() => {});
      return chain;
    },
    flush: () => chain,
    async record() {
      await chain;
      return rec;
    },
    // PIN ändern: gleicher Datenschlüssel, nur neu verpackt. Die Daten selbst bleiben unverändert.
    async changePin(oldPin, newPin) {
      await chain;
      const dekFull = await unwrapDek(rec, await deriveKek(oldPin, fromB64(rec.salt), rec.iter), true);
      const salt = rand(16);
      const wrap = await wrapDek(dekFull, await deriveKek(newPin, salt, ITER));
      rec = { ...rec, iter: ITER, len: newPin.length, salt: toB64(salt), ...wrap };
      commit();
    },
  };
}

export async function verifyPin(pin) {
  const rec = readRecord();
  if (!rec) return false;
  try {
    await unwrapDek(rec, await deriveKek(pin, fromB64(rec.salt), rec.iter));
    return true;
  } catch {
    return false;
  }
}

export async function createVault(pin, state) {
  const salt = rand(16);
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrap = await wrapDek(dek, await deriveKek(pin, salt, ITER));
  const record = { v: 1, iter: ITER, len: pin.length, salt: toB64(salt), ...wrap, ...(await encryptJson(dek, JSON.stringify(state))) };
  localStorage.setItem(LOCK_KEY, JSON.stringify(record));
  return makeSession(record, dek);
}

// Wirft bei falscher PIN (oder beschädigten Daten)
export async function unlockVault(pin, record = readRecord()) {
  if (!validRecord(record)) throw new Error('Keine gültigen verschlüsselten Daten');
  const dek = await unwrapDek(record, await deriveKek(pin, fromB64(record.salt), record.iter));
  const state = JSON.parse(await decryptJson(dek, record));
  return { state, session: makeSession(record, dek) };
}

// Gesicherte, verschlüsselte Datei wiederherstellen. Sie wird erst gespeichert, wenn die PIN stimmt.
export async function importVault(json, pin) {
  const record = JSON.parse(json);
  const result = await unlockVault(pin, record);
  localStorage.setItem(LOCK_KEY, JSON.stringify(record));
  return result;
}

export const isVaultFile = (obj) => !!obj && typeof obj === 'object' && obj.v === 1 && typeof obj.wrapped === 'string';

// Zu simple PINs ablehnen (000000, 123456, 654321)
export function weakPin(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  return Math.abs(step) === 1 && d.every((v, i) => i === 0 || v - d[i - 1] === step);
}
