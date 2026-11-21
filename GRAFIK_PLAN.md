# Grafik-Plan: Schwarzhornpass

Stand: 21.11.2026. Betrifft nur den Pass im Golden-Hour-Stil (`js/passstyle.js`). Die drei alten Rundkurse sind nicht Teil dieses Plans.

Ziel: Das Bild soll schärfer und sauberer werden und mehr Kontrast bekommen, ohne den flachen Low-Poly-Stil zu verlassen. Es wird nichts eingebaut, das das Bild unruhig macht.

## Stand der Umsetzung

Der Plan ist auf dem Branch `grafik-premium` umgesetzt, in 14 Commits. Fast jeder Schritt hat seinen eigenen; Licht, Schatten und Himmel (1.2 bis 1.4, 2.3) hängen zusammen und sind einer. Vorher/Nachher-Bilder liegen in `screenshots/grafik/`.

| Schritt | Stand | Was gemacht wurde |
|---|---|---|
| 0 Vergleichsbasis | erledigt | Bilder mit `tools/shots.js`, Zitter-Messung siehe „Prüfen“ |
| 1.1 Auflösung, Stufen | erledigt | Standard „Hoch“; Deckel 1,0 / 1,5 / 2,0 mit Pixelbudget für 4K/5K; Stufe steuert Schattenkarte, Gras und Laub |
| 1.2 Schatten | erledigt | PCF-Soft statt VSM, Sonne 3,2, Himmelslicht 1,0; Reichweite 70 m unverändert |
| 1.3 Neutrale Farben | erledigt | Ursache war eine andere als angenommen, siehe unten |
| 1.4 Zwei Himmel | erledigt | Violett (Vorgabe) und Blau, Zeile „HIMMEL“ in den Einstellungen |
| 2.1 Fahrer abheben | teilweise | Kantenlicht ja; Akzentfarbe nicht, siehe unten |
| 2.2 Trockenmauer | erledigt | Lagen aus flachen Steinen, schmale helle Fugen |
| 2.3 Tiefe in der Ferne | erledigt | Dunst nimmt mit der Höhe ab, Ringe in drei Stufen, Horizont und Dunst im selben Ton |
| 2.4 Wolken, Sonne | erledigt | 13 Low-Poly-Wolkenbänke, Sonnenscheibe mit Schein |
| 2.5 Glanzlichter | anders gelöst | kein HDR-Ziel, dafür ruhiger Schein in jeder Auflösung, siehe unten |
| 3.1 Blätter | erledigt | fallend, liegend, aufgewirbelt |
| 3.2 Staub | erledigt | heller Steinstaub statt Rasengrün auf dem Bankett |
| 3.3 Wolkenschatten | erledigt | nur auf den Berghängen außerhalb des Tals |

### Abweichungen vom Plan

- **Braune Straße (1.3):** Die Ursache war nicht die Sonnenfarbe. Das Straßenband war mit der Unterseite nach oben gebaut. Es bekam deshalb kein Sonnenlicht und keine Schatten, nur das braune Bodenlicht. Das erklärt auch, warum der Schatten des Motorrads fehlte. Richtig herum ist der Asphalt schiefergrau, die Linien sind weiß, und Baum- und Motorradschatten fallen auf die Straße. Die Sonnenfarbe wurde nur leicht aufgehellt (`#ffc890` → `#ffd2a2`).
- **VSM-Schatten (1.2):** Die alte Weichzeichnung hat kleine Sonnenflecken ganz verschluckt. Mit PCF-Soft sind sie da.
- **Akzentfarbe (2.1):** nicht umgesetzt. Auf der grauen Straße hebt sich der schwarz-weiße Fahrer jetzt klar ab, und eine Farbe hätte die Lederkombi verändert, die bewusst schwarz-weiß gestaltet ist. Wenn gewünscht, ist das eine Zeile in `js/core.js` (Fahrer „DU“).
- **Glanzlichter (2.5):** kein HDR-Ziel. Es hätte kontrastreiche Kanten nach der Kantenglättung wieder ausgefranst und das Mischen aller durchsichtigen Effekte verändert, auch auf den alten Kursen. Stattdessen zählt beim Verkleinern für den Schein jetzt jeder Pixel (kleine Glanzpunkte blitzen nicht mehr), und der Schein ist auf jedem Bildschirm gleich breit.
- **Schärfefilter:** nicht eingebaut. In voller Auflösung ist das Bild scharf, ein Filter hätte nur Flimmern verstärkt.
- **Unschärfe im Verfolger:** Der Verfolger hatte am oberen und unteren Bildrand eine leichte Miniatur-Unschärfe. Sie ist entfernt; Menü und Draufsicht behalten sie.

