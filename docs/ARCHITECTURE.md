# Architecture

A short tour of how MERIDIAN LINE is put together. Everything is plain ES modules on top of three.js r170. There are no build-time assets: geometry comes from primitives, textures from canvas, sound and music from WebAudio.

## Coordinates: the rail and the world

The game is an on-rails shooter, so most positions are expressed relative to an invisible anchor.

- **World space** is right-handed with +Y up. The level runs along **-Z**: things ahead of the player have a smaller (more negative) z.
- **The rail** (`src/core/rail.js`) is the anchor. `rail.position` moves forward along -Z at `rail.speed`, which eases towards a target that depends on boost, brake, the title screen and player death. `rail.distance` is the distance travelled and `-rail.position.z`. Level scripts, the boss trigger and the HUD progress bar are all keyed on `rail.distance`.
- **Player position** is `rail.position + localOffset`, where `localOffset` is a 2D offset (x, y) clamped to `config.bounds` (14 by 8 world units). The player never moves on z relative to the rail.
- **Enemies** default to rail-relative motion (`railRel = true`): a subclass writes `this.rel` (offset from the rail) and the base class derives the world position and velocity. Enemies that need free flight set `railRel = false` and write a world `vel` instead.
- Units are metres and seconds. Damage is expressed in "laser hits": one paired-pulse hit is 1 damage, and enemy hit points use the same unit.

## The shared `ctx` object

`startGame()` in `src/core/game.js` builds one context object and hands it to every module. It is also exposed as `window.__ctx`, which the test tools use.

```
ctx = {
  THREE, config, feel, events, state, input, rail, collision, cameraRig, impact, speedfx,
  player, projectiles, render, fx, audio, ui, world, enemies, allies,
  clock, timeScale,
  groups: { playerShots, enemyShots, enemies, obstacles, pickups, allies },
  scene, camera, renderer,   // added by render.init
  game,                      // phase control, added after module init
}
```

- `config` (`src/config.js`) holds all tunables: rail speeds, player handling, weapons, camera, difficulty multipliers, combo rules and the level id list.
- `state` (`src/core/state.js`) is the single source of truth for the HUD and game flow: phase, score, health, lives, bombs, boost, laser level, combo, current boss and per-level stats. `state.hits` is the KILLS counter shown on the HUD. On level complete `state.levelStats` also carries shield left, lives lost and escorts still flying, which the results screen turns into the letter rank.
- `events` (`src/core/events.js`) is a tiny emitter (`on`, `off`, `emit`) shared by all modules.
- `groups` are plain arrays of live entities. Collision and aim assist read them, and each owning module adds and removes entries.
- `timeScale` is used for hit stop and slow-motion accents. Gameplay modules receive `dt * timeScale`.

## Modules and update order

Every module is a singleton object with optional `init(ctx, uiRoot)`, `reset(ctx)` and `update(dt, ctx)` methods. `game.js` calls them through a wrapper that catches exceptions, so one faulty module logs a few errors instead of stopping the loop.

