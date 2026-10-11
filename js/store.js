// Persistenz: alles liegt lokal im Browser (localStorage), nichts geht an einen eigenen Server.

const KEY = 'rueckenwind.v1';

// Voreingestellte Radwetter-Profile. Jedes Profil ist nur ein Startpunkt, feinjustieren geht danach jederzeit.
export const RULE_PRESETS = {
  entspannt: {
    label: 'Entspannt',
    hint: 'Nur bei trockenem, mildem Wetter.',
    rules: { minTemp: 8, maxTemp: 30, maxRainProb: 25, maxPrecip: 0.2, maxWind: 25, maxGust: 40 },
  },
  ausgewogen: {
    label: 'Ausgewogen',
    hint: 'Etwas Niesel ja, Regen und Sturm nein.',
    rules: { minTemp: 3, maxTemp: 32, maxRainProb: 40, maxPrecip: 0.5, maxWind: 30, maxGust: 50 },
  },
  hartgesotten: {
    label: 'Hartgesotten',
    hint: 'Fast jedes Wetter, außer Sturm und Gewitter.',
    rules: { minTemp: -3, maxTemp: 35, maxRainProb: 60, maxPrecip: 1.5, maxWind: 40, maxGust: 60 },
  },
};

export const DEFAULTS = {
  route: {
    home: null, // { lat, lon, label }
    work: null,
    distanceKm: 10,
    distanceManual: false, // true = Nutzer hat die Distanz selbst eingetragen
    path: [], // Verlauf der Radroute als [[lat, lon], …] für die Kartenvorschau
    distanceSource: '', // 'route' (Radroute berechnet) | 'luftlinie' (geschätzt) | ''
    departHin: '07:30',
    departRueck: '17:00',
    workdays: [1, 2, 3, 4, 5], // 0 = Sonntag
    avgSpeed: 22, // km/h, für Fahrtdauer-Schätzung
    matchRadiusM: 400,
  },
  rules: {
    minTemp: 3,
    maxTemp: 32,
    maxRainProb: 40,
    maxPrecip: 0.5,
    maxWind: 30,
    maxGust: 50,
  },
  security: { autoLockMin: 1 }, // Minuten im Hintergrund, bis die App sich sperrt (0 = sofort)
  customPresets: [], // { id, label, rules } – selbst gespeicherte Radwetter-Profile
  car: {
    name: '',
    fuel: 'benzin', // benzin | diesel | hybrid | elektro
    consumption: 6.5, // l/100 km bzw. kWh/100 km
    energyPrice: 1.75, // €/l bzw. €/kWh
    annualKm: 12000,
    maintenance: 600, // €/Jahr Wartung & Reparatur
    tires: 150, // €/Jahr
    insurance: 600,
    tax: 150,
    depreciation: 2000, // Wertverlust €/Jahr
    parkingPerDay: 0, // € pro Arbeitstag
    mode: 'laufend', // laufend | voll
  },
  bike: {
    name: 'Cube mit Bosch',
    batteryWh: 750,
    whPerKm: 8,
    electricityPrice: 0.35,
    maintenance: 250, // €/Jahr
    annualKm: 3000,
  },
  person: { weightKg: 75, met: 5.0 },
  tax: { ratePerKm: 0.38 },
  co2: { gridGPerKWh: 380 },
  strava: {
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    athleteName: '',
    lastSync: 0,
  },
  rides: [], // { id, date, direction: 'hin'|'rueck', km, minutes, kcal, kcalSource, source, stravaId }
};

function merge(base, saved) {
  if (Array.isArray(base)) return Array.isArray(saved) ? saved : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(saved)) out[k] = k in base ? merge(base[k], saved[k]) : saved[k];
    }
    return out;
  }
  return saved === undefined ? base : saved;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return merge(structuredClone(DEFAULTS), raw ? JSON.parse(raw) : null);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearPlain() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
}

export function importState(json) {
  return merge(structuredClone(DEFAULTS), JSON.parse(json));
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
