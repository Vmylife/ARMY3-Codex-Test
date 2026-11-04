// ARMY3 Fight Lab V2 — expanded open yard, 4 independent recruits and group retaliation.
// Damage threshold is cumulative SINCE the last knockdown: 30 normal damage,
/// then the NEXT hit launches the victim. Never touches camp NPCs.
export const ATTACKS=Object.freeze({
 punch:{length:.72,hit:.29,damage:10,reach:1.93,push:1.35,freeze:.059},
 counter:{length:.80,hit:.33,damage:9,reach:1.90,push:1.28,freeze:.055},
 bullet:{length:0,hit:0,damage:16,reach:28,push:2.10,freeze:.042}
});
export const LAUNCH_AFTER_DAMAGE=30;
// Aim assistance only locks onto living enemies inside the player's 15-degree forward cone.
export const AUTO_AIM_HALF_ANGLE=7.5*Math.PI/180;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const createFighter=(id,x,z)=>({id,x,z,angle:id==='player'?Math.PI/2:-Math.PI/2,hp:100,
 state:'idle',attack:null,stun:0,down:0,rise:0,cd:0,moveSpeed:0,gunKick:0,
 pushX:0,pushZ:0,lean:0,airTime:0,airHeight:0,chain:0,chainAt:-99,damageSinceFall:0,
 impactAnim:'Hit_Reaction',fallen:false,deathAt:Infinity});
