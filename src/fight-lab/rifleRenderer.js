// Tiny vertex-colored GLB rifle; one shared GPU buffer and one draw per shooter.
// Weapon lives in local actor space, never duplicated inside the cadet GLB.
import {mul,translation,rotateY} from '../core/math.js?v=060';
const VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 p;layout(location=1) in vec4 colorIn;
uniform mat4 uVP,uModel;
out vec4 c;
void main(){gl_Position=uVP*uModel*vec4(p,1.);c=colorIn;}`;
const FS=`#version 300 es
precision mediump float;
in vec4 c;out vec4 frag;
void main(){frag=vec4(c.rgb*(.96+.04*c.a),1.);}`;
const scale=(v)=>new Float32Array([v,0,0,0,0,v,0,0,0,0,v,0,0,0,0,1]);
// Invert a joint's affine matrix once at calibration (supports non-unit bone scale).
function invertAffine(m){
 const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10];
 const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
 if(Math.abs(det)<1e-9)return null;
 const x=(e*i-f*h)/det,y=(c*h-b*i)/det,z=(b*f-c*e)/det;
 const u=(f*g-d*i)/det,v=(a*i-c*g)/det,w=(c*d-a*f)/det;
 const q=(d*h-e*g)/det,r=(b*g-a*h)/det,t=(a*e-b*d)/det;
 const tx=m[12],ty=m[13],tz=m[14];
 return new Float32Array([x,u,q,0,y,v,r,0,z,w,t,0,
  -(x*tx+y*ty+z*tz),-(u*tx+v*ty+w*tz),-(q*tx+r*ty+t*tz),1]);
}
function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function makeProgram(gl){const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
function bindMesh(gl,packed,indices){
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 const v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,packed,gl.STATIC_DRAW);
 gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
 gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);
 const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
 gl.bindVertexArray(null);return {vao,count:indices.length,type:indices instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT};
}
function flashGeometry(){
 const vert=[],indices=[];const add=(x,y,z,r,g,b)=>{vert.push(x,y,z,r,g,b,1);return vert.length/7-1};
 // muzzle is at +X on the original rifle. Four gold tapered fins.
 for(let k=0;k<4;k++){const a=k*Math.PI/2,s=Math.sin(a),c=Math.cos(a);
  const q=add(1.07,-.015,.02,1,.91,.51),l=add(1.19,.09*s,.09*c,1,.78,.32),r=add(1.19,-.09*s,-.09*c,1,.78,.32),tip=add(1.48,0,0,1,.89,.49);indices.push(q,l,tip,q,tip,r);
 }
 return {vert:new Float32Array(vert),indices:new Uint16Array(indices)};
}
export class RifleRenderer{
 constructor(gl){this.gl=gl;this.program=makeProgram(gl);this.vp=gl.getUniformLocation(this.program,'uVP');this.model=gl.getUniformLocation(this.program,'uModel');this.weapon=null;this.referenceGripInverse=null;let f=flashGeometry();this.flash=bindMesh(gl,f.vert,f.indices);}
 setGripReference(handWorld){
  this.referenceGripInverse=handWorld?invertAffine(handWorld):null;
  if(!this.referenceGripInverse)console.warn('[步槍] 找不到有效右手骨架，暫用角色定位');
 }
 addModel(gltf){
  let verts=[],indices=[],count=0;
  for(const mesh of gltf.json.meshes||[])for(const p of mesh.primitives){
   const pos=gltf.read(p.attributes.POSITION),vCount=pos.length/3;
   const c=p.attributes.COLOR_0!==undefined?gltf.read(p.attributes.COLOR_0):null;
   for(let i=0;i<vCount;i++){
    verts.push(pos[i*3],pos[i*3+1],pos[i*3+2],
     c?(c[i*4]/255):.30,c?(c[i*4+1]/255):.36,c?(c[i*4+2]/255):.28,1);
   }
   for(const ix of gltf.read(p.indices))indices.push(ix+count);
   count+=vCount;
  }
  if(!indices.length)throw Error('步槍沒有可讀取的三角形');
  this.weapon=bindMesh(this.gl,new Float32Array(verts),new Uint32Array(indices));
 }
 draw(vp,actor,now,{force=false,actorModel=null}={}){
  if(!this.weapon||!(actor.anim.rifleAim>.01||force))return;
  const gl=this.gl,recoil=Math.max(0,(actor.shotUntil-now)/90);
  // Calibrated local grip preserves the original rifle placement at rest.
  // A moving wrist drives its rotation/position in Run/Walk/Idle, while
  // actorModel adds the same root lift and torso leaning as the rendered body.
  const local=mul(translation(-.085,actorModel?.907:1.002,.300),mul(rotateY(-Math.PI/2),mul(translation(-.045*recoil,0,0),scale(.38))));
  const grip=actor.anim.rightHandWorld&&this.referenceGripInverse
   ?mul(actor.anim.rightHandWorld,this.referenceGripInverse):null;
  const root=actorModel||mul(translation(actor.pos.x,0,actor.pos.z),rotateY(actor.angle));
  const model=mul(root,grip?mul(grip,local):local);
  gl.useProgram(this.program);gl.uniformMatrix4fv(this.vp,false,vp);gl.uniformMatrix4fv(this.model,false,model);
  gl.bindVertexArray(this.weapon.vao);gl.drawElements(gl.TRIANGLES,this.weapon.count,this.weapon.type,0);
  if(recoil>0){gl.bindVertexArray(this.flash.vao);gl.drawElements(gl.TRIANGLES,this.flash.count,this.flash.type,0)}
  gl.bindVertexArray(null);
 }
}
