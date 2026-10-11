const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Kompasskurs von a nach b in Grad (0 = Nord, 90 = Ost)
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function midpoint(a, b) {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

// Adresssuche über OpenStreetMap Nominatim. Nur auf Knopfdruck aufrufen (Nutzungsrichtlinie: max. 1 Anfrage/s, kein Autocomplete).
export async function searchAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&accept-language=de&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Adresssuche fehlgeschlagen (${res.status})`);
  const list = await res.json();
  return list.map((r) => ({ lat: +r.lat, lon: +r.lon, label: r.display_name }));
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Standort wird nicht unterstützt'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Aktueller Standort' }),
      () => reject(new Error('Standort nicht verfügbar')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

// Radroute (Länge und Verlauf) zwischen zwei Punkten über den kostenlosen FOSSGIS-Routingdienst (OpenStreetMap-Daten, Fahrradprofil, ohne Schlüssel).
export async function fetchBikeRoute(a, b) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const url = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Routenberechnung fehlgeschlagen (${res.status})`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route?.distance) throw new Error('Keine Radroute gefunden');
    const path = (route.geometry?.coordinates ?? []).map(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
    return { km: route.distance / 1000, path };
  } finally {
    clearTimeout(timer);
  }
}
