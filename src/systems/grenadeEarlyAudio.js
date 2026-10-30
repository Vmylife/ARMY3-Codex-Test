import './grenadeGalleryFix.js?v=323';
/* v1.90: Initialize the workshop audio BEFORE its heavy 3D throw arena finishes.
 * Uses the same gameplay effect code; does not autoplay without a real user tap.
 */
import './grenadeWorkshopSfx.js?v=327';
import {installMinigameBgm} from './minigameBgm.js?v=190';
// Workshop uses its own #startBtn; the new music module recognizes that early stage.
installMinigameBgm('grenade',{host:window,sceneWindow:window,control:true});