export class FightEngine{
 constructor(){this.reset()}
 reset(){
  this.player=createFighter('player',0,0);
  this.enemy=createFighter('enemy',1.65,0);
  this.allies=[createFighter('ally1',5.8,-3.6),createFighter('ally2',6.7,3.5),createFighter('ally3',-5.5,6.2)];
  this.opponents=[this.enemy,...this.allies];
  this.opponents.forEach((f,i)=>{f.aiIndex=i;f.cd=1.0+i*.3});
  this.time=0;this.freeze=0;this.aggressive=false;this.reinforcements=false;this.alertAt=Infinity;
  this.difficulty='normal';this.aiEnabled=true;this.winner=null;
  this.weapon='fists';this.shotCooldown=0;this.nextBulletId=1;this.projectiles=[];this.shotsFired=0;
  this.hits=0;this.enemyHits=0;this.events=[];
 }
 emit(kind,payload={}){this.events.push({kind,...payload})}
 drain(){return this.events.splice(0)}
 face(a,b,dt=0){
  const dx=b.x-a.x,dz=b.z-a.z;
  if(dx*dx+dz*dz<1e-8)return;
  // Match the main camp's yaw convention: atan2(world X, world Z).
  // Z must be target minus actor (the old b.z-b.z was always zero).
  const desired=Math.atan2(dx,dz);
  const delta=Math.atan2(Math.sin(desired-a.angle),Math.cos(desired-a.angle));
  a.angle+=delta*Math.min(1,dt>0?dt*12:1);
 }
 enableAI(on){this.aiEnabled=Boolean(on);
  if(!on)for(const f of this.opponents){f.attack=null;if(f.state==='attack')f.state='idle'}
 }
  selectWeapon(weapon){
   if(!['fists','pistol'].includes(weapon)||this.winner||this.player.hp<=0||
     this.player.attack||['down','rise','hit'].includes(this.player.state))return false;
   if(this.weapon===weapon)return true;
   this.weapon=weapon;this.player.gunKick=0;this.emit('weapon',{weapon});return true;
  }
  switchWeapon(){return this.selectWeapon(this.weapon==='fists'?'pistol':'fists')}
  shoot(){
   const p=this.player;
   if(this.weapon!=='pistol'||this.winner||p.hp<=0||p.attack||p.stun>0||
     ['down','rise','hit'].includes(p.state)||this.shotCooldown>0)return false;
   const forwardX=Math.sin(p.angle),forwardZ=Math.cos(p.angle);
   // No full-screen targeting: only enemies within +/-7.5 degrees of player facing.
   const target=this.opponents
    .filter(foe=>foe.hp>0&&!['down','rise'].includes(foe.state))
    .map(foe=>{
     const vx=foe.x-p.x,vz=foe.z-p.z,dist=Math.hypot(vx,vz);
     const forward=dist>.01?(vx*forwardX+vz*forwardZ)/dist:-1;
     return {foe,dist,forward};
    })
    .filter(v=>v.dist<=28&&v.forward>=Math.cos(AUTO_AIM_HALF_ANGLE))
    .sort((a,b)=>a.dist-b.dist)[0]?.foe||null;
   const angle=target?Math.atan2(target.x-p.x,target.z-p.z):p.angle;
   const dx=Math.sin(angle),dz=Math.cos(angle);
   // Spawn at the rifle muzzle and keep visible projectiles, not instant-hit rays.
   const x=p.x+forwardX*.73-Math.cos(p.angle)*.085;
   const z=p.z+forwardZ*.73+Math.sin(p.angle)*.085;
   const bullet={id:this.nextBulletId++,x,z,prevX:x,prevZ:z,
    startX:x,startZ:z,dx,dz,angle,targetId:target?.id||null,remaining:28,speed:49,age:0};
   this.projectiles.push(bullet);this.shotsFired++;this.shotCooldown=.25;p.gunKick=.12;
   this.emit('shot',{who:p.id,id:bullet.id,angle,lockedTarget:target?.id||null,at:{x,z,y:1.08}});
   return true;
  }
  updateProjectiles(dt){
   if(!this.projectiles.length)return;
   const remaining=[];
   for(const b of this.projectiles){
    // Once acquired in the narrow forward cone, gently lead a moving NPC.
    // A dead or fallen target releases the lock; unlocked shots stay straight.
    const tracked=b.targetId?this.opponents.find(foe=>foe.id===b.targetId&&foe.hp>0&&!['down','rise'].includes(foe.state)):null;
    if(tracked){
     const desired=Math.atan2(tracked.x-b.x,tracked.z-b.z);
     const delta=Math.atan2(Math.sin(desired-b.angle),Math.cos(desired-b.angle));
     b.angle+=clamp(delta,-4.5*dt,4.5*dt);
     b.dx=Math.sin(b.angle);b.dz=Math.cos(b.angle);
    }else b.targetId=null;
    const travel=Math.min(b.speed*dt,b.remaining);
    b.prevX=b.x;b.prevZ=b.z;b.age+=dt;
    let first=null,nearest=Infinity;
    for(const target of this.opponents){
     if(target.hp<=0||['down','rise'].includes(target.state))continue;
     const ox=target.x-b.x,oz=target.z-b.z,along=ox*b.dx+oz*b.dz;
     const sidewaysSq=Math.max(0,ox*ox+oz*oz-along*along),radius=.59;
     if(sidewaysSq>radius*radius||along<-.59)continue;
     const enter=Math.max(0,along-Math.sqrt(radius*radius-sidewaysSq));
     if(enter<=travel&&enter<nearest){nearest=enter;first=target}
    }
    if(first){
     b.x+=b.dx*nearest;b.z+=b.dz*nearest;
     this.impact(this.player,first,'bullet',b.angle,true);
     this.emit('bulletImpact',{id:b.id,target:first.id,at:{x:b.x,z:b.z,y:1.05}});
    }else{
     b.x+=b.dx*travel;b.z+=b.dz*travel;b.remaining-=travel;
     if(b.remaining>.01)remaining.push(b);
    }
   }
   this.projectiles=remaining;
  }
 attack(){
  const p=this.player;
  if(this.weapon!=='fists'||this.winner||p.attack||p.stun>0||p.cd>0||['down','rise'].includes(p.state))return false;
  // No lock-on. Punch travels in the direction the player was freely walking.
  p.attack={type:'punch',clock:0,fired:false};p.state='attack';p.cd=ATTACKS.punch.length+.07;
  this.emit('swing',{who:'player',type:'punch'});return true;
 }
 impact(a,b,type,shotAngle=a.angle,fromProjectile=false){
  const def=ATTACKS[type],d=distance(a,b);
  const fx=Math.sin(shotAngle),fz=Math.cos(shotAngle);
  const face=((b.x-a.x)*fx+(b.z-a.z)*fz)/Math.max(.01,d);
  if((!fromProjectile&&(d>def.reach||face<.27))||b.hp<=0||['down','rise'].includes(b.state)){
   this.emit('miss',{who:a.id,type});return false;
  }
  b.hp=Math.max(0,b.hp-def.damage);b.damageSinceFall+=def.damage;
  b.chain=this.time-b.chainAt<2.5?b.chain+1:1;b.chainAt=this.time;
  b.attack=null;b.stun=type==='bullet'?.48:.62;b.lean=type==='bullet'?-.26:-.35;
  b.state='hit';b.impactAnim='Hit_Reaction';
  const ko=b.hp<=0,down=ko||(b.damageSinceFall>LAUNCH_AFTER_DAMAGE);
  if(down){
   b.damageSinceFall=0;b.state='down';b.down=ko?5:2.0;b.stun=0;b.lean=0;b.fallen=true;
   b.airTime=.63;b.airHeight=0;if(ko)b.deathAt=this.time;
  }
  const push=down?12.0:def.push;
  b.pushX=fx*push;b.pushZ=fz*push;
  if(a.id==='player'){
   this.hits++;this.aggressive=true;
   if(this.alertAt===Infinity){this.alertAt=this.time+.70;this.emit('alarm',{who:b.id})}
  }else this.enemyHits++;
  this.freeze=Math.max(this.freeze,def.freeze);
  this.emit('hit',{who:a.id,target:b.id,type,damage:def.damage,down,ko,chain:b.chain,
   health:b.hp,damageSinceFall:b.damageSinceFall,at:{x:b.x,z:b.z}});
  if(down)this.emit('down',{who:b.id,ko});
  if(ko&&a.id!=='player'){this.winner='opponents';this.emit('finished',{winner:'opponents'})}
  if(ko&&a.id==='player'&&this.opponents.every(f=>f.hp<=0)){
   this.winner='player';this.emit('finished',{winner:'player'});
  }
  return true;
 }
 attackCollision(a){
  if(a.id!=='player'){this.impact(a,this.player,'counter');return}
  const def=ATTACKS.punch,fx=Math.sin(a.angle),fz=Math.cos(a.angle);
  // Nearest eligible target in the active punching arc; does not change facing.
  const eligible=this.opponents
   .filter(b=>b.hp>0&&!['down','rise'].includes(b.state))
   .map(b=>({b,d:distance(a,b)})).sort((l,r)=>l.d-r.d);
  for(const {b,d} of eligible){
   const dot=((b.x-a.x)*fx+(b.z-a.z)*fz)/Math.max(.01,d);
   if(d<=def.reach&&dot>=.27){this.impact(a,b,'punch');return}
  }
  this.emit('miss',{who:'player',type:'punch'});
 }
 updateFighter(a,dt){
  a.cd=Math.max(0,a.cd-dt);
  a.gunKick=Math.max(0,a.gunKick-dt*.80);
  if(a.state==='down'){
   if(a.airTime>0){
    a.airTime=Math.max(0,a.airTime-dt);
    a.airHeight=.78*Math.sin(Math.PI*(1-a.airTime/.63));
   }else a.airHeight=0;
   a.down=Math.max(0,a.down-dt);
   if(a.down===0&&a.hp>0){a.rise=1.70;a.state='rise';this.emit('rise',{who:a.id})}
  }else if(a.state==='rise'){
   a.rise=Math.max(0,a.rise-dt);
   if(a.rise===0){a.state='idle';a.lean=0;a.fallen=false;a.airHeight=0}
  }else if(a.attack){
   a.attack.clock+=dt;const def=ATTACKS[a.attack.type];
   if(!a.attack.fired&&a.attack.clock>=def.hit){a.attack.fired=true;this.attackCollision(a)}
   if(a.attack&&a.attack.clock>=def.length){a.attack=null;a.state='idle'}
  }else if(a.stun>0){
   a.stun=Math.max(0,a.stun-dt);a.lean+=(0-a.lean)*Math.min(1,dt*6);
   if(a.stun===0&&a.state==='hit')a.state='idle';
  }
  if(Math.abs(a.pushX)+Math.abs(a.pushZ)>.002){
   a.x+=a.pushX*dt;a.z+=a.pushZ*dt;
   a.pushX*=Math.exp(-8.1*dt);a.pushZ*=Math.exp(-8.1*dt);
  }
  if(a.state!=='hit')a.lean+=(0-a.lean)*Math.min(1,dt*8);
 }
 think(dt){
  if(!this.aiEnabled||!this.aggressive||this.winner)return;
  for(const foe of this.opponents){
   if(foe.hp<=0||foe.stun>0||foe.attack||['down','rise','hit'].includes(foe.state))continue;
   if(foe!==this.enemy&&!this.reinforcements)continue;
   const p=this.player;this.face(foe,p,dt);const d=distance(foe,p);
   const desired=1.28+foe.aiIndex*.10;
   if(d>desired+.16){
    foe.state='walk';
    // Controlled run, under ARMY3's full sprint (8.3 m/s).
    const speed=this.difficulty==='hard'?5.5:5.05;
    const step=Math.min(speed*dt,d-desired);
    foe.x+=(p.x-foe.x)/d*step;foe.z+=(p.z-foe.z)/d*step;
    foe.moveSpeed=dt>0?step/dt:0;
   }else{foe.state='idle';foe.moveSpeed=0}
   if(d<=1.86&&foe.cd<=0&&p.hp>0&&!['down','rise'].includes(p.state)){
    foe.attack={type:'counter',clock:0,fired:false};foe.state='attack';
    foe.cd=(this.difficulty==='hard'?1.35:2.10)+foe.aiIndex*.19;
    this.emit('swing',{who:foe.id,type:'counter'});
   }
  }
 }
 step(dt,input={x:0,z:0}){
  dt=clamp(Number(dt)||0,0,.06);if(!dt)return;
  this.time+=dt;
  if(this.freeze>0){this.freeze=Math.max(0,this.freeze-dt);return}
  this.shotCooldown=Math.max(0,this.shotCooldown-dt);
  const p=this.player;this.updateFighter(p,dt);
  for(const foe of this.opponents)this.updateFighter(foe,dt);
  if(this.winner)return;
  if(!p.attack&&p.stun<=0&&!['down','rise','hit'].includes(p.state)){
   const x=Number(input.x)||0,z=Number(input.z)||0,d=Math.hypot(x,z);
   if(d>.06){
    const speed=clamp(Number(input.speed)||2.55,0,8.3),mx=x/d,mz=z/d;
    p.x+=mx*Math.min(1,d)*speed*dt;p.z+=mz*Math.min(1,d)*speed*dt;
    const aim=Math.atan2(mx,mz),turn=Math.atan2(Math.sin(aim-p.angle),Math.cos(aim-p.angle));
    p.angle+=turn*Math.min(1,dt*13.2);p.moveSpeed=speed;p.state='walk';
   }else if(p.state==='walk'){p.moveSpeed=0;p.state='idle'}
  }
  if(!this.reinforcements&&this.time>=this.alertAt){
   this.reinforcements=true;this.emit('reinforcements',{count:this.allies.length});
  }
  this.think(dt);
  this.updateProjectiles(dt);
  for(const a of [p,...this.opponents]){a.x=clamp(a.x,-15.6,15.6);a.z=clamp(a.z,-11.4,11.4)}
  // Keep 4 attackers from blending into one another; crowd surrounds, not stacks.
  const bodies=[p,...this.opponents];
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
   const a=bodies[i],b=bodies[j];if(a.hp<=0||b.hp<=0)continue;
   const d=distance(a,b);
   if(d<.88&&d>.001){
    const x=(b.x-a.x)/d,z=(b.z-a.z)/d,push=(.88-d)/2;
    a.x-=x*push;a.z-=z*push;b.x+=x*push;b.z+=z*push;
   }
  }
 }
 get status(){return{playerHP:this.player.hp,enemyHP:this.enemy.hp,
  playerState:this.player.state,enemyState:this.enemy.state,aggressive:this.aggressive,
  reinforcements:this.reinforcements,allies:this.allies.map(a=>({id:a.id,hp:a.hp,state:a.state,x:a.x,z:a.z})),
  aiEnabled:this.aiEnabled,hits:this.hits,enemyHits:this.enemyHits,winner:this.winner,freeze:this.freeze,
  weapon:this.weapon,shotsFired:this.shotsFired,activeBullets:this.projectiles.length,shotCooldown:this.shotCooldown}}
}