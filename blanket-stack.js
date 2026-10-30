// ARMY3 v1.53 — preserve scene damage across cleanups; continuous stacking without showcase pauses.
import {makeEnvironment as makeOriginalCampGround} from './src/map/ground103.js?v=103';
import {loadGlb} from './src/core/glb111.js?v=111';
import {RigAnimator} from './src/characters/rigAnimator.js';
import {returnToCamp} from './src/systems/campSession.js?v=144';
import {createGrenadeStyleBlastFX} from './blanket-blast-fx.js?v=148';
const $=id=>document.getElementById(id);
const cap=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>{t=cap(t,0,1);return t*t*(3-2*t)};
const TAU=Math.PI*2;
const canvas=$('field');
let gl=canvas.getContext('webgl2',{antialias:true,alpha:false,depth:true,powerPreference:'high-performance'});
let program=null,skinProgram=null,flatProgram=null,blastFX=null;
const cache=new Map(),pending=new Map(),failed=new Set();
const fractureCache=new Map(),fracturePending=new Map(),fractureFailed=new Set(),fractureDataCache=new Map();
let npcIdle=null,npcDown=null;
// WebGL matrices: column-major, original ARMY3 renderer coordinate conventions.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(x=>x/l)};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function lookAt(e,t){const f=norm(sub(t,e)),s=norm(cross(f,[0,1,0])),u=cross(s,f);return new Float32Array([s[0],u[0],-f[0],0,s[1],u[1],-f[1],0,s[2],u[2],-f[2],0,-dot(s,e),-dot(u,e),dot(f,e),1])}
function pers(fov,asp,near,far){const f=1/Math.tan(fov*Math.PI/360),k=1/(near-far);return new Float32Array([f/asp,0,0,0,0,f,0,0,0,0,(far+near)*k,-1,0,0,2*far*near*k,0])}
function mul(a,b){const o=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)o[i+j*4]+=a[i+k*4]*b[k+j*4];return o}
const T=(x,y,z)=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
const S=(x,y,z)=>new Float32Array([x,0,0,0,0,y,0,0,0,0,z,0,0,0,0,1]);
function ry(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1])}
function rx(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1])}
function rz(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1])}
// Rotate the entire tower about an axis perpendicular to its fall direction.
function rAxis(x,y,z,a){const c=Math.cos(a),s=Math.sin(a),t=1-c;return new Float32Array([
 t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,
 t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,
 t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,
 0,0,0,1]);}
const SOLDIER_LOD_PATH='./assets/grenade-low/grenade-soldier-low.glb';
const ASSET_FALLBACK={blanket:'./assets/blanket/folded-blanket.glb',skullMine:'./assets/mines/skull-mine.glb',friendly:'./assets/characters/cadet/cadet-green.glb'};
const cleanPath=p=>{if(typeof p!=='string')return '';const b=p.split('?')[0];return /^\.\/assets\/[\w\-\/]+\.glb$/i.test(b)?b:''};
const modelPath=o=>cleanPath(o?.model||ASSET_FALLBACK[o?.assetId]);
// Visual fabric response only. Physics and balance still use the original, rigid
// blanket footprint, so the tiny squash never changes collision or scoring.
function blanketClothShape(o){
 if(o?.category!=='blanket'||!o.clothPower)return {x:1,y:1,z:1};
 const t=Math.max(0,o.clothTime||0);
 const motion=Math.cos(t*15)*Math.exp(-t*9)*o.clothPower;
 // Only the newly landed layer compresses. Horizontal dimensions stay fixed,
 // so an existing tower does not appear to jump or re-centre on impact.
 return {x:1,y:1-.06*motion,z:1};
}
const qualityOf=o=>o.quality==='high'?'high':'low';
const BY={}; // asset lookup for shared editor shader routines

