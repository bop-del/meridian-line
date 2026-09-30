# MERIDIAN LINE

An on-rails 3D space shooter for the browser. You fly the Vanta Mk II with NINTH FLIGHT through the Meridian Reach, a chain of colonised worlds, against the Halvane Dominion and the ancient AI that rules it, the Regent.

Built with three.js (r170) and Vite. Everything is procedural: geometry from primitives, textures from canvas, sound effects and music synthesised with WebAudio. The game itself loads no image, model or audio files (the screenshots in `docs/` are only for this page).

**Play it:** https://bop-del.github.io/meridian-line/

![Title screen](docs/title.jpg)

![Thalassa Coast gameplay](docs/play.jpg)

## Controls

| Action | Keys |
|---|---|
| Steer | WASD or arrow keys |
| Fire | Space or Z. Hold about 0.6 s over enemies to charge and lock on, release for a homing volley |
| Bomb | X |
| Boost / brake | Shift / Ctrl or C |
| Barrel roll (deflects incoming fire) | Q / E, or double tap A / D |
| Pause | Esc or P |
| Mouse aim | M toggles it in flight. Left button fires, right button bombs |
| Title screen | Enter starts (after the sound gate, see below). 1, 2, 3 or Up and Down pick the MISSION (start in any level), Left and Right change the difficulty, M cycles the music style |
| Pause menu | Arrows select, Left and Right change a value. Music style and the sound switch are in the AUDIO block |

A gamepad works too: sticks to steer and aim, triggers and shoulders for fire, boost, brake and roll, Start to pause.

Control tips appear as a small prompt line at the bottom of the screen.

### Sound gate, music style and mute

Browsers block audio until the first key press, click or tap, so a fresh page load opens with a one-time prompt: PRESS ANY KEY FOR SOUND (TAP FOR SOUND on touch screens). That first key press or click unlocks the audio engine, starts the title theme and is consumed, so Enter cannot start the game before the sound is on. After that the normal title appears.

The MUSIC STYLE selector (title screen, M key or the arrows, and the pause menu) picks one of three styles that set the music for the title, all three levels, the boss fights and the victory and game over stingers. The choice is remembered in the browser. A small speaker icon on the title and pause screens, and the SOUND row in the pause menu, mute and unmute everything; the mute state is remembered too.

## Features

- Three levels, each ending in a multi-phase boss fight (play order: Obsidian Foundry, the Cinder Belt, Thalassa Coast)
- Lock-on volley (a rotating hexagon frame with a numbered pip on each target), pulse bomb, barrel roll that deflects enemy fire (and reflects some shells back), boost and brake
- Pickups: SHIELD CELL (heals, laid out along a slipstream lane in chains of four with a bonus on the fourth), CAPACITOR (rare, one per level in a detour, raises maximum shield and heals fully), PULSE UPGRADE (weapon upgrade), BOMB and REPAIR
- Two escort pilots (VEX, FERRO) and an escort drone (PIP) who fly beside you. A jamming contact can cut an escort's convoy transponder link in different ways (tail contact, blocked at a gate, drive fault, barrier), and a TRANSPONDER LINK readout with signal bars shows how much of the link is left to clear the contact
- Comm traffic in three forms: portraits (VEX as a helmeted pilot, FERRO as a full-face visor helmet with a data-lens glyph, and the enemy AI REGENT as a waveform), typed text readouts (PIP, LUMEN, SABLE) and a text-only dispatch card from CONTROL
- KILLS counter and combo multiplier during play, and a per-level results screen with a letter rank (S, A, B or C) from score against par, shield remaining, lives lost, time and escorts still flying
- Three difficulties: easy, normal, hard
- Synthesised soundtrack with layered intensity, three selectable music styles (each with its own title, level, boss and sting themes) and spatialised effects
- Tuned handling: a snappy, banking ship with a spring-mounted chase camera that leans into turns, layered screen shake and hit-stop that make impacts land, a speed sense built from FOV kick, streaks and motion blur
- A cinematic look: controlled HDR bloom, height fog, sun light shafts, a lens flare, a mild far blur and a colour grade per level, over a procedural ocean, clouds and sun scattering. On slower GPUs the adaptive quality gives things up in a fixed order (depth of field, shafts, water detail, bloom quality, then resolution) and leaves quality alone when the display caps the frame rate

## The levels

| # | Level | Boss | Look |
|---|---|---|---|
| 1 | OBSIDIAN FOUNDRY: the Regent's forge | The Regent, a crystalline sovereign core encircled by four orbital prism emitters that only take damage while their lens is open | Black glass, molten metal, blue-white smelter beams |
| 2 | THE CINDER BELT: through the burning debris | The Orrery, a ring-shaped warship with rotating segments and a sweeping beam | Ember-red debris with glowing cracks against a dark cyan void |
| 3 | THALASSA COAST: a strike on a Dominion landing fleet | The Tidebreaker, a siege barge held by three mooring cables. Cut the cables, then reflect its siege shell with a barrel roll or shoot the armour off | Teal water, twin gold suns, coral spires and reef arches |

## Run locally

