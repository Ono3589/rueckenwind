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

## Fahrten direkt von Bosch (vollautomatisch)

Bosch muss Besitzern in der EU ihre Daten nach dem **EU Data Act** herausgeben und bietet dafür eine kostenlose Schnittstelle. Dein Push-Dienst fragt sie alle 15 Minuten ab und legt neue Fahrten in den Eingang (`/inbox`), aus dem die App sie abholt. Kein Kurzbefehl, kein Einfügen. Fahrten lassen sich in der App nachträglich bearbeiten (Stift in der Fahrtenliste).

```
Kiox → eBike-Flow-App → Bosch-Cloud ← Push-Dienst (alle 15 Min.) → Eingang → Rückenwind
```

Die Anmeldung läuft als OAuth 2.0 mit PKCE als öffentlicher Client. Es gibt kein Client-Geheimnis, dein Bosch-Passwort sieht weder die App noch der Dienst. Die Bosch-Zugangsdaten liegen nur verschlüsselt (AES-256-GCM) beim Dienst.

**Einrichten (einmalig):**

1. Im [Bosch Data-Act-Portal](https://portal.bosch-ebike.com/data-act/app) als Datenempfänger eine App „Rückenwind“ anlegen, „Confidential client“ aus. Login URL: `https://DEIN-NAME.github.io/rueckenwind/#einstellungen`, Redirect URI: `https://DEIN-DIENST.workers.dev/bosch/callback`. Beides zeigt dir die App unter Einstellungen → Bosch eBike Flow fertig an. Die Adressen müssen zeichengenau stimmen.
2. Warten, bis Bosch die App freigibt (Minuten bis ein paar Tage). Danach im Flow-Portal (flow.bosch-ebike.com) oder in der eBike-Flow-App unter **Data Act** die Freigabe für „Rückenwind“ **und für dein Bike** einschalten. Ohne den Schalter am Bike verweigert Bosch den Zugriff (403).
3. Einmal den Schlüssel für die Verschlüsselung anlegen und den Dienst aktualisieren:
   ```bash
   node worker/scripts/setup-secrets.mjs bosch
   cd worker && npx wrangler@4 deploy
   ```
4. In der App unter Einstellungen → Bosch eBike Flow die Client-ID (beginnt mit `euda-`) eintragen und „Mit Bosch verbinden“ tippen. Nach der Bosch-Anmeldung das Fenster mit „Fertig“ schließen.

**Abgleich mit deinen Einträgen:** Gibt es für einen Tag und eine Richtung schon eine Fahrt (von Hand, Strava oder ein älterer Bosch-Stand), überschreibt Bosch sie nicht selbst. Die Fahrt erscheint unter **Fahrten → Abgleich mit Bosch** neben deinem Eintrag, und du entscheidest: **Überschreiben** oder **Behalten**. Behaltene Einträge bietet Bosch auch beim „Fahrten neu laden“ nicht noch einmal an. Um bestehende Einträge mit Bosch abzugleichen, in der Bosch-Karte **Fahrten neu laden** tippen.

**Was dabei passiert:** Der Dienst holt höchstens die letzten 14 Tage und jede Fahrt nur einmal. Er speichert Datum, Startzeit, Strecke, Dauer und Kalorien, keine GPS-Spur. Passende Pendelfahrten übernimmt die App beim Öffnen von selbst, alles andere landet unter „Fahrten → zur Prüfung“. Hin oder Rück bestimmt wie bisher die Startzeit.

**Grenzen:** Nur Bosch-Konten aus der EU und nur Smart-System-Bikes (die mit der Flow-App). Bosch veröffentlicht eine Fahrt erst, wenn die eBike-Flow-App sie von der Kiox geholt hat. Die Felder der Schnittstelle (`distance`, `durationWithoutStops`, `caloriesBurned`, `startTime`) stammen aus einer laufenden Open-Source-Integration, Boschs eigene Dokumentation liegt hinter dem Portal-Login. Zeigt „Jetzt abfragen“ Fahrten an, die nicht ankommen, hilft eine Rückmeldung mit der Fehlermeldung aus der Karte.

## Strava (optional, kostenpflichtig)

Die Strava-Schnittstelle ist nur mit einem Strava-Abonnement nutzbar. Wer eines hat, kann in den Einstellungen unter Kiox-Fahrten → Strava eine eigene API-App eintragen (Authorization Callback Domain: `<dein-name>.github.io`). Ohne Abo bleibt dieser Teil ungenutzt.

## Morgenmeldung (Push-Nachricht aufs iPhone)

Jeden Arbeitstag zur Wunschzeit kommt eine Meldung, zum Beispiel **„Jetzt losfahren!“** (mit dem Grund, etwa „Trocken, 12 °C, Rückenwind am Morgen“) oder **„Nimm lieber das Auto“**. Die Überschrift wechselt täglich aus einer Reihe von Varianten (`js/messages.js`), nie dieselbe an zwei Tagen hintereinander.

**Abendfrage:** Zusätzlich fragt eine zweite Meldung abends (Standard 18:30 Uhr, einstellbar, abschaltbar), ob du gefahren bist, zum Beispiel „Bist du heute geradelt?“ oder, bei schlechtem Wetter, „Heute doch mit dem Rad?“. Der Text passt zum Wetter des Tages. Ein Tipp auf die Meldung öffnet die App mit den Antwortknöpfen **Ja, hin und zurück / Nur Hinweg / Nur Rückweg / Nein**, die Fahrt wird mit deiner Strecke eingetragen. iOS zeigt in Web-Mitteilungen keine eigenen Knöpfe an, deshalb die Antwort in der App. Ist der Tag schon erledigt (beide Wege eingetragen oder beantwortet), meldet die App das dem Dienst, und die Frage entfällt. Ab dem Rückweg zeigt die App die Frage außerdem von selbst auf „Heute“, falls noch nichts eingetragen ist.

**Warum ein eigener Dienst?** Eine Webseite kann nicht von allein aufwachen. Damit morgens etwas ankommt, wenn die App zu ist, muss ein Server die Meldung schicken. Dafür dient ein winziger Cloudflare Worker in `worker/`. Er kostet nichts (kostenloser Tarif) und läuft in deinem eigenen Konto. Er speichert nur die Push-Adresse deines Geräts, den Mittelpunkt der Strecke (auf etwa 1 km gerundet), den Fahrtkurs, deine Zeiten und Schwellen sowie, ob der heutige Tag erledigt ist. Deine genauen Adressen gehen nie dorthin.

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
node worker/scripts/setup-secrets.mjs         # erzeugt die Schlüssel und das Token und legt sie bei Cloudflare ab
```

Das Skript zeigt am Ende **nur das Token** an (einmal, bitte kopieren). Den privaten Schlüssel siehst du nie, du musst nichts einfügen. Er und das Token sind geheim: nicht committen, nicht weitergeben. Danach ist kein neues `deploy` nötig.

Wichtig: Alle Befehle im Ordner `worker/` ausführen (die Eingabezeile endet auf `worker %`). In einem anderen Ordner findet wrangler die Konfiguration nicht.

**In der App:** Einstellungen → Morgenmeldung. Adresse des Dienstes und Token eintragen, **Einschalten** tippen und die Nachfrage „Mitteilungen erlauben“ bestätigen. Danach **Test senden**: Die Meldung für heute sollte nach wenigen Sekunden erscheinen. Ab dann prüft der Dienst alle 15 Minuten und schickt einmal pro Arbeitstag nach der Wunschzeit. Ändern sich Strecke, Zeiten oder Schwellen, überträgt die App die neuen Werte von selbst.

**Nach einem Update des Dienstes** (zum Beispiel für die Abendfrage) einmal im Ordner `worker/` `npx wrangler@4 deploy` ausführen. Die Schlüssel bleiben erhalten.

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
| `js/reconcile.js` | Abgleich: neue Bosch-Fahrten gegen vorhandene Einträge (übernehmen, zur Prüfung, Konflikt) |
| `js/health.js` | Fahrten als Textzeilen lesen und prüfen (so liefert der Dienst die Bosch-Fahrten), teilt Hin- und Rückweg in einer Fahrt |
| `js/geo.js` | Distanz, Kurs, Adresssuche (OpenStreetMap Nominatim), Radroute (FOSSGIS-Routing), Standort |
| `js/map.js` | Kartenvorschau aus OpenStreetMap-Kacheln mit Routenlinie (ein SVG), Linie ausdünnen |
| `js/store.js` | Einstellungen und Fahrten im localStorage |
| `js/vault.js` | App-Sperre: Verschlüsselung der Daten mit einem PIN-Schlüssel |
| `js/lock.js` | Sperrbildschirm mit Zahlenfeld |
| `js/app.js` | Oberfläche: Heute, Fahrten, Bilanz, Einstellungen |
| `worker/src/bosch.js` | Bosch-Data-Act im Push-Dienst: Anmeldung (PKCE), verschlüsselte Tokens, Abfrage neuer Fahrten, Umrechnung in Zeilen für die App |
| `js/push.js` | Anmeldung für die Morgenmeldung beim eigenen Push-Dienst |
| `js/messages.js` | Die Reihe der Morgenmeldungen und ihre Auswahl |
| `js/scene.js` | Die bewegte Pendelszene: Radfahrer mit tretenden Beinen, Stadt, Straße, Wind und Regen, je nach Wetter |
| `js/charts.js` | Tagesverlauf, Ersparnis-Profil und Wochenbalken als SVG |
| `js/motion.js` | Hochzählende Zahlen, Einblenden beim Scrollen, Wischen über Diagramme, Tab-Wechsel, Startbildschirm |
| `scripts/inject-splash.mjs` | Schreibt den Startbildschirm in `index.html`. Nach Änderungen an `js/scene.js` einmal `node scripts/inject-splash.mjs` ausführen |
| `worker/` | Cloudflare Worker: prüft morgens das Wetter und schickt die Push-Nachricht |
| `sw.js` | Offline-Cache der App-Hülle, zeigt Push-Nachrichten an |

## Ideen für v0.2

- Akku-Check am Vorabend (Reichweite gegen Strecke und Gegenwind)
- Wartungserinnerungen nach Kilometern (Kette, Bremsbeläge, Inspektion)
- Abzeichen und Wochenziele, Team-Challenge mit Kollegen
