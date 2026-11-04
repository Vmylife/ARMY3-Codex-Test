// ARMY3 FIGHT LAB V1 — real skinned soldiers + layered hits, no edits to army camp.
// Standalone: only one animation asset is downloaded and one GPU mesh is shared by both actors.
import {ArmyRenderer} from '../core/renderer.js?v=116';
import {RigAnimator} from '../characters/rigAnimator.js?v=121';
import {loadGlb} from '../core/glb111.js?v=111';
import {mul,translation,rotateY} from '../core/math.js?v=060';
import {FightEngine,ATTACKS,LAUNCH_AFTER_DAMAGE} from './engine.js?v=8';
import {installUserCombatClips} from './uploadedHitAnimations.js?v=1';
import {setupInput} from '../ui/input.js?v=062';
import {PistolRenderer} from './pistolRenderer.js?v=1';

const $=id=>document.getElementById(id);
const e=new FightEngine();
const SLOW_MOTION=.12;
let wheelOpen=false,wheelSelection='up',wheelPointer=null,wheelOverlayPointer=null,suppressWheelClick=false;
const WEAPON_SLOTS={up:{weapon:'fists',name:'拳頭'},right:{weapon:'pistol',name:'手槍'},bottom:{weapon:null,name:'未解鎖'},left:{weapon:null,name:'未解鎖'}};
let renderer=null,ground=null,actors=null,pistol=null,pistolActor=null,ready=false,last=0,shake=0,noticeUntil=0,roundSerial=0,audio=null,sample=null;
let gunAudioBuffer=null,gunAudioPromise=null;
const tracerNodes=new Map();
let input=()=>({x:0,y:0,magnitude:0});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*clamp(t,0,1);
let cameraYaw=.66,cameraPitch=.72,cameraZoom=12,targetZoom=12;
const rotateX=rad=>{const c=Math.cos(rad),s=Math.sin(rad);return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1])};
function tell(text,ms=1700){
 $('callout').textContent=text;
 noticeUntil=performance.now()+ms;
}
function loadProgress(got,total){
 if(total>0)$('loadBar').style.width=Math.min(92,Math.round(got/total*85))+'%';
 $('loadText').textContent='正在載入拳擊動畫與士兵模型…'+(total?Math.round(got/total*100)+'%':'');
}
function makeGround(gl){
 const pos=[],cols=[],norms=[];
 const push=(a,b,c,color)=>{for(const p of [a,b,c]){pos.push(...p);cols.push(...color);norms.push(0,1,0)}};
 const quad=(x1,z1,x2,z2,y,color)=>{
  push([x1,y,z1],[x2,y,z1],[x1,y,z2],color);
  push([x1,y,z2],[x2,y,z1],[x2,y,z2],color);
 };
 // Boxing test mat, drawn above the original camp's static terrain.
 for(let x=-18;x<18;x++)for(let z=-14;z<14;z++){
  const edge=x===-18||x===17||z===-14||z===13;
  quad(x,z,x+1,z+1,.075,edge?[.22,.40,.31]:(x+z)%2?[.66,.76,.61]:[.70,.78,.65]);
 }
 for(let k=0;k<86;k++){
  const a=k*2*Math.PI/86,b=(k+1)*2*Math.PI/86;
  const ring=(r,th,c)=>{
   const p=(rad,angle)=>[Math.cos(angle)*rad,.087,Math.sin(angle)*rad];
   push(p(r,a),p(r+th,a),p(r,b),c);
   push(p(r,b),p(r+th,a),p(r+th,b),c);
  };
  ring(10.85,.13,[.91,.73,.33]);
  ring(10.65,.038,[.93,.88,.64]);
 }
 quad(-.028,-11,.028,11,.093,[.87,.86,.62]);
 for(const side of [-1,1]){
  const color=side<0?[.26,.57,.47]:[.75,.36,.27];
  for(let k=0;k<58;k++){
   const a=2*Math.PI*k/58,b=2*Math.PI*(k+1)/58;
   const px=side*3.0,r=.58,y=.105;
   const pos=(ang,rad)=>[px+Math.cos(ang)*rad,y,Math.sin(ang)*rad];
   push(pos(a,r),pos(a,r+.065),pos(b,r),color);
   push(pos(b,r),pos(a,r+.065),pos(b,r+.065),color);
  }
 }
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 for(const [index,data] of [[0,pos],[1,cols],[2,norms]]){
  const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,3,gl.FLOAT,false,0,0);
 }
 gl.bindVertexArray(null);
 return{vao,count:pos.length/3};
}
function renderFloor(){
 if(!renderer||!ground)return;
 const gl=renderer.gl;
 gl.useProgram(renderer.pFlat);
 gl.uniformMatrix4fv(renderer.flatVP,false,renderer.vp);
 gl.bindVertexArray(ground.vao);gl.drawArrays(gl.TRIANGLES,0,ground.count);gl.bindVertexArray(null);
}
function poseFloorLift(asset,anim,pose){
 // Evaluate the rotated, skinned corpse's lowest sampled point above the floor.
 let lowest=Infinity;
 for(const s of asset.sample||[]){
  let x=0,y=0,z=0;
  for(let k=0;k<4;k++){
   const weight=s.w[k];if(weight<=0)continue;
   const b=s.j[k]*16,px=s.p[0],py=s.p[1],pz=s.p[2],m=anim.bones;
   x+=weight*(m[b]*px+m[b+4]*py+m[b+8]*pz+m[b+12]);
   y+=weight*(m[b+1]*px+m[b+5]*py+m[b+9]*pz+m[b+13]);
   z+=weight*(m[b+2]*px+m[b+6]*py+m[b+10]*pz+m[b+14]);
  }
  lowest=Math.min(lowest,pose[1]*x+pose[5]*y+pose[9]*z+pose[13]);
 }
 return Number.isFinite(lowest)?Math.max(0,.115-lowest):0;
}
function isRestingDead(f){return f.hp<=0&&Number.isFinite(f.deathAt)&&e.time-f.deathAt>=.75&&f.airTime<=0}
function lowFootLift(asset,anim){
 if(!['Knock_Down','Arise','BeHit_FlyUp','falling_down','Hit_Reaction','Block2'].includes(anim.clip)||!asset?.sample?.length)return 0;
 let low=Infinity;
 for(const s of asset.sample){
  let y=0;for(let k=0;k<4;k++){const weight=s.w[k];if(weight<=0)continue;
   const base=s.j[k]*16;
   y+=weight*(anim.bones[base+1]*s.p[0]+anim.bones[base+5]*s.p[1]+anim.bones[base+9]*s.p[2]+anim.bones[base+13]);
  }
  if(y<low)low=y;
 }
 return Number.isFinite(low)?clamp(.015-low,0,1.0):0;
}
function drawFighter(f,actor){
 const r=renderer,gl=r.gl,a=r.assets.get('duelist'),anim=actor.anim;
 if(!a)return;
 // Additive torso recoil around the waist, ON TOP of the original punch/knockdown animation.
 const deadRest=isRestingDead(f);
 const lean=clamp(f.lean+(f.id==='player'&&e.weapon==='pistol'?(f.gunKick||0):0),-.65,.30);
 // Negative X rotation turns the chest UP for a relaxed supine corpse.
 const pivot=deadRest?
  mul(translation(0,.75,0),mul(rotateX(-Math.PI/2),translation(0,-.75,0))):
  mul(translation(0,.77,0),mul(rotateX(lean),translation(0,-.77,0)));
 const lift=deadRest?poseFloorLift(a,anim,pivot):lowFootLift(a,anim)+.095+(f.airHeight||0);
 const model=mul(translation(f.x,lift,f.z),mul(rotateY(f.angle),pivot));
 gl.useProgram(r.p);
 gl.uniformMatrix4fv(r.uniforms.vp,false,r.vp);
 gl.uniformMatrix4fv(r.uniforms.model,false,model);
 gl.uniformMatrix4fv(r.uniforms.bones,false,anim.bones);
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,a.tex);
 gl.uniform1i(r.uniforms.tex,0);
 gl.bindVertexArray(a.vao);gl.drawElements(gl.TRIANGLES,a.count,a.indexType,0);
 gl.bindVertexArray(null);
 return model; // Let held weapons use exactly the same world transform as the soldier.
}
const CLIP={idle:'Idle',walk:'Walking',attack:'Punch_Combo_1',hit:'Hit_Reaction',down:'falling_down',rise:'Arise'};
function syncActor(f,actor,dt){
 const anim=actor.anim;
 let clip=isRestingDead(f)?'Idle':CLIP[f.state]||'Idle';
 if(f.state==='hit')clip=f.impactAnim||'Hit_Reaction';
 if(f.state==='walk'){
  clip=f.id==='player'?(f.moveSpeed>=7?'RunFast':f.moveSpeed>=4.2?'Running':'Walking')
   :(f.moveSpeed>=4.0?'Running':'Walking');
 }
 if(!anim.hasClip(clip))clip=anim.hasClip('Walking')?'Walking':Object.keys(anim.clips)[0];
 if(clip!==actor.clip){
  anim.setClip(clip,{restart:true});
  if(f.state==='attack'||f.state==='down'||f.state==='rise'||isRestingDead(f)){anim.transition=0;anim.prevClip=null}
  actor.clip=clip;
 }
 if(f.state==='attack'&&f.attack){
  const duration=anim.clips[clip]?.duration||1.5;
  anim.speed=clamp(duration/(ATTACKS[f.attack.type].length*1.45),.85,2.5);
 }else if(f.state==='hit'){
  anim.speed=clamp((anim.clips[clip]?.duration||1.6)/.64,1,3.1);
 }else if(f.state==='down'){
  anim.speed=clamp((anim.clips[clip]?.duration||2.2)/1.95,.85,1.7);
 }else if(f.state==='rise'){
  anim.speed=clamp((anim.clips[clip]?.duration||1.8)/1.70,.85,1.4);
 }else if(f.state==='walk'){
  // NPCs RUN, not sprint; foot tempo follows actual world displacement.
  anim.speed=f.id==='player'
   ?clamp((f.moveSpeed||3)/4,.86,1.55)
   :f.moveSpeed>=4.0?clamp((f.moveSpeed||5.05)/5.05,.90,1.18)
    :clamp((f.moveSpeed||2.6)/2.7,.72,1.08);
 }else anim.speed=1;
 if(f.id==='player'){
  const target=e.weapon==='pistol'&&f.hp>0&&!['hit','down','rise'].includes(f.state)?1:0;
  anim.rifleAim=lerp(anim.rifleAim||0,target,dt*13);
 }
 anim.evaluate(dt);
}
function project(x,y,z){
 if(!renderer)return{x:innerWidth/2,y:innerHeight/2};
 const m=renderer.vp,w=m[3]*x+m[7]*y+m[11]*z+m[15];
 if(w<.05)return{x:innerWidth/2,y:innerHeight/2};
 const sx=m[0]*x+m[4]*y+m[8]*z+m[12],sy=m[1]*x+m[5]*y+m[9]*z+m[13];
 const rect=$('arena').getBoundingClientRect();
 return{x:rect.left+(sx/w*.5+.5)*rect.width,y:rect.top+(.5-sy/w*.5)*rect.height};
}
function followLabel(id,f){
 const at=project(f.x,2.0,f.z),node=$(id);
 node.style.left=at.x+'px';node.style.top=at.y+'px';
}
function hitBurst(event){
 if(!renderer)return;
 const at=project(event.at.x,1.18,event.at.z);
 const node=document.createElement('div');node.className='hitBurst '+(event.down?'heavy ':'')+(event.type==='bullet'?'bulletHit ':'')+(event.who==='player'?'':'enemy');
 node.dataset.text=event.down?'擊飛！':event.type==='bullet'?'命中！':'啪！';
 node.style.left=at.x+'px';node.style.top=at.y+'px';
 $('burstLayer').appendChild(node);setTimeout(()=>node.remove(),410);
 const damage=document.createElement('div');damage.className='floatDamage';
 damage.textContent='-'+event.damage;damage.style.left=at.x+'px';damage.style.top=(at.y-23)+'px';
 $('burstLayer').appendChild(damage);setTimeout(()=>damage.remove(),810);
 const flash=$('flash');flash.style.transition='none';flash.style.opacity=event.down?.70:.40;
 requestAnimationFrame(()=>{flash.style.transition='opacity 110ms ease-out';flash.style.opacity=0});
}
function unlockAudio(){
 if(audio)return audio;
 const Constructor=window.AudioContext||window.webkitAudioContext;
 if(!Constructor)return null;
 try{audio=new Constructor();audio.resume?.();
  const buffer=audio.createBuffer(1,Math.ceil(audio.sampleRate*.35),audio.sampleRate);
  const pcm=buffer.getChannelData(0);
  for(let i=0;i<pcm.length;i++)pcm[i]=Math.random()*2-1;
  sample=buffer;
 }catch(err){console.warn('打擊音效暫時無法使用',err);audio=null}
 return audio;
}
function noise(duration,level,frequency,highpass=false){
 if(!unlockAudio()||!sample)return;
 const t=audio.currentTime,source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
 source.buffer=sample;filter.type=highpass?'highpass':'lowpass';filter.frequency.value=frequency;
 gain.gain.setValueAtTime(Math.max(.001,level),t);
 gain.gain.exponentialRampToValueAtTime(.001,t+duration);
 source.connect(filter);filter.connect(gain);gain.connect(audio.destination);
 source.start(t);source.stop(t+duration+.01);
}
function whoosh(heavy=false){noise(heavy?.19:.13,heavy?.12:.07,heavy?520:900,true)}
function thump(heavy=false){
 if(!unlockAudio())return;
 noise(heavy?.19:.115,heavy?.32:.23,heavy?900:1300);
 const t=audio.currentTime,osc=audio.createOscillator(),gain=audio.createGain();
 osc.type='triangle';osc.frequency.setValueAtTime(heavy?150:185,t);
 osc.frequency.exponentialRampToValueAtTime(heavy?52:75,t+(heavy?.19:.12));
 gain.gain.setValueAtTime(heavy?.48:.31,t);
 gain.gain.exponentialRampToValueAtTime(.001,t+(heavy?.21:.145));
 osc.connect(gain);gain.connect(audio.destination);osc.start(t);osc.stop(t+(heavy?.22:.16));
}

