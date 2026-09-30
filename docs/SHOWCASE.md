# Showcase mode

`?showcase=1` turns the game into a self-playing demo. An autopilot flies a whole level, fights the boss and shows the defeat, while the cinematic camera adds a few extra shots. The point is to screen record a trailer with the real audio, or to leave the game running on a second screen.

    http://localhost:5173/?showcase=1                 # level 0, the Obsidian Foundry
    http://localhost:5173/?showcase=1&level=2         # Thalassa Coast
    http://localhost:5173/?showcase=1&hud=0&loop=1    # clean picture, runs unattended

## URL parameters

| Parameter | Effect |
|---|---|
| `?showcase=1` | Turns the mode on. Without `level` it starts at the first mission. |
| `?level=0\|1\|2` | Mission to fly: 0 Obsidian Foundry, 1 the Cinder Belt, 2 Thalassa Coast. |
| `?hud=0` | Hides the HUD (warnings and banners included) and the comm boxes. The level name card at the start of a level stays. |
| `?loop=1` | Keeps going. After a level ends and the result screen has been up for a few seconds, the next level starts (Foundry, Cinder Belt, Thalassa, then round again). With an explicit `?level=` that same level repeats instead. |
| `?bars=0` | No letterbox bars. They are on by default and slide in and out with the camera shots. |

Other switches still work: `?difficulty=`, `?style=a|b|c|d` for the music style, `?q=` for the render quality.

## Starting it with sound

Browsers block audio until the first key press or click. The title screen already has a sound gate for this, and showcase mode uses it as the start button: open the URL, press any key or click once, and the run begins with the music playing. A headless browser (the tools) starts at once.

The window losing focus normally pauses the game. In showcase mode the game resumes by itself after a short moment, so clicking into the recorder does not freeze the run. Pausing with Esc still works when the window has focus.

## What the autopilot does

It only presses the same controls a player has (`input.autopilot`, see `src/core/input.js`), and it never edits the world. God mode is on, so the ship cannot be lost, but it is flown to look right anyway:

- **Steering.** A slow weave for composition, pulled toward the target it is shooting at and toward pickups, and pushed away from obstacles. Ten times a second it scores a grid of lanes by whether the ship would touch anything on the way there, using the obstacles' own hit test.
- **Fire.** Short pulse bursts at a single target. On groups of enemies and on the exposed weak points of a boss it holds the fire button, locks on and releases for the homing volley.
- **Boost.** On clear straights, when nothing is ahead and the boost meter is full enough. Never into a wave or into the boss.
- **Barrel roll.** At incoming enemy fire (it deflects the shot), and now and then for the picture.
- **Bomb.** When a crowd of six or more enemies is inside the blast range, never while a camera shot is running or about to start, and not around a boss.
- **Boss.** It waits for the entrance shot to end, lines up with the exposed weak points and fights through every phase. After the defeat finisher the normal result screen appears.

## Camera shots

Besides the level intro, the signature moment and the boss entrance and finisher (all in the game itself), showcase mode plays five extra shots through the cinema director with `cinema.play(name, { free: true })`. They are 5 to 6.4 seconds long, which is why they need `free`. The player keeps control during all of them. They start and end on the live chase camera, and they stay out of the way of the level's own signature moment and of the boss shots. The camera and the look point are filtered as offsets from the ship, the view turns at most about 2 degrees per frame at 60 Hz, the camera keeps at least 10.5 units from the ship and out of walls, so there are no snaps (measured: at most 0.6 units of camera travel and 2.2 degrees of turn per frame against the rail).

| Shot | What it shows |
|---|---|
| `showcase.drone` | A camera in front of and beside the ship that circles round to the back. |
| `showcase.flyby` | Starts far ahead beside the lane, the ship comes up to it, passes, and the camera falls in behind. |
| `showcase.lowsweep` | A low camera skimming beside the ship, rising into the chase. |
| `showcase.wide` | Pulls up and back for a high three quarter view of the level ahead. |
| `showcase.orbit` | Circles the boss fight with both the ship and the boss in frame. Plays once the boss has settled, at each phase change and when the boss is half gone. |

Shots are planned by rail distance (6 per level) and only start when the ship is not being shot at from close range.

## Reading the run

`__ctx.showcase.status()` returns the phase, rail distance, health, the boss state, the shots played and counters (kills, rolls, boosts, bombs, volleys). `__ctx.showcase.log` is a time stamped list of the level events, the shots and the boss phases. The tools use it.

## README GIFs

    node tools/gifs.mjs <port> docs           # one GIF per level into docs/

`tools/gifs.mjs` plays the showcase route on the real GPU with a fixed time step, so the frames are the same every time, and writes the GIFs that the README shows. It finds the moment in a first pass without rendering, replays to just before it, screenshots every step and builds the GIF with ffmpeg. See the header of the file for the options (`--kind=start|moment|fight|entrance|orbit|finisher`, `--len`, `--w`, `--fps`, `--software`).

GIFs of a flying camera are large, because every pixel changes from one frame to the next. Film grain and the scan line overlay are switched off for the capture, and the tool lowers the frame rate and the palette (big palettes first, because sea and sky band badly) until each GIF fits 2.5 MB. The last half second is cross faded over the first, so the loop has no jump. The four shipped GIFs are an orbit shot round the Regent fight, the Regent's defeat finisher, the Orrery's defeat finisher and the Tidebreaker's entrance.