Requires Node 20.11 or newer to build and run the game (Node 22 is used in CI). The test tools in `tools/` use puppeteer-core, which needs Node 22.12 or newer.

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # production bundle in dist/
    npm run preview    # serve dist/ on http://localhost:4173

The build uses relative asset paths (`base: './'`), so the contents of `dist/` can be hosted from any folder or sub path. A GitHub Actions workflow (`.github/workflows/pages.yml`) builds and deploys to GitHub Pages on every push to `main`.

## Project layout

    src/core/       game loop and phases, input, rail, collision, camera rig, the feel registry
    src/feel/       the tunable values (handling, impact, speed, look, sky, atmosphere) and their presets
    src/dev/        the ?tune=1 tuning panel and the ?diag=1 black frame detector
    src/entities/   the player controller and projectiles
    src/world/      levels, sky and clouds, ocean, scenery, obstacles, pickups (shield cells, capacitor), level script runner
    src/world/atmosphere/  ambient particles, boss hero lights, the explosion flash guard, Foundry floor and Cinder dust ring
    src/enemies/    enemy types, formations, bosses
    src/allies/     escort AI (two pilots and a drone)
    src/models/     procedural ship models
    src/render/     renderer and post chain (passes/), effect quality tiers (tiers.js), grade shader
    src/fx/         pooled particles, explosions, debris, impact feedback (shake, hit-stop), speed streaks and FOV kick
    src/ui/         HUD, menus, comm box and text readouts, portraits
    src/audio/      synth, sound effects, sequenced music, the three music styles
    music-lab.html  audition every track of every music style
    sfx-lab.html    audition every sound effect
    tools/          headless test helpers (system Chrome through puppeteer-core)
    docs/           architecture notes

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the modules fit together.

## Testing helpers

URL parameters: `?autostart=1`, `?level=0|1|2`, `?god=1`, `?difficulty=easy|normal|hard`, `?style=a|b|c` (music style, also `?title=`), `?tune=1` (live tuning panel, also opened by FEEL TUNING in the pause menu, see [docs/TUNING.md](docs/TUNING.md)), `?telemetry=1`, `?diag=1` (with `?report=<port>` it posts black frame reports to a local receiver on that port), `?nopost=1`, `?nooverlay=1`, `?q=0..5` (render quality), `?noadapt`. `window.__ctx` exposes the game context, and `__ctx.game.advance(seconds)` steps the simulation deterministically.

    node tools/shot.mjs <url> <out.png> [waitMs]      # screenshot plus console error check
    node tools/bossbot.mjs <port> <outDir> [0,1,2]    # aimbot through each boss to level complete
    node tools/flow.mjs <port> <outDir>               # title, pause, level complete, game over, restart
    node tools/gpushot.mjs <url> <out.png>            # screenshot on the real GPU (Metal) instead of the software renderer
    node tools/gpuflicker.mjs <baseUrl> off 10        # black-pixel fraction over many frames
    node tools/feelbot.mjs <port> <outDir>            # scripted input, checks steering, camera, shake and hit-stop numbers
    node tools/telemetry.mjs <url> <seconds>          # frame time report on the real GPU
    node tools/looktest.mjs <port> [outDir]           # screenshots at fixed points in every level plus frame ms per quality tier
    node tools/blackframes.mjs <port> [seconds]       # reads back every frame, flags black frames and non-finite values (--switch sweeps tiers)
    node tools/captest.mjs <port> [seconds]           # simulated 30 fps display: checks the adaptive quality and the tier order
    node tools/whiteout.mjs <port> [seconds]          # luminance runs, catches screen wide white-outs in boss fights
    node tools/release-check.mjs                      # fresh build, page loads, hostile URLs, docs and repo hygiene (run before a release)

The tools launch Google Chrome from the macOS default path, or from the `CHROME_PATH` environment variable if it is set (for example `CHROME_PATH=/usr/bin/google-chrome node tools/flow.mjs 5173 out`), and expect a running dev server. Headless Chrome uses a software renderer and runs at a few frames per second, so the tests step simulated time instead of waiting.

## Status and known limits

- Checked headless: no console errors, all three bosses beatable, full screen flow (title, pause, level complete, game over, restart).
- Checked on an Apple silicon GPU (Metal): locks 60 Hz at 1080p and 4 to 7 ms of GPU time per frame at the top quality tier (`tools/looktest.mjs` gives the figures), and no rendering artefacts on any level or boss arena.
- Designed for desktop with a keyboard first. A gamepad is supported. There are no touch controls: on touch screens the title shows TAP TO START and a desktop notice, but the flight itself needs a keyboard or gamepad.
- Needs a browser with WebGL2.
- Steering feel is tuned by hand with the `?tune=1` panel (the default is the `tight` preset). Not measured: feel across other input devices, and how the audio sounds on different hardware.
- A browser that caps the frame rate to 30 fps (Chrome Energy Saver, macOS Low Power Mode, a 30 Hz display) makes the game run at 30 fps but it keeps full quality.
- MSAA is off by default because it caused flickering black blocks on Apple GPUs. `?msaa=rt2` or `?msaa=both` turn it on for comparison.

## Licence

MIT, see [LICENSE](LICENSE).