| Module | File | Role |
|---|---|---|
| input | `src/core/input.js` | Keyboard, gamepad and optional mouse aim. Produces one snapshot per frame: held flags, one-frame pulses, smoothed axes. |
| rail | `src/core/rail.js` | The anchor described above. |
| world | `src/world/world.js` | Sky, lights, fog, streamed scenery, obstacles, pickups and the level script runner. |
| enemies | `src/enemies/enemies.js` | Spawn API, formations, boss spawning, culling, difficulty scaling. |
| allies | `src/allies/allies.js` | Escort flight AI (two pilots and a drone) and the escort-in-trouble mechanic (`allies.chaseMe(name, enemy, {time})`). |
| player | `src/entities/player.js` | The Vanta Mk II controller: steering, barrel roll, boost and brake, paired pulse, lock-on volley, bomb, damage and respawn. |
| projectiles | `src/entities/projectiles.js` | Pooled player and enemy shots drawn with instanced meshes. |
| collision | `src/core/collision.js` | Sphere and swept-segment tests between the groups, plus score and combo bookkeeping. |
| cameraRig | `src/core/cameraRig.js` | Chase camera on critically damped springs (look-ahead, swing, bank roll, boost push and brake pull), adds the shake from `impact` and the FOV kick from `speedfx`, intro swoop, death cam, orbit shot for end screens. |
| impact | `src/fx/impact.js` | The only camera shake source (layered per-event curves with a soft cap), hit-stop rules with a time budget, damage and low-health feedback, reticle pulse. |
| speedfx | `src/fx/speedfx.js` | Speed sensation: FOV kick with an onset punch, speed lines, space dust and a near parallax layer, the blur and chroma amounts read by the post pass. |
| fx | `src/fx/fx.js` | Pooled particles, debris, shockwaves, trails, hit sparks and kill bursts. `fx.shake` forwards to `impact`. |
| feel | `src/core/feel.js` | Registry of live tunable values (`feel.p.<group>.<key>`, groups in `src/feel/`), presets, and the overrides behind the `?tune=1` panel. |
| ui | `src/ui/ui.js` | DOM overlay: HUD, comm box and text readouts, title, pause, level complete (letter rank), game over, victory screens. See below. |
| audio | `src/audio/audio.js` | Sound effects, engine ambience and the music engine. |
| render | `src/render/renderer.js` | WebGL renderer, bloom, a custom grade pass and FXAA, adaptive quality, screen flash. |

Per frame while **playing**, `game.js` runs in this order:

1. `input.update`
2. `rail`, `world`, `enemies`, `allies`, `player`, `projectiles`, `collision` (in that order)
3. `projectiles.lateUpdate`, `impact`, `speedfx`, `cameraRig`, `fx`
4. `ui`, `audio`, then the dev modules when `?tune=1`, `?telemetry=1` or `?diag=1` loaded them
5. `render.render`

Other phases run a subset: the title screen advances rail, world, player, camera and fx; pause freezes the world and advances only UI, audio and render; game over, level complete and victory freeze the world but keep the orbiting camera and particles alive. `ctx.game.advance(seconds)` steps the same `step()` function without rendering, which makes the simulation deterministic for tests.

### Phases

```
title -> playing <-> paused
playing -> gameover | levelcomplete -> playing (next level) | victory
```

`ctx.game` exposes `setPhase`, `newRun`, `startLevel`, `restartLevel`, `toTitle`, `pause`, `resume`, `hitStop`, `step` and `advance`.

## Entity protocol

Anything that lives in a `ctx.groups` array follows a small duck-typed protocol, so collision and aim code do not care what an entity is.

Required fields and methods:

- `position` (a `THREE.Vector3`, world space), `radius`, `alive`
- `group` (a `THREE.Object3D`; shots use a detached one that shares `position`)
- `update(dt, ctx)`
- `takeDamage(amount, source, ctx)` (enemies and destructible obstacles)
- `destroy(ctx)`: silent, idempotent removal with no score and no effects

Optional fields the other modules understand:

- `lockable = false` or `untargetable = true` to be skipped by lock-on or by shots
- `velocity`, used by aim assist and lead calculation
- `aimOffset`, a `Vector3` added to `position` when aiming at large or offset targets
- `hitTest(position, radius)` with `collider === 'box'` for custom shapes instead of a sphere
- `contactDamage`, the ram damage hint used by collision
- `shootable = true` on enemy shots, so player shots can destroy them (homing missiles)
- `collidesShots = false` or `passShots` on obstacles that let shots through

`Enemy` (`src/enemies/enemy.js`) is the shared base class. Subclasses in `src/enemies/types/` override `build`, `onSpawn`, `think`, `late`, `onHit` and `onDeath`. The base class handles rail-relative motion, hit flash, budgeted and lead-aimed enemy shots (`shoot`, `shootAt`), swept player-distance tests and death effects. Bosses in `src/enemies/bosses/` extend a shared boss base and are made of parts (`src/enemies/part.js`) that are inserted at the front of the enemy group so shots hit them before the hull behind.

