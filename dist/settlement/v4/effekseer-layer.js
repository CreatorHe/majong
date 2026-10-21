// Effekseer owns particles only. Illustration, subject motion and typography stay
// in the caller's compositor. No RAF is installed by this module.
const DURATION_MS = 4000;
const FPS = 60;
const BASE = new URL('.', import.meta.url);
const RUNTIME_PROMISE = Symbol.for('jade.effekseer.1.70e.runtime');

export const EFFEKSEER_SEQUENCE = Object.freeze([
  Object.freeze({ id:'charge', file:'fx/00_Version16/Aura01.efkefc', start:0, end:78,
    sourceStart:0, speed:1, scale:.76, y:-2.4, rotation:[0,0,0], seed:73129, fadeIn:15, fadeOut:22 }),
  Object.freeze({ id:'slash', file:'fx/00_Basic/Simple_Ribbon_Sword.efkefc', start:58, end:94,
    sourceStart:0, speed:1, scale:1.65, y:.3, rotation:[0,0,-.38], seed:73133, fadeIn:1, fadeOut:10 }),
  Object.freeze({ id:'sparks', file:'fx/00_Basic/Simple_Turbulence_Fireworks.efkefc', start:64, end:240,
    sourceStart:100, speed:1, scale:.24, y:-6.0, rotation:[0,0,0], seed:73141, fadeIn:2, fadeOut:42 }),
]);

const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const smooth = v => { const x=clamp(v,0,1);return x*x*(3-2*x); };

function loadRuntime() {
  if(globalThis[RUNTIME_PROMISE])return globalThis[RUNTIME_PROMISE];
  const promise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('vendor/effekseer/effekseer.min.js',BASE).href;
    script.async=true;
    script.onerror=()=>reject(new Error('Effekseer 1.70e runtime script could not be loaded'));
    script.onload=()=>{
      const runtime=globalThis.effekseer;
      if(!runtime?.initRuntime){reject(new Error('Effekseer global API is unavailable'));return;}
      runtime.initRuntime(new URL('vendor/effekseer/effekseer.wasm',BASE).href,
        ()=>resolve(runtime),()=>reject(new Error('Effekseer WebAssembly initialization failed')));
    };
    document.head.append(script);
  });
  globalThis[RUNTIME_PROMISE]=promise;
  promise.catch(()=>{delete globalThis[RUNTIME_PROMISE];});
  return promise;
}

/** Fixed-step native playback, exported separately for tests without a browser.
 * Native 1.70e setFrame() restores the original internally generated seed when
 * moving backwards, not the later setRandomSeed() value. Recreate handles on a
 * rewind and seed BEFORE BeginUpdate/Preupdate instead of trusting that path.
 * The selected samples have no time-dependent custom material. Per-handle
 * setFrame advances their nodes while renderer global material time stays zero.
 */
export function createEffekseerTimeline(context,effects,{centerX=0,sequence=EFFEKSEER_SEQUENCE}={}) {
  let frame=-1,disposed=false;
  const active=new Map();
  function reset() {
    if(disposed)return;
    context.stopAll();context.beginUpdate();context.endUpdate();
    active.clear();frame=-1;
  }
  function seek(timeMs) {
    if(disposed)throw new Error('Effekseer timeline is disposed');
    const target=Math.floor(clamp(Number.isFinite(timeMs)?timeMs:0,0,DURATION_MS)*FPS/1000+1e-8);
    if(target<frame)reset();
    while(frame<target) {
      frame++;
      for(const cue of sequence) {
        if(frame===cue.start) {
          const handle=context.play(effects.get(cue.id),centerX,cue.y,0);
          if(!handle)throw new Error(`Effekseer could not play ${cue.id}`);
          handle.setRandomSeed(cue.seed);
          handle.setScale(cue.scale,cue.scale,cue.scale);
          handle.setRotation(...cue.rotation);
          active.set(cue.id,{handle,cue});
        }
      }
      for(const [id,{handle,cue}] of active) {
        if(frame>=cue.end){handle.stop();active.delete(id);continue;}
        const fade=smooth((frame-cue.start+1)/cue.fadeIn)*smooth((cue.end-frame)/cue.fadeOut);
        // Keep source RGB intact; a dedicated pass recolors the complete emission.
        handle.setAllColor(255,255,255,Math.round(255*fade));
      }
      context.beginUpdate();
      try {
        for(const {handle,cue} of active.values()) {
          handle.setFrame(cue.sourceStart+Math.floor((frame-cue.start)*cue.speed)+1);
        }
      } finally {context.endUpdate();}
    }
    return frame;
  }
  function dispose(){if(disposed)return;reset();disposed=true;}
  return {seek,reset,dispose,get frame(){return frame;},get activeCount(){return active.size;}};
}

