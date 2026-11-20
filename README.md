# Digitalfunk-Trainer

WebApp für Funkübungen mit echten Funkgeräten. Die App verteilt Aufgaben, prüft Texteingaben und zeigt der Übungsleitung den Fortschritt. Sie überträgt kein Audio. Die mitgelieferten Meldungen sind erfunden.

## Starten

Docker und Docker Compose reichen aus. Node.js und SQLite laufen im Container.

`.env.example` nach `.env` kopieren und `ADMIN_PASSWORD` setzen. Die Ports werden ebenfalls dort eingestellt.

```sh
docker compose -f compose.dev.yml up -d --build
```

Mit den Beispielports ist die App unter `http://localhost:5173` erreichbar, die Übungsleitung unter `/admin`. Für Smartphones im gleichen WLAN `DEV_BIND_IP=0.0.0.0` setzen und die IP des Rechners statt `localhost` verwenden.

```sh
# Logs
docker compose -f compose.dev.yml logs -f

# Tests und Build
docker compose -f compose.dev.yml exec app npm test
docker compose -f compose.dev.yml exec app npm run build

# Stoppen
docker compose -f compose.dev.yml down
```

Quellcodeänderungen werden automatisch übernommen. Abhängigkeiten und Datenbank liegen in Docker-Volumes. `down` behält die Daten, `down -v` löscht sie.

## Eine Übung durchführen

Unter `/admin` ein Game mit 2, 4 oder 6 Gruppen und 1–15 Runden erstellen. Die Gruppen öffnen die Startseite und treten mit dem Beitrittspasswort bei. Jede Gruppe braucht ein eigenes Gerät oder Browserprofil; Tabs desselben Profils teilen die Anmeldung.

Jede Gruppe hat einen Sende- und einen Empfangsauftrag. Sind beide Aufträge bei allen Gruppen bestätigt, beginnt die nächste Runde mit anderen Funkpartnern. Ab 4 Gruppen sind Sende- und Empfangspartner verschieden. Bei 4 Gruppen kehrt sich die Richtung des Funkrings nach jeder Runde um.

Die Übungsleitung sieht live alle Aufgaben und offenen Bestätigungen. Sie kann Runden überspringen oder die Übung beenden. Danach gibt es eine Auswertung pro Runde. „Alles zurücksetzen“ löscht Game, Gruppen und Auswertung, solange keine Übung läuft. Ein neues Game ersetzt ebenfalls alle bisherigen Spieldaten.

Ein Reload oder Verbindungsabbruch verliert weder Gruppenplatz noch Spielstand. Nach einem Backendneustart muss sich nur die Übungsleitung neu anmelden.

## Aufgaben ändern

Die Textinhalte stehen in `backend/data/`:

- `words.json`: Begriffe zum Buchstabieren.
- `equipment.json`: Listen mit jeweils sechs Gegenständen, in der gewünschten Reihenfolge.
- `messages.json`: Lagemeldungen mit frei benannten Textfeldern. Auch Zahlen werden als Text eingetragen.

Die vorhandenen Dateien zeigen das Format. Jede Datei braucht mindestens einen Eintrag, einzelne Texte dürfen höchstens 250 Zeichen lang sein. Nach Änderungen den Entwicklungscontainer mit `docker compose -f compose.dev.yml restart app` neu starten.

Skizzen als SVG direkt in `backend/drawings/` ablegen. Neue Dateien werden ohne Neustart für neue Aufgaben eingelesen. Bereits vergebene Skizzen während einer Übung nicht umbenennen oder entfernen.

## Betrieb auf einem Server

```sh
docker compose up -d --build
```

Der Produktionscontainer liefert die gesamte App aus. `APP_PORT` aus `.env` wird nur an die Loopback-Adresse des Servers gebunden. Reverse-Proxy und HTTPS müssen selbst eingerichtet werden; die Admin-Anmeldung im Produktionsmodus benötigt HTTPS. Es gibt keine automatische Bereitstellung oder Aktualisierung.

Nach Code- oder Inhaltsänderungen den Container neu bauen. Für eine Datensicherung die App stoppen und das Datenvolume sichern.

`.env`, Datenbanken, Logs und lokale Konfiguration gehören nicht ins Repository. `.env.example` enthält keine Zugangsdaten. Die Beispieldaten können durch eigene fiktive Übungsdaten ersetzt werden.
