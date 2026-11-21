# Grafik-Plan: Schwarzhornpass

Stand: 21.11.2026. Betrifft nur den Pass im Golden-Hour-Stil (`js/passstyle.js`). Die drei alten Rundkurse sind nicht Teil dieses Plans.

Ziel: Das Bild soll schärfer und sauberer werden und mehr Kontrast bekommen, ohne den flachen Low-Poly-Stil zu verlassen. Es wird nichts eingebaut, das das Bild unruhig macht.

## Leitplanken

Diese Punkte sind entschieden und gelten für jeden Schritt:

- **Das HUD bleibt, wie es ist.** Kein Schritt fasst `style.css` oder die HUD-Elemente an. In den Einstellungen kommt genau eine Zeile dazu (Himmel, siehe 1.4).
- **Keine Bewegungsunschärfe.** Auch keine Randunschärfe, keine Speed-Lines, kein zusätzliches Kamerawackeln, keine Farbsäume. Tempo wird nur über die Welt gezeigt (Blätter, Staub), nie über einen Filter auf dem Bild.
- **Nichts Neues, das mit der Entfernung umschaltet.** Das hat beim Drauf-zu-Fahren schon einmal gezittert. Ein Objekt sieht aus jeder Entfernung gleich aus. Vorhandene Entfernungslogik (Gras-Ausdünnung in `update`, Fugen-Ausblendung der Mauer) wird nicht erweitert.
- **Jeder Schritt wird in Bewegung geprüft**, nicht nur am Standbild (siehe „Prüfen“).

## Ausgangslage

Gemessen an Standbildern vom aktuellen Stand (Verfolger, Helm, von oben; Grafik „Hoch“, 1280×720, Software-Renderer). Farben sind dort exakt, Framerate und Bewegung waren nicht zu beurteilen.

| Befund | Messwert / Stelle |
|---|---|
| „Mittel“ rendert auf Retina nur ein Viertel der Pixel | Deckel 1,0 bei Pixeldichte 2 (`game.js:87`); „Hoch“ 1,5 |
| Grafikstufe ändert im Pass nur die Auflösung | `passstyle.js` liest die Stufe nicht; Schatten 4096 und Gras immer voll |
| Schatten weich und flau | VSM, Radius 4 (`passstyle.js:266`, `:726`); Himmelslicht 1,45 gegen Sonne 2,25 (`:17`) |
| Schlagschatten des Motorrads kaum sichtbar | Sonne steht 13° hoch, der Schatten müsste gut 4× so lang sein wie das Bike hoch |
| Blockige Schattenflecken auf der Leitplanke | sichtbar im Verfolger, rechte Leitplanke |
| Asphalt kommt graubraun an statt lavendel | Palette `#888fba`, am Bildschirm ca. rgb 116/96/87; Linien ocker statt weiß |
| Himmel dunkler und violetter als die Palette | Palette `#8fa3d8`, am Bildschirm ca. rgb 99/97/166; Shader ohne Gamma-Kodierung (`:248–258`) |
| Ferne Hänge flächig orange | ca. rgb 206/123/72; die drei Silhouetten-Ringe (`:369`) gehen unter |
| Fahrer und Bike heben sich kaum ab | schwarz-weiß auf dunkler Straße, im Verfolger rund 130 px hoch bei 720p |
| Keine Wolken, keine Sonnenscheibe im Bild | Himmel ist ein reiner Verlauf |

## Phase 0: Vergleichsbasis

Vor der ersten Änderung, damit jeder Schritt gegen denselben Stand verglichen wird.

- Sechs feste Bilder mit `tools/psgame.js` (braucht Playwright und Chrome, die KI fährt die Strecke): Verfolger bei Schritt 500, 1400, 2600 und 4200, Helmkamera bei 1400, von oben bei 2600. Ablage in `screenshots/grafik/vorher/`.
- Eine Zitter-Folge: 30 aufeinanderfolgende Bilder an zwei Stellen (Anfahrt auf die Mauer, Anfahrt auf den Waldrand). Daraus die Helligkeitsschwankung pro Pixel berechnen; die Zahl ist der Vergleichswert für später.

## Phase 1: Schärfe und Licht

Größte Wirkung, kein neues Asset. Reihenfolge wie nummeriert, weil 1.3 und 1.4 die Farben verschieben und danach alles andere abgestimmt wird.

### 1.1 Auflösung und Grafikstufen (Aufwand: klein)

- Die Stufe steuert künftig auch Schattenkarte und Grasdichte, damit Auflösung frei wird.
- Vorschlag, auf deinem Mac gegen die Framerate abzustimmen:

| Stufe | Pixeldichte-Deckel | Schattenkarte | Gras |
|---|---|---|---|
| Niedrig | 0,8 → 1,0 | 2048 | 50 % |
| Mittel | 1,0 → 1,5 | 4096 | 75 % |
| Hoch | 1,5 → 2,0 | 4096 | 100 % |

