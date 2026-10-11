// Fahrten aus Apple Health: Ein iOS-Kurzbefehl legt Zeilen in die Zwischenablage, die App liest sie hier ein.
// Eine Fahrt pro Zeile:   datum;start;km;minuten;kcal
// Beispiel:               2026-10-12;07:31;10,4;27;186
// Start, Minuten und Kalorien dürfen leer sein. Ohne Startzeit gilt die Zeile als Tagessumme
// (fast doppelte Pendelstrecke wird auf Hin- und Rückweg verteilt).

const MAX_KM = 300;

function num(v) {
  const t = String(v ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function parseDate(s) {
  s = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const g = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (g) m = [g[0], g[3], g[2].padStart(2, '0'), g[1].padStart(2, '0')];
  }
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  const ok = d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3];
  return ok ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = +m[1];
  return h < 24 && +m[2] < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

const round1 = (n) => Math.round(n * 10) / 10;

// text: Inhalt der Zwischenablage. distanceKm: deine Strecke pro Weg. today: 'YYYY-MM-DD' (nur für den Zukunftscheck).
export function parseHealthText(text, { distanceKm = 0, today = new Date().toISOString().slice(0, 10) } = {}) {
  const items = [];
  const ignored = [];
  const seen = new Set();
  const perDay = new Map(); // für Zeilen ohne Startzeit: erste = Hinweg, weitere = Rückweg
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 1);
  const latest = limit.toISOString().slice(0, 10);

  const lines = String(text ?? '').split(/\r?\n/).slice(0, 500);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^rw[;:\s]/i.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);

    const f = line.split(';');
    const date = parseDate(f[0]);
    const start = parseTime(f[1]);
    const km = num(f[2]);
    const minutes = num(f[3]);
    const kcal = num(f[4]);
    if (!date) { ignored.push({ line, reason: 'Datum nicht lesbar' }); continue; }
    if (date > latest) { ignored.push({ line, reason: 'liegt in der Zukunft' }); continue; }
    if (km === null || Number.isNaN(km) || km < 0.3 || km > MAX_KM) { ignored.push({ line, reason: 'Strecke fehlt oder unplausibel' }); continue; }
    if (Number.isNaN(minutes) || (minutes !== null && (minutes < 1 || minutes > 720))) { ignored.push({ line, reason: 'Dauer unplausibel' }); continue; }
    if (Number.isNaN(kcal) || (kcal !== null && (kcal < 0 || kcal > 6000))) { ignored.push({ line, reason: 'Kalorien unplausibel' }); continue; }

    const split = start === null && distanceKm > 0 && km >= distanceKm * 1.65 && km <= distanceKm * 2.35;
    const parts = split ? [['hin', 'Tagessumme, geteilt'], ['rueck', 'Tagessumme, geteilt']] : [[null, '']];
    for (const [forced, note] of parts) {
      const share = split ? 2 : 1;
      let direction = forced;
      if (!direction) {
        if (start) direction = Number(start.slice(0, 2)) < 12 ? 'hin' : 'rueck';
        else {
          const n = perDay.get(date) ?? 0;
          direction = n === 0 ? 'hin' : 'rueck';
          perDay.set(date, n + 1);
        }
      }
      const k = round1(km / share);
      items.push({
        date,
        start,
        km: k,
        minutes: minutes === null ? null : Math.max(1, Math.round(minutes / share)),
        kcal: kcal === null ? null : Math.round(kcal / share),
        direction,
        note,
        fits: distanceKm <= 0 || (k >= distanceKm * 0.65 && k <= distanceKm * 1.35),
        ref: `${date}|${start ?? '-'}|${k}|${direction}`,
      });
    }
  }
  items.sort((a, b) => (a.date === b.date ? (a.direction === 'hin' ? -1 : 1) : a.date < b.date ? -1 : 1));
  return { items, ignored };
}
