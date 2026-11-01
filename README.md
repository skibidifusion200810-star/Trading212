# GOLDX — Trading-Simulator

Ein globaler Multiplayer-Gold-Trading-Simulator mit **ausschließlich virtuellem Guthaben** und selbst simulierten Goldkursen (nicht die echten XAU/USD-Börsenkurse).

## Aufteilung (GitHub Pages + Render)

- **GitHub Pages:** statische Dateien aus `public/` (UI, Candlestick-Chart, Benutzerprofile, Leaderboard, Chat-Fenster).
- **Render:** Node.js-Backend mit Express und Socket.IO für Registrierung, Login, Goldkurs, Trades, Chat und Leaderboard.
- **Deine vorhandene Render PostgreSQL-Datenbank:** Benutzer, Guthaben, Transaktionen, Positionen, Chat. GOLDX benutzt dabei das eigene Datenbankschema `goldx`, damit andere Anwendungen in `public` unberührt bleiben.

**Es wird keine zweite kostenlose Datenbank erstellt.** Die Datenbank und der öffentliche Render-Backend-Link müssen einmalig in deinen Dashboard-Einstellungen konfiguriert werden. **Keine Datenbankzugangsdaten in GitHub oder den Chat kopieren.**

### 1. Render: Backend starten

1. Öffne deinen vorhandenen Render-Blueprint `trading-game`.
2. Klicke **Manual sync**. Die neue `render.yaml` enthält jetzt nur noch den Web-Service `goldx-trading`, keine Datenbank.
3. Öffne bei Render deine **bereits existierende PostgreSQL-Datenbank** und kopiere die **Internal Database URL**. Nutze diese nur im privaten Render-Dashboard.
4. Öffne Render → **goldx-trading** → **Environment** → **Add Environment Variable**.
   - Name: `DATABASE_URL`
   - Value: deine vorhandene **Internal Database URL**.
   - `SESSION_SECRET` wird über die Blueprint-Datei automatisch generiert.
   - `FRONTEND_ORIGIN` ist auf `https://skibidifusion200810-star.github.io` gesetzt.
5. **Save, deploy**, und überprüfe `https://DEINE-RENDER-ADRESSE.onrender.com/api/health`. Die Antwort soll `{"ok":true}` sein.
6. Kopiere die **öffentliche** Render-Backend-Adresse (z. B. `https://DEINE-RENDER-ADRESSE.onrender.com`, **nicht** die Datenbank-URL).

**Wichtig:** Backend und PostgreSQL müssen für die interne Datenbankadresse im selben Render-Region/privaten Netzwerk erreichbar sein. Die Blueprint-Datei setzt die Region `frankfurt`. Liegt deine existierende Datenbank in einer anderen Region, ändere den Eintrag `region` in `render.yaml` entsprechend, bevor du synchronisierst, oder verwende eine dafür geeignete externe Datenbankverbindung mit TLS.

**Render-Besonderheit:** Bei bereits existierenden Blueprints fordert Render `DATABASE_URL` (`sync: false`) nach Updates oft nicht erneut an. Du musst den Wert dann im Environment-Tab des Web-Service setzen. Ohne ihn startet GOLDX nicht.

### 2. GitHub Pages: Website veröffentlichen

1. Öffne im Repository **Settings → Pages**.
2. Stelle unter **Build and deployment → Source** **GitHub Actions** ein. (Nicht „Deploy from a branch“.)
3. Öffne **Settings → Secrets and variables → Actions → Variables → New repository variable**.
4. Erstelle die Variable:
   - **Name:** `GOLDX_API_URL`
   - **Value:** die öffentliche Render-Backend-Adresse, z. B. `https://DEINE-RENDER-ADRESSE.onrender.com` (ohne Pfad, ohne abschließenden Slash).
5. Öffne **Actions → Deploy GOLDX to GitHub Pages → Run workflow** (oder pushe erneut auf `main`).
6. Deine Pages-Adresse ist nach erfolgreichem Deploy normalerweise:
   **https://skibidifusion200810-star.github.io/Trading212/**

