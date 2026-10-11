# Rückenwind – E-Bike-Pendler-App (v0.1)

Eine PWA für das iPhone: Jeden Morgen die Antwort „Heute Rad fahren?“, dazu Kilometer, Ersparnis gegenüber deinem Auto und verbrannte Kalorien.
Ohne Build-Schritt und ohne Abhängigkeiten, also reines HTML, CSS und JavaScript. Alle Daten bleiben im Browser (localStorage).

## Lokal starten

```bash
python3 -m http.server 5173 --bind 127.0.0.1
```

Dann http://localhost:5173 öffnen. Tests der Logik laufen mit `npm test` (Node 20 oder neuer).

## Veröffentlichen mit GitHub Pages (kostenlos)

Eine PWA braucht HTTPS. GitHub Pages liefert das ohne Konfiguration. Die App besteht nur aus statischen Dateien und hat keinen Server. Deine Daten liegen weiter ausschließlich im Browser deines Geräts und kommen nie ins Repository.

1. Auf https://github.com/new ein **öffentliches** Repository `rueckenwind` anlegen (ohne README, ohne Lizenz). Pages ist bei kostenlosen Konten nur für öffentliche Repositories verfügbar. Der Code enthält keine Zugangsdaten.
2. Im Projektordner:
   ```bash
   git remote add origin https://github.com/<dein-name>/rueckenwind.git
   git push -u origin main
   ```
3. Im Repository unter **Settings → Pages** als Quelle **Deploy from a branch**, Branch `main`, Ordner `/ (root)` wählen. Nach ein bis zwei Minuten läuft die App unter `https://<dein-name>.github.io/rueckenwind/`.
4. Die Adresse auf dem iPhone in **Safari** öffnen und **Teilen → Zum Home-Bildschirm** wählen. **Richte die App erst danach ein**, denn Safari und die installierte App haben auf dem iPhone getrennten Speicher.
5. Updates: Änderungen committen und pushen. Die App holt sich beim nächsten Start die neue Version. Bei einer neuen Version die Zahl in `VERSION` in `sw.js` erhöhen.

Für die Strava-Anbindung trägst du als *Authorization Callback Domain* `<dein-name>.github.io` ein.

## Strava-Anbindung (Kiox-Daten)

Bosch bietet keine öffentliche Kiox-API. Der Weg geht deshalb über Strava:
**Kiox → eBike Flow → Strava → Rückenwind**. komoot lässt sich zusätzlich mit Strava verbinden.

1. In der eBike-Flow-App Strava verbinden.
2. Unter https://www.strava.com/settings/api eine eigene API-App anlegen. Als *Authorization Callback Domain* den Hostnamen deiner gehosteten App eintragen (bei GitHub Pages `<dein-name>.github.io`), lokal `localhost`.
3. In Rückenwind unter Einstellungen → Strava die Client-ID und das Client-Secret eintragen und verbinden.

Als Pendelfahrt zählt eine Fahrt, die bis 400 m von Zuhause bzw. Arbeit startet und endet. Fehlen Koordinaten, entscheiden Distanz (±35 %) und Tageszeit.
Kalorien kommen aus Strava (also von der Kiox). Ohne diese Daten werden sie aus Gewicht × MET × Fahrtdauer geschätzt.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `js/weather.js` | Open-Meteo-Abfrage, Bewertung von Hin- und Rückweg, Wind relativ zur Fahrtrichtung, Ausrüstungstipps |
| `js/costs.js` | Kosten pro km für Auto (aus Verbrauch, Preis, Jahreskosten) und E-Bike, CO₂, Bilanz, Entfernungspauschale |
| `js/strava.js` | OAuth, Aktivitäten laden, Pendelfahrten erkennen |
| `js/geo.js` | Distanz, Kurs, Adresssuche (OpenStreetMap Nominatim), Radroute (FOSSGIS-Routing), Standort |
| `js/map.js` | Kartenvorschau aus OpenStreetMap-Kacheln mit Routenlinie (ein SVG), Linie ausdünnen |
| `js/store.js` | Einstellungen und Fahrten im localStorage |
| `js/app.js` | Oberfläche: Heute, Fahrten, Bilanz, Einstellungen |
| `sw.js` | Offline-Cache der App-Hülle |

## Ideen für v0.2

- **Morgen-Push um 6:30 Uhr:** ein Cloudflare Worker mit Cron-Trigger und Web Push (VAPID). Das ist kostenlos, braucht aber ein Cloudflare-Konto.
  Alternative ohne Server: eine iOS-Kurzbefehl-Automation, die die App öffnet.
- Akku-Check am Vorabend (Reichweite gegen Strecke und Gegenwind)
- Wartungserinnerungen nach Kilometern (Kette, Bremsbeläge, Inspektion)
- Abzeichen und Wochenziele, Team-Challenge mit Kollegen
