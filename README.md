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

## Morgenmeldung (Push-Nachricht aufs iPhone)

Jeden Arbeitstag zur Wunschzeit kommt eine Meldung, zum Beispiel **„Jetzt losfahren!“** (mit dem Grund, etwa „Trocken, 12 °C, Rückenwind am Morgen“) oder **„Nimm lieber das Auto“**. Die Überschrift wechselt täglich aus einer Reihe von Varianten (`js/messages.js`), nie dieselbe an zwei Tagen hintereinander.

**Warum ein eigener Dienst?** Eine Webseite kann nicht von allein aufwachen. Damit morgens etwas ankommt, wenn die App zu ist, muss ein Server die Meldung schicken. Dafür dient ein winziger Cloudflare Worker in `worker/`. Er kostet nichts (kostenloser Tarif) und läuft in deinem eigenen Konto. Er speichert nur die Push-Adresse deines Geräts, den Mittelpunkt der Strecke (auf etwa 1 km gerundet), den Fahrtkurs, deine Zeiten und Schwellen. Deine genauen Adressen gehen nie dorthin.

**Voraussetzungen:** iPhone mit iOS 16.4 oder neuer, die App ist **zum Home-Bildschirm hinzugefügt** und wird von dort geöffnet, ein kostenloses [Cloudflare-Konto](https://dash.cloudflare.com/sign-up), Node.js auf dem Mac.

**Einmalige Einrichtung** (im Ordner `worker/`):

```bash
cd worker
npx wrangler@4 login                          # Browser öffnet sich, bei Cloudflare anmelden
npx wrangler@4 kv namespace create SUBS       # gibt eine "id" aus
```

Die ausgegebene `id` in `wrangler.toml` bei `id = "HIER_DIE_KV_ID_EINTRAGEN"` eintragen. Bei `ALLOWED_ORIGINS` und `VAPID_SUBJECT` steht schon deine GitHub-Pages-Adresse.

```bash
npx wrangler@4 deploy                         # gibt die Adresse aus, z. B. https://rueckenwind-push.NAME.workers.dev
node scripts/gen-vapid.mjs                    # druckt einen öffentlichen und einen privaten Schlüssel
npx wrangler@4 secret put VAPID_PUBLIC        # öffentlichen Schlüssel einfügen
npx wrangler@4 secret put VAPID_PRIVATE_JWK   # privaten Schlüssel (die Zeile mit { … }) einfügen
openssl rand -hex 24                          # druckt ein zufälliges Token, kopieren
npx wrangler@4 secret put API_TOKEN           # das Token einfügen
```

Der private Schlüssel und das Token sind geheim: nicht committen, nicht weitergeben. Nach `secret put` ist kein neues `deploy` nötig.

**In der App:** Einstellungen → Morgenmeldung. Adresse des Dienstes und Token eintragen, **Einschalten** tippen und die Nachfrage „Mitteilungen erlauben“ bestätigen. Danach **Test senden**: Die Meldung für heute sollte nach wenigen Sekunden erscheinen. Ab dann prüft der Dienst alle 15 Minuten und schickt einmal pro Arbeitstag nach der Wunschzeit. Ändern sich Strecke, Zeiten oder Schwellen, überträgt die App die neuen Werte von selbst.

**Zum Prüfen und Abstellen**
- Läuft der Dienst? `https://…workers.dev/health` im Browser öffnen, es kommt `{"ok":true}`.
- Ausschalten: in der App „Ausschalten“. Das meldet das Gerät ab und löscht die gespeicherten Werte. Den ganzen Dienst entfernst du mit `npx wrangler@4 delete`.
- Kommt nach „Test senden“ nichts an, prüfe in iOS unter Einstellungen → Mitteilungen → Rückenwind, ob Mitteilungen erlaubt sind, und dass kein Fokus-Modus sie unterdrückt.

**Stand der Prüfung:** Verschlüsselung (gegen die Testwerte aus RFC 8291), Absenderausweis, Zeitplan, Zeitzone, Wiederholung bei Fehlern und die Anzeige im Service Worker sind automatisch getestet (`tests/webpush.test.mjs`, `tests/worker.test.mjs`, `tests/sw.test.mjs`). Der echte Versand über Apple und die Anzeige auf dem iPhone sind **nicht** getestet, das geht nur mit deinem Gerät.

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
| `js/push.js` | Anmeldung für die Morgenmeldung beim eigenen Push-Dienst |
| `js/messages.js` | Die Reihe der Morgenmeldungen und ihre Auswahl |
| `worker/` | Cloudflare Worker: prüft morgens das Wetter und schickt die Push-Nachricht |
| `sw.js` | Offline-Cache der App-Hülle, zeigt Push-Nachrichten an |

## Ideen für v0.2

- Akku-Check am Vorabend (Reichweite gegen Strecke und Gegenwind)
- Wartungserinnerungen nach Kilometern (Kette, Bremsbeläge, Inspektion)
- Abzeichen und Wochenziele, Team-Challenge mit Kollegen