Wenn die Variable noch fehlt, zeigt GOLDX eine verständliche Einrichtungsmeldung statt einer defekten Anmeldung. Die GitHub Actions-Workflow-Datei `.github/workflows/pages.yml` erzeugt automatisch die öffentliche `config.js` für diese API-Adresse. Die URL ist öffentlich und darf in der Website stehen — **niemals** aber das private `DATABASE_URL`-Passwort oder `SESSION_SECRET`.

### 3. Testen

- Backend: `https://DEIN-BACKEND.onrender.com/api/health` → `{"ok":true}`.
- Pages: `https://skibidifusion200810-star.github.io/Trading212/`.
- Registriere einen Testnutzer: 1.500 $ Startguthaben.
- Erstelle einen Affiliate-Code (ein Code pro Benutzer). Registriere anderen Testnutzer mit Code: 3.500 $ Startguthaben; Werber erhält 1.000 $.
- Öffne zwei unterschiedliche Browser/Konten und prüfe gemeinsamen Kurs, Chat und Bestenliste.
- Teste BUY / SELL, Limit und Stop, Stop Loss/Take Profit.

### Wenn etwas nicht geht

| Fehler | Ursache / Lösung |
|---|---|
| „Backend noch nicht eingerichtet“ | GitHub Variable `GOLDX_API_URL` fehlt oder Pages-Workflow wurde danach nicht neu gestartet |
| „Failed to fetch“ oder CORS | Prüfe Render-URL, Backend-Status und `FRONTEND_ORIGIN`; nur HTTPS verwenden |
| Render startet nicht, `DATABASE_URL is required` | Füge `DATABASE_URL` im Environment-Tab des Render Web Service hinzu |
| PostgreSQL-Verbindung abgelehnt | Prüfe Datenbankname, Region, Internal Database URL und Rechte, im Render-Dashboard |
| Pages zeigt Repository-Inhalt statt App | Settings → Pages → Source → GitHub Actions setzen |
| Kein Chat nach Login | Prüfe Browser-Konsole, WebSocket-Verbindung und Render-Server-Logs |
| Render Sleep | Kostenloser Render-Service kann einschlafen; in der Zeit läuft die simulierte Markt-Engine nicht |

## Sicherheit & Grenzen

- Server berechnet verbindlich Kurs, Kontostände und Orders; keine echten Ein-/Auszahlungen.
- Pages speichert für Cross-Origin-Anmeldung einen signierten Login-Token bis zu 7 Tage im Browser (`localStorage`). In einer größeren Produktion empfehlen sich stärkere Sessions, Token-Widerruf und weitere Schutzmaßnahmen.
- Zugangsdaten bleiben serverseitig. Teile niemals deine Database URL, Passwörter, oder das `SESSION_SECRET` öffentlich.
- Keine vollständig hochverfügbare Börseninfrastruktur: Auf dem kostenlosen Render-Backend pausiert der Kursgenerator, wenn der Prozess schläft. Es gibt keine Marktnachholung für die Zwischenzeit. Nutzerpositionen bleiben gespeichert; die marktbedingten Ausführungen werden erst bei laufendem Server wieder geprüft.
- Für dauerhaft verfügbaren Handel und Daten sind ein laufender Server, beständige DB und Backups erforderlich.
- Einfache Accountprüfungen ersetzen keinen vollständigen Schutz gegen Mehrfachkonten oder Affiliate-Betrug.

## Lokal entwickeln

```bash
npm install
# DATABASE_URL und SESSION_SECRET über deine eigene Umgebung setzen
npm start
npm run check
npm test
```

`npm test` benötigt eine laufende PostgreSQL-Datenbank und eine `SESSION_SECRET`-Umgebungsvariable (mindestens 32 Zeichen). Die GitHub CI startet eine Testdatenbank automatisch.

## Dateien

```
server.js                  # Backend: Login, Kurse, Orders, Chat, PostgreSQL
public/index.html          # Statische Benutzeroberfläche
public/app.js              # Chart und API/WebSocket-Client
public/config.js           # Öffentliche API-Konfiguration (im Pages-Workflow generiert)
public/style.css           # Responsives UI
render.yaml                # Render-Web-Service ohne neue DB
.github/workflows/pages.yml # GitHub Pages Release
.github/workflows/ci.yml   # Integrationstests
tests/smoke.test.js        # Auth, Affiliates, Orders, Livechat, CORS
```