### Zusätzlich gemacht

- Wiese und Gras ohne Spiegelglanz: Gegen die tiefe Sonne lag ein heller Schleier auf allem, was nach oben zeigt, und Halme an der Mauerkante wurden fast weiß.
- Brücke: Brüstung und Abdeckung waren auf einer Seite spiegelverkehrt gebaut und zeigten ihre Innenseite.
- Schärfere Texturen in den Nahkameras: Cockpit-Anzeige, Startnummer und Seitenschild werden in vierfacher Größe gezeichnet.

### Nachbesserung nach der ersten Probefahrt

Die Probefahrt hat gezeigt: Beim Zufahren auf Dinge flackerten Schatten, vor allem auf Baumkronen, und die Mauer verlor nach etwa zehn Metern ihr Muster. Die erste Zitter-Messung hatte das nicht erfasst, weil sie mit kleinen Kameraschritten arbeitete und die Schattenkarte dabei kaum wanderte. Behoben ist:

- **Schatten stehen fest.** Bisher wanderte eine einzige Schattenkarte mit dem Motorrad mit. Sie rastete nur grob und in der Höhe gar nicht ein, also verschob sich jede Schattenkante bei jedem Bild ein wenig, und Schatten gab es nur im Umkreis von etwa 70 m. Jetzt gibt es zwei Karten derselben Sonne: eine für die ganze Strecke, die einmal beim Laden gezeichnet wird und sich nie bewegt, und eine schärfere um die Kamera, die nur in ganzen Texeln ihres eigenen Rasters weiterrückt. Dazwischen liegt eine breite, weiche Überblendung. Nebenbei haben die fernen Hänge jetzt Baumschatten.
- **Bäume bekommen keine Karten-Schatten mehr.** Sie werfen Schatten, aber ihre eigene Form kommt nur aus dem festen Sonnenlicht auf ihren Flächen. Die gezackten Flecken auf den Kronen, die sich beim Näherkommen ständig änderten, sind damit weg.
- **Leuchten nur von echtem Licht.** Der Leuchteffekt sprach auf das helle Gelb der Bäume an, und zwar stärker, je größer der Baum im Bild wurde. Er reagiert nur noch auf Sonne, weiße Glanzlichter, Bremslicht und Auspuffflamme.
- **Mauer als echte Textur.** Das Steinmuster wird einmal in eine Textur gemalt (12,8 m × 3,2 m, 320 Pixel pro Meter, nahtlos wiederholt). Die Grafikkarte filtert sie wie jede Textur; nichts wird mehr von Hand ein- oder ausgeblendet.
- **Mauerenden geschlossen.** Jede Mauer endet in einem Steinpfeiler mit eigenem Deckstein. Vorher war die Stirnseite offen, und man sah unter die Abdeckung auf den Hang.
- **Kein Lichtspalt am Mauerfuß.** Die Mauer war für die Schatten nur ein dünnes Blatt. Zwei unsichtbare Flächen im Hang dahinter stehen jetzt für den Mauerkörper.
- **Laub in fester Größe.** Blätter wurden mit der Entfernung etwas breiter gezeichnet; jetzt haben sie überall dieselbe Größe.

