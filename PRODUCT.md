# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installierbare PWA, gebaut für das iPhone (Safari → „Zum Home-Bildschirm“). Eine native iOS-App ist bewusst ausgeschlossen, weil kein bezahlter Apple-Developer-Account genutzt werden soll.

## Users

- **Primär:** der Eigentümer selbst. Er pendelt mit einem Cube-E-Bike mit Bosch-Antrieb und Kiox-Display rund 10 km zur Arbeit. Morgens will er schnell wissen, ob das Wetter für die Fahrt passt, und über die Zeit sehen, was das Radfahren bringt.
- **Später:** Kollegen, die ebenfalls mit dem Rad pendeln, etwa für eine Team-Challenge. Das ist noch nicht gebaut. Ein Konto- oder Teilen-Modell ist noch nicht entschieden.

## Product Purpose

Rückenwind beantwortet jeden Morgen die Frage „Heute mit dem Rad zur Arbeit?“ und macht über die Zeit sichtbar, was das Pendeln bringt: Kilometer, gesparte Euro gegenüber dem eigenen Auto, verbrannte Kalorien und vermiedenes CO₂.

Beide Jobs sind gleich wichtig:

- die schnelle Entscheidung am Morgen;
- die Motivation durch die Bilanz.

Erfolg heißt: Die App wird morgens geöffnet, weil sie in Sekunden eine verlässliche Antwort gibt, und die Bilanz trägt dazu bei, dass der Nutzer öfter fährt.

## Positioning

- **Wetter für die Fahrt, nicht für den Tag:** Die Entscheidung bewertet genau die Zeitfenster von Hin- und Rückweg, nach den persönlichen Schwellen des Nutzers. Wind wird relativ zur Fahrtrichtung gerechnet (Rücken-, Gegen- oder Seitenwind).
- **Ersparnis aus dem echten Fahrzeug:** Sie wird aus den Daten des eigenen Autos berechnet, also Antrieb, Verbrauch, Preis und Jahreskosten, wahlweise laufende Kosten oder Vollkosten. Es gibt bewusst keine Pauschale.

## Operating Context

- Genutzt wird die App vor allem früh morgens vor der Abfahrt, oft bei Dunkelheit, auf dem iPhone, mit einem kurzen Blick. Am Abend kommt der Rückweg dazu.
- **Fahrtdaten:** Bosch bietet keine öffentliche Kiox-API. Der Weg geht daher über Kiox → eBike Flow → Strava → Rückenwind (Strava-API mit eigener Client-ID). Der Nutzer verwendet komoot. Strava ist nur als Datenbrücke vorgesehen. Fahrten lassen sich auch manuell eintragen.
- **Pendelfahrt-Erkennung:** Start und Ende liegen in der Nähe von Zuhause und Arbeit. Fehlen Koordinaten, entscheiden Distanz und Tageszeit.
- **Externe Dienste:**
  - Open-Meteo für das Wetter (kostenlos, ohne Schlüssel);
  - OpenStreetMap Nominatim für die Adresssuche;
  - FOSSGIS-Routing (OpenStreetMap, Fahrradprofil) für die Distanz zwischen Zuhause und Arbeit, ersatzweise Luftlinie × 1,3;
  - Google Fonts für die Schrift.

## Capabilities and Constraints

- **Heute:**
  - Urteil „Ja, rollen!“, „Machbar.“ oder „Heute lieber nicht.“;
  - getrennte Bewertung von Hin- und Rückweg;
  - Ausrüstungstipps;
  - Regen im Tagesverlauf;
  - nach Feierabend oder am Wochenende zeigt die App den nächsten Arbeitstag.
