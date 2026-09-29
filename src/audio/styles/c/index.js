// Music style 'c' (Restrained orchestral). tracks maps a track name to a variant module (see ../../title/player.js for the contract):
// title, thalassa, cinder, foundry, boss, victory, gameover. Missing tracks fall back to the legacy songs in ../../songs.js.
import * as title from '../../title/variant_c.js';
import * as thalassa from './thalassa.js';
import * as cinder from './cinder.js';
import * as foundry from './foundry.js';
import * as boss from './boss.js';
import * as victory from './victory.js';
import * as gameover from './gameover.js';

export const style = { id: 'c', name: 'Restrained orchestral', tracks: { title, thalassa, cinder, foundry, boss, victory, gameover } };