function loadEffect(context,cue) {
  return new Promise((resolve,reject)=>{
    let effect;
    effect=context.loadEffect(new URL(cue.file,BASE).href,1,
      ()=>queueMicrotask(()=>resolve(effect)),
      (reason,path)=>reject(new Error(`Effekseer ${cue.id}: ${reason} (${path})`)));
  });
}

function shader(gl,type,source) {
  const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) {
    const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(`Gold pass shader: ${error}`);
  }
  return s;
}

// This pass preserves the authored particle silhouettes/trajectories while
// replacing RGB hues with a narrow antique-gold palette. A multiplicative
// setAllColor alone cannot turn green/blue source emission into warm gold.
function createGoldPass(gl,width,height) {
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  const depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
  gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,width,height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Effekseer gold framebuffer is incomplete');
  const vertex=shader(gl,gl.VERTEX_SHADER,`
    attribute vec2 aPosition; varying vec2 vUv;
    void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.,1.);}
  `);
  const fragment=shader(gl,gl.FRAGMENT_SHADER,`
    precision mediump float; varying vec2 vUv; uniform sampler2D uEffect;
    void main(){
      vec4 src=texture2D(uEffect,vUv);
      float energy=max(src.r,max(src.g,src.b));
      float alpha=clamp(max(src.a,energy),0.,1.);
      vec3 gold=mix(vec3(.66,.25,.025),vec3(1.,.74,.25),smoothstep(.02,.65,energy));
      gold=mix(gold,vec3(1.,.94,.73),smoothstep(.78,1.,energy)*.66);
      gl_FragColor=vec4(gold*alpha,alpha);
    }
  `);
  const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`Gold pass link: ${gl.getProgramInfoLog(program)}`);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'aPosition'),sampler=gl.getUniformLocation(program,'uEffect');
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  return {
    begin(){
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(0,0,width,height);
      gl.colorMask(true,true,true,true);gl.depthMask(true);gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    },
    draw(){
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);
      gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.SCISSOR_TEST);
      gl.depthMask(false);gl.colorMask(true,true,true,true);gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(sampler,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,6);
    },
    dispose(){
      gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
      gl.deleteRenderbuffer(depth);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);
    },
  };
}

/** Await once; render(milliseconds) is synchronous and can seek in either direction.
 * Canvas is transparent and is not added to the DOM. Composite it using drawImage.
 * Frame range is a single 0..4000 ms sequence; values outside are clamped.
 */
export async function createEffekseerLayer({width=1280,height=720}={}) {
  width=Math.round(width);height=Math.round(height);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw new Error('Invalid Effekseer canvas size');
  const runtime=await loadRuntime();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const attributes={alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true};
  // The pinned 1.70e distribution was built around the WebGL 1 runtime.
  const gl=canvas.getContext('webgl',attributes)||canvas.getContext('experimental-webgl',attributes);
  if(!gl)throw new Error('Effekseer requires WebGL');
  const context=runtime.createContext();
  if(!context)throw new Error('Effekseer context creation failed');
  let goldPass,timeline,disposed=false;
  const effects=new Map();
  try {
    context.init(gl,{instanceMaxCount:6000,squareMaxCount:10000,enablePremultipliedAlpha:true});
    context.setRestorationOfStatesFlag(true);
    const worldHeight=24,worldWidth=worldHeight*width/height;
    context.setProjectionOrthographic(worldWidth,worldHeight,.1,250);
    context.setCameraLookAt(0,0,80,0,0,0,0,1,0);
    // Serial loading keeps official 1.70e's shared WASM resource context unambiguous.
    for(const cue of EFFEKSEER_SEQUENCE)effects.set(cue.id,await loadEffect(context,cue));
    goldPass=createGoldPass(gl,width,height);
    timeline=createEffekseerTimeline(context,effects,{centerX:-worldWidth*.14});
  } catch(error) {
    goldPass?.dispose();
    for(const effect of effects.values())context.releaseEffect(effect);
    runtime.releaseContext(context);gl.getExtension('WEBGL_lose_context')?.loseContext();throw error;
  }
  function render(timeMs) {
    if(disposed)throw new Error('Effekseer layer is disposed');
    timeline.seek(timeMs);goldPass.begin();context.draw();goldPass.draw();
    return canvas;
  }
  function reset(){if(!disposed){timeline.reset();goldPass.begin();goldPass.draw();}}
  function dispose() {
    if(disposed)return;disposed=true;
    timeline.dispose();
    for(const effect of effects.values())context.releaseEffect(effect);
    effects.clear();goldPass.dispose();runtime.releaseContext(context);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return {canvas,render,reset,dispose,get ready(){return !disposed;},durationMs:DURATION_MS,
    stats:{runtime:'EffekseerForWebGL 1.70e',sampleCount:effects.size,simulationFps:FPS,color:'gold',fixedSeeds:EFFEKSEER_SEQUENCE.map(c=>c.seed)}};
}
