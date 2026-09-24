# HATGEN 3D Produktseite

3D-Produktseite mit Scroll-Animationen für den **HATGEN S5500-5DS / S6500-5DS** Silent-Dieselgenerator von Heinze Automatisierungstechnik (Ruppertshofen).

Live (nach Merge auf `main`): https://cooljin.github.io/hatgen/

## Was die Seite kann

* Prozedurales 3D-Modell des Generators in three.js, ohne externe Modelldateien. Das Gehäuse, die Bedienblende mit Steckdosen, Display und Schlüsselschalter sowie die Innenteile (Motor, Generator mit AVR, Tank, Batterie, Schalldämpfer, Dämmung) sind einzeln modelliert.
* Scrollgesteuerte Kamerafahrten: Hero, Nahaufnahmen der Anschlüsse, Explosionsansicht, Blueprint mit Bemaßung, Modellwahl und Schlussbild mit laufendem Motor.
* Probestart per Button: Das Display bootet, das Aggregat vibriert, am Auspuff steigt Dampf auf.
* Die Modellwahl (5,5 oder 6,5 kW) ändert Leistungswerte, Preis, Datenblatt und das Typenschild am 3D-Modell.
* Adaptive Render-Qualität: Die Seite misst die Bildrate und schaltet Effekte bei schwachen Geräten stufenweise ab.
* Mobil optimiert: Das Produkt steht über dem Text, und die Bildausschnitte werden automatisch berechnet.
* Ohne WebGL erscheint ein statisches Posterbild, bei `prefers-reduced-motion` gibt es keine Bewegungsanimationen.
* DSGVO: Die Schriften liegen lokal, das YouTube-Video lädt erst nach Klick (2-Klick-Lösung), und es gibt keine externen Requests beim Laden.
* `noindex` (der Checkout ist eine Demo, die Seite soll nicht in Suchmaschinen erscheinen). Impressum und Datenschutz verweisen auf heinze-at.de.

## Lokal starten

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # Produktionsbuild nach dist/
npm run preview    # Build lokal ansehen
```

Nützliche URL-Parameter:

* `?debug` zeigt Abschnitt, Scrollfortschritt, Kamera und fps.
* `?quality=low|medium|high` erzwingt eine Render-Stufe.
* `?capture=poster` oder `?capture=og` rendert nur die 3D-Szene (für `public/img/poster.jpg` und `og.jpg`).

## Deployment (GitHub Pages)

Der Workflow `.github/workflows/pages.yml` baut bei jedem Pull Request (nur Build, kein Deploy) und deployt bei jedem Push auf `main`.

Einmalig einrichten: Repository Settings, Pages, Source auf **GitHub Actions** stellen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `index.html` | Seitenstruktur, alle Texte, JSON-LD, Meta-Tags |
| `src/styles/` | Design Tokens und Styles |
| `src/ui/` | Loader, Header, Scroll-Reveals, Schritte, Oszilloskop, Konfigurator, Einsatzbereiche, Video |
| `src/three/generator/` | Prozedurales Generator-Modell mit Öffnen, Explosion, Blueprint, Bemaßung, Motorlauf |
| `src/three/stage/` | Renderer, Licht, Boden, Kontaktschatten, Reflexion, Hintergrund, Post-Processing, Qualitätsstufen |
| `src/scroll/` | Director (Scroll zu Kamera und Zustand), Keyframes pro Abschnitt, 3D-Callouts |
| `src/content/models.js` | Produktdaten, Preise und Kontakt (Quelle: heinze-at.de) |
| `src/app.js` | Start: Smooth Scroll, 3D, Intro, Probestart |
| `dev/` | Testseiten für Modell (`dev/model.html`) und Bühne (`dev/stage.html`) |

Texte und Daten ändern: Produktdaten und Preise stehen in `src/content/models.js`, die sichtbaren Texte in `index.html`. Kamerafahrten lassen sich in `src/scroll/shots.js` anpassen.
