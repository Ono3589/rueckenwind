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

## App-Sperre (PIN)

Unter Einstellungen → Sicherheit lässt sich eine PIN (6, 8 oder 10 Ziffern) einschalten.

- Fahrten, Adressen, Fahrzeugdaten und Strava-Zugangsdaten werden mit AES-256-GCM verschlüsselt. Der Schlüssel entsteht aus der PIN (PBKDF2-SHA-256, 600 000 Runden). Die PIN selbst wird nirgends gespeichert.
- Die App sperrt sich nach 0, 1, 5 oder 15 Minuten im Hintergrund und beim Neustart. Nach fünf falschen Versuchen kommt eine Wartezeit.
- Sicherungen („Sichern“) sind dann ebenfalls verschlüsselt und brauchen dieselbe PIN.
- **Keine Wiederherstellung:** Wer die PIN vergisst, kommt nicht mehr an die Daten. „PIN vergessen?“ löscht alles auf dem Gerät. Eine verschlüsselte Sicherung lässt sich danach mit ihrer PIN wieder einspielen.
- **Grenzen:** Eine PIN hat wenige Kombinationen. Wer die verschlüsselte Datei kopiert, kann sie offline durchprobieren. 8 oder mehr Ziffern machen das deutlich schwerer. Die Sperre schützt vor fremdem Zugriff auf das Gerät oder auf Sicherungen, nicht vor Schadsoftware, die den entsperrten Zustand ausliest.
- Es gibt keinen Server und kein Konto. Eine Anmeldung mit Einmalcode (OTP) wäre nur mit einem Server sinnvoll, etwa für Synchronisation oder eine Team-Funktion.
- Kartenkacheln und der Wetter-Zwischenspeicher werden bei aktiver Sperre nicht gespeichert, weil sie die Gegend deiner Route verraten.

## Fahrten aus Apple Health (Kiox → eBike Flow → Apple Health → Rückenwind)

Bosch bietet keine öffentliche Kiox-API. Der kostenlose Weg geht über Apple Health:

1. In der **eBike-Flow**-App die Verbindung zu Apple Health einschalten.
2. In der **Kurzbefehle**-App einen Kurzbefehl bauen, der die letzten Radtrainings aus Apple Health liest und pro Fahrt eine Zeile `datum;start;km;minuten;kcal` in die **Zwischenablage** kopiert, zum Beispiel `2026-10-12;07:31;10,4;27;186`. Start, Dauer und Kalorien dürfen fehlen. Eine Zeile `datum;;km` mit der Tagessumme wird auf Hin- und Rückweg verteilt.
3. In Rückenwind unter **Fahrten → Einfügen** die gefundenen Fahrten ansehen und übernehmen. Fahrten, die nicht zu deiner Strecke passen, sind abgewählt, bereits übernommene werden übersprungen.

Warum die Zwischenablage? Ein Link aus einem Kurzbefehl öffnet auf dem iPhone immer Safari, nie die installierte App. Safari und die App haben getrennten Speicher, die Daten kämen also nie an. Die Zwischenablage ist der einzige Weg, der in die installierte App führt. iOS fragt beim Einfügen einmal nach.

Der Kurzbefehl wurde ohne iPhone entworfen und ist **ungetestet**. Die Bezeichnungen der Aktionen können je nach iOS-Version abweichen. Das Einlesen der Zeilen in der App ist getestet (`tests/health.test.mjs`).

### Strava (optional, kostenpflichtig)

Die Strava-Schnittstelle ist nur mit einem Strava-Abonnement nutzbar. Wer eines hat, kann in den Einstellungen unter Kiox-Fahrten → Strava eine eigene API-App eintragen (Authorization Callback Domain: `<dein-name>.github.io`). Ohne Abo bleibt dieser Teil ungenutzt.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `js/weather.js` | Open-Meteo-Abfrage, Bewertung von Hin- und Rückweg, Wind relativ zur Fahrtrichtung, Ausrüstungstipps |
| `js/costs.js` | Kosten pro km für Auto (aus Verbrauch, Preis, Jahreskosten) und E-Bike, CO₂, Bilanz, Entfernungspauschale |
| `js/strava.js` | OAuth, Aktivitäten laden, Pendelfahrten erkennen (optional, Strava-Abo nötig) |
| `js/health.js` | Fahrten aus der Zwischenablage (Apple-Health-Kurzbefehl) einlesen und prüfen |
| `js/geo.js` | Distanz, Kurs, Adresssuche (OpenStreetMap Nominatim), Radroute (FOSSGIS-Routing), Standort |
| `js/map.js` | Kartenvorschau aus OpenStreetMap-Kacheln mit Routenlinie (ein SVG), Linie ausdünnen |
| `js/store.js` | Einstellungen und Fahrten im localStorage |
| `js/vault.js` | App-Sperre: Verschlüsselung der Daten mit einem PIN-Schlüssel |
| `js/lock.js` | Sperrbildschirm mit Zahlenfeld |
| `js/app.js` | Oberfläche: Heute, Fahrten, Bilanz, Einstellungen |
| `sw.js` | Offline-Cache der App-Hülle |

## Ideen für v0.2

- **Morgen-Push um 6:30 Uhr:** ein Cloudflare Worker mit Cron-Trigger und Web Push (VAPID). Das ist kostenlos, braucht aber ein Cloudflare-Konto.
  Alternative ohne Server: eine iOS-Kurzbefehl-Automation, die die App öffnet.
- Akku-Check am Vorabend (Reichweite gegen Strecke und Gegenwind)
- Wartungserinnerungen nach Kilometern (Kette, Bremsbeläge, Inspektion)
- Abzeichen und Wochenziele, Team-Challenge mit Kollegen
