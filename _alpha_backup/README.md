# APEX & PASS

**Sim-Cade Motorcycle Racing — spielbarer Vertical-Slice-Prototyp**

Minimalistische Bergwelt, drei eigenständige Bikes, eine Fahrphysik, die Wheelies, Stoppies, Bremsslides, Powerslides und Burnouts aus Kräften entstehen lässt. Kein Build, keine Installation, kein Internet nötig.

![APEX & PASS Menü](screenshots/menu.png)

---

## Sofort starten

1. Ordner `apex-and-pass` öffnen.
2. `index.html` doppelklicken (Chrome, Edge, Safari oder Firefox).
3. Bike, Strecke, Modus und Licht wählen → **FAHREN**.
4. Kopfhörer empfohlen — der Motorsound ist prozedural synthesiziert.

Das Spiel läuft komplett lokal. Three.js liegt als `three.min.js` daneben; es gibt keine externen Requests, keinen Server und keinen Build-Schritt.

---

## Steuerung

### Tastatur

| Taste | Funktion |
|---|---|
| `W` | Gas (progressiv über Rampe) |
| `S` | Vorderradbremse (Stoppie, harte Anbremszone) |
| `X` | Hinterradbremse (Wheelie-Kontrolle, Backing-it-in, Burnout) |
| `A` / `D` | Lenken / Schräglage |
| `←` / `→` | Fahrer-Gewichtsverlagerung links/rechts (Hanging-Off) |
| `↑` / `↓` | Gewicht nach vorne/hinten (Stoppie-/Wheelie-Bias) |
| `Leertaste` | Manuelle Kupplung |
| `Q` / `E` | Runterschalten / Hochschalten |
| `C` | Kamera: Chase ↔ Helm-POV |
| `R` | Quick-Reset (Motorrad aufstellen) |
| `Esc` | Pause / Setup |
| `M` | Ton an/aus |
| `H` | Steuerungshinweis einblenden |

### Gamepad (Dual-Stick)

- Linker Stick: Lenken
- Rechter Stick: Gewichtsverlagerung (X = Hanging-Off, Y = vorne/hinten)
- RT / LT: Gas / Vorderradbremse
- B / A: Hinterradbremse / Kupplung
- RB / LB: Hoch-/Runterschalten
- Y: Kamera, Start: Pause, Back: Reset

Die Fahrhilfen (TC, ABS, Anti-Wheelie) lassen sich im Pause-Menü mehrstufig regeln oder komplett abschalten.

---

## Was in diesem Prototyp steckt

### Drei Bikes mit eigenem Charakter

| Bike | Motor | Fahrverhalten |
|---|---|---|
| **STRADA V4** | 1100 cm³ V4, 153 kW | Brachialer Antritt, breiter Lenker, wheelie-freudig, fette Powerslides |
| **CORSA 600** | 600 cm³ Inline-4, 88 kW | Leichtfüßig, späte Bremspunkte, hohe Kurvengeschwindigkeit, Stoppie-Maschine |
| **NOMAD 1300** | 1300 cm³ Boxer-Twin, 100 kW | Druck aus dem Keller, lange Federwege, hoher Schwerpunkt, setzt früh auf |

Jedes Bike hat ein eigenes Low-Poly-Modell (Gabel, Schwinge, Federbein, Auspuff, Bremsen, Boxer-Zylinder, Koffer), eine eigene Sitzposition und eine eigene prozedurale Sound-Signatur (V4-Grollen, Inline-4-Kreischen, Boxer-Blubbern).

### Zwei Strecken

- **BERGPASS** — 2,06 km Serpentinen-Loop mit Höhenzug, Kuppen, Felswänden, Leitplanken und weitem Talblick. Kurvenräubern, Wheelies über Kuppen, Backing-it-in.
- **HOCKENHEIM GP** — 2,06 km Circuit mit langer Gerade, technischen Kehren, Curbs, Reifenstapeln und Streckenwerbung. Top-Speed und harte Anbremszonen.

### Fahrphysik (240-Hz-Substepping)

- Dynamischer Schwerpunkt: Fahrergewicht (links/rechts/vorne/hinten) verschiebt den effektiven CoM und damit Grip, Wheelie- und Stoppie-Moment.
- Lasttransfer: Bremsen belastet das Vorderrad, Beschleunigen das Hinterrad; Wheelie/Stoppie entstehen aus dem Drehmoment um den Aufstandspunkt.
- Kupplung, Getriebe, Drehzahlbegrenzer, Quickshifter-Feeling, Anti-Hopping-Anklang.
- Kombiniertes Grip-Modell mit Längs- und Querschlupf: Powerslides, Bremsslides, Highsider beim abrupten Gaswegnehmen, Lowsider bei blockierendem Vorderrad.
- 3-Zonen-Reifentemperatur (links/mitte/rechts) pro Reifen: kalt = wenig Grip, optimales Fenster = maximaler Grip, überhitzt = schmierig.
- Reifenmischung (Soft/Medium/Hard), Reifendruck, Federhärte, Dämpfung und Übersetzung greifen direkt in die Physik.
- Stürze: Lowsider, Highsider, Looping, Stoppie-Flip, Leitplanken-Einschlag; Fahrer wird abgekoppelt und tumbled physikalisch, Bike rutscht mit Funken; Quick-Reset per `R`.

