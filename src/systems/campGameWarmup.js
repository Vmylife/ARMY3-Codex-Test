/* ARMY3 v1.90 - staged network prefetch + reusable near-portal game frames.
 * Never executes heavyweight GLB parsing for both mini-games during camp travel.
 * Only one near-portal scene is GPU-warmed at a time. Standalone page links remain fallback.
 */
import {clearCampSession} from './campSession.js?v=144';
const ROOT = new URL('../../', import.meta.url);
const urls = {
 blanket:'blanket-stack.html',
 grenade:'grenade-workshop-test.html'
};
const stage1 = [
 'blanket-stack.html?fromCamp=1&armyPrewarmed=1&v=157','grenade-workshop-test.html?fromCamp=1&armyPrewarmed=1&v=153',
 'assets/audio/minigames/blanket-parade-loop.mp3','assets/audio/minigames/grenade-ordnance-loop.mp3',
 'src/systems/minigameBgm.js?v=190','src/systems/grenadeEarlyAudio.js?v=191','src/systems/blanketSfx.js?v=173',
 'src/systems/blanketAchievements.js?v=324','src/systems/grenadeWorkshopSfx.js?v=326',
 'src/systems/grenadeArenaSfx.js?v=325',
 'assets/audio/blanket/blanket_drop_fabric.mp3','assets/audio/blanket/blanket_land_1.mp3',
 'assets/audio/blanket/blanket_land_2.mp3','assets/audio/blanket/blanket_land_3.mp3',
 'assets/audio/blanket/blanket_land_4.mp3','assets/audio/blanket/blanket_perfect_ding.mp3',
 'assets/audio/blanket/coin_payout_finish.mp3',
 'assets/audio/grenade/01_fill_loop.mp3',
 'assets/audio/grenade/02_fill_stop.mp3','assets/audio/grenade/03_press_start.mp3',
 'assets/audio/grenade/04_press_good.mp3','assets/audio/grenade/05_press_perfect.mp3',
 'assets/audio/grenade/06_press_bad.mp3','assets/audio/grenade/10_overflow.mp3',
 'assets/audio/grenade/ratchet_1.mp3','assets/audio/grenade/ratchet_2.mp3',
 'assets/audio/grenade/ratchet_3.mp3','assets/audio/grenade/ratchet_4.mp3',
 'assets/audio/grenade/aim_lock.mp3',
 'assets/audio/grenade/flight_cartoon_B_long.mp3',
 'assets/audio/grenade/explosion_crack_rumble.mp3',
 'assets/audio/grenade/ground_land.mp3','assets/audio/grenade/collapse_2.mp3',
 'assets/audio/grenade/collapse_3.mp3','assets/audio/grenade/debris_scatter.mp3',
 'assets/audio/grenade/collapse_1.mp3',
 'blanket-stack-scene.json?v=153','grenade-user-scene.json?v=130',
 'blanket-stack.js?v=156','grenade-user-play.html?embedded=1&v=153',
 'grenade-user-play-3d.js?v=139'
];
const status = {blanket:{},grenade:{}};
let enabled=false, active=null, warming=null, prefetching=false, pendingPrefetch=false;
const seen = new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const isIdle=()=>document.body.classList.contains('army-ready')&&!document.hidden&&!active;
const idle=()=>new Promise(resolve=>{if('requestIdleCallback'in window)requestIdleCallback(resolve,{timeout:1000});else setTimeout(resolve,120)});
async function fetchCached(path){
 const url=new URL(path,ROOT);
 if(seen.has(url.href))return;
 seen.add(url.href);
 try{
  const res=await fetch(url,{cache:'force-cache'});
  if(!res.ok)throw new Error('HTTP '+res.status);
  // Read the whole body so the HTTP cache stores it, but do not retain binary buffers.
  await res.arrayBuffer();
 }catch(err){seen.delete(url.href);console.debug('[營區預載]略過',path,err?.message||err)}
}
async function sceneryModels(sceneFile,kind){
 try{
  const r=await fetch(new URL(sceneFile,ROOT),{cache:'force-cache'});
  if(!r.ok)return [];
  const json=await r.json(),items=Array.isArray(json.items)?json.items:[];
  const priority=[];
  if(kind==='blanket'){
   const base=items.find(x=>x.uid===json.foundationId&&x.category==='blanket');
   if(base)priority.push(base);
   const mine=items.find(x=>x.category==='mine');if(mine)priority.push(mine);
   const cadet=items.find(x=>x.category==='soldier');if(cadet)priority.push(cadet);
   priority.push({model:'./assets/grenade-low/grenade-soldier-low.glb'});
  }else{
   const thrower=items.find(x=>x.uid===(json.throwerUid||'g10001'));
   if(thrower)priority.push(thrower);
   const enemy=items.find(x=>x.team==='enemy');if(enemy)priority.push(enemy);
   const friend=items.find(x=>x.team==='friendly');if(friend)priority.push(friend);
  }
  const unique=new Set(),out=[];
  for(const obj of [...priority,...items]){
   const model=obj?.model;
   if(typeof model!=='string'||!/^\.\/assets\/[\w/-]+\.glb(?:\?.*)?$/i.test(model))continue;
   if(unique.has(model))continue;unique.add(model);out.push(model);
   if(out.length>= (kind==='blanket'?10:12))break;
  }
  return out;
 }catch(e){console.debug('場景清單預載略過',kind,e);return []}
}
async function prefetch(){
 if(prefetching||pendingPrefetch)return;
 pendingPrefetch=true;
 await idle();
 pendingPrefetch=false;
 if(!isIdle())return;
 if(navigator.connection?.saveData||/2g/.test(navigator.connection?.effectiveType||''))return;
 prefetching=true;
 try{
  // Audio, pages and scene definitions first: fixes the silent opening seconds.
  for(const f of stage1){
   if(!isIdle())break;
   await fetchCached(f);
   await idle();
  }
  if(isIdle()){
   const a=await sceneryModels('blanket-stack-scene.json?v=153','blanket');
   const b=await sceneryModels('grenade-user-scene.json?v=130','grenade');
   // Avoid several simultaneous large GLB downloads while 3D camp is running.
   const interleaved=[];
   for(let i=0;i<Math.max(a.length,b.length);i++){if(a[i])interleaved.push(a[i]);if(b[i])interleaved.push(b[i]);}
   for(const f of interleaved){
    if(!isIdle())break;
    await fetchCached(f);
    await idle();
   }
  }
 }finally{prefetching=false;}
}
function discard(kind){
 const s=status[kind];if(!s?.frame)return;
 s.frame.remove();s.frame=null;s.loaded=false;s.ready=false;
 if(warming===kind)warming=null;
}
function readyFrame(kind){
 const s=status[kind],frame=s.frame;
 if(!frame||!s.loaded)return false;
 try{
  const w=frame.contentWindow;
  if(kind==='blanket')return !!w.__blanketTest&&w.__blanketTest.state==='intro';
  const nested=w.document.getElementById('grenadeArenaFrame');
  return !!nested?.contentWindow?.__grenadeTest?.world&&nested.contentWindow.__grenadeTest.world.modelState==='ready';
 }catch{return false}
}
function warm(kind){
 if(!isIdle()||!urls[kind])return;
 if(warming&&warming!==kind)discard(warming);
 if(status[kind].frame)return;
 const frame=document.createElement('iframe');
 frame.dataset.armyPrewarmedGame=kind;
 frame.id='armyWarmGameFrame';
 frame.title=kind==='blanket'?'棉被疊疊樂預先載入':'手榴彈遊戲預先載入';
 frame.setAttribute('loading','eager');
 frame.setAttribute('aria-hidden','true');
 frame.setAttribute('allow','autoplay');
 frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:90;opacity:0;visibility:hidden;pointer-events:none;background:#13251c;';
 const s=status[kind];s.frame=frame;s.loaded=false;s.ready=false;warming=kind;
 frame.addEventListener('load',()=>{
  if(s.frame!==frame)return;
  s.loaded=true;
  if(kind==='grenade'){
   try{
    // Workshop has the ability to preload its nested 3D scene without starting the challenge.
    const w=frame.contentWindow;
    // The workshop previously waited for its 3D sub-frame before loading any audio.
    // Boot the original workshop SFX and BGM here, while the player is still walking.
    const script=w.document.createElement('script');script.type='module';
    script.src=new URL('src/systems/grenadeEarlyAudio.js?v=191',ROOT).href;
    w.document.head.append(script);
    // The workshop wraps warmThrowingGame in a private closure. Its own start
    // button is the supported way to start the nested arena warm-up. Restore
    // the intro overlay so the player still makes the real start gesture.
    const start=w.document.getElementById('startBtn');
    if(start){start.click();const intro=w.document.getElementById('intro');if(intro)intro.style.display='';}
   }catch(e){console.debug('手榴彈預建投擲場',e)}
  }
 },{once:true});
 frame.addEventListener('error',()=>{if(s.frame===frame)discard(kind)},{once:true});
 frame.addEventListener('load',()=>{
  // An older cached return handler may navigate only the iframe. Recover safely.
  try{if(s.frame===frame&&active===kind&&/\/index\.html$/.test(frame.contentWindow.location.pathname))exit()}catch{}
 });
 frame.src=new URL(urls[kind]+'?fromCamp=1&armyPrewarmed=1'+(kind==='grenade'?'&v=153':'&v=157'),ROOT).href;
 document.body.appendChild(frame);
}
const lastApproach={blanket:0,grenade:0};
let rewarmAfter=0;
function approach(kind,distance){
 if(!enabled||active||!isIdle())return;
 const now=performance.now();
 if(now<rewarmAfter)return;
 if(now-(lastApproach[kind]||0)<380)return;lastApproach[kind]=now;
 if(distance<=11){
   if(!status[kind]?.frame)warm(kind);
   else status[kind].ready=readyFrame(kind);
 }else if(distance>23&&warming===kind){discard(kind)}
}
function enter(kind){
 const s=status[kind];if(!s||active)return false;
 // Even when the frame is still warming, display its real loading UI. No duplicate page navigation.
 if(!s.frame)warm(kind);
 if(!s.frame)return false;
 active=kind;
 document.body.classList.add('army-in-minigame');
 window.armyMinigameActive=true;
 s.frame.style.visibility='visible';s.frame.style.opacity='1';s.frame.style.pointerEvents='auto';
 s.frame.setAttribute('aria-hidden','false');
 s.frame.contentWindow?.focus?.();
 return true;
}
function exit(){
 if(!active)return;
 const kind=active;active=null;rewarmAfter=performance.now()+3500;
 document.body.classList.remove('army-in-minigame');
 window.armyMinigameActive=false;
 clearCampSession();
 discard(kind);
 // Let the camp breathe before any new WebGL warm-up.
 setTimeout(()=>{if(isIdle())prefetch()},900);
}
window.addEventListener('message',event=>{
 if(!active||event.origin!==location.origin)return;
 const s=status[active];if(!s?.frame||event.source!==s.frame.contentWindow)return;
 if(event.data?.type==='ARMY3_RETURN_TO_CAMP')exit();
});
const observer=new MutationObserver(()=>{
 if(document.body.classList.contains('army-ready')){enabled=true;observer.disconnect();setTimeout(prefetch,1200);}
});
observer.observe(document.body,{attributes:true,attributeFilter:['class']});
if(document.body.classList.contains('army-ready')){enabled=true;setTimeout(prefetch,1200)}
window.addEventListener('pageshow',()=>{if(isIdle())setTimeout(prefetch,500)});
window.armyGameWarmup={approach,enter,exit,getState:(kind)=>({loaded:!!status[kind]?.loaded,ready:!!status[kind]?.ready,prefetching})};
