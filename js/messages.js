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

// ---------- Abendfrage: „Bist du heute gefahren?“ ----------
// Der Text passt zum Wetter des Tages. Tippen auf die Meldung öffnet die App mit den Antwortknöpfen
// (iOS zeigt in Web-Mitteilungen keine eigenen Knöpfe an).

export const EVENING = {
  go: [
    { title: 'Bist du heute geradelt?', body: 'Bei dem Wetter lag es nahe. Tippe, um die Fahrt einzutragen.' },
    { title: 'Rad oder Auto heute?', body: 'Es war ein guter Radtag. Wie bist du gefahren?' },
    { title: 'Feierabend! Warst du auf dem Rad?', body: 'Ein kurzer Tipp, und die Fahrt zählt.' },
    { title: 'Fahrt eintragen?', body: 'Heute war Radwetter. Hast du es genutzt?' },
    { title: 'Wie war die Fahrt?', body: 'Sag kurz, ob du heute geradelt bist.' },
  ],
  caution: [
    { title: 'Bist du heute gefahren?', body: 'Es war machbar. Trag ein, wie du unterwegs warst.' },
    { title: 'Rad gewagt?', body: 'Das Wetter war nicht ganz einfach. Wie bist du gefahren?' },
    { title: 'Feierabend! Rad oder Auto?', body: 'Kurz eintragen, damit die Bilanz stimmt.' },
    { title: 'Hat es mit dem Rad geklappt?', body: 'Ein Tipp genügt.' },
  ],
  no: [
    { title: 'Heute doch mit dem Rad?', body: 'Das Wetter war schlecht. Trag nur ein, falls du gefahren bist.' },
    { title: 'Auto oder Rad?', body: 'Heute war kein Radwetter. Kurz Bescheid geben?' },
    { title: 'Feierabend! Trotzdem geradelt?', body: 'Dann trag die Fahrt kurz ein.' },
    { title: 'Wie bist du heute gefahren?', body: 'Ein Tipp, dann ist der Tag erledigt.' },
  ],
};

export function buildEveningNotification(day, date) {
  const pool = EVENING[day.status] ?? EVENING.caution;
  return pool[((dayNumber(date) % pool.length) + pool.length) % pool.length];
}