### Time Attack & Ghost

- Rundenzeit, Live-Delta zur Bestzeit, Bestzeiten pro Strecke/Bike in `localStorage`.
- Ghost der eigenen Bestzeit als transparente blaue Silhouette.
- Free Ride ohne Zeitdruck, inklusive Tageszeit-Auswahl (Golden Hour, Mittag, Dämmerung).

### HUD & Kameras

- Tacho/Drehzahlband mit Schaltblitz, Gang, km/h, Eingabe-Balken.
- Reifen-Widget mit drei Temperaturzonen pro Reifen, Gewichtsverlagerungs-Pad.
- Chase-Kamera mit Lean-Mitneigung, Apex-Verschiebung und Speed-FOV; Helm-POV mit Cockpit, Blick in den Scheitelpunkt und Kopfausgleich.

### Look & Sound

- Prozedurale Low-Poly-Bergwelt mit Gradient-Shading, atmosphärischem Nebel, gemaltem Bergpanorama, Kiefern, Felsbrocken, Leitplanken, Curbs und Sonnenuntergang.
- Darkies/Skidmarks als dynamische Mesh-Strips, Reifenrauch und Funken als Partikelsysteme.
- Motor, Ansauggeräusch, Reifenquietschen, Wind, Schaltvorgänge und Crash-Sound komplett per WebAudio synthetisiert.

---

## Fahr-Tipps

- **Erste Kurven:** Reifen starten kalt. Zwei, drei saubere Kurven geben Grip; danach liegt das Bike deutlich satter.
- **Wheelie:** Im Setup `Anti-Wheelie` auf `OFF`, dann im 1. oder 2. Gang bei mittlerer Drehzahl Gas aufziehen. Hinterradbremse (`X`) kontrolliert den Kippwinkel.
- **Stoppie:** `ABS` auf `OFF`, bei höherer Geschwindigkeit progressiv `S` ziehen und Gewicht nach vorne (`↑`). Zu viel Bremsdruck → Stoppie-Flip.
- **Burnout:** Im Stand `X` (Hinterradbremse) + `W` (Gas) halten. Der Reifen heizt auf, raucht und hinterlässt einen schwarzen Fleck. Danach ist der Hinterreifen erst mal „gut“ — oder zu heiß.
- **Powerslide:** TC auf `OFF` oder `1`, in Schräglage am Kurvenausgang Gas öffnen. Gas halten, nicht abrupt schließen — sonst Highsider.
- **Backing-it-in:** Vor der Kurve hart vorne bremsen, dabei leicht einlenken und mit `X` das Heck lockern.
- **Setup:** Weichere Feder vorne = mehr Gabeltauchen und Stoppie-Neigung. Weichere Feder hinten = mehr Squat und Wheelie-Neigung. Kurze Übersetzung = mehr Punch, weniger Top-Speed.

---

## Technik

- **Three.js r128** (lokal, kein CDN), klassische Scripts — läuft auch per `file://`.
- **240 Hz fixed-step Physics** mit bis zu 30 Sub-Steps pro Frame; Rendering über `requestAnimationFrame`.
- **Kein Build-Step**, keine npm-Abhängigkeiten, keine externen Assets. Alle Texturen (Asphalt, Gras, Banner, Panorama) werden zur Laufzeit auf Canvas gezeichnet.
- Bestzeiten/Ghosts: `localStorage`-Keys `apex_best_v2_<track>_<bike>`.

### Dateien

```
apex-and-pass/
├─ index.html
├─ style.css
├─ three.min.js
├─ js/
│  ├─ util.js      Mathe, Daten, WebAudio-Engine
│  ├─ world.js     Strecken, Terrain, Props, Panorama
│  ├─ bike.js      3D-Modelle, Fahrer-Rig
│  ├─ physics.js   Fahrphysik, Reifen, Stürze
│  └─ game.js      Loop, Kamera, HUD, Time Attack, FX
├─ screenshots/
└─ README.md
```

---

## Ehrlicher Scope

Das ist ein **spielbarer Vertical-Slice-Prototyp**, kein fertiges Steam-Spiel. Die Kernpfeiler aus dem GDD sind umgesetzt und direkt erlebbar:

- emergente Fahrmanöver statt geskripteter Animationen,
- drei klar unterschiedliche Bikes,
- Bergpass und GP-Layout,
- Reifenthermodynamik und Setup,
- Time Attack mit Ghost,
- prozeduraler Sound und stilisierte Low-Poly-Welt.

Für einen echten Steam-Release fehlen weiterhin: vollständige Rigid-Body-/Ragdoll-Simulation mit echter Fahrer-IK, FMOD-Integration mit aufgenommenen Samples, Streckenausbau, Menü-/Progression-System, Spielpad-Feinabstimmung, Lokalisierung, Plattform-/Steam-Anbindung und ein professionelles Art-/Content-Pipeline. Der Prototyp ist bewusst so gebaut, dass diese Systeme anschließend ergänzt werden können.