function preloadGunSound(){
 const ctx=unlockAudio();
 if(!ctx||gunAudioBuffer||gunAudioPromise)return;
 gunAudioPromise=fetch('./assets/audio/rifle/npc_rifle_B.mp3?v=1')
  .then(response=>{if(!response.ok)throw Error('槍聲 HTTP '+response.status);return response.arrayBuffer()})
  .then(bytes=>ctx.decodeAudioData(bytes))
  .then(buffer=>{gunAudioBuffer=buffer})
  .catch(error=>{console.warn('步槍音效讀取失敗，繼續使用合成槍聲',error);gunAudioPromise=null});
}
function pistolSound(){
 const ctx=unlockAudio();if(!ctx)return;
 if(gunAudioBuffer){
  const source=ctx.createBufferSource(),gain=ctx.createGain();
  source.buffer=gunAudioBuffer;source.playbackRate.value=1.22+Math.random()*.09;
  gain.gain.value=.52;source.connect(gain);gain.connect(ctx.destination);source.start(ctx.currentTime);
 }else{
  // The first shot remains immediate while Safari decodes the original rifle sample.
  noise(.17,.45,2800);noise(.10,.21,750);
  const osc=ctx.createOscillator(),gain=ctx.createGain(),t=ctx.currentTime;
  osc.type='triangle';osc.frequency.setValueAtTime(190,t);
  osc.frequency.exponentialRampToValueAtTime(58,t+.18);
  gain.gain.setValueAtTime(.31,t);gain.gain.exponentialRampToValueAtTime(.001,t+.19);
  osc.connect(gain);gain.connect(ctx.destination);osc.start(t);osc.stop(t+.20);
 }
}
function clearTracers(){for(const node of tracerNodes.values())node.remove();tracerNodes.clear()}
function showMuzzle(at){
 const pos=project(at.x,at.y,at.z),burst=document.createElement('div');
 burst.className='gunMuzzle';burst.style.left=pos.x+'px';burst.style.top=pos.y+'px';
 $('burstLayer').appendChild(burst);setTimeout(()=>burst.remove(),125);
}
function drawTracers(){
 const live=new Set();
 for(const b of e.projectiles){
  live.add(b.id);
  let node=tracerNodes.get(b.id);
  if(!node){node=document.createElement('div');node.className='bulletTracer';
   $('burstLayer').appendChild(node);tracerNodes.set(b.id,node)}
  // This streak follows the real projectile in world coordinates, not an aimed enemy.
  const a=project(b.x-b.dx*1.16,1.05,b.z-b.dz*1.16),tip=project(b.x,1.05,b.z);
  const dx=tip.x-a.x,dy=tip.y-a.y;
  node.style.left=a.x+'px';node.style.top=a.y+'px';
  node.style.width=Math.max(4,Math.min(140,Math.hypot(dx,dy)))+'px';
  node.style.transform='rotate('+Math.atan2(dy,dx)+'rad)';
 }
 for(const [id,node] of tracerNodes)if(!live.has(id)){node.remove();tracerNodes.delete(id)}
}
function syncWeaponControls(){
 const armed=e.weapon==='pistol';
 $('weaponIcon').textContent='◉';
 $('weaponLabel').textContent='武器';
 $('attackIcon').textContent=armed?'🔫':'✊';
 $('attackLabel').textContent=armed?'開火':'攻擊';
 $('weaponSwitch').setAttribute('aria-pressed',String(armed));
 $('attack').classList.toggle('pistol',armed);
}
function highlightWheel(dir){
 if(!WEAPON_SLOTS[dir])return;
 wheelSelection=dir;
 for(const item of document.querySelectorAll('.wheelSlot'))item.classList.toggle('selected',item.dataset.slot===dir);
 const slot=WEAPON_SLOTS[dir];$('wheelChoice').textContent=slot.weapon?slot.name:'尚未解鎖';
}
function directionFromDrag(dx,dy){
 if(Math.hypot(dx,dy)<26)return null;
 return Math.abs(dx)>=Math.abs(dy)?(dx>=0?'right':'left'):(dy>=0?'bottom':'up');
}
function openWeaponWheel(){
 if(!ready||!pistol||e.winner||wheelOpen)return false;
 wheelOpen=true;wheelSelection=e.weapon==='pistol'?'right':'up';
 $('weaponWheel').hidden=false;$('weaponWheel').setAttribute('aria-hidden','false');
 $('weaponSwitch').setAttribute('aria-expanded','true');
 document.body.classList.add('weaponWheelOpen');
 highlightWheel(wheelSelection);
 return true;
}
function finishWeaponWheel(choose=true){
 if(!wheelOpen)return;
 const picked=WEAPON_SLOTS[wheelSelection];
 wheelOpen=false;wheelPointer=null;wheelOverlayPointer=null;
 $('weaponWheel').hidden=true;$('weaponWheel').setAttribute('aria-hidden','true');
 $('weaponSwitch').setAttribute('aria-expanded','false');
 document.body.classList.remove('weaponWheelOpen');
 if(!choose)return;
 if(!picked.weapon){tell('這個欄位還沒有武器',950);return}
 const changed=e.selectWeapon(picked.weapon);
 if(changed){
  if(picked.weapon==='pistol')preloadGunSound();
  syncWeaponControls();react();
  tell(picked.weapon==='pistol'?'手槍：單發射擊 · 前方 15° 自動追蹤':'拳頭：靠近對手出拳',1200);
 }
}
function weaponWheelControls(){
 const switcher=$('weaponSwitch'),overlay=$('weaponWheel'),disc=$('wheelDisc');
 switcher.addEventListener('pointerdown',event=>{
  if(event.pointerType==='mouse'&&event.button!==0)return;
  if(!openWeaponWheel())return;
  wheelPointer={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  suppressWheelClick=true;
  try{switcher.setPointerCapture(event.pointerId)}catch{}
  event.preventDefault();
 });
 switcher.addEventListener('pointermove',event=>{
  if(!wheelPointer||wheelPointer.id!==event.pointerId)return;
  const dir=directionFromDrag(event.clientX-wheelPointer.x,event.clientY-wheelPointer.y);
  if(dir){wheelPointer.moved=true;highlightWheel(dir)}
 });
 switcher.addEventListener('pointerup',event=>{
  if(!wheelPointer||wheelPointer.id!==event.pointerId)return;
  const dragged=wheelPointer.moved;wheelPointer=null;
  if(dragged)finishWeaponWheel(true); // Hold + swipe + release
  event.preventDefault();
 });
 switcher.addEventListener('pointercancel',()=>{wheelPointer=null;finishWeaponWheel(false)});
 switcher.addEventListener('click',event=>{
  event.preventDefault();
  if(suppressWheelClick){suppressWheelClick=false;return}
  if(!wheelOpen)openWeaponWheel();else finishWeaponWheel(false);
 });
 const fromDiscPointer=event=>{
  const rect=disc.getBoundingClientRect();
  return directionFromDrag(event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2);
 };
 overlay.addEventListener('pointerdown',event=>{
  if(event.target===overlay){finishWeaponWheel(false);return}
  const slot=event.target.closest('[data-slot]');
  if(slot)highlightWheel(slot.dataset.slot);
  wheelOverlayPointer={id:event.pointerId,cancelPressed:Boolean(event.target.closest('#wheelCancel'))};
  try{overlay.setPointerCapture(event.pointerId)}catch{}
  event.preventDefault();
 });
 overlay.addEventListener('pointermove',event=>{
  if(!wheelOverlayPointer||event.pointerId!==wheelOverlayPointer.id)return;
  const dir=fromDiscPointer(event);if(dir)highlightWheel(dir);
 });
 overlay.addEventListener('pointerup',event=>{
  if(!wheelOverlayPointer||event.pointerId!==wheelOverlayPointer.id)return;
  if(wheelOverlayPointer.cancelPressed){finishWeaponWheel(false);return}
  const dir=fromDiscPointer(event);if(dir)highlightWheel(dir);
  finishWeaponWheel(true);
 });
 overlay.addEventListener('pointercancel',()=>{wheelOverlayPointer=null;finishWeaponWheel(false)});
 $('wheelCancel').addEventListener('click',()=>finishWeaponWheel(false));
}

function react(){
 for(const event of e.drain()){
  if(event.kind==='shot'){
   if(pistolActor)pistolActor.shotUntil=performance.now()+110;
   pistolSound();shake=Math.max(shake,.13);
   cameraPitch=clamp(cameraPitch-.014,.32,1.12);
   showMuzzle(event.at);
  }else if(event.kind==='swing'){
   whoosh(false);
   if(event.who!=='player')tell('有人要揍你了！快走位！',900);
  }else if(event.kind==='hit'){
   shake=Math.max(shake,event.down?.25:event.type==='bullet'?.085:.095);
   hitBurst(event);
   if(event.type!=='bullet')thump(Boolean(event.down));
   if(event.who==='player'){
    tell(event.down?(event.type==='bullet'?'子彈擊飛！':'擊飛！這拳直接讓他躺平！'):
     event.damageSinceFall>=LAUNCH_AFTER_DAMAGE?'累積受傷 30%！下一擊會被擊飛！':
     (event.type==='bullet'?'射擊命中！':'拳擊命中！')+'累積受傷 '+event.damageSinceFall+' / '+LAUNCH_AFTER_DAMAGE,1300);
   }else{
    tell(event.down?'你被打趴了！其他人還在追！':'靠北！你被反擊了！',1150);
   }
   if(event.who==='player'&&event.chain>=2){
    $('combo').textContent=event.chain+' HIT COMBO';$('combo').hidden=false;
    clearTimeout(react.comboTimer);react.comboTimer=setTimeout(()=>$('combo').hidden=true,950);
   }
  }else if(event.kind==='alarm'){
   tell('阿兵哥：「欸！有人打我們的人！」',1200);
  }else if(event.kind==='reinforcements'){
   tell('靠北！另外 3 名友軍也衝過來揍你了！',2300);
  }else if(event.kind==='miss'){
   if(event.who==='player')tell('揮空了！要自己面向對手才打得到。',850);
  }else if(event.kind==='rise'&&event.who!=='player'){
   tell('阿兵哥爬起來了：「你再打一次試試看！」',1100);
  }else if(event.kind==='finished'){
   const serial=roundSerial;
   setTimeout(()=>{if(serial===roundSerial)showEnd(event.winner)},1800);
  }
 }
}
function updateHUD(){
 for(const [id,hp] of [['player',e.player.hp],['enemy',e.enemy.hp]]){
  const fill=$(id+'HP'),txt=$(id+'HPText'),shown=Math.ceil(hp);
  if(fill.dataset.hp!==String(shown)){fill.style.width=hp+'%';fill.dataset.hp=String(shown);txt.textContent=shown+' / 100'}
 }
 $('attack').disabled=!ready||Boolean(e.winner)||wheelOpen;
 $('weaponSwitch').disabled=!ready||Boolean(e.winner);
 const active=e.opponents.filter(f=>f.hp>0).length;
 $('sceneStatus').textContent=e.winner?'格鬥結束':e.reinforcements?'1 對 4！所有友軍都來了':
  e.aggressive?'對手已還手 · 支援即將抵達':'先打其中一名阿兵哥看看';
 const count=$('allyCount');
 if(count)count.textContent=e.reinforcements?'友軍已參戰：'+active+' 人':'其他 3 人尚未警戒';
 for(const ally of e.allies){
  const badge=$('allyStatus'+ally.aiIndex);
  if(badge){badge.textContent='友軍 '+ally.aiIndex+' · '+Math.ceil(ally.hp)+'%';
   badge.classList.toggle('isDown',ally.hp<=0)}
 }
}
function showEnd(winner){
 $('endTitle').textContent=winner==='player'?'一打四！全營最不想惹的人':'被阿兵哥們集體教育';
 $('endComment').textContent=winner==='player'?
  '班長：「你以為軍營是格鬥場是不是？四個人都被你揍倒？」':
  '班長：「你一個人挑四個，還真以為自己是葉問？」';
 $('playerHits').textContent=e.hits;$('enemyHits').textContent=e.enemyHits;
 $('endScreen').hidden=false;
}
function reset(){
 roundSerial++;
 finishWeaponWheel(false);
 const settings={ai:$('counter').checked,difficulty:$('difficulty').value,weapon:e.weapon};
 e.reset();e.enableAI(settings.ai);e.difficulty=settings.difficulty;
 if(settings.weapon==='pistol')e.selectWeapon('pistol');
 clearTracers();if(pistolActor)pistolActor.shotUntil=0;
 syncWeaponControls();
 $('endScreen').hidden=true;$('burstLayer').replaceChildren();$('combo').hidden=true;
 shake=0;last=0;if(renderer)renderer.cameraReady=false;
 tell(e.weapon==='pistol'?'手槍已就位，正前方 15° 內會自動追蹤！':'像在軍營一樣自由移動，面向對手再揮拳！',1700);updateHUD();
 if(actors){for(const a of Object.values(actors)){a.clip='';a.anim.setClip('Idle',{restart:true});a.anim.evaluate(0)}}
}
function controls(){
 // Reuse the EXACT same floating joystick / camera-look / pinch-zoom module
 // that operates the real army camp. It captures canvas touches, not attack buttons.
 input=setupInput($('arena'),
  (dx,dy)=>{cameraYaw+=dx;cameraPitch=clamp(cameraPitch+dy,.32,1.12);},
  ratio=>{if(Number.isFinite(ratio)&&ratio>0)targetZoom=clamp(targetZoom*ratio,6.5,17.6)}
 );
 function playAction(){
  if(!ready)return;
  unlockAudio();
  if(wheelOpen)return;
  if(e.weapon==='pistol')e.shoot();else e.attack();
  react();updateHUD();
 }
 $('attack').addEventListener('click',playAction);
 weaponWheelControls();
 $('reset').addEventListener('click',reset);$('again').addEventListener('click',reset);
 $('counter').addEventListener('change',event=>{
  e.enableAI(event.target.checked);
  tell(event.target.checked?'反擊模式開啟，對手會還手。':'反擊模式關閉，練習出拳手感。',1150);
 });
 $('difficulty').addEventListener('change',event=>{e.difficulty=event.target.value});
 window.addEventListener('keydown',event=>{
  if(event.code==='KeyQ'){event.preventDefault();if(!event.repeat)openWeaponWheel();return}
  if(wheelOpen){
   if(event.code==='Escape'){event.preventDefault();finishWeaponWheel(false)}
   const dir={ArrowUp:'up',ArrowRight:'right',ArrowDown:'bottom',ArrowLeft:'left'}[event.code];
   if(dir){event.preventDefault();highlightWheel(dir)}
   return;
  }
  if(event.code==='KeyJ'&&!event.repeat){event.preventDefault();playAction()}
 });
 window.addEventListener('keyup',event=>{
  if(event.code==='KeyQ'&&wheelOpen){event.preventDefault();finishWeaponWheel(true)}
 });
}
// Identical 3D directional basis as src/main111.js: camera-relative movement.
function direction(){
 const stick=input(),mag=stick.magnitude;
 if(!Number.isFinite(mag)||mag<.09)return{x:0,z:0,speed:0};
 const speed=mag<.42?lerp(1.8,4.2,(mag-.09)/(.42-.09))
  :mag<.75?lerp(4.2,6.6,(mag-.42)/(.75-.42))
  :lerp(6.6,8.3,(mag-.75)/(.25));
 const dx=stick.x/mag,dy=stick.y/mag;
 const c=Math.cos(cameraYaw),s=Math.sin(cameraYaw);
 return{x:dx*c-dy*s,z:-dx*s-dy*c,speed};
}
function frame(now){
 requestAnimationFrame(frame);
 if(!ready)return;
 const dt=last?clamp((now-last)/1000,0,.055):0;
 last=now;
 if(document.hidden){last=0;return}
 const simulationDt=dt*(wheelOpen?SLOW_MOTION:1);
 e.step(simulationDt,direction());
 cameraZoom+=(targetZoom-cameraZoom)*Math.min(1,dt*12);
 react();
 const frozen=e.freeze>0;
 if(!frozen){syncActor(e.player,actors.player,simulationDt);
  for(const foe of e.opponents)syncActor(foe,actors[foe.id],simulationDt);
 }
 shake=Math.max(0,shake-dt*.73);
 const cameraJitter=shake*Math.sin(now*.091)*.075;
 renderer.setCamera({yaw:cameraYaw+cameraJitter,pitch:cameraPitch+shake*Math.cos(now*.11)*.035,zoom:cameraZoom});
 renderer.startFrame(e.player);
 renderFloor();const playerModel=drawFighter(e.player,actors.player);
 for(const foe of e.opponents)drawFighter(foe,actors[foe.id]);
 if(pistol&&e.weapon==='pistol'){
  pistolActor.pos=e.player;pistolActor.angle=e.player.angle;
  pistol.draw(renderer.vp,pistolActor,now,{actorModel:playerModel});
 }
 drawTracers();
 followLabel('playerLabel',e.player);followLabel('enemyLabel',e.enemy);
 for(const ally of e.allies)followLabel(ally.id+'Label',ally);
 if(now>noticeUntil&&e.aggressive&&!e.winner){
  $('callout').textContent=e.aiEnabled?'NPC 會還手，靠移動走位！':'練習模式：NPC 暫不還手';
 }
 updateHUD();
}
async function boot(){
 try{
  $('loadText').textContent='初始化 WebGL2 與格鬥測試場…';
  renderer=new ArmyRenderer($('arena'));
  ground=makeGround(renderer.gl);
  // The existing animation laboratory model includes real Punch_Combo_1 and Knock_Down clips.
  // It is deliberately loaded ONCE and rendered twice, saving texture and GPU memory.
  const glb=await loadGlb('./assets/characters/cadet/cadet-animation-lab.glb?v=1181',
   {timeoutMs:90000,onProgress:loadProgress});
  const base=new RigAnimator(glb);
  if(!base.hasClip('Punch_Combo_1'))throw new Error('士兵 GLB 沒有拳擊動畫');
  const loaded=installUserCombatClips(base);
  if(!loaded)throw new Error('上傳受擊動畫與現有士兵骨架不相容，請重新校正模型');
  $('loadText').textContent='建立 5 名士兵骨架與貼圖…';$('loadBar').style.width='92%';
  await renderer.addModel('duelist',glb);
  actors={player:{anim:base,clip:''}};
  for(const foe of e.opponents){
   const anim=new RigAnimator(glb);installUserCombatClips(anim);
   actors[foe.id]={anim,clip:''};
  }
  for(const actor of Object.values(actors)){actor.anim.setClip('Idle');actor.anim.evaluate(0)}
  $('loadText').textContent='建立立體手槍與槍口火光…';
  pistol=new PistolRenderer(renderer.gl);pistol.addModel();
  const playerAnim=actors.player.anim;
  playerAnim.rifleAim=1;playerAnim.evaluate(0);
  pistol.setGripReference(playerAnim.rightHandWorld);
  playerAnim.rifleAim=0;playerAnim.evaluate(0);
  pistolActor={pos:e.player,angle:e.player.angle,anim:playerAnim,shotUntil:0};
  $('loadBar').style.width='100%';
  ready=true;$('loading').hidden=true;
  reset();requestAnimationFrame(frame);
 }catch(error){
  console.error('[國軍格鬥實驗室]',error);
  $('loadText').textContent='載入失敗：'+String(error.message||error);
  $('retry').hidden=false;$('retry').onclick=()=>location.reload();
 }
}
document.addEventListener('visibilitychange',()=>{last=0});
controls();boot();
window.armyFightLab={
 get status(){return{...e.status,ready,modelLoaded:!!actors,
  hasPunch:!!actors?.player.anim.hasClip('Punch_Combo_1'),
  hasKnockdown:!!actors?.player.anim.hasClip('falling_down'),
  hasHitReaction:!!actors?.player.anim.hasClip('Hit_Reaction'),
  hasArise:!!actors?.player.anim.hasClip('Arise'),
  hasBlock2:!!actors?.player.anim.hasClip('Block2'),wheelOpen}},
 attack:()=>{const ok=e.attack();react();return ok},
 reset,engine:e,
 openWeaponWheel,selectWeapon:weapon=>{const ok=e.selectWeapon(weapon);syncWeaponControls();react();return ok},fire:()=>{const ok=e.shoot();react();return ok},
 get camera(){return {yaw:cameraYaw,pitch:cameraPitch,zoom:cameraZoom,targetZoom}},
 get movement(){return direction()}
};
