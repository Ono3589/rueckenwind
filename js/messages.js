// Die Morgenmeldung: eine kurze Überschrift aus einer Reihe von Varianten, dazu der Grund aus der Wetterbewertung.
// Die Variante hängt vom Datum ab, so wiederholt sich dieselbe Meldung nie an zwei Tagen hintereinander.

export const TITLES = {
  go: [
    'Jetzt losfahren!',
    'Perfekt zum Radeln',
    'Das Rad ruft',
    'Rauf aufs Rad',
    'Heute rollt’s',
    'Beste Bedingungen',
    'Zeit für die Pedale',
    'Besser wird’s nicht',
    'Los geht’s, ab aufs Rad',
  ],
  caution: [
    'Machbar, mit Jacke',
    'Radeln geht, pack dich ein',
    'Heute etwas rauer, aber fahrbar',
    'Geht klar, nimm was Warmes mit',
    'Mit Augenmaß aufs Rad',
    'Schaffbar, schau kurz aufs Wetter',
    'Fahrbar, aber nicht gemütlich',
  ],
  no: [
    'Nimm lieber das Auto',
    'Heute bleibt das Rad stehen',
    'Heute lieber trocken ankommen',
    'Kein Radwetter heute',
    'Das Rad hat heute frei',
    'Heute besser mit Auto oder Bahn',
    'Bei dem Wetter: lieber Auto',
  ],
};

// Zusätzliche Varianten, wenn der Hinweg Rückenwind hat
const TAILWIND = ['Rückenwind auf dem Hinweg, los!', 'Der Wind schiebt dich zur Arbeit'];

const dayNumber = (isoDate) => Math.floor(Date.parse(`${isoDate}T12:00:00Z`) / 86400000);

// day: Ergebnis von assessDay(); date: 'YYYY-MM-DD'
export function buildNotification(day, date) {
  const status = day.status; // 'go' | 'caution' | 'no'
  let pool = TITLES[status] ?? TITLES.caution;
  if (status === 'go' && day.hin?.rel?.kind === 'rueck') pool = [...pool, ...TAILWIND];
  const title = pool[((dayNumber(date) % pool.length) + pool.length) % pool.length];

  let body = day.reason;
  if (status !== 'no' && day.gear?.length) body += ` Denk an: ${day.gear.map((g) => g.text).join(', ')}.`;
  return { title, body };
}
