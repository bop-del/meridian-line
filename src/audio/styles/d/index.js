// Music style 'd' (Techno, melodic techno family).
//
// Mix variants (all share the same tracks, keys, tempos and config driven builder, see shared/variants.js):
//   ?dvar=melodic   pluck arps and a sparse bell motif are the main voice
//   ?dvar=pressure  strongest kick and bass, arps as quiet texture, almost no motif
//   ?dvar=deep      (default) pads forward, rounder kick and sub bass, a single bell note now and then, less percussion
//   ?dvar=hypno     groove first: kick, bass and percussion, short filtered arp ticks, no motif, low steady pads
// The switch applies to the title, foundry, cinder, thalassa and boss tracks for that page load (also in music-lab.html);
// the victory and game over stings keep their sound. An unknown value falls back to deep.
//
// tracks maps a track name to a variant module (contract in ../../title/player.js):
// title, foundry, cinder, thalassa, boss, victory, gameover. A track that is missing falls back to the legacy songs until it is written.
import * as title from '../../title/variant_d.js';
import * as foundry from './foundry.js';
import * as cinder from './cinder.js';
import * as thalassa from './thalassa.js';
import * as boss from './boss.js';
import * as victory from './victory.js';
import * as gameover from './gameover.js';

export const style = { id: 'd', name: 'Techno', tracks: { title, foundry, cinder, thalassa, boss, victory, gameover } };
