// Abgleich: Fahrten von Bosch gegen das, was schon in der App steht.
// Pro Tag und Richtung gibt es höchstens eine Fahrt. Ist der Platz schon belegt (von Hand, Strava oder ein älterer
// Bosch-Stand), überschreibt Bosch nicht selbst, sondern die Fahrt wartet als Konflikt auf deine Bestätigung.

export const slotOf = (r) => `${r.date}|${r.direction}`;

// items: gelesene Fahrten (aus parseHealthText). Rückgabe: was übernommen wird, was zur Prüfung geht, was kollidiert.
export function classifyIncoming(items, { rides = [], pending = [], conflicts = [], kept = [] } = {}) {
  const known = new Set([...rides, ...pending, ...conflicts].map((x) => x.ref).filter(Boolean));
  for (const ref of kept) known.add(ref); // „Behalten“ gilt dauerhaft, auch beim erneuten Laden
  const bySlot = new Map(rides.map((r) => [slotOf(r), r]));
  const taken = new Set(); // in dieser Lieferung schon vergebene Plätze
  const out = { add: [], pending: [], conflicts: [] };
  for (const it of items) {
    if (!it.ref || known.has(it.ref)) continue;
    known.add(it.ref);
    const existing = bySlot.get(slotOf(it));
    if (existing) out.conflicts.push({ ...it, existingId: existing.id });
    else if (it.fits && !taken.has(slotOf(it))) {
      out.add.push(it);
      taken.add(slotOf(it));
    } else out.pending.push(it); // passt nicht zur Strecke oder zweite Fahrt am selben Platz
  }
  return out;
}

// Gibt es die Fahrt, mit der ein Konflikt verglichen wurde, nicht mehr (gelöscht oder verschoben),
// ist der Platz frei: dann darf Bosch ohne Nachfrage übernehmen.
export function staleConflicts(conflicts, rides) {
  const slots = new Set(rides.map(slotOf));
  return conflicts.filter((c) => !slots.has(slotOf(c)));
}

// Bestätigt: Bosch ersetzt alles am selben Tag in derselben Richtung.
export function replaceInSlot(rides, conflict, newRide) {
  return [...rides.filter((r) => r.id !== conflict.existingId && slotOf(r) !== slotOf(conflict)), newRide];
}
