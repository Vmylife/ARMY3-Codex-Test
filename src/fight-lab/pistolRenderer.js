// ARMY3 Fight Lab — vertex-coloured low-poly 3D pistol, attached to right hand.
import {mul,translation,rotateY} from '../core/math.js?v=060';
const VS=`#version 300 es
precision highp float;layout(location=0) in vec3 p;layout(location=1) in vec4 colorIn;
uniform mat4 uVP,uModel;out vec4 c;void main(){gl_Position=uVP*uModel*vec4(p,1.);c=colorIn;}`;
const FS=`#version 300 es
precision mediump float;in vec4 c;out vec4 frag;void main(){frag=vec4(c.rgb*(.96+.04*c.a),1.);}`;
const scale=v=>new Float32Array([v,0,0,0,0,v,0,0,0,0,v,0,0,0,0,1]);
const DARK=[.14,.19,.21],METAL=[.28,.33,.34],TOP=[.37,.42,.42],FRAME=[.23,.27,.26],GRIP=[.33,.30,.26],BLACK=[.065,.075,.08],GOLD=[.95,.77,.40];
function shader(gl,type,code){const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function program(gl){const p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,VS));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,FS));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p}
function bind(gl,packed,indices){
 const vao=gl.createVertexArray();gl.bindVertexArray(vao);
 const vertex=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertex);gl.bufferData(gl.ARRAY_BUFFER,packed,gl.STATIC_DRAW);
 gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
 gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);
 const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
 gl.bindVertexArray(null);return {vao,count:indices.length,type:gl.UNSIGNED_SHORT};
}
function geometry(){
 const v=[],ix=[];
 const vertex=(p,c)=>{v.push(p[0],p[1],p[2],c[0],c[1],c[2],1);return v.length/7-1};
 const quad=(a,b,c,d,col)=>{const t=[a,b,c,d].map(p=>vertex(p,col));ix.push(t[0],t[1],t[2],t[0],t[2],t[3])};
 const box=(x0,y0,z0,x1,y1,z1,col)=>{
  quad([x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],col);
  quad([x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],col);
  quad([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],col.map(x=>Math.min(1,x*1.16)));
  quad([x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0],col);
  quad([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],col);
  quad([x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],col);
 };
 const extrude=(points,z0,z1,col)=>{
  const near=points.map(([x,y])=>vertex([x,y,z0],col)),far=points.map(([x,y])=>vertex([x,y,z1],col));
  for(let k=1;k<points.length-1;k++){ix.push(near[0],near[k],near[k+1]);ix.push(far[0],far[k+1],far[k])}
  for(let k=0;k<points.length;k++){const n=(k+1)%points.length;ix.push(near[k],far[k],far[n],near[k],far[n],near[n])}
 };
 // Distinct rectangular slide + thin exposed barrel + coloured frame.
 box(-.19,.14,-.105,.60,.27,.105,DARK);
 box(-.14,.245,-.093,.55,.28,.093,TOP);
 box(-.10,.12,-.112,.40,.16,.112,FRAME);
 box(.44,.17,-.11,.60,.22,.11,METAL);
 box(.596,.172,-.052,.612,.223,.052,BLACK);
 box(.605,.185,-.027,.619,.211,.027,METAL);
 box(.08,.272,.02,.29,.286,.084,BLACK); // ejection port
 for(let i=0;i<4;i++)box(-.125+i*.040,.165,.106,-.112+i*.040,.246,.116,METAL);
 // Slanted pistol grip and magazine base.
 extrude([[-.135,.125],[.104,.102],[.02,-.38],[-.202,-.35]],-.085,.085,GRIP);
 extrude([[-.105,.045],[.067,.040],[-.004,-.310],[-.17,-.28]],-.092,.092,FRAME);
 box(-.20,-.391,-.098,.037,-.355,.098,BLACK);
 // Trigger guard has a visible hollow centre.
 box(.13,.046,-.025,.365,.075,.025,METAL);
 box(.13,-.139,-.026,.37,-.113,.026,FRAME);
 box(.349,-.126,-.025,.372,.050,.025,FRAME);
 box(.165,-.035,-.030,.199,.050,.030,GOLD);
 box(.51,.280,-.030,.555,.336,.030,BLACK);
 box(-.140,.280,-.075,-.100,.321,.075,BLACK);
 return {v:new Float32Array(v),ix:new Uint16Array(ix)};
}
function flashGeometry(){
 const v=[],ix=[],add=(x,y,z)=>{v.push(x,y,z,1,.88,.52,1);return v.length/7-1};
 for(let k=0;k<4;k++){const a=k*Math.PI/2,s=Math.sin(a),c=Math.cos(a);
  const q=add(.63,.20,0),l=add(.71,.20+.075*s,.075*c),r=add(.71,.20-.075*s,-.075*c),tip=add(.97,.20,0);
  ix.push(q,l,tip,q,tip,r);
 }
 return {v:new Float32Array(v),ix:new Uint16Array(ix)};
}
function inverseAffine(m){
 const a=m[0],b=m[4],c=m[8],d=m[1],e=m[5],f=m[9],g=m[2],h=m[6],i=m[10],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
 if(Math.abs(det)<1e-9)return null;
 const x=(e*i-f*h)/det,y=(c*h-b*i)/det,z=(b*f-c*e)/det;
 const u=(f*g-d*i)/det,v=(a*i-c*g)/det,w=(c*d-a*f)/det;
 const q=(d*h-e*g)/det,r=(b*g-a*h)/det,t=(a*e-b*d)/det;
 const tx=m[12],ty=m[13],tz=m[14];
 return new Float32Array([x,u,q,0,y,v,r,0,z,w,t,0,-(x*tx+y*ty+z*tz),-(u*tx+v*ty+w*tz),-(q*tx+r*ty+t*tz),1]);
}
export class PistolRenderer{
 constructor(gl){
  this.gl=gl;this.program=program(gl);
  this.vp=gl.getUniformLocation(this.program,'uVP');this.model=gl.getUniformLocation(this.program,'uModel');
  this.weapon=null;this.referenceGripInverse=null;
  const f=flashGeometry();this.flash=bind(gl,f.v,f.ix);
 }
 addModel(){const g=geometry();this.weapon=bind(this.gl,g.v,g.ix)}
 setGripReference(hand){this.referenceGripInverse=hand?inverseAffine(hand):null}
 draw(vp,actor,now,{actorModel=null}={}){
  if(!this.weapon||actor.anim.rifleAim<.01)return;
  const gl=this.gl,recoil=Math.max(0,(actor.shotUntil-now)/100);
  const local=mul(translation(-.085,.907,.28),mul(rotateY(-Math.PI/2),mul(translation(-.065*recoil,0,0),scale(.75))));
  const grip=actor.anim.rightHandWorld&&this.referenceGripInverse?mul(actor.anim.rightHandWorld,this.referenceGripInverse):null;
  const root=actorModel||mul(translation(actor.pos.x,0,actor.pos.z),rotateY(actor.angle));
  const model=mul(root,grip?mul(grip,local):local);
  gl.useProgram(this.program);gl.uniformMatrix4fv(this.vp,false,vp);gl.uniformMatrix4fv(this.model,false,model);
  gl.bindVertexArray(this.weapon.vao);gl.drawElements(gl.TRIANGLES,this.weapon.count,this.weapon.type,0);
  if(recoil>0){gl.bindVertexArray(this.flash.vao);gl.drawElements(gl.TRIANGLES,this.flash.count,this.flash.type,0)}
  gl.bindVertexArray(null);
 }
}
