# APEX — Motorcycle Racing (v0.2 rebuild)

Top-down motorcycle racing in the browser, in the spirit of Circuit Superstars, but on two wheels.
Open `index.html` (or double-click `start.command`). Nothing to install and no server needed. Chrome, Edge or Safari work best.

The previous alpha is untouched in `_alpha_backup/`.

## Controls
| | Keyboard | Gamepad |
|---|---|---|
| Steer | A / D | left stick |
| Throttle / brake | W / S | RT / LT |
| Hang off left / right (more grip to the inside, less to the outside) | ← / → | right stick ← → |
| Weight forward: keeps the front down, tucks in on straights | ↑ | right stick ↑ |
| Weight back: wheelie with the throttle open, resists stoppies under hard braking | ↓ | right stick ↓ |
| Camera (top-down / rotating / chase) | C | Y |
| Reset onto track | R | B |
| Pause / mute | Esc / M | Start |

The ring next to the gear shows where your body weight is. It turns green when you're hanging off to the inside of the corner.

## Schwarzhornpass (hill climb)
The main mode is now a hill climb on a fictional Swiss-style pass: 2.3 km, 145 m of climb and 10 hairpins, from the start in the valley to the summit sign. The road has real elevation, and the slope pulls on the bike (uphill costs speed, the bike pitches with the road). There are dry-stone retaining walls on the hill side, W-beam guardrails and snow poles on the valley side, chevron signs in the hairpins, a pine forest, and snow-capped peaks in the distance.
- **Time trial** (default): start lights, then ride to the summit against your ghost, with a live delta and distance-to-summit/altitude in the HUD.
- **Race**: same climb against AI riders.
- **Cameras** (C): chase (default), helmet cam, top-down.
- Defaults: Strada V4, assists off, graphics medium. The old circuits are still in the menu.

