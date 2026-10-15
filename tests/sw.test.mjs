// node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadSw() {
  const listeners = {};
  const shown = [];
  const opened = [];
  const focused = [];
  const navigated = [];
  let windows = [];
  const self = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: { scope: 'https://ono3589.github.io/rueckenwind/', showNotification: async (title, opts) => shown.push({ title, opts }) },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => opened.push(url),
      claim: async () => {},
    },
    skipWaiting: () => {},
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), { self, caches: {}, fetch: async () => {}, location: { origin: 'https://ono3589.github.io' }, URL, Promise, Request: class {}, console });
  return { listeners, shown, opened, focused, navigated, setWindows: (w) => (windows = w) };
}

const event = (extra) => {
  const waits = [];
  return { waits, waitUntil: (p) => waits.push(p), ...extra };
};

test('Eine Push-Nachricht wird als sichtbare Meldung gezeigt', async () => {
  const sw = loadSw();
  const e = event({ data: { json: () => ({ title: 'Jetzt losfahren!', body: 'Trocken, 12 °C.', tag: 'morgen', url: './#heute' }) } });
  sw.listeners.push(e);
  await Promise.all(e.waits);
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, 'Jetzt losfahren!');
  assert.equal(sw.shown[0].opts.body, 'Trocken, 12 °C.');
  assert.equal(sw.shown[0].opts.tag, 'morgen');
  assert.equal(sw.shown[0].opts.data.url, './#heute');
});

test('Auch eine leere oder kaputte Nachricht zeigt eine Meldung (iOS verlangt das)', async () => {
  for (const data of [null, { json: () => { throw new Error('kein JSON'); }, text: () => 'Hallo' }]) {
    const sw = loadSw();
    const e = event({ data });
    sw.listeners.push(e);
    await Promise.all(e.waits);
    assert.equal(sw.shown.length, 1);
    assert.equal(sw.shown[0].title, 'Rückenwind');
  }
});

test('Tippen auf die Meldung öffnet die App bei „Heute“', async () => {
  const sw = loadSw();
  let closed = false;
  const e = event({ notification: { close: () => (closed = true), data: { url: './#heute' } } });
  sw.listeners.notificationclick(e);
  await Promise.all(e.waits);
  assert.equal(closed, true);
  assert.deepEqual(sw.opened, ['https://ono3589.github.io/rueckenwind/#heute']);
});

test('Ist die App schon offen, wird sie nach vorn geholt statt doppelt geöffnet', async () => {
  const sw = loadSw();
  const win = { url: 'https://ono3589.github.io/rueckenwind/#fahrten', focus: async () => sw.focused.push(1), navigate: async (u) => sw.navigated.push(u) };
  sw.setWindows([win]);
  const e = event({ notification: { close() {}, data: {} } });
  sw.listeners.notificationclick(e);
  await Promise.all(e.waits);
  assert.equal(sw.opened.length, 0);
  assert.deepEqual(sw.navigated, ['https://ono3589.github.io/rueckenwind/#heute']);
});
