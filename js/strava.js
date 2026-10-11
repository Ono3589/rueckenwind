// Strava als Datenquelle: Kiox → eBike Flow → Strava (und komoot → Strava) → Rückenwind.
// Client-ID und -Secret stammen aus deiner eigenen Strava-API-App und bleiben nur in diesem Browser.

import { distanceM } from './geo.js';

const AUTH = 'https://www.strava.com/oauth/authorize';
const TOKEN = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';
const BIKE_TYPES = ['EBikeRide', 'EMountainBikeRide', 'Ride'];

export function redirectUri() {
  return location.origin + location.pathname;
}

export function authorizeUrl(clientId) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all',
  });
  return `${AUTH}?${p}`;
}

async function tokenRequest(s, params) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Strava-Anmeldung fehlgeschlagen (${res.status})`);
  const t = await res.json();
  s.accessToken = t.access_token;
  s.refreshToken = t.refresh_token;
  s.expiresAt = t.expires_at;
  if (t.athlete) s.athleteName = [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(' ');
}

export function exchangeCode(s, code) {
  return tokenRequest(s, { code, grant_type: 'authorization_code' });
}

async function ensureToken(s) {
  if (!s.refreshToken) throw new Error('Strava ist nicht verbunden');
  if (s.expiresAt - 60 < Date.now() / 1000) await tokenRequest(s, { refresh_token: s.refreshToken, grant_type: 'refresh_token' });
}

async function get(s, path) {
  await ensureToken(s);
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${s.accessToken}` } });
  if (res.status === 429) throw new Error('Strava-Limit erreicht – bitte in 15 Minuten erneut versuchen');
  if (!res.ok) throw new Error(`Strava-Fehler (${res.status})`);
  return res.json();
}

// Arbeitsweg erkennen: Start bei Zuhause und Ende bei der Arbeit (oder umgekehrt).
// Fehlen Koordinaten (z. B. Privatsphäre-Zone), entscheiden Distanz und Tageszeit.
export function classify(act, route) {
  const r = route.matchRadiusM;
  const pt = (ll) => (ll && ll.length === 2 ? { lat: ll[0], lon: ll[1] } : null);
  const start = pt(act.start_latlng);
  const end = pt(act.end_latlng);
  const near = (a, b) => a && b && distanceM(a, b) <= r;
  if (route.home && route.work && start && end) {
    if (near(start, route.home) && near(end, route.work)) return 'hin';
    if (near(start, route.work) && near(end, route.home)) return 'rueck';
    return null;
  }
  const km = act.distance / 1000;
  if (Math.abs(km - route.distanceKm) > route.distanceKm * 0.35) return null;
  const hour = Number(act.start_date_local.slice(11, 13));
  return hour < 12 ? 'hin' : 'rueck';
}

export async function fetchCommutes(s, route, knownIds, { maxDetails = 25 } = {}) {
  const after = Math.floor((s.lastSync ? s.lastSync - 7 * 864e5 : Date.now() - 90 * 864e5) / 1000);
  const acts = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await get(s, `/athlete/activities?after=${after}&per_page=100&page=${page}`);
    acts.push(...batch);
    if (batch.length < 100) break;
  }
  const found = [];
  let details = 0;
  for (const a of acts) {
    if (knownIds.has(a.id) || !BIKE_TYPES.includes(a.sport_type || a.type)) continue;
    const direction = classify(a, route);
    if (!direction) continue;
    let kcal = null;
    if (details < maxDetails) {
      details++;
      try {
        kcal = (await get(s, `/activities/${a.id}`)).calories || null;
      } catch {
        /* Kalorien werden dann geschätzt */
      }
    }
    found.push({
      stravaId: a.id,
      date: a.start_date_local.slice(0, 10),
      direction,
      km: Math.round(a.distance / 100) / 10,
      minutes: Math.round(a.moving_time / 60),
      kcal,
      name: a.name,
    });
  }
  s.lastSync = Date.now();
  return found;
}