## What's in it
- **Physics** (`js/physics.js`): steering asks for a lean angle and the bike has to roll into it. One friction circle per tyre, so too much throttle while leaned slides the rear and leaves a black line, and braking while leaned pushes the front. Wheelies and stoppies come from the real weight transfer. Automatic 6-speed gearbox, rev limiter, engine braking. Surfaces are tarmac, kerbs, grass and gravel traps. Crashes: lowside, highside, loop-out, over the bars, wall impact, contact.
- **Assists**: *Full* (learning), *Sport* (no aids, anything goes), *Off* (no aids, more lean and grip at the limit and more room before a slide throws you off: fastest, hardest).
- **3 bikes**: Corsa 600 (inline-4), Strada V4 (superbike), Duetto 900 (naked V-twin). Each has its own handling, power curve and engine sound.
- **3 original circuits**: Kiefernring, Hafenkurs, Alpenspeedway. They are generated from spline data, with an automatically computed racing line, kerbs, gravel traps, tyre walls, pit building, grandstands with crowds, sponsor boards, marshal posts and scenery.
- **AI riders** use the same physics and inputs as you, follow the racing line, overtake, give room and make the odd mistake. There are 4 difficulty levels.
- **Modes**: Race (start lights, standings tower, results, fastest lap) and Time Trial (ghost of your best lap and a live delta). Best laps are saved per track and bike.
- **Sound** (`js/audio.js`): the engines are synthesised in real time in an AudioWorklet, with per-cylinder firing order, exhaust resonance, quick-shifter and limiter cuts, overrun burble and pops. On top of that come tyre squeal, kerb rumble, wind, gravel, crashes and Doppler on passing bikes. The three bikes play through a per-cylinder voice (the `multi` block in each bike's `engine` data in `js/core.js`): real firing orders (even inline four, twin-pulse V4, 90° V-twin), every cylinder with its own pulse into a header and silencer model, airbox, valve train and overrun pops. The Corsa is tuned against a recording of a 600 supersport (harmonics and overall spectrum at idle, 8,000 and 13,000 rpm, and on the overrun). Delete a bike's `multi` block to get its original voice back. A single-cylinder voice on the same model (450 supermoto) is ready as `AX.ENGINES.single450` for a bike with `engine: AX.ENGINES.single450`; no bike uses it yet. Open `soundlab.html` to hear and tune all of them without starting the game; its "Alter Klang" switch plays the original voices for comparison.
- **Graphics**: procedurally modelled bikes and animated riders who hang off, tuck and sit up under braking. Shadows, environment reflections, tilt-shift, bloom, persistent tyre marks, smoke, dirt and sparks. The *Graphics* setting (low/medium/high) scales shadows, resolution and post-processing.

## 3D asset kits
The trees, bushes, rocks, grass and flowers come from **Quaternius – Stylized Nature MegaKit** (CC0). The grandstands, pit garages, tents, flags, cones and light posts come from **Kenney – Racing Kit** (CC0). Both zips sit in `assets/`, and their extracted files are in `assets/src/`.

Browsers won't load model files from a page opened straight from disk, so the models are packed into `assets/pack_nature.js` and `assets/pack_kenney.js`. After adding or changing models, rebuild the packs from the Apex folder:

    python3 tools/build_assets.py

This needs Python 3 with Pillow. The script lists the models it packs at the top. Texture names ending in `_C` are turned grey so the game can tint the foliage for each circuit. If the packs are missing, the game falls back to its built-in procedural scenery.

## Pass textures, walls and buildings
The pass uses a baked texture set (rock, meadow, scree, gravel, asphalt, granite, each with a colour and a normal map) plus the stone layout of the dry-stone walls. All of it is generated by `tools/texgen.py` into `assets/pack_pass.js` (needs Python 3 with numpy, scipy and Pillow):

    python3 tools/texgen.py

The retaining walls are built from real 3D stones taken from that layout. Up close you see the stones, and further away (beyond about 95 m on Medium) a flat wall with the same pattern painted on takes over. On Low there are no 3D stones.

The alp huts and hay barns are modelled in Blender by `tools/blender_props.py`. `tools/bake_props.py` bakes their colour and ambient occlusion into one texture each and exports `blender/prop_hut.glb` and `blender/prop_barn.glb`. Those are packed into `assets/pack_props.js`. The Blender file is `blender/props.blend`.

## Riding (physics)
- **S** front brake, **Space** rear brake (LB on a gamepad). The rear brake, engine braking and weight forward on the brakes make the rear step out: back the bike into the corner.
- **↓ weight back / sit up**: more braking before the rear lifts (no stoppie), air brake, more rear brake bite; with throttle it lifts the front.
- **↑ weight forward / tuck**: less wheelie, more usable drive, less drag on straights; on the brakes it lifts the rear (stoppie, over the bars without ABS).
- **← → hang off**: more grip and lean on the inside, less on the outside. Knee sliders (and at full lean the elbow) touch down and draw a thin line.
- **Trail braking**: a light-to-medium front brake while leaned turns the bike in quicker and tighter; a handful of brake stands it up.
- Black lines only come from real wheelspin, a sliding or a locked rear.
- Assists: *Voll/Full* catches everything; *Sport* is raw (highsides, loop-outs, tucks, going over the bars); *Aus/Off* is raw too, but with ~5° more lean, ~5% more side grip, easier slides, harder-biting trail braking and ~15% more room before a slide or over-lean throws you off. With keys only, the rider instinctively rolls off before a loop and eases the lever before going over, unless the weight is thrown that way.

## Files
`js/core.js` data and helpers · `assets.js` model loader · `track.js` circuits and racing line · `physics.js` bike model · `ai.js` AI riders · `models.js` 3D bikes and riders · `world.js` environment · `pass.js` the mountain pass world · `fx.js` tyre marks, particles, post-processing · `audio.js` sound · `soundlab.html` engine sound test page · `game.js` game flow, camera, HUD, menus.

## Known gaps / next steps
- The online 1v1 from the alpha (PeerJS) is not wired into the rebuild yet.
- No tyre wear, fuel or pit stops yet (Circuit Superstars has these).
- All art is generated in code. Real hand-made models (glTF) could replace the procedural ones later without touching the physics.