function shader(gl,t,src){const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function makeProgram(vs,fs){const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p}
const VS=`#version 300 es\nprecision highp float;layout(location=0)in vec3 p;layout(location=1)in vec3 n;layout(location=2)in vec2 uv;layout(location=5)in float cap;uniform mat4 uVP,uModel;out vec2 vUV;out vec3 vN;out float vCap;void main(){gl_Position=uVP*uModel*vec4(p,1.);vUV=uv;vCap=cap;vN=normalize(mat3(uModel)*n);}`;
const SKINVS=`#version 300 es\nprecision highp float;layout(location=0)in vec3 p;layout(location=1)in vec3 n;layout(location=2)in vec2 uv;layout(location=3)in vec4 j;layout(location=4)in vec4 w;layout(location=5)in float cap;uniform mat4 uVP,uModel,uBones[44];out vec2 vUV;out vec3 vN;out float vCap;void main(){ivec4 ji=ivec4(j+.5);mat4 m=uBones[ji.x]*w.x+uBones[ji.y]*w.y+uBones[ji.z]*w.z+uBones[ji.w]*w.w;gl_Position=uVP*uModel*m*vec4(p,1.);vUV=uv;vCap=cap;vN=normalize(mat3(uModel)*mat3(m)*n);}`;
const FS=`#version 300 es\nprecision highp float;in vec2 vUV;in vec3 vN;in float vCap;uniform sampler2D uTex;uniform vec3 uTint,uInnerColor;uniform float uRed;out vec4 outColor;void main(){vec3 col=texture(uTex,vUV).rgb;float cloth=smoothstep(.025,.10,col.g-col.r)*smoothstep(.055,.13,col.g-col.b);vec3 redCloth=vec3(min(1.,col.g*1.58),col.g*.47,col.g*.38);col=mix(col,redCloth,uRed*cloth);col=mix(col,uInnerColor,clamp(vCap,0.,1.));float light=.76+.29*max(0.,dot(normalize(vN),normalize(vec3(-.45,1.,.60))));outColor=vec4(col*uTint*light,1.);}`;
const FLATVS=`#version 300 es\nprecision highp float;layout(location=0)in vec3 p;uniform mat4 uVP,uModel;void main(){gl_Position=uVP*uModel*vec4(p,1.);}`;
const FLATFS=`#version 300 es\nprecision highp float;uniform vec3 uColor;out vec4 outColor;void main(){outColor=vec4(uColor,1.);}`;
const cube=[];function face(a,b,c,d){for(const q of [a,b,c,a,c,d])cube.push(...q)}
face([-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5]);face([-.5,1,-.5],[-.5,1,.5],[.5,1,.5],[.5,1,-.5]);
for(let i=0;i<4;i++){const t=i*Math.PI/2,t2=t+Math.PI/2;const p=[Math.cos(t)*.5,Math.sin(t)*.5],q=[Math.cos(t2)*.5,Math.sin(t2)*.5];face([p[0],0,p[1]],[q[0],0,q[1]],[q[0],1,q[1]],[p[0],1,p[1]])}
let cubeVAO=null,white=null;
// A single immutable GPU buffer, copied from the main game's exact terrain
// generator. Geometry includes road curves, oval track and basketball lines.
const CAMP_GROUND_VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 p;
layout(location=1) in vec3 c;
layout(location=2) in vec3 n;
uniform mat4 uVP;
out vec3 vColor;
out vec3 vN;
void main(){gl_Position=uVP*vec4(p,1.);vColor=c;vN=n;}`;
const CAMP_GROUND_FS=`#version 300 es
precision highp float;
in vec3 vColor;
in vec3 vN;
out vec4 frag;
void main(){float sun=max(0.,dot(normalize(vN),normalize(vec3(-.5,1.,.4))));frag=vec4(vColor*(.82+.22*sun),1.);}`;
let originalGroundVAO=null,originalGroundProgram=null,originalGroundCount=0;
function initOriginalGround(){
 // Construct only once. All subsequent frames are one drawElements-free draw call.
 const env=makeOriginalCampGround();
 if(!env?.verts||!env?.cols||!env?.norms||env.verts.length!==env.cols.length||env.verts.length!==env.norms.length)throw Error('主遊戲地板頂點資料不完整');
 originalGroundProgram=makeProgram(CAMP_GROUND_VS,CAMP_GROUND_FS);
 originalGroundVAO=gl.createVertexArray();gl.bindVertexArray(originalGroundVAO);
 for(const [index,data] of [[0,env.verts],[1,env.cols],[2,env.norms]]){
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,3,gl.FLOAT,false,0,0);
 }
 gl.bindVertexArray(null);originalGroundCount=env.count;
}
function drawOriginalGround(vp){
 if(!originalGroundVAO)return;
 gl.useProgram(originalGroundProgram);
 gl.uniformMatrix4fv(gl.getUniformLocation(originalGroundProgram,'uVP'),false,vp);
 gl.bindVertexArray(originalGroundVAO);gl.disable(gl.CULL_FACE);
 gl.drawArrays(gl.TRIANGLES,0,originalGroundCount);gl.enable(gl.CULL_FACE);
 gl.bindVertexArray(null);
}

function initGL(){if(!gl){msg('目前瀏覽器沒有 WebGL2，使用平面編輯預覽；JSON 仍可匯出');return}
 program=makeProgram(VS,FS);skinProgram=makeProgram(SKINVS,FS);flatProgram=makeProgram(FLATVS,FLATFS);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
 cubeVAO=gl.createVertexArray();gl.bindVertexArray(cubeVAO);const arr=new Float32Array(cube),buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
 white=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,white);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);initOriginalGround();blastFX=createGrenadeStyleBlastFX(gl)}
function gpuAsset(gltf,primitive=null){const a=primitive||gltf.json.meshes[0].primitives[0],pr=a.attributes;
 const mesh=gl.createVertexArray();gl.bindVertexArray(mesh);
 for(const [key,i,sz] of [['POSITION',0,3],['NORMAL',1,3],['TEXCOORD_0',2,2],['JOINTS_0',3,4],['WEIGHTS_0',4,4],['_CAP',5,1]]){
  if(pr[key]===undefined)continue;const arr=gltf.read(pr[key]),idx=gltf.json.accessors[pr[key]],b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,sz,idx.componentType,!!idx.normalized,0,0)}
 const inds=gltf.read(a.indices),b=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,inds,gl.STATIC_DRAW);gl.bindVertexArray(null);
 const ac=gltf.json.accessors[pr.POSITION];const positions=gltf.read(pr.POSITION);let lo=ac.min,hi=ac.max;
 if(!lo||!hi){lo=[Infinity,Infinity,Infinity];hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],positions[i+k]);hi[k]=Math.max(hi[k],positions[i+k])}}
 const mat=gltf.json.materials?.[a.material||0],textureIndex=mat?.pbrMetallicRoughness?.baseColorTexture?.index,source=gltf.json.textures?.[textureIndex]?.source;
 return{mesh,count:inds.length,itype:gltf.json.accessors[a.indices].componentType,lo,hi,textureSource:source,skin:pr.JOINTS_0!==undefined}}
async function texture(gltf,source){if(source==null)return white;const blob=gltf.imageFrom(source),url=URL.createObjectURL(blob),img=new Image();try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url})}finally{URL.revokeObjectURL(url)}
 const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t}

// Batch and cache per model; draw the supplied 529 editable objects at their exported coordinates.
async function ensureModel(o,overridePath=null){
 const path=overridePath||modelPath(o);
 if(!path||!gl||failed.has(path))return null;
 if(cache.has(path))return cache.get(path);
 if(pending.has(path))return pending.get(path);
 const job=(async()=>{
  try{
   const g=await loadGlb(path,{timeoutMs:45000});
   const geo=gpuAsset(g),tex=await texture(g,geo.textureSource);
   let animator=null;
   if(geo.skin){
    animator=new RigAnimator(g);animator.setClip('Idle',{restart:true});animator.evaluate(.01);
    if(o.assetId==='friendly'){npcIdle=animator;try{npcDown=new RigAnimator(g);if(!npcDown.setClip('Knock_Down',{restart:true}))npcDown.setClip('Dead',{restart:true});npcDown.evaluate(.85)}catch{npcDown=null}}
   }
   const m={geo,tex,animator,g:geo.skin?g:null};cache.set(path,m);return m;
  }catch(err){console.error('棉被場景模型載入失敗:',path,err);failed.add(path);return null}
  finally{pending.delete(path)}
 })();pending.set(path,job);return job;
}
function modelMatrix(o,geo){
 const sz=o.size||[1,1,1],oScale=o.scale||1,lo=geo.lo,hi=geo.hi,midX=(lo[0]+hi[0])/2,midZ=(lo[2]+hi[2])/2;
 let sx=sz[0]*oScale/Math.max(.0001,hi[0]-lo[0]),sy=sz[1]*oScale/Math.max(.0001,hi[1]-lo[1]),sz0=sz[2]*oScale/Math.max(.0001,hi[2]-lo[2]);
 if(o.useSourceModelUnits&&Array.isArray(o.sourceScaleXYZ)){
  [sx,sy,sz0]=o.sourceScaleXYZ.map(v=>v*oScale);
 }else if(o.fitMode==='uniform3D'&&o.sourceFootprint){
  const b=o.sourceFootprint,turn=Math.abs(Math.sin(o.rot*Math.PI/180))>.5;
  const uni=Math.min((turn?b.d:b.w)*.95/Math.max(.0001,hi[0]-lo[0]),(turn?b.w:b.d)*.95/Math.max(.0001,hi[2]-lo[2]))*oScale;
  sx=sy=sz0=uni;
 }else if(o.fitMode==='uniformXZ'&&o.sourceFootprint){
  const b=o.sourceFootprint,uni=Math.min(b.w*.91/Math.max(.0001,hi[0]-lo[0]),b.d*.91/Math.max(.0001,hi[2]-lo[2]))*1.14*oScale;
  sx=sz0=uni;
 }
 const cloth=blanketClothShape(o);
 sx*=cloth.x;sy*=cloth.y;sz0*=cloth.z;
 let m=mul(T(o.x+(o.swayX||0),o.y??o.sourceY??0,o.z+(o.swayZ||0)),ry((o.rot||0)*Math.PI/180));
 if(o.tiltAxis&&Number.isFinite(o.tiltAngle))m=mul(m,rAxis(o.tiltAxis[0],0,o.tiltAxis[1],o.tiltAngle));
 else{if(o.tiltX)m=mul(m,rx(o.tiltX));if(o.tiltZ)m=mul(m,rz(o.tiltZ));}
 return mul(m,mul(S(sx,sy,sz0),T(-midX,-lo[1],-midZ)));
}
let lastUsed=null;
// Cache program uniform locations: 275 soldiers × 6 lookups each frame is wasteful.
const uniformCache=new WeakMap();
function uniform(p,name){let c=uniformCache.get(p);if(!c){c=new Map();uniformCache.set(p,c)}
 if(!c.has(name))c.set(name,gl.getUniformLocation(p,name));return c.get(name)}
function drawModel(o,vp,overridePath=null){
 const path=overridePath||modelPath(o),m=cache.get(path);if(!m)return false;
 const p=m.geo.skin?skinProgram:program;
 if(lastUsed!==p){gl.useProgram(p);lastUsed=p}
 const u=n=>uniform(p,n);
 gl.uniformMatrix4fv(u('uVP'),false,vp);
 gl.uniformMatrix4fv(u('uModel'),false,modelMatrix(o,m.geo));
 // Subtle colour separation keeps the target readable without new lighting or textures.
 const tint=o.crushed?[.72,.74,.70]:o.broken?[.67,.62,.57]:o.category==='soldier'?[.91,.94,.90]:o.category==='blanket'?[1.06,1.035,1]:[1,1,1];
 gl.uniform3fv(u('uTint'),tint);gl.uniform3fv(u('uInnerColor'),[.42,.41,.38]);gl.uniform1f(u('uRed'),o.team==='enemy'?1:0);
 gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,m.tex);gl.uniform1i(u('uTex'),0);
 if(m.geo.skin){
  const animator=o.flyAnim||((o.crushed&&npcDown)?npcDown:m.animator);
  if(!animator)return false;
  gl.uniformMatrix4fv(u('uBones[0]'),false,animator.bones);
 }
 gl.bindVertexArray(m.geo.mesh);gl.disable(gl.CULL_FACE);gl.drawElements(gl.TRIANGLES,m.geo.count,m.geo.itype,0);gl.enable(gl.CULL_FACE);
 return true;
}
function flatDraw(vp,model,color){gl.useProgram(flatProgram);lastUsed=flatProgram;const u=n=>gl.getUniformLocation(flatProgram,n);gl.uniformMatrix4fv(u('uVP'),false,vp);gl.uniformMatrix4fv(u('uModel'),false,model);gl.uniform3fv(u('uColor'),color);gl.bindVertexArray(cubeVAO);gl.disable(gl.CULL_FACE);gl.drawArrays(gl.TRIANGLES,0,cube.length/3);gl.enable(gl.CULL_FACE)}
// Each fractured GLB contains separate meshes/nodes. Draw and animate those
// chunks individually, as the grenade game does. A fractured GLB is NOT a single object.
async function ensureFracture(o){
 const path=cleanPath(o.destructible?.fracturedModel);
 if(!path||fractureFailed.has(path))return null;
 if(fractureCache.has(path))return fractureCache.get(path);
 if(fracturePending.has(path))return fracturePending.get(path);
 const job=(async()=>{try{
  const gltf=await (fractureDataCache.get(path)||loadGlb(path,{timeoutMs:65000}));
  fractureDataCache.delete(path);
  const pieces=[];
  for(const n of gltf.json.nodes||[]){
   if(n.mesh===undefined)continue;
   const mesh=gltf.json.meshes[n.mesh];
   for(const prim of mesh.primitives||[]){
    const geo=gpuAsset(gltf,prim);
    pieces.push({geo,node:n.translation||[0,0,0],innerColor:mesh.extras?.innerColor||[.42,.41,.38]});
   }
  }
  if(!pieces.length)throw Error('破壞模型沒有分離碎塊: '+path);
  const result={pieces,path};fractureCache.set(path,result);return result;
 }catch(e){console.warn('破壞碎片載入失敗:',path,e);fractureFailed.add(path);return null}
 finally{fracturePending.delete(path)}})();
 fracturePending.set(path,job);return job;
}
const applyMatrixPoint=(m,p)=>({x:m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],y:m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],z:m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]});
const fragmentScale=m=>[Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10])];
let activeFragments=0;
function spawnFractures(o,asset,impactX,impactZ,isBlast=false){
 if(!o.broken||o.fragments?.length||!asset)return;
 const intact=cache.get(modelPath(o));if(!intact){
  // A mine can hit an object before its intact GLB has completed loading.
  const epoch=o.breakEpoch;
  void ensureModel(o).then(loaded=>{if(!o.broken||o.breakEpoch!==epoch)return;
   if(loaded)spawnFractures(o,asset,impactX,impactZ,isBlast);
   else o.fragmentsReady=true;
  });
  return;
 }
 const world=modelMatrix(o,intact.geo),scale=fragmentScale(world),rotation=(o.rot||0)*Math.PI/180;
 const budget=o.category==='building'?Math.max(0,620-activeFragments):Math.max(0,300-activeFragments);
 if(budget<=0){o.fragmentsReady=true;return}
 o.fragments=[];o.fragmentsReady=true;
 const stride=Math.max(1,Math.ceil(asset.pieces.length/budget));
 for(let i=0;i<asset.pieces.length;i+=stride){
  const piece=asset.pieces[i],pos=applyMatrixPoint(world,piece.node);
  const dx=pos.x-impactX,dz=pos.z-impactZ,phi=Math.atan2(dz,dx)+(i%5-2)*.15;
  const force=(isBlast?5.8:3.8)+(i%7)*.52;
  o.fragments.push({piece,x:pos.x,y:Math.max(.15,pos.y),z:pos.z,
   vx:Math.cos(phi)*force,vz:Math.sin(phi)*force,vy:(isBlast?5:3.5)+(i%8)*.56,
   rotY:rotation,rotX:0,rotZ:0,spinX:(i%7-3)*.93,spinZ:(i%5-2)*.8,
   scale});activeFragments++;
 }
}
function breakObject(o,x,z,blast=false){
 if(o.broken||!o.destructible?.fracturedModel)return;
 o.broken=true;o.fragments=[];o.fragmentsReady=false;
 o.breakOriginX=x;o.breakOriginZ=z;
 if(o.category==='building'){roundBuildings++;totalBuildings++}
 const epoch=o.breakEpoch;
 void ensureFracture(o).then(asset=>{if(o.broken&&o.breakEpoch===epoch){
  if(asset)spawnFractures(o,asset,o.breakOriginX,o.breakOriginZ,blast);
  else o.fragmentsReady=true; // Keep the intact building if downloading failed.
 }});
}
function drawFragments(o,vp){
 const m=cache.get(modelPath(o));if(!m)return;
 for(const f of o.fragments||[]){
  const p=program;if(lastUsed!==p){gl.useProgram(p);lastUsed=p}
  const u=n=>uniform(p,n);
  const transform=mul(T(f.x,f.y,f.z),mul(ry(f.rotY),mul(rx(f.rotX),mul(rz(f.rotZ),S(...f.scale)))));
  gl.uniformMatrix4fv(u('uVP'),false,vp);gl.uniformMatrix4fv(u('uModel'),false,transform);
  gl.uniform3fv(u('uTint'),[1,1,1]);gl.uniform3fv(u('uInnerColor'),f.piece.innerColor);
  gl.uniform1f(u('uRed'),0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,m.tex);
  gl.uniform1i(u('uTex'),0);
  gl.bindVertexArray(f.piece.geo.mesh);gl.disable(gl.CULL_FACE);
  gl.drawElements(gl.TRIANGLES,f.piece.geo.count,f.piece.geo.itype,0);
  gl.enable(gl.CULL_FACE);
 }
}
function updateFragments(dt){
 for(const o of things){if(!o.fragments?.length)continue;
  for(const f of o.fragments){
   f.x+=f.vx*dt;f.z+=f.vz*dt;f.y+=f.vy*dt;f.vy-=17*dt;
   f.rotX+=f.spinX*dt;f.rotZ+=f.spinZ*dt;
   if(f.y<.18){f.y=.18;f.vy=f.vy<-.8?-f.vy*.22:0;
    const drag=Math.exp(-3.5*dt);f.vx*=drag;f.vz*=drag;f.spinX*=drag;f.spinZ*=drag;}
  }
 }
}
let ringVAO=null,ringCount=0;
function initRings(){const segments=48,vertices=[];for(let i=0;i<segments;i++){const a=i*TAU/segments,b=(i+1)*TAU/segments;const p=(t,r)=>[Math.cos(t)*r,0,Math.sin(t)*r];vertices.push(...p(a,.965),...p(a,1.035),...p(b,1.035),...p(a,.965),...p(b,1.035),...p(b,.965));}
 ringCount=vertices.length/3;ringVAO=gl.createVertexArray();gl.bindVertexArray(ringVAO);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindVertexArray(null)
}
function drawRing(vp,x,z,r,c,y=.23){gl.useProgram(flatProgram);lastUsed=flatProgram;gl.uniformMatrix4fv(gl.getUniformLocation(flatProgram,'uVP'),false,vp);gl.uniformMatrix4fv(gl.getUniformLocation(flatProgram,'uModel'),false,mul(T(x,y,z),S(r,1,r)));gl.uniform3fv(gl.getUniformLocation(flatProgram,'uColor'),c);gl.bindVertexArray(ringVAO);gl.disable(gl.CULL_FACE);gl.drawArrays(gl.TRIANGLES,0,ringCount);gl.enable(gl.CULL_FACE)}
// Render a visible, unbroken gold rectangle ON TOP OF the last landed blanket.
// Four 3D strips (not a screen-space box) precisely follow its rotation/scale.
let topOutlineVAO=null,topOutlineCount=0;
function initTopOutline(){
 const v=[];const q=(x0,z0,x1,z1)=>v.push(x0,1.023,z0,x1,1.023,z0,x1,1.023,z1,x0,1.023,z0,x1,1.023,z1,x0,1.023,z1);
 const t=.024;
 q(-.5,-.5,.5,-.5+t);q(-.5,.5-t,.5,.5);
 q(-.5,-.5+t,-.5+t,.5-t);q(.5-t,-.5+t,.5,.5-t);
 topOutlineCount=v.length/3;topOutlineVAO=gl.createVertexArray();gl.bindVertexArray(topOutlineVAO);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.STATIC_DRAW);
 gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
}
function drawTopOutline(vp){
 if(!topOutlineVAO||!stack.length||!['flying','dropping'].includes(state))return;
 const o=stack[stack.length-1],sz=o.size||foundation.size,k=o.scale||1;
 const cloth=blanketClothShape(o);
 const m=mul(T(o.x+(o.swayX||0),o.y,o.z+(o.swayZ||0)),mul(ry((o.rot||0)*Math.PI/180),S(sz[0]*k*cloth.x,sz[1]*k*cloth.y,sz[2]*k*cloth.z)));
 gl.useProgram(flatProgram);lastUsed=flatProgram;
 gl.uniformMatrix4fv(gl.getUniformLocation(flatProgram,'uVP'),false,vp);
 gl.uniformMatrix4fv(gl.getUniformLocation(flatProgram,'uModel'),false,m);
 const riskTint=cap((lastRisk.value-.45)/.55,0,1);
 gl.uniform3f(gl.getUniformLocation(flatProgram,'uColor'),1,.76-riskTint*.22+Math.min(.20,outlineFlash*.65),.025+Math.min(.27,outlineFlash*.85));
 gl.bindVertexArray(topOutlineVAO);gl.disable(gl.CULL_FACE);
 gl.drawArrays(gl.TRIANGLES,0,topOutlineCount);gl.enable(gl.CULL_FACE);gl.bindVertexArray(null);
}
let scene=null,foundation=null,things=[],mines=[],soldiers=[],buildings=[],props=[],stack=[],flying=null,falling=null,blasts=[];
let state='loading',round=1,roundResults=[],collapsingAt=0,collapseDir=[1,0],collapseImpactTime=0,collapseSavedLayers=1;
let collapseAngle=0,collapseSpeed=0,collapseStage='hinge',collapseAxis=[0,1],collapseReleased=0;
let totalCrushed=0,totalBuildings=0,totalMines=0,roundCrushed=0,roundBuildings=0,roundMines=0;
let angleChoice=0,camYaw=.12,camDist=17.5,camPitch=.88,camTargetHeight=1.0,camFocus={x:-20.8,z:-2};
let lastRisk={value:0,dx:0,dz:0},dangerStrikes=0,landingKick=0,outlineFlash=0,visualSwayBlend=1;
let ready=false,last=performance.now(),gameTime=0,pendingCelebration=null,messageEnds=0;
let audioContext=null;
const originalFoundation=()=>({...foundation,y:foundation.y||0,tiltX:0,tiltZ:0});
const tierHeight=()=>foundation.size[1]*foundation.scale;
function setState(next){state=next;const active=next!=='loading'&&next!=='intro'&&next!=='result';$('hud').hidden=!active;$('actions').hidden=!active;
 $('cleanup').disabled=!(next==='flying'||next==='collapseDone');$('cleanup').textContent=next==='collapseDone'?'收拾倒塌棉被':'收拾棉被';syncHUD()}
function syncHUD(){$('round').textContent=String(round);$('left').textContent=String(4-round);$('layers').textContent=String(state==='collapsing'||state==='collapseDone'?collapseSavedLayers:stack.length)}
function say(message,seconds=1.25){$('message').textContent=message;$('message').classList.add('show');messageEnds=performance.now()+seconds*1000}
function startRound(resetWorld=false){
 // 收拾只清掉棉被塔；被擊飛的友軍、破碎建築、引爆過的地雷與碎片都留在現場。
 // Only the first round of an entirely new game (or the "play again" button)
 // may restore the camp.  Otherwise the three rounds share ONE damaged world.
 if(resetWorld){
  for(const o of things){
   if(o.startX===undefined){o.startX=o.x;o.startZ=o.z;o.startY=o.y??o.sourceY??0}
   o.x=o.startX;o.z=o.startZ;o.y=o.startY;o.crushed=false;o.broken=false;
   o.fragments=[];o.fragmentsReady=false;o.breakEpoch=(o.breakEpoch||0)+1;
   o.flyAnim=null;o.flyClock=undefined;o.flyVX=0;o.flyVZ=0;o.flyVY=0;
   o.tiltX=0;o.tiltZ=0;o.tiltAngle=undefined;o.tiltAxis=undefined;o.model=o.originalModel||o.model;
  }
  for(const m of mines){m.ignited=false;m.queued=0}
  activeFragments=0;blasts=[];
 }
 // Reset only the tower and this round's score. Keep the world simulation
 // running, including already triggered chain explosions and flying NPCs.
 stack=[originalFoundation()];flying=null;falling=null;
 roundCrushed=0;roundBuildings=0;roundMines=0;collapseSavedLayers=1;
 camFocus={x:foundation.x,z:foundation.z};camTargetHeight=1.2;camDist=17.5;camPitch=.88;landingKick=0;outlineFlash=0;lastRisk={value:0,dx:0,dz:0};dangerStrikes=0;
 spawnFlying();setState('flying');
}
function spawnFlying(){
 const directions=[0,Math.PI/2,Math.PI,3*Math.PI/2,Math.PI/4,5*Math.PI/4,3*Math.PI/4,7*Math.PI/4];
 angleChoice=(angleChoice+1+Math.floor(Math.random()*3))%directions.length;
 const dir=directions[angleChoice];const u=[Math.cos(dir),Math.sin(dir)],v=[-u[1],u[0]];
 const lane=(Math.random()-.5)*(stack.length<5?.7:1.15);
 const target=stack[stack.length-1];const range=6.4+Math.min(3,stack.length*.13);
 const obj={...foundation,uid:'flying',x:target.x-u[0]*range+v[0]*lane,z:target.z-u[1]*range+v[1]*lane,y:stack.length*tierHeight()+1.65,rot:foundation.rot,tiltX:0,tiltZ:0};
 // Preserve the early-game speed; taller towers require more careful timing.
 const tallTowerSpeed=cap((stack.length-20)*.06,0,1.5);
 flying={obj,dir:u,side:v,targetX:target.x,targetZ:target.z,lane,dist:-range,range,speed:4.3+Math.min(5.5,stack.length*.18)+tallTowerSpeed,bob:0};
}
function dropFlying(){if(state!=='flying'||!flying)return;playTap();falling={o:{...flying.obj},velocity:0,landingY:stack.length*tierHeight(),time:0};flying=null;setState('dropping')}
// Recoverable arcade balance: weight the RECENT upper tower most strongly.
// The old test examined each lower support against ALL blocks above it and
// amplified the result with height. One old offset therefore became almost
// impossible to correct, and even a perfectly aligned next blanket could fall.
// This model still punishes drifting away from the foundation, but shifting
// the next few blankets toward the opposite side genuinely restores balance.
function stackRisk(){
 const halfX=Math.max(.3,foundation.size[0]*foundation.scale*.5);
 const halfZ=Math.max(.3,foundation.size[2]*foundation.scale*.5);
 const base=stack[0];
 let sumX=0,sumZ=0,sumWeight=0,wholeX=0,wholeZ=0;
 const first=Math.max(1,stack.length-7);
 for(let i=1;i<stack.length;i++){
  const o=stack[i];wholeX+=o.x;wholeZ+=o.z;
  if(i>=first){
   // More weight on recent placements => an opposite correction works.
   const age=stack.length-1-i,w=1/(1+age*.42);
   sumX+=o.x*w;sumZ+=o.z*w;sumWeight+=w;
  }
 }
 const n=Math.max(1,stack.length-1);
 const recentX=sumWeight?sumX/sumWeight:base.x,recentZ=sumWeight?sumZ/sumWeight:base.z;
 const overallX=wholeX/n,overallZ=wholeZ/n;
 const dx=(recentX-base.x)*.86+(overallX-base.x)*.14;
 const dz=(recentZ-base.z)*.86+(overallZ-base.z)*.14;
 // Height makes a leaning tower slightly more sensitive; a STRAIGHT tower
 // never becomes unstable merely because it has many layers.
 const heightFactor=1+Math.min(.10,Math.max(0,stack.length-5)*.004);
 const lean=Math.hypot(dx/(halfX*1.12),dz/(halfZ*1.12))*heightFactor;
 const top=stack[stack.length-1],below=stack[stack.length-2];
 let contact=0,contactX=0,contactZ=0;
 if(below){
  contactX=top.x-below.x;contactZ=top.z-below.z;
  // Physically unsupported: an almost entirely missed mattress must fall.
  contact=Math.max(Math.abs(contactX)/(halfX*1.75),Math.abs(contactZ)/(halfZ*1.75));
 }
 return {
  value:Math.max(lean,contact*.76),dx:Math.abs(dx)+Math.abs(dz)>.015?dx:contactX,
  dz:Math.abs(dx)+Math.abs(dz)>.015?dz:contactZ,contact
 };
}
function landBlanket(){
 const previous=stack[stack.length-1];
 const before=lastRisk.value;
 const landed=falling.o;
 const dropSpeed=falling.velocity;
 landed.y=stack.length*tierHeight();landed.tiltX=0;landed.tiltZ=0;
 stack.push(landed);falling=null;
 const risk=stackRisk();lastRisk=risk;landingKick=0;outlineFlash=.28;
 const accuracy=previous?Math.hypot(landed.x-previous.x,landed.z-previous.z):3;
 // Only the newly landed blanket compresses; supporting layers stay still.
 const impactEnergy=cap(.68+dropSpeed*.011,.72,1);
 for(let i=stack.length-1;i>=Math.max(0,stack.length-5);i--){
  const layer=stack[i],d=stack.length-1-i;
  if(d===0){layer.clothPower=impactEnergy;layer.clothTime=0;}
 }
 playStackImpact(accuracy,stack.length);
 // A dangerous placement gets a chance for a recovery on the next drop.
 // Precise landings cannot suddenly destroy an otherwise surviving tower.
 const unsupported=risk.contact>=1;
 const extreme=risk.value>=1.60;
 const worsening=risk.value>before+.045;
 if(risk.value>1.08&&worsening&&accuracy>.28){
  dangerStrikes+=risk.value>1.35?1.5:1;
 }else if(risk.value<.97||accuracy<.28||risk.value<before-.045){
  dangerStrikes=Math.max(0,dangerStrikes-1);
 }else{
  dangerStrikes=Math.max(0,dangerStrikes-.25);
 }
 // Only a severe unsupported overhang, an extreme overall lean or two
 // *worsening* risky placements in a row can cause a real collapse.
 if(unsupported||(accuracy>.28&&(extreme||(risk.value>=1.08&&worsening&&dangerStrikes>=2)))){
  beginCollapse(risk,true);return;
 }
 if(accuracy<.24&&stack.length>2)say('PERFECT！',.85);
 else if(risk.value>.62)say('棉被塔正在傾斜！',1.1);
 if(risk.value>.62)playCreak(risk.value);
 // The next blanket immediately enters: no five-layer cinematic pause.
 spawnFlying();setState('flying');
}
function beginCollapse(risk,failedPlacement=false){
 // A blanket that CAUSED the collapse never counts as successfully stacked.
 // If the tower falls from an external cause, retain all previously stacked layers.
 collapseSavedLayers=Math.max(1,stack.length-(failedPlacement?1:0));
 for(const o of stack){o.baseX=o.x;o.baseZ=o.z;o.baseY=o.y;o.tiltX=0;o.tiltZ=0;o.tiltAngle=0;o.vx=0;o.vy=0;o.vz=0;o.spin=0}
 setState('collapsing');collapsingAt=0;collapseImpactTime=0;collapseAngle=0;collapseSpeed=.20;
 collapseStage='hinge';collapseReleased=0;
 let dx=risk.dx,dz=risk.dz;
 if(Math.hypot(dx,dz)<.2){dx=stack[stack.length-1].x-foundation.x;dz=stack[stack.length-1].z-foundation.z}
 if(Math.hypot(dx,dz)<.15){const a=Math.random()*TAU;dx=Math.cos(a);dz=Math.sin(a)}
 const d=Math.hypot(dx,dz)||1;collapseDir=[dx/d,dz/d];
 // axis × UP = fall direction, so each block actually rotates toward the ground.
 collapseAxis=[collapseDir[1],-collapseDir[0]];
 say('棉被塔倒塌！',2.4);playCollapse();
}
function hitSoldier(o,originX=foundation.x,originZ=foundation.z,blast=false){
 if(o.crushed)return;
 o.crushed=true;o.flyClock=0;o.flyFromY=o.y||0;o.flyLife=blast?1.8:1.5;
 const dx=o.x-originX,dz=o.z-originZ,len=Math.hypot(dx,dz)||1;
 const dirX=Math.hypot(dx,dz)>.12?dx/len:collapseDir[0],dirZ=Math.hypot(dx,dz)>.12?dz/len:collapseDir[1];
 const force=blast?10.5:6.7;
 o.flyVX=dirX*force+collapseDir[0]*1.6;o.flyVZ=dirZ*force+collapseDir[1]*1.6;
 o.flyVY=blast?9.2:6.4;o.tiltX=0;o.tiltZ=0;
 // Reuse the green cadet's actual Knock_Down clip, with an independent rig per hit.
 const high=cache.get(modelPath(o));
 if(high?.geo.skin&&high.g?.json?.skins?.length){
  try{const a=new RigAnimator(high.g);a.setClip(a.hasClip('Knock_Down')?'Knock_Down':'Idle_11',{restart:true});a.evaluate(0);o.flyAnim=a;}catch(e){console.warn('NPC 擊倒動畫無法建立',e)}
 }
 roundCrushed++;totalCrushed++;
}
function hitBuilding(o,x=foundation.x,z=foundation.z,blast=false){breakObject(o,x,z,blast)}
function distanceToSegment(x,z,ax,az,bx,bz){
 const dx=bx-ax,dz=bz-az,t=cap(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1),0,1);
 return Math.hypot(x-(ax+dx*t),z-(az+dz*t));
}
// Continuous collision: a fast falling blanket cannot tunnel THROUGH a soldier/mine
// between rendered frames. Building footprints are checked separately from centers.
function impactSweep(ax,az,bx,bz,r,canHitMines=true){
 const midX=(ax+bx)*.5,midZ=(az+bz)*.5,reach=Math.hypot(bx-ax,bz-az)*.5+r;
 for(const o of soldiers){if(o.crushed||Math.hypot(o.x-midX,o.z-midZ)>reach+2)continue;
  if(distanceToSegment(o.x,o.z,ax,az,bx,bz)<=r+.46)hitSoldier(o,(ax+bx)*.5,(az+bz)*.5);
 }
 for(const o of buildings){if(o.broken)continue;
  const br=Math.hypot(o.size?.[0]||1,o.size?.[2]||1)*.40*(o.scale||1);
  if(Math.hypot(o.x-midX,o.z-midZ)>reach+br+1)continue;
  if(distanceToSegment(o.x,o.z,ax,az,bx,bz)<=r+br*.75)hitBuilding(o,(ax+bx)*.5,(az+bz)*.5);
 }
 for(const o of props){if(o.broken||!o.destructible?.fracturedModel)continue;
  const pr=Math.hypot(o.size?.[0]||1,o.size?.[2]||1)*.38*(o.scale||1);
  if(Math.hypot(o.x-midX,o.z-midZ)>reach+pr+1)continue;
  if(distanceToSegment(o.x,o.z,ax,az,bx,bz)<=r+pr*.7)breakObject(o,(ax+bx)*.5,(az+bz)*.5);
 }
 if(canHitMines)for(const m of mines){if(m.ignited||m.queued)continue;
  if(distanceToSegment(m.x,m.z,ax,az,bx,bz)<=r+.40)detonateMine(m);
 }
}
function squashPoint(x,z,r,reason='blanket'){
 for(const o of soldiers){if(!o.crushed&&Math.hypot(o.x-x,o.z-z)<=r)hitSoldier(o,x,z,reason==='mine')}
 for(const o of buildings){if(!o.broken&&Math.hypot(o.x-x,o.z-z)<=r+Math.hypot(o.size[0],o.size[2])*.31)hitBuilding(o,x,z,reason==='mine')}
 for(const o of props){if(!o.broken&&o.destructible?.fracturedModel&&Math.hypot(o.x-x,o.z-z)<=r+Math.hypot(o.size?.[0]||1,o.size?.[2]||1)*.25)breakObject(o,x,z,reason==='mine')}
}
function detonateMine(m){if(m.ignited)return;m.ignited=true;m.queued=0;roundMines++;totalMines++;const radius=9.5;
 blasts.push({x:m.x,z:m.z,time:0,radius,seed:Math.random()*TAU});playBlast();squashPoint(m.x,m.z,radius,'mine');
 for(const other of mines){if(!other.ignited&&!other.queued&&Math.hypot(other.x-m.x,other.z-m.z)<=radius*.9){other.queued=gameTime+.28+Math.random()*.25}}
}
function updateFall(dt){
 collapsingAt+=dt;
 const h=tierHeight(),blanketWidth=Math.max(foundation.size[0],foundation.size[2])*foundation.scale;
 if(collapseStage==='hinge'){
  // A rigid tower first pivots from its base under accelerating gravity.
  collapseSpeed+= (2.6+4.8*Math.sin(collapseAngle))*dt;
  collapseAngle=Math.min(Math.PI*.475,collapseAngle+collapseSpeed*dt);
  const a=collapseAngle,sa=Math.sin(a),ca=Math.cos(a);
  for(let i=0;i<stack.length;i++){
   const o=stack[i],previousX=o.x,previousZ=o.z;
   // Each layer stays attached to the layer below until impact.
   const along=i*h*sa,offsetX=o.baseX-foundation.x,offsetZ=o.baseZ-foundation.z;
   o.x=foundation.x+collapseDir[0]*along+offsetX*ca;
   o.z=foundation.z+collapseDir[1]*along+offsetZ*ca;
   o.y=Math.max(.01,i*h*ca);o.tiltAxis=collapseAxis;o.tiltAngle=a;
   // A tipped layer can hit soldiers when it reaches head height; mines
   // only react once its physical lower edge is almost on the ground.
   if(o.y<2.15)impactSweep(previousX,previousZ,o.x,o.z,blanketWidth*.40,o.y<.68);
  }
  if(collapseAngle>=Math.PI*.475){
   collapseStage='scatter';collapseReleased=collapsingAt;
   // After the column strikes the ground, loose layers bounce and slide.
   for(let i=0;i<stack.length;i++){
    const o=stack[i],f=i/Math.max(1,stack.length-1),side=(Math.random()-.5)*(.65+f*1.7);
    o.vx=collapseDir[0]*(1.0+f*4.6)+-collapseDir[1]*side;
    o.vz=collapseDir[1]*(1.0+f*4.6)+collapseDir[0]*side;
    o.vy=.28+f*2.6;o.spin=(Math.random()-.5)*2.7;
    // All layers make contact along their swept path at ground impact.
    impactSweep(o.x-collapseDir[0]*h*.5,o.z-collapseDir[1]*h*.5,o.x+collapseDir[0]*h*.5,o.z+collapseDir[1]*h*.5,blanketWidth*.49,true);
   }
  }
 }else{
  for(let i=0;i<stack.length;i++){
   const o=stack[i],px=o.x,pz=o.z;
   o.vy-=18.5*dt;
   o.x+=o.vx*dt;o.z+=o.vz*dt;o.y+=o.vy*dt;
   if(o.y<.035){o.y=.035;if(o.vy<0)o.vy=-o.vy*.28;
    if(Math.abs(o.vy)<.34)o.vy=0;
    const drag=Math.exp(-3.5*dt);o.vx*=drag;o.vz*=drag;o.spin*=drag;
   }
   // Loose blankets settle flat after a few bounces instead of standing up like cards.
   o.tiltAngle=cap(o.tiltAngle+o.spin*dt,-Math.PI*.62,Math.PI*.62);
   if(o.y<.30)o.tiltAngle=mix(o.tiltAngle,0,Math.min(1,dt*2.2));
   // Swept AABB on the floor: hit only what this moving layer actually touches.
   if(o.y<1.6)impactSweep(px,pz,o.x,o.z,blanketWidth*.53,o.y<.50);
  }
  if(collapsingAt-collapseReleased>2.4+Math.min(1.5,stack.length*.035)){
   setState('collapseDone');say('本輪 '+collapseSavedLayers+' 層',2.1);
  }
 }
}
function updateGame(dt){
 gameTime+=dt;
 // Decay the impact deformation; it is deliberately not a physics impulse.
 for(const o of stack){
  if(o.clothPower){o.clothTime=(o.clothTime||0)+dt;
   if(o.clothTime>.64){o.clothPower=0;o.clothTime=0}
  }
 }
 if(state==='flying'&&flying){
  const f=flying;f.dist+=f.speed*dt;if(f.dist>f.range)f.dist=-f.range;
  f.bob+=dt*4;f.obj.x=f.targetX+f.dir[0]*f.dist+f.side[0]*f.lane;f.obj.z=f.targetZ+f.dir[1]*f.dist+f.side[1]*f.lane;
  f.obj.y=stack.length*tierHeight()+1.48+Math.sin(f.bob)*.09;
 }else if(state==='dropping'&&falling){
  falling.time+=dt;falling.velocity+=27*dt;falling.o.y=Math.max(falling.landingY,falling.o.y-falling.velocity*dt);
  if(falling.o.y<=falling.landingY+.002)landBlanket();
 }else if(state==='collapsing')updateFall(dt);
 for(const m of mines){if(m.queued&&gameTime>=m.queued){m.queued=0;detonateMine(m)}}
 blasts=blasts.filter(b=>(b.time+=dt)<3.7);
 updateFragments(dt);
 for(const o of soldiers){if(!o.crushed||o.flyClock===undefined||o.flyClock>o.flyLife+1)continue;
  o.flyClock+=dt;o.flyAnim?.evaluate(dt);
  if(o.flyClock<=o.flyLife){o.flyVY-=17*dt;o.x+=o.flyVX*dt;o.z+=o.flyVZ*dt;o.y+=o.flyVY*dt;
   o.tiltZ=Math.sin(Math.min(1,o.flyClock/o.flyLife)*Math.PI)*.85;
   if(o.y<=.01){o.y=.01;o.flyVY=Math.abs(o.flyVY)*.20;o.flyVX*=.72;o.flyVZ*=.72;}
   o.flyVX*=Math.exp(-.8*dt);o.flyVZ*=Math.exp(-.8*dt);
  }else{o.y=Math.max(.01,(o.y||0)-dt*2.5);o.tiltZ=1.30;o.flyAnim?.evaluate(0);}
 }
 const collapsing=state==='collapsing'||state==='collapseDone';
 const height=stack.length*tierHeight();
 // Continuous, tilted stacking view: smoothly track the growing tower.
 // There is no scheduled camera cut, frozen blanket, or forced milestone pause.
 outlineFlash=Math.max(0,outlineFlash-dt);
 const pitchGoal=collapsing?.48:cap(.91-stack.length*.004,.75,.89);
 camPitch=mix(camPitch,pitchGoal,Math.min(1,dt*1.9));
 const desired=collapsing?Math.max(30,26+height*1.40):16.8+height*.68;
 landingKick=Math.max(0,landingKick-dt);
 camDist=mix(camDist,desired-(landingKick>0?.85*Math.sin(landingKick/.24*Math.PI):0),1-Math.exp(-dt*(collapsing?2.2:1.5)));
 const targetHeight=collapsing?height*.26:Math.max(.9,height*.68);
 camTargetHeight=mix(camTargetHeight,targetHeight,1-Math.exp(-dt*(collapsing?2.5:1.6)));
 const move=collapsing?Math.min(height*.45,12):0;
 camFocus.x=mix(camFocus.x,foundation.x+collapseDir[0]*move,Math.min(1,dt*1.7));
 camFocus.z=mix(camFocus.z,foundation.z+collapseDir[1]*move,Math.min(1,dt*1.7));
 camYaw=mix(camYaw,.12,Math.min(1,dt*.75));
}
function finishRound(){
 if(!['flying','collapseDone'].includes(state))return;
 const score=state==='collapseDone'?collapseSavedLayers:stack.length;
 roundResults.push({layers:score,collapsed:state==='collapseDone',friends:roundCrushed,buildings:roundBuildings,mines:roundMines});
 if(round>=3){showResult();return}
 round++;startRound();say('第 '+round+' 輪',1.2);
}
function showResult(){setState('result');$('actions').hidden=true;$('hud').hidden=true;
 const best=Math.max(...roundResults.map(r=>r.layers));const total=roundResults.reduce((n,r)=>n+r.layers,0);
 const score=cap(Math.round(1+Math.min(70,best*2.25)+Math.min(20,total*.35)+(best>0?Math.max(0,9-totalMines*3-totalCrushed*.16-totalBuildings*2):0)),1,100);
 try{const key='ARMY3_blanket_progress_v1';const old=JSON.parse(localStorage.getItem(key)||'{}');localStorage.setItem(key,JSON.stringify({best:Math.max(old.best||0,best),last:roundResults,played:(old.played||0)+1,highestTotal:Math.max(old.highestTotal||0,total),lastScore:score,highScore:Math.max(old.highScore||0,score),savedAt:Date.now()}))}catch{}
 const t=$('modal');t.replaceChildren();
 const title=document.createElement('h1');title.textContent='棉被鑑測結算';t.append(title);
 const big=document.createElement('div');big.className='big';big.textContent=score+' 分';t.append(big);const summary=document.createElement('p');summary.textContent='最高 '+best+' 層　·　累計 '+total+' 層';t.append(summary);
 const result=document.createElement('div');result.id='scores';result.innerHTML=roundResults.map((r,i)=>`<div><small>第 ${i+1} 輪</small>${r.layers} 層</div>`).join('');t.append(result);
 if(totalCrushed||totalBuildings||totalMines){const p=document.createElement('p');p.textContent=`友軍 ${totalCrushed}　建築 ${totalBuildings}　地雷 ${totalMines}`;t.append(p)}
 const back=document.createElement('button');back.textContent='返回軍營';back.onclick=()=>returnToCamp();t.append(back);
 const again=document.createElement('button');again.className='secondary';again.textContent='再玩一次';again.onclick=()=>{round=1;roundResults=[];totalCrushed=0;totalBuildings=0;totalMines=0;$('overlay').hidden=true;startRound(true)};t.append(again);
 $('overlay').hidden=false;
}
function worldToScreen(x,y,z,vp){
 const w=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];if(w<=.01)return null;
 return{x:(vp[0]*x+vp[4]*y+vp[8]*z+vp[12])/w,y:(vp[1]*x+vp[5]*y+vp[9]*z+vp[13])/w}
}
let firstRender=false;
function camera(){const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight),ratio=w/h,portrait=ratio<.8;
 const pitch=camPitch; // close three-quarter gameplay, brief dramatic side reveal
 const target=[camFocus.x,camTargetHeight,camFocus.z];
 const shake=blasts.length?Math.max(...blasts.map(b=>Math.exp(-b.time*3)*.30)):0;
 const eye=[target[0]+camDist*Math.sin(camYaw)*Math.cos(pitch)+Math.sin(gameTime*72)*shake,target[1]+camDist*Math.sin(pitch)+Math.sin(gameTime*103)*shake*.52,target[2]+camDist*Math.cos(camYaw)*Math.cos(pitch)];
 return mul(pers(portrait?51:49,ratio,.1,850),lookAt(eye,target));
}
function draw(){
 if(!gl)return;
 const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight),ratio=Math.min(window.devicePixelRatio||1,1.45);
 const cw=Math.max(1,Math.round(w*ratio)),ch=Math.max(1,Math.round(h*ratio));
 if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch}
 gl.viewport(0,0,cw,ch);gl.clearColor(.63,.78,.83,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 const vp=camera();gl.useProgram(originalGroundProgram);lastUsed=originalGroundProgram;
 gl.uniformMatrix4fv(gl.getUniformLocation(originalGroundProgram,'uVP'),false,vp);gl.bindVertexArray(originalGroundVAO);gl.disable(gl.CULL_FACE);gl.drawArrays(gl.TRIANGLES,0,originalGroundCount);gl.enable(gl.CULL_FACE);
 const far=state==='collapsing'||state==='collapseDone'?105:Math.max(45,camDist*1.65);
 // NO hard 115-person cap: all 275 placed NPCs are eligible for rendering.
 // For mid/far soldiers, reuse a low-poly mesh instead of drawing 275 high-poly rigs.
 for(const o of things){
  if(o.category==='mine'&&o.ignited)continue;
  const fragmented=o.broken&&o.fragmentsReady&&o.fragments?.length>0;
  if(Math.hypot(o.x-camFocus.x,o.z-camFocus.z)>far+(fragmented?18:0))continue;
  const ndc=worldToScreen(o.x,Math.min(1.2,(o.size?.[1]||1)*.4),o.z,vp);
  if(!ndc||Math.abs(ndc.x)>(fragmented?1.9:1.4)||Math.abs(ndc.y)>(fragmented?1.85:1.38))continue;
  const low=o.category==='soldier'&&!o.crushed&&Math.hypot(o.x-camFocus.x,o.z-camFocus.z)>11&&cache.has(SOLDIER_LOD_PATH);
  if(!cache.has(low?SOLDIER_LOD_PATH:modelPath(o)))continue;
  if(fragmented){drawFragments(o,vp);continue}
  if(o.broken&&o.fragmentsReady&&!o.fragments?.length){
   // Download unavailable: keep a visibly damaged tilted silhouette rather than vanishing.
   o.tiltZ=.28;
  }
  drawModel(o,vp,low?SOLDIER_LOD_PATH:null);
 }
 for(let i=0;i<stack.length;i++){const o=stack[i];
  // Purely visual sub-centimeter oscillation; the stability calculation never changes.
  const wobble=(state==='flying'||state==='dropping')?Math.max(0,lastRisk.value-.36)*Math.min(.85,stack.length*tierHeight()*.095)*i/Math.max(1,stack.length-1)*Math.sin(gameTime*(2.0+lastRisk.value*2)):0;
  const directionLength=Math.hypot(lastRisk.dx,lastRisk.dz)||1;
  const swayX=wobble*(Math.abs(lastRisk.dx)>1e-4?lastRisk.dx/directionLength:1);
  const swayZ=wobble*lastRisk.dz/directionLength;
  o.swayX=mix(o.swayX||0,swayX,visualSwayBlend);
  o.swayZ=mix(o.swayZ||0,swayZ,visualSwayBlend);drawModel(o,vp);
 }
 drawTopOutline(vp);
 if(flying)drawModel(flying.obj,vp);
 if(falling)drawModel(falling.o,vp);
 blastFX?.draw(vp,blasts);
 lastUsed=null; // The independent explosion shader changes the GL program.
 // Overlay explosion glow tracks the real 3D mine positions.
 const visibleBoom=blasts.find(b=>b.time<1.25);
 const glow=$('boomFlash');
 if(visibleBoom){const pt=worldToScreen(visibleBoom.x,.5,visibleBoom.z,vp);
  if(pt){glow.style.left=((pt.x+1)*.5*w)+'px';glow.style.top=((1-pt.y)*.5*h)+'px';glow.style.width=Math.max(110,Math.min(460,(visibleBoom.radius*(.5+visibleBoom.time)*w/camDist)*1.9))+'px';glow.style.height=glow.style.width;glow.style.opacity=String(Math.max(0,.75-visibleBoom.time*.6))}
 }else glow.style.opacity='0';
 gl.bindVertexArray(null);
 if(!firstRender){firstRender=true}
}
function playTap(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;audioContext=audioContext||new C();if(audioContext.state==='suspended')void audioContext.resume();const o=audioContext.createOscillator(),g=audioContext.createGain(),t=audioContext.currentTime;o.type='triangle';o.frequency.setValueAtTime(220,t);o.frequency.exponentialRampToValueAtTime(90,t+.14);g.gain.setValueAtTime(.1,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+.2)}catch{}}
function playCollapse(){playTap()}
function playStackImpact(offset,layers){try{
 const C=window.AudioContext||window.webkitAudioContext;if(!C)return;audioContext=audioContext||new C();if(audioContext.state==='suspended')void audioContext.resume();
 const t=audioContext.currentTime,osc=audioContext.createOscillator(),gain=audioContext.createGain();
 // Low, short, muffled thud instead of a hard block-on-block clack.
 osc.type='sine';osc.frequency.setValueAtTime(115+Math.min(60,layers*2.2),t);
 osc.frequency.exponentialRampToValueAtTime(43,t+.16);
 gain.gain.setValueAtTime(.15,t);gain.gain.exponentialRampToValueAtTime(.001,t+.22);
 osc.connect(gain);gain.connect(audioContext.destination);osc.start(t);osc.stop(t+.24);
 // Filtered rustle is the quick fabric surface making contact.
 const length=Math.max(1,Math.floor(audioContext.sampleRate*.085));
 const noise=audioContext.createBuffer(1,length,audioContext.sampleRate),ch=noise.getChannelData(0);
 for(let i=0;i<length;i++){const decay=1-i/length;ch[i]=(Math.random()*2-1)*decay*decay;}
 const fabric=audioContext.createBufferSource(),filter=audioContext.createBiquadFilter(),soft=audioContext.createGain();
 fabric.buffer=noise;filter.type='lowpass';filter.frequency.setValueAtTime(490,t);
 soft.gain.setValueAtTime(.13,t);soft.gain.exponentialRampToValueAtTime(.001,t+.09);
 fabric.connect(filter);filter.connect(soft);soft.connect(audioContext.destination);fabric.start(t);fabric.stop(t+.1);
 if(offset<.24){const bell=audioContext.createOscillator(),g=audioContext.createGain();bell.type='triangle';
  bell.frequency.setValueAtTime(840,t+.04);bell.frequency.exponentialRampToValueAtTime(1180,t+.23);
  g.gain.setValueAtTime(.055,t+.04);g.gain.exponentialRampToValueAtTime(.001,t+.33);bell.connect(g);g.connect(audioContext.destination);bell.start(t+.04);bell.stop(t+.34)}
 }catch(e){console.warn('blanket impact audio',e)}
}

let lastCreakAt=-100;
function playCreak(risk){if(gameTime-lastCreakAt<.9)return;lastCreakAt=gameTime;
 try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;audioContext=audioContext||new C();if(audioContext.state==='suspended')void audioContext.resume();
  const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();
  o.type='sawtooth';o.frequency.setValueAtTime(95,t);o.frequency.exponentialRampToValueAtTime(47,t+.35);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(Math.min(.07,.022+risk*.026),t+.09);g.gain.exponentialRampToValueAtTime(.001,t+.44);
  o.connect(g);g.connect(audioContext.destination);o.start(t);o.stop(t+.48);
 }catch(e){console.warn('tower creak',e)}
}
function playBlast(){try{
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
 audioContext=audioContext||new AC();if(audioContext.state==='suspended')void audioContext.resume();
 const t=audioContext.currentTime,n=Math.round(audioContext.sampleRate*.86),buff=audioContext.createBuffer(1,n,audioContext.sampleRate),data=buff.getChannelData(0);
 for(let i=0;i<n;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/n,2);
 const src=audioContext.createBufferSource(),low=audioContext.createBiquadFilter(),gain=audioContext.createGain();
 src.buffer=buff;low.type='lowpass';low.frequency.setValueAtTime(680,t);low.frequency.exponentialRampToValueAtTime(70,t+.73);
 gain.gain.setValueAtTime(.47,t);gain.gain.exponentialRampToValueAtTime(.001,t+.83);
 src.connect(low);low.connect(gain);gain.connect(audioContext.destination);src.start(t);src.stop(t+.86);
 const osc=audioContext.createOscillator(),og=audioContext.createGain();osc.type='sine';
 osc.frequency.setValueAtTime(110,t);osc.frequency.exponentialRampToValueAtTime(39,t+.40);
 og.gain.setValueAtTime(.40,t);og.gain.exponentialRampToValueAtTime(.001,t+.52);
 osc.connect(og);og.connect(audioContext.destination);osc.start(t);osc.stop(t+.55);
 }catch(e){console.warn('mine blast audio',e)}
}
function tick(now){
 try{
  const dt=Math.min(.05,(now-last)/1000||0);last=now;
  visualSwayBlend=1-Math.exp(-dt*6);
  if(ready&&state!=='result'&&state!=='intro'&&state!=='loading')updateGame(dt);
  $('layers').parentElement.classList.toggle('danger',lastRisk.value>.73&&['flying','dropping'].includes(state));
  if($('message').classList.contains('show')&&now>messageEnds)$('message').classList.remove('show');
  // The opaque result covers the scene; retain its last frame while reading.
  if(ready&&state!=='result')draw();
  requestAnimationFrame(tick);
 }catch(e){console.error('棉被遊戲迴圈失敗',e);fatal(e)}
}
function fatal(e){$('reason').textContent=String(e?.message||e);$('fatal').hidden=false}
async function boot(){
 if(!gl){fatal(new Error('此裝置無法使用 WebGL2'));return}
 try{
  const resp=await fetch('./blanket-stack-scene.json?v=153',{cache:'no-cache'});
  if(!resp.ok)throw Error('無法下載玩家設定的棉被場景：HTTP '+resp.status);
  scene=await resp.json();
  if(scene.format!=='army3-blanket-scene'||scene.schemaVersion!==1||!Array.isArray(scene.items))throw Error('棉被場景 JSON 格式不相容');
  foundation=scene.items.find(o=>o.uid===scene.foundationId&&o.category==='blanket');
  if(!foundation)throw Error('找不到你指定的第一層棉被');
  things=scene.items.filter(o=>o.category!=='blanket').map(o=>({...o}));
  for(const o of things){if(o.category==='mine')mines.push(o);else if(o.category==='soldier')soldiers.push(o);else if(o.category==='building')buildings.push(o);else if(o.category==='prop')props.push(o)}
  camFocus={x:foundation.x,z:foundation.z};
  initGL();initRings();initTopOutline();
  // Keep the opening responsive: load the actual blanket first, then mines and soldiers.
  const priority=[foundation,mines[0],soldiers[0]].filter(Boolean);
  for(let i=0;i<priority.length;i++){
   $('loadingText').textContent=['載入棉被模型…','準備骷髏地雷…','準備友軍模型…'][i];
   $('loadBar').style.width=((i+1)*25)+'%';await ensureModel(priority[i]);
  }
  if(!cache.has(modelPath(foundation)))throw Error('棉被 3D 模型未能載入');
  const group=[...new Map(things.filter(o=>modelPath(o)).map(o=>[modelPath(o),o])).values()]
    .filter(o=>!cache.has(modelPath(o)))
    .sort((a,b)=>Math.hypot(a.x-foundation.x,a.z-foundation.z)-Math.hypot(b.x-foundation.x,b.z-foundation.z));
  const launch=async()=>{let cursor=0;const worker=async()=>{while(cursor<group.length){const o=group[cursor++];await ensureModel(o);await new Promise(r=>setTimeout(r,35))}};await Promise.all([worker(),worker()])};
  void launch();
  // Warm the six building fracture sources; a hit does not have to wait for a full download.
  const fracturePaths=[...new Set(buildings.map(o=>cleanPath(o.destructible?.fracturedModel)).filter(Boolean))];
  void (async()=>{for(const path of fracturePaths){try{
   if(fractureCache.has(path))continue;
   const job=loadGlb(path,{timeoutMs:65000});fractureDataCache.set(path,job);
   await job;
  }catch(e){fractureDataCache.delete(path);console.warn('破壞模型預載:',path,e)}}})();
  // The fallback remains the original hi-poly NPC if a low-poly asset is missing.
  void ensureModel({model:SOLDIER_LOD_PATH,assetId:'lowSoldier'});
  stack=[originalFoundation()];state='intro';ready=true;
  $('loadingText').textContent='';$('loadLine').hidden=true;$('play').disabled=false;$('play').textContent='開始挑戰';$('loadBar').style.width='100%';
  $('play').onclick=()=>{$('overlay').hidden=true;round=1;roundResults=[];totalCrushed=0;totalBuildings=0;totalMines=0;startRound(true)};
  // Draw a real WebGL frame before unlocking start.
  draw();
 }catch(e){console.error('棉被遊戲初始化失敗',e);fatal(e)}
}
canvas.addEventListener('pointerdown',e=>{if(e.cancelable)e.preventDefault();if(state==='flying')dropFlying()},{passive:false});
$('cleanup').addEventListener('click',finishRound);
$('reload').addEventListener('click',()=>location.reload());
document.addEventListener('visibilitychange',()=>{last=performance.now()});
window.addEventListener('pageshow',()=>{last=performance.now()});
requestAnimationFrame(tick);
void boot();
// Exposed only for deterministic automated gameplay checks.
window.__blanketTest={get state(){return state},get layers(){return stack.length},get cameraPitch(){return camPitch},get stabilityHidden(){return !document.getElementById('stability')},get danger(){return lastRisk.value},get dangerStrikes(){return dangerStrikes},get round(){return round},get mines(){return roundMines},get soldiers(){return roundCrushed},get npcTotal(){return soldiers.length},get drawLimit(){return Infinity},get collapseStage(){return collapseStage},get collapseScore(){return collapseSavedLayers},get maxReach(){return stack.length*tierHeight()},get fracturedBuildings(){return buildings.filter(o=>o.broken&&o.fragmentsReady).length},get activeFragments(){return activeFragments},get propDestroyed(){return props.filter(o=>o.broken).length},tap:dropFlying,cleanup:finishRound,collapse:(x=1,z=0)=>beginCollapse({dx:x,dz:z}),get scene(){return scene}};