### Noch von dir zu prüfen

- **Framerate auf „Hoch“:** Hier konnte nur ein Software-Renderer laufen. Ob „Hoch“ auf deinem Mac flüssig ist und ob die ersten Sekunden ruckeln, zeigt nur eine Probefahrt.
- **Zittern in Fahrt:** siehe „Prüfen“. Die Messung ist eine Näherung.
- **Laubmenge:** An Start und in der ersten Waldpassage liegt viel Laub auf der Straße. Die Menge steht in `passstyle.js` im Abschnitt „leaves“.

## Leitplanken

Diese Punkte sind entschieden und gelten für jeden Schritt:

- **Das HUD bleibt, wie es ist.** Kein Schritt fasst `style.css` oder die HUD-Elemente an. In den Einstellungen kommt genau eine Zeile dazu (Himmel, siehe 1.4).
- **Keine Bewegungsunschärfe.** Auch keine Randunschärfe, keine Speed-Lines, kein zusätzliches Kamerawackeln, keine Farbsäume. Tempo wird nur über die Welt gezeigt (Blätter, Staub), nie über einen Filter auf dem Bild.
- **Nichts Neues, das mit der Entfernung umschaltet.** Das hat beim Drauf-zu-Fahren schon einmal gezittert. Ein Objekt sieht aus jeder Entfernung gleich aus. Vorhandene Entfernungslogik (Gras-Ausdünnung in `update`, Fugen-Ausblendung der Mauer) wird nicht erweitert.
- **Jeder Schritt wird in Bewegung geprüft**, nicht nur am Standbild (siehe „Prüfen“).

## Ausgangslage

Stand vor dem Umbau. Gemessen an Standbildern (Verfolger, Helm, von oben; Grafik „Hoch“, 1280×720, Software-Renderer). Farben sind dort exakt, Framerate und Bewegung waren nicht zu beurteilen.

| Befund | Messwert / Stelle |
|---|---|
| „Mittel“ rendert auf Retina nur ein Viertel der Pixel | Deckel 1,0 bei Pixeldichte 2 (`game.js:87`); „Hoch“ 1,5 |
| Grafikstufe ändert im Pass nur die Auflösung | `passstyle.js` liest die Stufe nicht; Schatten 4096 und Gras immer voll |
| Schatten weich und flau | VSM, Radius 4 (`passstyle.js:266`, `:726`); Himmelslicht 1,45 gegen Sonne 2,25 (`:17`) |
| Schlagschatten des Motorrads kaum sichtbar | Sonne steht 13° hoch, der Schatten müsste gut 4× so lang sein wie das Bike hoch |
| Blockige Schattenflecken auf der Leitplanke | sichtbar im Verfolger, rechte Leitplanke |
| Asphalt kommt graubraun an statt lavendel | Palette `#888fba`, am Bildschirm ca. rgb 116/96/87; Linien ocker statt weiß |
| Ursache dafür (beim Umbau gefunden) | Straßenband mit der Unterseite nach oben gebaut: kein Sonnenlicht, keine Schatten |
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

So wurde geprüft:

1. **Feste Bilder:** dieselben Stellen vor und nach dem Umbau, in `screenshots/grafik/vorher`, `nachher` und `nachher_blau`. Erzeugt mit `tools/shots.js` (die KI fährt die Strecke).
2. **Fehlerfreiheit:** keine Shader- oder Skriptfehler in allen vier Kameras, auf Niedrig, Mittel und Hoch, mit beiden Himmeln, im Rennen mit fünf Gegnern, beim Umschalten des Himmels im Menü und auf dem alten Rundkurs Kiefernring.
3. **Zitter-Messung:** Die Welt steht still (keine Physik, Uhr angehalten), die Kamera gleitet 24 Bilder lang je 2 cm vorwärts. Alles im Bild sollte sich dann gleichmäßig ändern; was aufpoppt oder flimmert, zeigt sich als Unruhe von Bild zu Bild. Gemessen wird die mittlere Unruhe der Helligkeit (0 bis 255), einmal absolut und einmal im Verhältnis zur Kantenmenge im Bild, weil ein kontrastreicheres Bild bei gleicher Bewegung von selbst mehr Änderung zeigt.

