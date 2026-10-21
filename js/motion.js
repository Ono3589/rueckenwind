// Bewegung als Material: Zahlen rollen hoch, Diagramme zeichnen sich beim Sichtbarwerden, Wischen zeigt Werte,
// Tabs gleiten, der Startbildschirm läuft einmal ab. Alles respektiert „Bewegung reduzieren“.

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

// ---------- Zahlen, die hochrollen ----------

export function formatCount(value, { dec = 0, cur = false } = {}) {
  const opts = cur ? { style: 'currency', currency: 'EUR' } : { minimumFractionDigits: dec, maximumFractionDigits: dec };
  return new Intl.NumberFormat('de-DE', opts).format(value);
}

function countUp(el, duration = 1300) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || el.dataset.counted) return; // nur einmal, sonst würde ein Zwischenstand zum Endwert
  el.dataset.counted = '1';
  const final = el.textContent; // der Endwert steht schon im Text, auch ohne JavaScript und für Vorlesehilfen
  const opts = { dec: Number(el.dataset.dec ?? 0), cur: 'cur' in el.dataset };
  if (reducedMotion() || target === 0 || document.hidden) return;
  const start = performance.now();
  let done = false;
  const step = (now) => {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    el.textContent = t >= 1 ? final : formatCount(target * easeOutExpo(t), opts);
    if (t < 1) requestAnimationFrame(step);
    else done = true;
  };
  el.textContent = formatCount(0, opts);
  requestAnimationFrame(step);
  // Läuft kein Bild mehr (App im Hintergrund), steht trotzdem der richtige Wert da
  setTimeout(() => {
    if (!done) el.textContent = final;
    done = true;
  }, duration + 250);
}

// ---------- Sichtbar werden ----------

let observer = null;

// Alles mit [data-reveal], .chart und [data-count] bekommt die Klasse .in, sobald es zu mindestens einem Teil im Bild ist
export function reveal(root = document) {
  observer?.disconnect();
  const items = [...root.querySelectorAll('[data-reveal], .chart, [data-count]')].filter((el) => !el.classList.contains('in'));
  const show = (el) => {
    el.classList.add('in');
    if (el.matches('[data-count]')) countUp(el);
    el.querySelectorAll?.('[data-count]').forEach((c) => {
      c.classList.add('in');
      countUp(c);
    });
  };
  if (reducedMotion() || !('IntersectionObserver' in globalThis)) {
    items.forEach(show);
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        show(e.target);
        observer.unobserve(e.target);
      }
    },
    { threshold: 0.18, rootMargin: '0px 0px -6% 0px' },
  );
  items.forEach((el) => observer.observe(el));
}

// ---------- Wischen über ein Diagramm ----------

export function scrub(root = document) {
  root.querySelectorAll('.chart[data-scrub]').forEach((chart) => {
    if (chart.dataset.bound) return;
    chart.dataset.bound = '1';
    let series;
    try {
      series = JSON.parse(chart.dataset.scrub);
    } catch {
      return;
    }
    const svg = chart.querySelector('svg');
    const tip = chart.querySelector('.tip');
    const guide = svg.querySelector('.guide');
    if (!series.length || !tip || !guide) return;
    const vw = Number(chart.dataset.vw) || 360;
    const line = guide.querySelector('line');
    const dot = guide.querySelector('circle');
    let hideTimer;

    const show = (clientX) => {
      const box = svg.getBoundingClientRect();
      const x = ((clientX - box.left) / box.width) * vw;
      const p = series.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best), series[0]);
      line.setAttribute('x1', p.x);
      line.setAttribute('x2', p.x);
      if (dot) {
        dot.setAttribute('cx', p.x);
        if (p.y != null) {
          dot.setAttribute('cy', p.y);
          dot.removeAttribute('hidden');
        } else dot.setAttribute('hidden', '');
      }
      guide.removeAttribute('hidden');
      tip.innerHTML = `<strong>${p.title}</strong>${p.lines.map((l) => `<span>${l}</span>`).join('')}`;
      tip.removeAttribute('hidden');
      const frac = p.x / vw;
      tip.style.left = `${frac * 100}%`;
      tip.style.transform = `translateX(${frac > 0.68 ? '-100%' : frac < 0.32 ? '0' : '-50%'})`;
      chart.classList.add('scrubbing');
      clearTimeout(hideTimer);
    };
    const hide = (delay = 0) => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        guide.setAttribute('hidden', '');
        tip.setAttribute('hidden', '');
        chart.classList.remove('scrubbing');
      }, delay);
    };
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointermove', (e) => (e.pressure > 0 || e.pointerType === 'mouse') && show(e.clientX));
    svg.addEventListener('pointerup', (e) => hide(e.pointerType === 'mouse' ? 0 : 1800));
    svg.addEventListener('pointerleave', () => hide(250));
    svg.addEventListener('pointercancel', () => hide(0));
  });
}

// ---------- Wechsel zwischen den Tabs ----------

export function slide(update, direction) {
  if (reducedMotion() || !document.startViewTransition) return update();
  document.documentElement.dataset.slide = direction >= 0 ? 'fwd' : 'back';
  const t = document.startViewTransition(update);
  t.finished.finally(() => delete document.documentElement.dataset.slide);
}

// ---------- Startbildschirm ----------

// Läuft einmal pro Kaltstart: kurz warten, bis die Schrift da ist, mindestens minMs zeigen, Tippen überspringt.
// onLeave läuft, sobald er auszublenden beginnt: die App baut sich dann schon darunter auf.
export function runSplash({ minMs = 2200, skipAfterMs = 700, onLeave } = {}) {
  const el = document.getElementById('splash');
  if (!el) {
    document.documentElement.classList.remove('has-splash');
    onLeave?.();
    return Promise.resolve();
  }
  const reduced = reducedMotion();
  const min = reduced ? 700 : minMs;
  return new Promise((resolve) => {
    const t0 = performance.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.classList.add('out');
      document.documentElement.classList.remove('has-splash');
      onLeave?.();
      setTimeout(() => {
        el.remove();
        resolve();
      }, reduced ? 120 : 800);
    };
    const fonts = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
    const wait = new Promise((r) => setTimeout(r, min));
    Promise.all([fonts, wait]).then(finish);
    el.addEventListener('pointerdown', () => performance.now() - t0 > skipAfterMs && finish());
  });
}
