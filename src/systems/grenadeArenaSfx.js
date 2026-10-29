import './grenadePowerBalanceFix.js?v=324';
import './grenadeCasualtyGrounding.js?v=323';
import './grenadeGalleryFix.js?v=323';
import './grenadeEnemyReview.js?v=321';
/* ARMY3 grenade audio v3.16: cartoon B launched at real hand-release, reduced volume. */
(()=>{'use strict';
if(window.__armyGrenadeArenaSfx?.dispose)return;
const rootUrl=new URL('../../assets/audio/grenade/',import.meta.url);
const files={meter1:'meter_1.mp3',meter2:'meter_2.mp3',lock:'aim_lock.mp3',
 flight:'flight_cartoon_B_long.mp3',land:'ground_land.mp3',blast:'explosion_crack_rumble.mp3',
 debris:'debris_scatter.mp3',collapse1:'collapse_1.mp3',collapse2:'collapse_2.mp3',collapse3:'collapse_3.mp3'};
const AudioClass=window.AudioContext||window.webkitAudioContext;
const decoded=new Map(),pending=new Map(),listeners=[];
let ctx=null,master=null,flight=null,flightInstance=null,phase='',lastCount=0,meterTravel=0,lastMeterPosition=null,lastMeter=0;
let lastCollapse=0,queue=0,collapseIndex=0,activeCollapses=0,disposed=false;
function muted(){try{return localStorage.getItem('ARMY3_grenade_sfx_muted_v1')==='1'}catch{return false}}
function context(){if(!AudioClass||disposed)return null;if(!ctx){ctx=new AudioClass();master=ctx.createGain();master.gain.value=.67;master.connect(ctx.destination)}return ctx}
function preload(name){if(pending.has(name))return pending.get(name);const c=context();if(!c)return Promise.resolve(null);
 const promise=fetch(new URL(files[name],rootUrl),{cache:'force-cache'})
  .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status+': '+files[name]);return r.arrayBuffer()})
  .then(buffer=>c.decodeAudioData(buffer))
  .then(buffer=>{decoded.set(name,buffer);return buffer})
  .catch(error=>{console.warn('[ARMY3 grenade SFX]',name,error);return null});
 pending.set(name,promise);return promise;
}
function unlock(){const c=context();if(c&&c.state==='suspended')c.resume().catch(()=>{});for(const key in files)preload(key)}
function play(key,volume=1,rate=1){if(muted()||disposed)return null;const c=context(),b=decoded.get(key);if(!c||c.state!=='running')return null;if(!b){preload(key);return null}
 const source=c.createBufferSource(),g=c.createGain();source.buffer=b;source.playbackRate.value=rate;
 g.gain.value=Math.max(0,Math.min(1.15,volume));source.connect(g);g.connect(master);source.start();
 return {source,gain:g};
}
function stopFlight(){if(!flight)return;const f=flight;flight=null;try{const t=ctx.currentTime;f.gain.gain.cancelScheduledValues(t);f.gain.gain.setValueAtTime(f.gain.gain.value,t);f.gain.gain.linearRampToValueAtTime(.0001,t+.105);f.source.stop(t+.115)}catch{}}
function listen(target,type,fn,option){if(!target)return;target.addEventListener(type,fn,option);listeners.push(()=>target.removeEventListener(type,fn,option))}
// Playback on iPhone needs an explicit tap; events from the same-origin workshop
// activate the already-preloaded range iframe before the first throw.
const parentDoc=(()=>{try{return window.parent!==window&&window.parent.location.origin===location.origin?window.parent.document:null}catch{return null}})();
listen(document,'pointerdown',unlock,{passive:true});listen(document,'keydown',unlock,{passive:true});
listen(parentDoc,'pointerdown',unlock,{passive:true});listen(parentDoc,'keydown',unlock,{passive:true});
listen(document,'visibilitychange',()=>{if(document.hidden)stopFlight()});
listen(window,'pagehide',stopFlight);
Object.keys(files).forEach(preload);
function meterPosition(stage){
 if(stage==='aimX'){
  const v=Number(document.getElementById('grenadeDirectionRay')?.getAttribute('x2'));
  return Number.isFinite(v)?Math.max(0,Math.min(1,(v-24)/272)):null;
 }
 const v=parseFloat(document.getElementById('needleV')?.style.top);
 return Number.isFinite(v)?Math.max(0,Math.min(1,(v-16)/68)):null;
}
function cycle(ms){if(disposed)return;requestAnimationFrame(cycle);const game=window.__grenadeTest;
 if(!game?.world)return;
 const current=game.state; if(!current)return;
 if(current!==phase){
  // Confirm plays only when a valid tap changes the meter state, not while sliding the controls.
  if(phase==='aimX'&&current==='aimZ')play('lock',.59,1.07);
  if(phase==='aimZ'&&current==='flight')play('lock',.70,.92);
  if(current==='flight'){
   // The UI enters 'flight' at button tap, while the actor is still turning and
   // performing the pitching animation. The grenade must remain silent here.
   stopFlight();flightInstance=null;
  }
  if(current==='landed'){
   stopFlight();flightInstance=null;play('land',.92,.94+Math.random()*.1);
  }
  if(current==='blast'){
   stopFlight();play('blast',.76,.97+Math.random()*.055);
   // The original grenade's low rumble continues underneath this sharp transient.
  }
  if(current==='aimX'||current==='aimZ'){stopFlight();flightInstance=null;meterTravel=0;lastMeterPosition=null;lastMeter=ms}
  if(current==='end'||current==='intro'){stopFlight();flightInstance=null;meterTravel=0;lastMeterPosition=null;queue=0;if(current==='end')play('lock',.34,.82)}
  phase=current;
 }
 if(document.hidden)return;
 if(muted())stopFlight();
 // Actual release detection: launchFlight() constructs world.flight and changes
 // camPhase to 'flight' only when the right-hand grenade leaves the animation.
 // Don't guess a fixed timer; throwing duration/camera timing can vary.
 if(current==='flight'){
  const grenade=game.world.flight;
  if(game.world.camPhase==='flight'&&grenade&&!grenade.done&&flightInstance!==grenade){
   // Play B exactly once per released grenade, at lower volume; if decoding
   // hasn't finished yet, retry on the next frame rather than skipping forever.
   stopFlight();
   const shot=play('flight',.38,1);
   if(shot){flight=shot;flightInstance=grenade;}
  }
 }
 // Tick proportional to actual pointer movement, with a speed cap so it doesn't sound electronic.
 if(current==='aimX'||current==='aimZ'){
  const p=meterPosition(current);
  if(p!==null){
   if(lastMeterPosition!==null)meterTravel+=Math.min(.085,Math.abs(p-lastMeterPosition));
   lastMeterPosition=p;
   if(meterTravel>=.155&&ms-lastMeter>=145){
    meterTravel-=.155;lastMeter=ms;
    play(Math.random()<.5?'meter1':'meter2',.29,.97+Math.random()*.07);
   }
  }
 }
 // Building count persists between all three throws. Never replay a destroyed building.
 const count=Math.max(0,Math.floor(Number(game.world.counter?.buildings)||0));
 if(count<lastCount){lastCount=count;queue=0}
 if(count>lastCount){if(current==='blast')queue=Math.min(6,queue+count-lastCount);lastCount=count}
 if(current==='blast'&&queue>0&&activeCollapses<2&&ms-lastCollapse>=250){
  const batch=Math.min(queue,3);queue-=batch;lastCollapse=ms;collapseIndex=(collapseIndex+1)%3;
  const variant='collapse'+(collapseIndex+1),played=play(variant,Math.min(.94,.61+.095*batch),.91+Math.random()*.13);
  if(played){activeCollapses++;played.source.addEventListener('ended',()=>{activeCollapses=Math.max(0,activeCollapses-1)},{once:true});
   if(batch>=2)play('debris',Math.min(.55,.20+batch*.09),.95+Math.random()*.10);
  }
 }
}
requestAnimationFrame(cycle);
window.__armyGrenadeArenaSfx={unlock,dispose(){disposed=true;stopFlight();for(const f of listeners)try{f()}catch{};try{ctx?.close()}catch{}}};
})();