Pickups (`shieldCell`, `capacitor`, `pulseUpgrade`, `bomb`, `repair`) live in `groups.pickups` and are collected by proximity to the player (`collision.pickups`). A pickup's own `collect(ctx)` applies its effect. Shield cells are small lit hexagonal capsules laid out along a slipstream lane in chains of four (`world.spawnCells(kind, pos, count, shape, opts)`), with a bonus on the fourth. A capacitor is a single violet crystal cell, one per level in a detour, that raises maximum shield and heals fully. Clearing a formation gives score and combo only and drops nothing.

## Levels and the script runner

Each level file in `src/world/levels/` default-exports `{ info, buildEnvironment(ctx, W), script(ctx, S, W) }`.

- `info` carries the display name, subtitle, level length, the distance at which the boss starts, the music key and the render look (bloom, exposure, vignette).
- `buildEnvironment` configures sky, lights and fog through `W.setup(...)`, adds meshes to `W.root` and returns a streamer object `{ update, invalidate?, reset?, dispose? }` that generates scenery ahead of the player.
- `script` registers a timeline against `rail.distance` through the `S` toolbox (`src/world/script.js`): timed events, streams of repeated spawns, comm lines, formations, shield cell lanes (`S.cells`), escort trouble beats (`S.escort`, with a distance, cell chain, kill count or barrel roll trigger) and the boss trigger. Static objects are created about 700 units before the player reaches them, and enemy waves appear about 330 units ahead.

## Events

Modules talk through `ctx.events`. Names are `domain:action`. The ones in use:

| Group | Events |
|---|---|
| Flow | `phase {phase, prev}`, `game:start`, `game:over`, `game:victory`, `level:start {index}`, `level:progress {t}`, `level:complete {index}`, `world:loaded` |
| UI commands | `ui:start`, `ui:resume`, `ui:pause`, `ui:restart`, `ui:nextLevel`, `ui:quitToTitle`, `ui:difficulty` |
| Player | `player:fire`, `player:lockon`, `player:roll`, `player:boost`, `player:bomb`, `player:damage {amount, source}`, `player:heal`, `player:dead`, `player:respawn` |
| Combat | `enemy:hit`, `enemy:killed {enemy, points, position}`, `formation:cleared`, `shot:reflected`, `shot:destroyed`, `bomb:detonate` |
| Bosses | `boss:spawn`, `boss:phase`, `boss:defeated` |
| Pickups | `pickup:collected {kind, position}`, `cell:collected {kind}` (a shield cell or capacitor was taken), `cell:set` (a whole cell chain was collected) |
| Allies | `ally:down`, `ally:rescued`, `ally:retreat`, `ally:return` |
| Feedback | `score:add`, `warning {text}`, `fx:hitstop {duration}` |

`collision.js` listens to `enemy:killed` to award points and drive the combo multiplier. `game.js` listens to the `ui:*` commands and to `game:over` and `level:complete` to change phase, and turns damage, kill and boss events into hit stop.

## HUD, comm and hints

`ctx.ui` exposes `comm({speaker, text, duration})`, `banner(text, sub)`, `warning(text)`, `hint(text, duration = 4)`, `toast(text, kind)` and `setCrosshair(bool)`.

- **Speakers** (`SABLE`, `VEX`, `FERRO`, `PIP`, `LUMEN`, `CONTROL`, `REGENT`): VEX, FERRO and the enemy AI REGENT use a portrait comm box. PIP (the escort drone), LUMEN (ship systems), CONTROL (Meridian Control dispatch) and SABLE use the text readout strip: a monospace tag, a left rule and typed text, smaller and in the bottom-right corner.
- **Hints** are short control tips: `ctx.ui.hint('FLIP: Q or E deflects incoming fire')` shows a small prompt line.
- **HUD layout**: lives top-left, score and the KILLS counter top-centre with the boss bar under them, shield as a vertical bar on the left edge with boost beside it, bombs and pulse level below, the TRANSPONDER LINK readout top-right (one row per escort in trouble, the bar is the time left), comm and readout strips bottom-right.
- **Letter rank** (`rankOf` in `src/ui/screens.js`): S, A, B or C from a composite of score against a per-level par, shield remaining, lives lost, time and escorts alive, shown as a large thin letter in a hairline frame.

## Rendering

