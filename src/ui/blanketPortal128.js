// ARMY3 v1.90: camp training portals, near-range GPU warm-up with safe navigation fallback.
export const BLANKET_PORTAL=Object.freeze({x:-36.37,z:1.49});
export const GRENADE_PORTAL=Object.freeze({x:-22.79,z:-27.52});
const OPEN_RADIUS=3.05,RESET_RADIUS=3.65;
function makeGroundRing(renderer,position){
 const gl=renderer.gl,p=[],c=[],n=[];
 const add=(x,y,z,col)=>{p.push(x,y,z);c.push(...col);n.push(0,1,0)};
 const tri=(a,b,d,col)=>{add(...a,col);add(...b,col);add(...d,col)};
 const quad=(a,b,d,e,col)=>{tri(a,b,d,col);tri(a,d,e,col)};
 const y=.184,segments=72;
 function band(inner,outer,col){for(let i=0;i<segments;i++){
   const a=2*Math.PI*i/segments,b=2*Math.PI*(i+1)/segments;
   const at=r=>[position.x+Math.cos(a)*r,y,position.z+Math.sin(a)*r];
   const bt=r=>[position.x+Math.cos(b)*r,y,position.z+Math.sin(b)*r];
   quad(at(inner),at(outer),bt(outer),bt(inner),col);
 }}
 band(.72,.99,[.40,.32,.075]);band(.76,.95,[1,.82,.07]);band(.80,.85,[1,.97,.44]);
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 for(const [i,data] of [[0,p],[1,c],[2,n]]){
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,0,0);
 }
 gl.bindVertexArray(null);
 return ()=>{gl.useProgram(renderer.pFlat);gl.uniformMatrix4fv(renderer.flatVP,false,renderer.vp);
   gl.bindVertexArray(vao);gl.drawArrays(gl.TRIANGLES,0,p.length/3);gl.bindVertexArray(null)};
}
function createPortalMenu({position,kind,panelId,startId,cancelId,destination,onStart,initialDismissed=false}){
 const panel=document.getElementById(panelId),start=document.getElementById(startId),cancel=document.getElementById(cancelId);
 if(!panel||!start||!cancel)throw new Error('Missing portal menu: '+panelId);
 let dismissed=initialDismissed,wasNear=false;
 cancel.addEventListener('click',()=>{dismissed=true;panel.hidden=true});
 start.addEventListener('click',()=>{
  try{onStart?.()}catch(error){console.error('軍營進度儲存失敗',error);alert('目前無法保存軍營位置，請重試。');return}
  dismissed=true;panel.hidden=true;
  // Re-use the exact iframe whose models were preinitialized while walking.
  if(window.armyGameWarmup?.enter(kind))return;
  const url=new URL(destination,location.href);url.searchParams.set('fromCamp','1');location.assign(url.href);
 });
 return {update(playerPos,blocked=false){
   const distance=Math.hypot(playerPos.x-position.x,playerPos.z-position.z);
   window.armyGameWarmup?.approach(kind,distance);
   if(distance>RESET_RADIUS){dismissed=false;wasNear=false;panel.hidden=true;return}
   const near=distance<=OPEN_RADIUS||(wasNear&&distance<=RESET_RADIUS);
   if(!near){panel.hidden=true;return}
   wasNear=true;panel.hidden=blocked||dismissed;
 }};
}
export function createBlanketPortal(renderer,{onTrainingStart=()=>{},resuming=false}={}){
 const blanketDraw=makeGroundRing(renderer,BLANKET_PORTAL),grenadeDraw=makeGroundRing(renderer,GRENADE_PORTAL);
 const blanket=createPortalMenu({position:BLANKET_PORTAL,kind:'blanket',panelId:'blanketPortalMenu',startId:'blanketPortalStart',cancelId:'blanketPortalCancel',destination:'./blanket-stack.html?v=155',onStart:()=>onTrainingStart('blanket'),initialDismissed:resuming});
 const grenade=createPortalMenu({position:GRENADE_PORTAL,kind:'grenade',panelId:'grenadePortalMenu',startId:'grenadePortalStart',cancelId:'grenadePortalCancel',destination:'./grenade-workshop-test.html?v=153',onStart:()=>onTrainingStart('grenade'),initialDismissed:resuming});
 return {draw(){blanketDraw();grenadeDraw()},update(playerPos,blocked=false){blanket.update(playerPos,blocked);grenade.update(playerPos,blocked)}};
}
