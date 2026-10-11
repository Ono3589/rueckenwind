// Sperrbildschirm mit Zahlenfeld. Fragt eine PIN ab und gibt sie zurück, sobald alle Stellen eingegeben sind.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6 6-6zM12.5 10l4 4M16.5 10l-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const root = () => document.getElementById('lock');

export function hideLock() {
  const r = root();
  r.hidden = true;
  r.innerHTML = '';
  document.documentElement.classList.remove('has-lock');
}

// links: zusätzliche Textknöpfe unter dem Zahlenfeld, z. B. „PIN vergessen“. Sie liefern ihren `value` zurück.
// Gibt die PIN zurück, `null` beim Abbrechen oder den `value` eines Links.
export function askPin({ title, hint = '', len = 6, error = '', cancelable = false, links = [], logo = true }) {
  return new Promise((resolve) => {
    const r = root();
    let value = '';
    let finished = false;
    r.hidden = false;
    document.documentElement.classList.add('has-lock');
    r.innerHTML = `
    <div class="lock-inner" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      ${logo ? '<img class="lock-logo" src="icons/icon-192.png" alt="" width="64" height="64">' : ''}
      <h1 id="lock-title">${esc(title)}</h1>
      <p class="lock-hint">${esc(hint)}</p>
      <div class="lock-dots${error ? ' shake' : ''}" aria-hidden="true">${'<i></i>'.repeat(len)}</div>
      <p class="lock-count" aria-live="polite"></p>
      <p class="lock-error" role="alert">${esc(error)}</p>
      <div class="lock-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        ${cancelable ? '<button type="button" class="ghost" data-k="cancel">Abbrechen</button>' : '<span></span>'}
        <button type="button" data-k="0">0</button>
        <button type="button" class="ghost" data-k="back" aria-label="Letzte Ziffer löschen">${BACK}</button>
      </div>
      <div class="lock-links">${links.map((l) => `<button type="button" class="linkbtn" data-link="${esc(l.value)}">${esc(l.label)}</button>`).join('')}</div>
    </div>`;

    const dots = r.querySelectorAll('.lock-dots i');
    const count = r.querySelector('.lock-count');
    const paint = () => {
      dots.forEach((d, i) => d.classList.toggle('on', i < value.length));
      count.textContent = value.length ? `${value.length} von ${len} Ziffern` : '';
    };
    const done = (v) => {
      if (finished) return;
      finished = true;
      r.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const press = (k) => {
      if (finished) return;
      if (k === 'back') value = value.slice(0, -1);
      else if (/^\d$/.test(k) && value.length < len) value += k;
      else return;
      paint();
      if (value.length === len) setTimeout(() => done(value), 140); // kurz die letzte Stelle zeigen
    };
    const onClick = (e) => {
      const link = e.target.closest('[data-link]');
      if (link) return done(link.dataset.link);
      const key = e.target.closest('[data-k]')?.dataset.k;
      if (key === 'cancel') return done(null);
      if (key) press(key);
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Escape' && cancelable) done(null);
    };
    r.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    r.querySelector('[data-k="5"]')?.focus({ preventScroll: true });
  });
}

// Meldung ohne Zahlenfeld, etwa während einer Wartezeit nach zu vielen Fehlversuchen
export function showMessage({ title, text }) {
  const r = root();
  r.hidden = false;
  document.documentElement.classList.add('has-lock');
  r.innerHTML = `<div class="lock-inner" role="dialog" aria-modal="true" aria-labelledby="lock-title">
    <img class="lock-logo" src="icons/icon-192.png" alt="" width="64" height="64">
    <h1 id="lock-title">${esc(title)}</h1><p class="lock-hint">${esc(text)}</p></div>`;
}
