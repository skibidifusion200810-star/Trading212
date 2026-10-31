# GOLDX — Global Gold Trading Simulator

Ein responsives, globales Browser-Trading-Spiel mit **virtuellem Gold (XAU/USD)**. Keine echten Börsenkurse, kein Echtgeld und keine Auszahlungen. Alle Spieler sehen denselben serverseitig simulierten Kurs.

## Features

- Registrierung und Anmeldung mit gehashten Passwörtern, HTTP-only Session-Cookie
- **1.500 $ virtuelles Startguthaben**
- Affiliate-System: **genau ein Code pro Konto**; Neuling bekommt **+2.000 $**, Werber **+1.000 $**
- Gemeinsamer Live-Goldpreis, zufällige Marktrichtungen und zeitweise erhöhte Volatilität
- Candlestick-Chart mit Zeitintervallen, Zoom, Pan, Crosshair, SL/TP-Linien
- Long/Buy und Short/Sell mit Spread, Positionsgröße und simuliertem Hebel 1:20
- Market-, Limit- und Stop-Orders, Stop Loss, Take Profit, manuelles Schließen
- Serverseitige Berechnungen und Prüfungen der freien Margin
- WebSocket-Livechat, globales Ranking, Profil mit Trade-Statistik und Kontoaktivitäten
- Responsive Dark-Mode-UI auf Deutsch

### Technischer Aufbau

Node.js 20+ · Express · PostgreSQL · Socket.IO · HTML/CSS/Canvas/Vanilla-JavaScript. Ein einzelner Node-Webservice liefert Website, REST-API und WebSocket. Das Backend erstellt die Tabellen beim Start.

## In Render veröffentlichen (Blueprint)

1. Öffne **https://dashboard.render.com/blueprints** und wähle **New Blueprint Instance**.
2. Verbinde GitHub mit Render und wähle **skibidifusion200810-star/Trading212**.
3. Render erkennt die `render.yaml` im Repository und legt **goldx-trading** und **goldx-postgres** an.
4. Bestätige den Blueprint-Deploy. Render erzeugt automatisch das `SESSION_SECRET` und übernimmt die interne `DATABASE_URL` der Datenbank.
5. Sobald der Deploy erfolgreich ist, öffne die von Render angezeigte `https://...onrender.com`-Adresse und registriere dich.

Du kannst stattdessen einen manuellen Web Service erstellen: Build `npm install --omit=dev`, Start `npm start`, mit einer PostgreSQL-Datenbank und den Umgebungsvariablen `DATABASE_URL` und `SESSION_SECRET` (mindestens 32 zufällige Zeichen). Verwende für echte Nutzer HTTPS.

**Wichtig bei kostenlosen Render-Instanzen:** Webdienste schlafen nach ca. 15 Minuten ohne Traffic ein; während dieser Zeit läuft die Preisberechnung nicht weiter. Beim Aufwachen setzt sie mit dem zuletzt gespeicherten Kurs fort. Die kostenlose Render-PostgreSQL-Datenbank läuft derzeit nach **30 Tagen** ab und ist daher nicht als dauerhafte Produktionsdatenbank geeignet. Verwende für ein dauerhaftes, durchgehend laufendes Spiel einen passenden kostenpflichtigen Tarif und regelmäßige Backups.

## Lokal ausführen

Node.js und laufendes PostgreSQL erforderlich:

```bash
npm install
export DATABASE_URL="postgresql://postgres:password@localhost:5432/goldx"
export SESSION_SECRET="ersetze-dies-durch-einen-langen-zufaelligen-geheimen-schluessel"
npm start
```

Danach `http://localhost:3000` öffnen. Unter Windows PowerShell werden Umgebungsvariablen mit `$env:DATABASE_URL="..."` und `$env:SESSION_SECRET="..."` gesetzt.

## Regeln

- Jeder neue Account startet mit 1.500 virtuellen USD; mit gültigem Affiliate-Code mit 3.500 USD. Der Affiliate erhält 1.000 USD.
- Affiliate-Codes sind einmalig und können bei Erstellung nicht verändert werden. Pro E-Mail/Benutzername kann nur ein Konto erstellt werden.
- Long-Einstieg zum simulierten Ask, Long-Ausstieg zum Bid; bei Short umgekehrt. Der Spread beträgt 0,24 USD pro Feinunze.
- Margin = Einstiegspreis × Menge / 20. Schließen berücksichtigt realisierten P&L, Verluste werden höchstens bis zum verfügbaren Guthaben verrechnet.
- Affiliate-Boni sind nicht Bestandteil des Trading-Profits im Ranking.
- Der Markt ist unabhängig von Spielerpositionen; kein Echtgeld, keine echten Börsenpreise.

## Status und Grenzen

**Spielbare erste Version (MVP)**: Das Projekt ist zum Deploy vorbereitet, aber nicht durch einen vollständigen Live-Test auf Render/PostgreSQL freigegeben. Ein 24/7-Preismarkt, hochverfügbare Multi-Instance-Architektur und weitergehender Betrugsschutz benötigen zusätzliche Infrastruktur. Der Preisgenerator läuft nur, solange der Node-Prozess aktiv ist. Angelegte Orders werden serverseitig überwacht, solange der Prozess läuft; bei Schlafmodus/Restart besteht eine Pause. Für Produktion empfehlenswert: Worker/Leader-Lock, robuste Marktdaten-Catch-up-Logik, Monitoring, Echtzeit-Lasttests, Verifizierung von Accounts, Missbrauchserkennung, Admin-Moderation, weitere Tests und Datenbank-Backups.

### Sicherheitshinweise

Keine geheimen Schlüssel ins Repository committen. Die App ist ausschließlich ein Echtgeld-freies Spiel. Öffentliche Bestenlisten und Chat-Inhalte sind sichtbar; Nutzer müssen sparsam mit persönlichen Daten umgehen.

## Projektstruktur

```
├── server.js             # API, PostgreSQL, WebSockets, simulierte Trading-Engine
├── public/
│   ├── index.html        # Trading-Terminal und Seiten
│   ├── app.js            # Canvas-Chart, Frontend-Interaktionen und Socket-Client
│   └── style.css         # Modernes Responsive-Design
├── package.json
└── render.yaml           # Render Blueprint: Node-Webservice + PostgreSQL
```
