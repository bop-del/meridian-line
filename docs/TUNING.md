# Tuning the feel

MERIDIAN LINE has a live tuning panel. Every number that shapes how the game feels (steering, camera, hits, sense of speed) is a slider you can move while you fly, with no rebuild and no reload. The panel and its measuring tools only load when you ask for them, so the normal game never contains them.

## Turn it on

Add `?tune=1` to the game address, for example:

```
http://localhost:5173/?tune=1                       (title screen, start a level by hand)
http://localhost:5173/?tune=1&autostart=1&level=0   (straight into level 1)
http://localhost:5173/?tune=1&autostart=1&level=0&god=1   (no damage while you test)
```

Use `?telemetry=1` instead if you only want the measuring (no panel).

Press `F2` or the backquote key (`` ` ``) to hide and show the panel. When it is hidden, a small `FEEL` tab stays in the corner and shows an amber `TUNED` badge if any value is changed.

The panel is made not to take the keyboard: your keys keep flying the ship while it is open, except while a number box has focus (click away or press Escape to give the keys back). The mouse is used for the panel only. After you drag a slider or type in a box, the panel lets go of the keyboard again as soon as you release the mouse or move off the panel.

## What is on the panel

From top to bottom:

- **Readouts.** FPS, frame time (p95, the slow end of recent frames), camera lag (how far the camera trails behind where it wants to be, in world units), rail speed, field of view and current shake. These are live.
- **Filter box and preset menu.** Type part of a name, hint or group to show only matching values (groups open automatically). The preset menu switches everything at once. It reads `custom` when your values match none of them.
- **Groups.** `handling`, `impact` and `speed`. Each group is folded into sections (Input, Ship, Bank, Roll, Boost, Brake, Camera and so on). Click a group or section name to fold it. A dot and a count next to a name shows how many values inside are changed.
- **One row per value.** Name, unit, a slider and a number box. The grey tick on a slider marks the default. Type an exact number in the box and press Enter. A changed value turns amber and gets a filled dot: click the dot (or double-click the name) to put that one value back. Hover any row for its hint at the bottom of the panel.
- **File buttons.** `Copy values`, `JSON`, `Paste`, `Share link` and `Reset all` (see "Sending values back").
- **Test moves.** `Turn`, `Boost`, `Brake`, `Roll`. They press the real keys for you, so they go through the same input code as your keyboard, including the smoothing. They only work during a level.
- **Test hits.** `Damage 10`, `Damage 25` and `Blast` fire the same events a real hit or blast fires (shake, hit-stop, screen feedback, sound). Nothing is subtracted from your health. Damage alternates left and right so you can see the direction cue.
- **REC and Report.** `REC` starts a telemetry recording, press again to stop. `Report` copies the numbers as JSON.

Your changes are saved in the browser (local storage keys `meridian-feel` for values and `meridian-feel-ui` for the panel's open state) and come back the next time you open a `?tune=1` address. If you open the panel from the FEEL TUNING entry in the pause menu instead, your changes last until you reload the page. Use `?tune=1` to keep them. The title screen works too: values apply when the game starts.

## What each group does

- **handling.** How the ship flies. *Input* is how quickly held keys ramp up and down, the response curve, stick deadzone and the double-tap roll rules. *Ship* is top speed, acceleration, how fast it stops, and how softly it eases into the edge of the play area. *Bank* is how far the ship leans, pitches and yaws, and how springy that is (damping under 1 overshoots and settles, which is what gives a sense of mass). *Roll* is the barrel roll: length, sideways kick, how long steering is locked out. *Boost* and *Brake* are the forward speed ramps. *Camera* is the trailing follow: distance, height, lag on each axis, look-ahead, swing with sideways speed, roll into the bank.
- **impact.** How hits land. Shake per event type (player hit, blast, boss, barrel roll, death, explosion, charge, reflect), the caps that keep shake comfortable, hit-stop (the brief freeze on big events), damage vignette and low-health state, hit sparks, kill bursts, the reticle pulse and enemy wind-up cues.
- **speed.** How fast it feels. Field-of-view kick on boost and brake, speed streaks and dust, motion blur and chromatic fringe, and the boost and brake visuals.

Every value has a hint. If a name is unclear, hover it.

## A good way to tune

1. Start with the preset closest to what you want (`tight` is the default, `weighty` is heavier, `floaty` is deliberately extreme, use it to see what a value does).
2. Change one thing at a time. Use the test buttons so every trial is the same move.
3. Watch camera lag and the FOV/speed readouts while you do it. If lag climbs past about 4 units in a hard turn, the camera feels loose. If it stays near 0, the camera feels bolted on.
4. Use `Reset all` when you lose track. Amber rows are exactly what you changed.

## Sending values back

Pick whichever is easiest:

1. **Copy values.** Copies only what you changed, as text like:
   ```
   feel overrides:
     handling.accel: 18,   // default 14
     handling.camDistance: 11,   // default 12.5
   ```
   Paste it into a message. This is the smallest and most readable option.
2. **JSON.** Copies every value as a JSON snapshot. Use it if you want a complete record of a setup.
3. **Share link.** Copies an address with your changes packed in (`?tune=1&feel=...`). Whoever opens it gets exactly those values. A link always describes the complete set of changes, so it replaces any saved values on that browser instead of adding to them.

To load values you received, press `Paste`, paste either the JSON or the "Copy values" text, and press `Apply`. "reset first" (on by default) puts everything back to defaults before applying, so the result is exactly what was sent. Values the game does not know are ignored and counted in the message.

## Measuring instead of guessing

Open the browser console on a `?tune=1` or `?telemetry=1` page:

```js
__telemetry.start()    // begin recording
// fly for a while
__telemetry.stop()
__telemetry.report()   // plain JSON
```

The report contains:

- **frameMs.** Frame time in milliseconds: average, p50, p95, p99, worst, and counts of frames over 18 ms (below 55 fps) and 33 ms (below 30 fps). Aim for p95 under 16.7 ms.
- **camLag.** Distance between where the chase camera wants to be and where it is, in world units. Average, p95, max.
- **inputLatency.** Time from a steering key event to the first frame the ship's sideways or vertical velocity changed, in milliseconds and in frames. "fromRest" is the number that matters: a key press from standstill should show up in 1 frame or less.
- **railSpeed, fov.** Min, average and max.
- **shake.** Peak offset, average size and peak roll in degrees.

For a real-GPU frame-time run without touching the browser:

```
node tools/telemetry.mjs "http://localhost:5173/?autostart=1&level=0&god=1" 30 --weave
```

`--weave` flies a steering, boost and brake pattern with real key presses while it records. Add `--json` for raw output, `--out=report.json` to save it, and `--w`, `--h`, `--dpr` to change the window (default 1920x1080 at 1x).

## Regression bot

`tools/feelbot.mjs` steps the game at a fixed 60 Hz with scripted key presses and checks the result against `tools/feel-budgets.json`:

```
node tools/feelbot.mjs 5173 /tmp/feelbot
node tools/feelbot.mjs 5173 /tmp/feelbot --preset=tight
node tools/feelbot.mjs 5173 /tmp/feelbot --set=handling.accel=20,handling.decel=8
```

It prints a PASS or FAIL line for each check and exits with a non-zero code if anything fails. It checks: no NaN in ship or camera, how fast the ship responds to a key, overshoot and settle time, that the lean returns to zero, that the camera never ends up inside the ship or flips, camera lag in a hard turn, that a barrel roll ends at exactly zero rotation, that boost and brake reach their speed and return, that the field of view returns to normal after a boost, that every kind of shake stays under its cap and decays to zero, and that hit-stop always gives the time scale back at exactly 1.

The budgets are deliberately loose: they catch broken feel, not taste. Tighten them in `tools/feel-budgets.json` once you have settled on a preset.

## For developers: adding a tunable value

Register it in the file for its group (`src/feel/handling.js`, `impact.js` or `speed.js`) and read it as `feel.p.<group>.<key>` every frame, never cached:

```js
feel.register('speed', {
  streakLength: { value: 14, min: 4, max: 40, step: 0.5, label: 'Streaks: length', unit: 'u', hint: 'Length of a speed streak at full boost.' },
});
```

The panel picks it up with no other change. A label written as `Section: name` puts the row in a folded section called Section (or set `section: 'Section'` explicitly). Presets are `feel.definePreset(name, { 'group.key': value })`.