- Die Grasdichte ist ein fester Faktor pro Stufe beim Aufbau der Welt, keine Entfernungslogik.
- **Standard wird „Hoch“** (entschieden: der erste Eindruck zählt). Stellen: Vorgabe in `game.js:60`, Hinweistext `qNote` („Für starke Grafikkarten“ passt dann nicht mehr), README Zeile 27. Wer schon gespielt hat, behält seine gespeicherte Stufe; die neue Vorgabe gilt nur für neue Spieler.
- Weil „Hoch“ damit auch auf schwächeren Rechnern startet, muss der Start sauber sein: Die automatische Absenkung fängt zu lange Bilder ab, aber erst nach 3 Sekunden. Zu prüfen ist, ob die ersten Sekunden auf einem schwächeren Gerät ruckeln.
- Die automatische Absenkung (`game.js:743`) bleibt. Sie senkt die Auflösung während der Fahrt in Sprüngen von 12 %; zu prüfen ist, ob das als Ruck auffällt.
- Stellen: `game.js:85–92`, `passstyle.js:264` und Gras ab `:679`.
- Ein Schärfefilter kommt erst ganz am Ende und nur, wenn die Zitter-Folge ruhig bleibt. Auf feinem Gras verstärkt er Flimmern.

### 1.2 Schatten (klein bis mittel)

- Weichzeichnung von Radius 4 auf etwa 1,5 bis 2; alternativ zurück zu PCF-Soft. Beide Varianten gegen die Flecken auf der Leitplanke testen.
- Himmelslicht von 1,45 auf etwa 0,9 bis 1,0, damit Schatten Tiefe bekommen. Die Schattenfarbe bleibt violett über das Himmelslicht (`hemiSky`).
- Die Schattenreichweite bleibt bei 70 m. Enger wäre schärfer, aber dann tauchen Schatten beim Näherkommen auf, und genau das soll nicht passieren.
- Das Einrasten der Schattenkamera auf Texel (`world.js:761`) bleibt unangetastet.
- Ziel: Der lange Schatten des Motorrads liegt klar auf der Straße.

### 1.3 Sonne und neutrale Farben (klein)

- Sonnenfarbe von `#ffc890` auf einen helleren, weniger gesättigten Ton (Start: `#ffe0bd`), Stärke nachziehen.
- Die Wärme kommt danach aus Dunst und Farbabstimmung im letzten Pass (`fx.js:85`, die Lichter-Tönung gibt es dort schon).
- Zielwerte am Bildschirm: Asphalt kühl grauviolett, Linien klar cremeweiß, Seitenstreifen grau statt erdbraun.
- Danach alle Palettenfarben einmal gegen das Bild prüfen (`passstyle.js:16–30`).

### 1.4 Himmel in zwei Varianten, wählbar (mittel)

Entschieden: Beide Himmel werden gebaut und sind in den Einstellungen wählbar.

- **Violett:** der tiefe Abendhimmel wie jetzt. Der Dunst der Berge wird darauf abgestimmt, damit Horizont und Hänge zusammenpassen.
- **Blau:** das hellere Blau der Palette (`#8fa3d8`). Dafür bekommt der Himmel-Shader dieselbe Kodierung wie der Rest (`passstyle.js:248–258`).
- Eine Variante ist ein Satz aus Himmelsfarben, Dunstfarben und der Umgebung für die Lackspiegelung (`:267`), damit alles zusammenpasst.
- Die Dunstfarben sind heute fest in den Shader geschrieben (`:50–66`). Sie werden zu Werten, die pro Variante gesetzt werden.
- **Einstellung:** neue Zeile „HIMMEL: VIOLETT / BLAU“ unter „GRAFIK“ (`game.js:626`), deutsch und englisch, gespeichert wie die anderen. Beim Umschalten wird die Welt neu aufgebaut, so wie heute beim Look-Schalter (`game.js:138`).
- Die Zeile wirkt nur auf den Pass. Vorgabe bleibt Violett, bis du beide nebeneinander gesehen hast.
- Die Schritte 1.3, 2.3 und 2.4 werden für beide Varianten abgestimmt und geprüft.

## Phase 2: Held und Stil

### 2.1 Motorrad und Fahrer abheben (mittel)

- Kantenlicht in Sonnenfarbe auf Lack, Leder und Helm (im Shader, hängt nur vom Blickwinkel ab).
- Eine Akzentfarbe am Fahrer, zum Beispiel Helmstreifen und Schulterpartie.
- Keine Kontur (entschieden): Ohne Umrisslinie wirkt das Bild natürlicher. Das Abheben kommt allein aus Licht, Farbe und dem Schlagschatten aus 1.2.
- Stellen: `models.js:150–175`, `passstyle.js:744` (`tameBike`).

### 2.2 Trockenmauer (klein)