`src/render/renderer.js` owns the WebGL renderer and an `EffectComposer` chain built from `src/render/passes/`: the scene is drawn into an HDR target with a depth texture (`scenePass.js`), a sanitise pass removes NaN and Inf and adds height fog and a far-only depth of field (`fogPass.js`), `UnrealBloomPass` runs with a soft knee and a cap (`bloomPass.js`), a half resolution sun pass makes light shafts and the lens flare from the sky's suns (`sunPass.js`), and the grade shader (`postShader.js`: speed blur, chromatic fringe, bloom and shafts, a white-out guard, ACES tone mapping, per-level colour grade, vignette, damage, flash, grain) is followed by FXAA and the output pass. The values per level come from the `look` feel group. MSAA on the composer targets is off by default because it produced flickering black blocks on Apple GPUs through ANGLE. `?msaa=rt2` and `?msaa=both` bring it back for comparison. `src/render/tiers.js` holds the effect tiers (flags for depth of field, shafts, flare, water detail, fog and grade, plus pixel ratio and bloom scale) and the adaptive controller: effects drop in a fixed order, changes are requested after a frame and applied before the next draw, and a step down that does not help is undone. `?q=0..5` forces a tier. Sky, clouds and the ocean are in `src/world/sky.js` and `liquids.js`, level atmosphere (particles, boss hero lights, the explosion flash guard) in `src/world/atmosphere/`.

## Audio

`src/audio/` is entirely WebAudio, with no sample files. Collecting a shield cell plays the `cell` sound with a pitch that climbs along the chain.

- `synth.js` and `instruments.js` provide oscillator, noise and filter building blocks and the instrument voices.
- `sfx.js` defines the sound effects and their metadata (rate limits and priorities). `audio.js` dedupes sounds triggered both by events and by direct calls, limits the voice count and applies distance and pan.
- `songs.js` holds the level and jingle scores. `music.js` is a bar-based lookahead sequencer with crossfading and intensity layers.
- `src/audio/styles/` holds the three music styles (B dark synthwave, the default, A cinematic drift, C restrained orchestral). Each style defines seven tracks: title, the three level themes, the boss theme, and the victory and game over stingers. Level themes take an intensity value that follows level progress; stingers play once. The choice is stored in `localStorage` under `meridian-music-style` (an older `meridian-title-variant` key is migrated) and can be overridden with `?style=a|b|c` (`?title=` is an alias). The title tracks live in `src/audio/title/` together with the track player.
- `src/audio/sfx2/` holds the weapon and impact sound recipes that override the base ones in `sfx.js`, plus the sound lab. `music-lab.html` and `sfx-lab.html` are pages for auditioning every track and every sound effect.
- The first key press or tap on the title screen unlocks audio (the sound gate) and starts the title music; the pause and title screens have a mute toggle.

## Test hooks

- URL parameters: `?autostart=1`, `?level=0|1|2`, `?god=1`, `?difficulty=easy|normal|hard`, `?q=`, `?msaa=`, `?style=a|b|c` (music style, `?title=` is an alias).
- `window.__ctx` is the context above. `__ctx.game.advance(seconds)` steps the simulation without rendering.
- `tools/` contains puppeteer-core scripts that drive system Chrome; see the README.

## Feel tuning and diagnostics

- The values that decide how the game feels (steering, camera, shake, hit-stop, speed effects) live in the `feel` registry, one group per file in `src/feel/`. Code reads `feel.p.<group>.<key>` every frame. `?tune=1` (or the FEEL TUNING entry in the pause menu) opens a panel with a slider per value, presets and a copy button. See [TUNING.md](TUNING.md).
- `?telemetry=1` records frame time, camera lag and input latency (`window.__telemetry`). `tools/feelbot.mjs` drives scripted input and checks the numbers against `tools/feel-budgets.json`.
- `?diag=1` counts frames that came out black on the real display, `?nopost=1` skips the post chain and `?nooverlay=1` removes the page overlays, to isolate rendering problems.
- Adaptive quality changes are requested after a frame and applied before the next draw (a resize clears the canvas). A step down that does not speed frames up is undone and locked out for a while, because a 30 Hz display or browser energy saver caps the frame rate without the GPU being the limit.
