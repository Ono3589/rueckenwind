// Fahrten aus Apple Health: Ein iOS-Kurzbefehl legt Zeilen in die Zwischenablage, die App liest sie hier ein.
// Eine Fahrt pro Zeile:   datum;start;km;minuten;kcal
// Beispiel:               2026-10-12;07:31;10,4;27;186
// Auch Rohwerte von iOS gehen:  12.10.2026, 07:31;;10,4 km;27 min;186 kcal   (die Startzeit darf im Datum stecken)
// Start, Minuten und Kalorien dürfen leer sein. Ohne Startzeit gilt die Zeile als Tagessumme
// (fast doppelte Pendelstrecke wird auf Hin- und Rückweg verteilt).

const MAX_KM = 300;

// Der Kurzbefehl darf die Rohwerte aus Apple Health übergeben. Die App versteht sie so, wie iOS sie ausgibt:
// Datum mit Uhrzeit („12.10.2026, 07:31“, „12. Okt. 2026 um 07:31“), Strecke („10,4 km“, „10400 m“),
// Dauer („27 min“, „00:27:03“, „1 Std. 5 Min.“), Energie („186 kcal“, „186 Cal“).

const MONTHS = { jan: 1, feb: 2, mär: 3, mae: 3, mrz: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

// Zahl mit Komma oder Punkt als Dezimaltrennzeichen. Bei gemischter Schreibweise („1.234,5“) zählt das letzte Zeichen.
function toNumber(raw, { thousandsDot = false } = {}) {
  let t = String(raw).trim();
  if (!/^[\d.,]+$/.test(t)) return NaN;
  if (t.includes('.') && t.includes(',')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (thousandsDot && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function parseKm(v) {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  const m = /^([\d.,]+)\s*(km|kilometer|meter|m|mi|miles?)?\.?$/i.exec(t);
  if (!m) return NaN;
  const unit = (m[2] ?? '').toLowerCase();
  const n = toNumber(m[1], { thousandsDot: unit === 'm' || unit === 'meter' });
  if (!Number.isFinite(n)) return NaN;
  if (unit === 'm' || unit === 'meter') return n / 1000;
  if (unit.startsWith('mi')) return n * 1.609344;
  if (unit === '' && n > MAX_KM) return n / 1000; // ohne Einheit und zu groß für Kilometer: wohl Meter
  return n;
}

function parseMinutes(v) {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (clock) {
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] === undefined ? null : Number(clock[3])];
    if (c !== null) return a * 60 + b + c / 60; // h:mm:ss
    return a <= 5 ? a * 60 + b : a + b / 60; // „1:05“ = 1 h 5 min, „27:03“ = 27 min 3 s
  }
  if (/^[\d.,]+$/.test(t)) return toNumber(t); // nackte Zahl = Minuten
  let total = 0;
  let found = false;
  for (const m of t.matchAll(/([\d.,]+)\s*(stunden?|std\.?|h|minuten?|min\.?|m|sekunden?|sek\.?|sec|s)(?![a-zäöü])/gi)) {
    const n = toNumber(m[1]);
    if (!Number.isFinite(n)) return NaN;
    const u = m[2].toLowerCase();
    total += u.startsWith('st') || u === 'h' ? n * 60 : u.startsWith('s') ? n / 60 : n;
    found = true;
  }
  return found ? total : NaN;
}

function parseKcal(v) {
  const t = String(v ?? '').trim();
  if (t === '') return null;
  const m = /^([\d.,]+)\s*(kcal|cal|kj)?\.?$/i.exec(t);
  if (!m) return NaN;
  const n = toNumber(m[1], { thousandsDot: true }); // „1.200 kcal“ = 1200
  return (m[2] ?? '').toLowerCase() === 'kj' ? n / 4.184 : n;
}

const pad2 = (n) => String(n).padStart(2, '0');
const validYmd = (y, mo, d) => {
  const x = new Date(Date.UTC(y, mo - 1, d, 12));
  return x.getUTCFullYear() === y && x.getUTCMonth() + 1 === mo && x.getUTCDate() === d ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
};
const hhmm = (h, mi) => (h === undefined || h === '' ? null : Number(h) < 24 && Number(mi) < 60 ? `${pad2(Number(h))}:${pad2(Number(mi))}` : null);

// Gibt { date, time } zurück (time kann fehlen) oder null
function parseDateTime(raw) {
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s,]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { date: validYmd(+m[1], +m[2], +m[3]), time: hhmm(m[4], m[5]) };
  m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}|\d{2})(?!\d)(?:[,\s]+(?:um\s+|at\s+)?(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return { date: validYmd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]), time: hhmm(m[4], m[5]) };
  m = /^(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]+)\.?,?\s+(\d{4})(?:[,\s]+(?:um\s+|at\s+)?(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? null;
    return mo ? { date: validYmd(+m[3], mo, +m[1]), time: hhmm(m[4], m[5]) } : null;
  }
  return null;
}

function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? '').trim());
  return m ? hhmm(m[1], m[2]) : null;
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
    const dt = parseDateTime(f[0]);
    const date = dt?.date ?? null;
    const start = parseTime(f[1]) ?? dt?.time ?? null; // Uhrzeit aus der eigenen Spalte oder aus dem Datum
    const km = parseKm(f[2]);
    const minutes = parseMinutes(f[3]);
    const kcal = parseKcal(f[4]);
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