- Fugen heller und schmaler, Steine flacher und lagiger, damit die Mauer nicht als einzige Fläche schwarze Linien trägt.
- Weniger Fugenkontrast senkt auch das Flimmerrisiko in der Ferne. Die vorhandene Ausblendung (`:131`) bleibt.
- Stelle: `passstyle.js:113–143`.

### 2.3 Tiefe in der Ferne (klein bis mittel)

- Dunst heller und weniger gesättigt. Die Abnahme mit der Höhe gibt es schon, aber nur mit 30 %; sie wird verstärkt (Talnebel unten, klare Grate oben).
- Die drei Silhouetten-Ringe bekommen klar getrennte Helligkeitsstufen.
- Der Dunst ist ein stetiger Verlauf im Shader, kein Umschalten. Stellen: `passstyle.js:50–66`, `:369–385`.

### 2.4 Wolken und Sonnenscheibe (mittel)

- Zwei bis drei flache, kantige Wolkenbänder und eine sichtbare Sonnenscheibe im Himmel-Shader.
- Sie sitzen fest am Himmel und bewegen sich höchstens sehr langsam.

### 2.5 Glanzlichter (mittel, nur wenn ruhig)

- Szene in ein HDR-Ziel rendern und erst am Ende auf den Bildschirm abbilden (`fx.js:150–167`). Dann glühen Chrom, Bremslicht und Auspuffflamme.
- Risiko: Kleine Glanzpunkte können von Bild zu Bild aufblitzen. Helligkeit deckeln und mit der Zitter-Folge prüfen; wenn es unruhig wird, entfällt der Schritt.

## Phase 3: Leben in der Welt

### 3.1 Fallende Blätter (mittel)

- **Quelle:** die goldenen Lärchen und Ahorne nahe der Straße (Platzierung ab `passstyle.js:636`), Farben aus `P.gold` und `P.maple`.
- **Fallende Blätter:** ein einziges instanziertes Netz mit fester Anzahl (Hoch etwa 400, Mittel 200, Niedrig aus). Jedes Blatt gehört fest zu einem Baum. Fallen, Trudeln und Winddrift laufen im Vertex-Shader über die vorhandene Windzeit (`AX.windT`).
- **Kein Entfernungsbezug:** Alle Blätter aller Bäume fallen immer. Am Ende der Schleife schrumpft ein Blatt über die Zeit auf null, nicht über den Abstand.
- **Liegendes Laub:** feste, flache Blätter auf Bankett und Fahrbahnrand unter den goldenen Bäumen.
- **Aufwirbeln:** Fährt das Bike durch eine Laubzone, steigen hinter dem Hinterrad einige Blätter auf und setzen sich wieder. Kleiner eigener Vorrat (etwa 150), Blattform statt der runden Punkte aus `fx.js:39`.
- **Helmkamera:** Fallende Blätter enden neben der Fahrbahn und aufgewirbelte entstehen nur hinter dem Bike, damit nichts groß durchs Bild fliegt.

### 3.2 Staub auf dem Bankett (klein)

- Prüfen, wie die vorhandene Staubfahne im neuen Licht aussieht; Farbe an den neuen Seitenstreifen anpassen. Kantigere Form nur, wenn es zum Rest passt.

### 3.3 Wolkenschatten (optional, klein)

- Große, sehr langsam ziehende Helligkeitsflecken auf Wiesen und Hängen im Gelände-Shader (`passstyle.js:70`).

## Prüfen

Für jeden Schritt:

1. Die sechs Bilder aus Phase 0 neu erzeugen und neben „vorher“ legen.
2. Die Zitter-Folge neu rechnen; der Wert darf nicht steigen.
3. Du fährst die Strecke einmal auf deinem Mac in Verfolger- und Helmkamera. Zittern, Aufpoppen und Framerate lassen sich nur dort sicher beurteilen.
4. Erst dann der nächste Schritt. Jeder Schritt ist ein eigener Commit, damit er einzeln zurückgenommen werden kann.

## Nicht im Plan

- HUD; im Menü nur die eine neue Zeile für den Himmel
- Konturlinien (Outlines) an Motorrad, Fahrer oder Welt
- Bewegungsunschärfe, Randunschärfe, Speed-Lines, Kamerazittern, Farbsäume
- Engere Schattenreichweite, neue Detailstufen, alles was mit der Entfernung umschaltet
- Neue Modelle für Bike, Fahrer oder Strecke
- Die alten Rundkurse

## Entschieden

- **Himmel:** beide Varianten, in den Einstellungen wählbar (1.4).
- **Standard-Grafikstufe:** „Hoch“ (1.1).
- **HUD:** bleibt unverändert.
- **Keine Konturlinien** an Motorrad und Fahrer.
- **Keine Bewegungsunschärfe** und nichts, das mit der Entfernung umschaltet.

## Offene Entscheidungen

1. **Vorgabe für den Himmel:** Violett oder Blau, nach dem Vergleich beider Varianten.
