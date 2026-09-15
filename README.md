# Tagwerk

Tages- und Wochenplaner mit verschiebbaren Zeitblöcken – für iPhone **und** Mac.
Läuft komplett lokal im Browser, ohne Konto, ohne Server, offline.

![Woche](docs/screenshot-woche.png)

## Das Konzept

Drei Ebenen, die zusammenspielen:

| Ebene | Wofür | Wo |
|---|---|---|
| **Zeitblöcke** | Der eigentliche Tagesplan: „Deep Work 9–11", „Lernsession Statistik 14–15:30" | Kalenderraster, per Finger/Maus verschieb- und dehnbar |
| **Wochenaufgaben** | Was diese Woche irgendwann passieren muss – ohne festen Termin | Seitenleiste, an die Kalenderwoche gebunden |
| **To-dos** | Kleinkram für einen Tag, plus Checklisten *innerhalb* eines Blocks (z. B. Schritte einer Lernsession) | Seitenleiste bzw. im Block-Editor |

Der Kniff: Aufgaben lassen sich mit einem Tipp (📅) in einen echten Zeitblock verwandeln –
die App sucht dafür automatisch die nächste freie Lücke im Tag.

## Funktionen

**Planen**
- Wochen- und Tagesansicht, Raster frei einstellbar (5–60 min)
- Blöcke ziehen (Zeit **und** Wochentag), an beiden Kanten dehnen
- Anlegen: auf dem Mac ins leere Raster ziehen, auf dem Handy antippen
- Überlappende Blöcke werden automatisch nebeneinander gelegt
- 8 Farben, Notizen, „Erledigt"-Haken, Jetzt-Linie, Zoom, Dunkelmodus

**Wiederholen**
- wöchentlich, alle 2, 3 oder 4 Wochen
- beliebige Wochentag-Kombination (z. B. Mo + Mi + Fr)
- optionales Serienende
- Einzelne Termine dürfen abweichen: Verschieben wirkt erst nur auf diesen Termin,
  per Tipp auf „Ganze Serie" im Hinweis gilt es für alle. Genauso beim Bearbeiten und Löschen.

**Aufgaben**
- Wochenaufgaben pro Kalenderwoche, offene per Klick aus der Vorwoche übernehmen
- Tages-To-dos
- Checkliste pro Block – die Haken gelten nur für den einzelnen Termin,
  die Schritte selbst für die ganze Serie (perfekt für wiederkehrende Lernsessions)

**Drumherum**
- Überblick: geplante Stunden pro Tag/Woche, erledigte Blöcke, Balken über die Woche
- Rückgängig/Wiederherstellen (⌘Z / ⇧⌘Z)
- Sicherung als JSON exportieren und importieren (auch zum Umzug aufs zweite Gerät)
- Beispielwoche zum Ausprobieren (Menü ⋯)
- Offline nutzbar, Daten bleiben auf dem Gerät

**Kurzbefehle:** `←`/`→` blättern · `T` heute · `D`/`W` Ansicht · `N` neuer Block · `⌘Z` zurück · `Esc` schließen

## Auf dem Gerät installieren

Die App ist eine PWA – kein App Store, keine Installation im klassischen Sinn.

**iPhone/iPad:** Adresse in **Safari** öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.
Danach startet Tagwerk wie eine native App im Vollbild, inklusive Icon.

**Mac:**
- Safari 17+: Adresse öffnen → *Ablage* → *Zum Dock hinzufügen*
- Chrome/Edge: Symbol „Installieren" in der Adressleiste

**Wichtig:** Die Daten liegen pro Gerät im lokalen Speicher des Browsers – iPhone und Mac
synchronisieren sich also *nicht* automatisch. Für den Umzug: Menü ⋯ → *Daten sichern (JSON)*
und auf dem anderen Gerät → *Daten laden (JSON)*.

### Veröffentlichen

Jeder Static-Hoster genügt, die App braucht keinen Build.

- **GitHub Pages:** in den Repo-Einstellungen unter *Pages* als Quelle *GitHub Actions* wählen –
  `.github/workflows/pages.yml` veröffentlicht dann jeden Push auf `main`.
- **Netlify/Vercel/Cloudflare Pages:** Repo verbinden, kein Build-Befehl, Ausgabeverzeichnis `.`
- **Eigener Server:** Ordner hochladen. HTTPS ist Pflicht, sonst startet der Service Worker nicht.

## Lokal starten

```bash
npm run dev          # http://localhost:4173
npm test             # 19 Logiktests (Serien, Datum, Speicher)
npm run test:browser # End-to-End im echten Chromium (Ziehen, Editor, Mobilansicht)
```

Node 22+, sonst nichts. **Null Abhängigkeiten** – kein Bundler, kein Framework,
`index.html` lässt sich notfalls direkt öffnen.

## Aufbau

```
index.html            Gerüst
styles.css            Design-Tokens, Hell/Dunkel, Handy-Layout
app/
  dates.js            Datum, ISO-Kalenderwochen, Formatierung
  store.js            Zustand, localStorage, Undo, Export/Import
  recurrence.js       Serien → konkrete Termine, Überlappungs-Layout
  grid.js             Raster, Ziehen, Dehnen, Anlegen (Maus + Touch)
  editor.js           Block-Editor (Serien, Checkliste, Farben)
  panels.js           Wochenaufgaben, Tages-To-dos, Überblick
  ui.js               Sheet, Menü, Toasts
sw.js                 Service Worker (Offline)
scripts/              Dev-Server, Icon-Generator, Browser-Test
tests/run.mjs         Logiktests
```

### Datenmodell

Ein Block ist entweder ein Einzeltermin oder eine Serienvorlage:

```js
{ id, title, color, notes, date, start /* Minuten ab 0 Uhr */, duration,
  todos: [{ id, title, done }],
  recur: { every: 2, weekdays: [1, 3], until: null } | null }
```

Abweichungen einzelner Serientermine liegen in `overrides["blockId|YYYY-MM-DD"]`
(`start`, `duration`, `movedTo`, `deleted`, `todoDone`, …). Dadurch bleibt die Serie
eine einzige Zeile, und trotzdem darf jeder Termin anders sein.

Datumsarithmetik läuft über UTC-Tagesindizes, damit Sommer-/Winterzeit nichts verschiebt.

## Später möglich

- Synchronisierung zwischen Geräten (z. B. über einen kleinen eigenen Server oder iCloud Drive/JSON)
- Abo-Import aus bestehenden Kalendern (`.ics`)
- Vorlagen: eine ganze Woche als Vorlage speichern und auf andere Wochen anwenden
- Als echte Desktop-App verpacken (Tauri oder Electron um dieselben Dateien)
- Statistik über längere Zeiträume (geplant vs. tatsächlich erledigt)

## Lizenz

MIT
