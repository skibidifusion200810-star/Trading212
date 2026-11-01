# GOLDX – direkt auf GitHub Pages spielen

**Spiel starten: https://skibidifusion200810-star.github.io/Trading212/**

GOLDX ist ein virtuelles Gold-Trading-Spiel, das als **Browser-Demo komplett ohne Render, Backend, Server oder Datenbank** funktioniert. Du brauchst **keinen Render-Account und keine E-Mail**.

## Anmeldung

- Beim ersten Aufruf **Registrieren** auswählen.
- Benutzername (3–20 Buchstaben/Zahlen/Unterstrich) und Passwort (8–72 Zeichen) eingeben.
- Jeder neue Spieler bekommt **1.500 $ virtuelles Startguthaben**.
- Für spätere Besuche mit demselben Gerät und Browser wieder mit Benutzername/Passwort anmelden.
- Konten und alle Daten existieren **ausschließlich in deinem eigenen Browser**. Andere Geräte haben keine gemeinsame Datenbank. Löscht man Browserdaten, gehen die Spielstände verloren.

Passwörter werden im Browser mit PBKDF2 gehasht gespeichert, aber dies ist **keine serverseitig sichere Benutzerverwaltung**: Wer Zugriff auf deine Browserdaten hat, kann Spielstände manipulieren. Verwende deshalb **kein Passwort, das du für echte Dienste nutzt**.

## Was funktioniert?

- Live animierter, *zufällig simulierter* Goldkurs / Candlestick-Chart mit Zeitintervallen
- BUY / LONG und SELL / SHORT
- Virtuelles Guthaben, Kontostand, Equity, Margin, Gewinne und Verluste
- Market-, Limit- und Stop-Orders; Take Profit und Stop Loss
- Orders manuell schließen, Order-Historie
- Lokale Bestenliste der Konten, die **auf demselben Browser** angelegt wurden
- Ein Affiliate-Code pro lokalem Benutzer. Anmeldung mit dem Code auf **demselben Gerät und Browser**: neuer Benutzer +2.000 $ (insgesamt 3.500 $); Code-Inhaber +1.000 $
- Lokales Nachrichtenfenster, das auf diesem Browser gespeichert bleibt
- Responsive Dark-Mode-Oberfläche

**Wichtige Einschränkung:** Ein echter *weltweiter* Live-Chat, gemeinsame Bestenliste, weltweite Affiliate-Codes und gemeinsam synchronisierte Kurse sind auf **GitHub Pages allein technisch nicht möglich**. Dafür wäre ein zusätzlicher Onlinedienst/Backend nötig. Diese Demo täuscht keine weltweiten Spieler vor. Der Markt tickt im geöffneten Browser und pausiert, wenn die Seite geschlossen ist. Alles ist virtuelles Spielgeld, keine echten Goldkurse oder Zahlungen.

## GitHub Pages einrichten

1. Repository: https://github.com/skibidifusion200810-star/Trading212
2. **Settings → Pages → Build and deployment → Source → GitHub Actions** wählen.
3. GitHub startet nach jedem Push automatisch den Workflow **Deploy playable GOLDX to GitHub Pages**.
4. Wenn die Action erfolgreich ist, die Seite öffnen:
   **https://skibidifusion200810-star.github.io/Trading212/**
5. Falls du noch die alte Seite siehst, ein hartes Neuladen mit **Strg + F5** durchführen oder den privaten Browsermodus testen.

Die Seite wird ausschließlich aus dem Ordner `public/` bereitgestellt, ohne Umgebungsvariablen und ohne Render-Verbindung.

## Projektstruktur

- `public/index.html` – Website und Login ohne E-Mail
- `public/style.css` – modernes Design
- `public/app.js` – Interface, Canvas-Chart und Trading-Steuerung
- `public/demo.js` – lokale Spielengine, Registrierung, Guthaben, Trading, Chat, lokale Bestenliste und Affiliate-Logik
- `.github/workflows/pages.yml` – automatische GitHub-Pages-Veröffentlichung
- `tests/browser-demo.test.js` – automatische Tests der lokalen Spielfunktionen

Die älteren Backend-Dateien `server.js` und `tests/smoke.test.js` sind noch im Repository, werden von GitHub Pages **nicht** benötigt und laufen **nicht** als Backend. Die Render-Blueprint-Datei wurde entfernt.

## Tests

Die GitHub-Action `GOLDX CI` prüft Javascript-Syntax und die Spiellogik. Für lokale Tests ist Node.js erforderlich:

```bash
npm install
node --test tests/browser-demo.test.js
```

`npm test` prüft zusätzlich den älteren Server-Code und benötigt eine PostgreSQL-Testdatenbank. Zum Spielen über GitHub Pages ist PostgreSQL nicht erforderlich.