- **Fahrten:** manuell eintragen, mit einem Tipp als gefahren markieren, Abgleich mit Strava, nach Wochen gruppiert.
- **Bilanz:** Ersparnis, km, kcal, CO₂ und Serie je Woche, Monat, Jahr oder gesamt. Dazu ein 12-Wochen-Verlauf, Kosten pro km für Auto und E-Bike, die Entfernungspauschale und ein CSV-Export.
- **Einstellungen:**
  - Strecke wird aus Zuhause und Arbeit automatisch berechnet und lässt sich von Hand überschreiben;
  - Abfahrtszeiten und Arbeitstage;
  - Wetterschwellen;
  - Auto- und E-Bike-Daten;
  - Gewicht und MET für die Kalorienschätzung;
  - Pauschalsatz und Strommix (einstellbar);
  - Strava-Verbindung;
  - Sicherung, Wiederherstellung und Löschen der Daten.
- **Kalorien:** bevorzugt aus den Kiox-Daten über Strava, sonst geschätzt (Gewicht × MET × Dauer). Geschätzte Werte werden gekennzeichnet.
- **Speicherung:** Alle Daten liegen lokal im Browser (localStorage). Es gibt keinen eigenen Server und keine Konten.
- **App-Sperre:** Optional schützt eine PIN die lokalen Daten durch Verschlüsselung (kein Serverkonto, keine Einmalcodes). Sie greift beim Start und nach einer einstellbaren Zeit im Hintergrund. Face ID ist noch nicht umgesetzt, weil es sich ohne echtes iPhone nicht prüfen ließ.
- **Kostenrahmen:** keine laufenden Kosten. Dienste müssen kostenlos nutzbar sein.
- **Sprache:** Die Oberfläche ist auf Deutsch. Englisch soll später dazukommen, deshalb sollen Texte so angelegt werden, dass eine Übersetzung möglich bleibt. Zahlen und Daten werden im deutschen Format angezeigt.
- **Offen:**
  - Morgen-Benachrichtigung um ca. 6:30 Uhr. Vorgesehen ist ein kostenloser Cloudflare Worker mit Web Push, alternativ eine iOS-Kurzbefehl-Automation.
  - Akku-Check am Vorabend.
  - Wartungserinnerungen nach km.
  - Abzeichen und Wochenziele.
  - Team-Funktion für Kollegen.
- **Ungeprüft:** ob eBike Flow und komoot zuverlässig an Strava liefern, und wie das Strava-OAuth sich in der installierten iOS-PWA verhält.

## Brand Commitments

- **Name:** „Rückenwind“.
- **Ton:** Deutsch, direkt, freundlich und knapp. Die Entscheidung kommt in einem Satz („Ja, rollen!“) und braucht keine Erklärung.

## Evidence on Hand

- Es gibt noch keine echten Fahrtdaten des Nutzers. Testfahrten im Entwicklungsbrowser waren erfunden und wurden wieder gelöscht.
- Es gibt keine Nutzerstimmen und keine Kennzahlen. Solche Angaben dürfen nicht erfunden werden.
- **Rechenannahmen** (Standardwerte, einstellbar, keine geprüften Fakten):
  - CO₂ für Benzin 2,37 kg/l und für Diesel 2,65 kg/l;
  - Strommix 380 g/kWh;
  - Ladeverlust E-Bike 15 %;
  - Laugenbreze ≈ 230 kcal;
  - Entfernungspauschale 0,38 €/km (vor der Steuererklärung prüfen).

## Product Principles

1. **Antwort zuerst:** Die Morgenentscheidung muss in einem Blick erfassbar sein. Details folgen danach.
2. **Ehrlich rechnen:** Ersparnis und Kalorien kommen aus echten Fahrzeug- und Fahrtdaten. Schätzungen werden gekennzeichnet und Annahmen bleiben einstellbar.
3. **Persönliche Schwellen schlagen allgemeine Wetterurteile:** Der Nutzer entscheidet, was für ihn Radwetter ist.
4. **Kostenlos und lokal:** keine Pflichtkonten, keine laufenden Kosten, Daten bleiben auf dem Gerät.
5. **Motivation ohne Druck:** Bilanz und Serien sollen ermutigen, nicht bestrafen.

## Accessibility & Inclusion

Es gibt keine besonderen Anforderungen. Grundlage sind lesbare Kontraste in Hell- und Dunkelmodus, Touch-Ziele mit mindestens 40–44 px und die Berücksichtigung von „Bewegung reduzieren“.