| Stelle | Unruhe vorher | Unruhe nachher | Im Verhältnis zu den Kanten |
|---|---|---|---|
| Anfahrt auf die Mauer (Schritt 1340) | 1,63 | 1,64 | 0,36 → 0,29 |
| Waldpassage mit Laub (Schritt 1560) | 1,12 | 1,25 | 0,26 → 0,26 |
| Lange Mauer, Leitplanke (Schritt 4100) | 1,33 | 1,49 | 0,26 → 0,28 |

Ergebnis: Die Unruhe liegt auf dem alten Niveau. Sie steigt absolut leicht, weil das Bild mehr Kontrast hat (weiße Linien auf grauem Asphalt, scharfe Schatten, Laub); im Verhältnis zu den Kanten ist sie an einer Stelle deutlich niedriger, an einer gleich und an einer 5 % höher. Die stärkste Quelle ist vorher wie nachher das Gras direkt am Straßenrand.

Grenzen: Das ist eine Näherung aus einem Software-Renderer bei 1280×720. Sie ersetzt keine Probefahrt. Eine erste Messung in voller Fahrt war unbrauchbar, weil dort die Bewegung selbst alles überdeckt.

4. **Messung nach der Nachbesserung (Schatten):** Die erste Zitter-Messung oben hat das Flackern aus der Probefahrt nicht erfasst. Die neue Messung trennt die Ursache sauber ab: Die Kamera steht still, und nur das Schattenlicht wird so weitergerückt, als würde man je Bild 0,5 m fahren. Bei stehender Kamera ist jeder Pixel, der sich ändert, ein Schatten, der dem Fahrer folgt statt in der Welt zu stehen.

| Stelle | Pixel, die pro Schritt sichtbar umspringen, vorher | nachher |
|---|---|---|
| Waldkurve (Schritt 1340) | 0,052 % | 0,000 % |
| Lange Mauer (Schritt 4100) | 0,017 % | 0,002 % |

Die Anteile wirken klein, sitzen aber gebündelt an Schattenkanten und auf Baumkronen, also genau dort, wo es geflackert hat. Dieselbe Probe für die Gras-Ausdünnung zeigt vorher wie nachher praktisch keine Änderung.

5. **Noch offen, nur auf deinem Mac möglich:** Framerate auf „Hoch“, die ersten Sekunden nach dem Start, und der Eindruck in Fahrt in Verfolger- und Helmkamera.

## Nicht im Plan

- HUD; im Menü nur die eine neue Zeile für den Himmel
- Konturlinien (Outlines) an Motorrad, Fahrer oder Welt
- Bewegungsunschärfe, Randunschärfe, Speed-Lines, Kamerazittern, Farbsäume
- Engere Schattenreichweite, neue Detailstufen, alles was mit der Entfernung umschaltet
- Neue Modelle für Bike, Fahrer oder Strecke
- Die alten Rundkurse

## Entschieden

- **Himmel:** beide Varianten, in den Einstellungen wählbar (1.4). Vorgabe bleibt Violett, solange es nur diese Strecke gibt.
- **Standard-Grafikstufe:** „Hoch“ (1.1).
- **HUD:** bleibt unverändert.
- **Keine Konturlinien** an Motorrad und Fahrer.
- **Keine Bewegungsunschärfe** und nichts, das mit der Entfernung umschaltet.

## Offene Entscheidungen

1. **Akzentfarbe am Fahrer:** nicht umgesetzt (siehe „Abweichungen vom Plan“). Soll sie doch kommen, und wenn ja, wo?
2. **Laubmenge auf der Straße:** so lassen oder weniger?
