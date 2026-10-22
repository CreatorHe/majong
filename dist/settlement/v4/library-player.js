import {createEffekseerLayer} from './effekseer-layer.js';
import {artUrl} from '../../art-loader.js';
export const DURATION = 4200;
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => {x=clamp(x);return x*x*(3-2*x);};
const out = x => 1-(1-clamp(x))**3;
const mix = (a,b,t) => a+(b-a)*t;
const random = n => {const v=Math.sin(n*127.1+91.23)*43758.5453;return v-Math.floor(v);};
const url = path => artUrl(new URL(path,import.meta.url).href);
const THEMES = {
  phoenix:{background:'assets/fire-background.webp',accent:'#ffd18a',particles:'ember'},
  cosmos:{background:'assets/cosmos-background.webp',accent:'#f2d6a4',particles:'star'},
  lotus:{background:'assets/lake-background.webp',accent:'#dec3fa',particles:'petal'},
  sovereign:{background:'../cinematic/gate-v2.webp',accent:'#ffe2a0',particles:'gold'},
  gate:{background:'../cinematic/gate-v2.webp',accent:'#edc69b',particles:'stone'},
  scroll:{background:'../cinematic/scroll-v2.webp',accent:'#e7d0ae',particles:'ink'},
  forest:{background:'assets/lake-background.webp',accent:'#bce1b8',particles:'leaf'},
};

/** One reusable renderer. Scene changes replace textures, never open new GL contexts. */
export async function createLibraryPlayer({width=960,height=540,signal}={}) {
  const P=globalThis.PIXI,F=P.filters,app=new P.Application();
  let fx,fxTexture,font;
  // Awaiting decoration is cancellable even when its underlying browser API is
  // not. Resources arriving after cancellation are released, never mounted.
  const guarded=(promise,onLate=()=>{})=>new Promise((resolve,reject)=>{
    let finished=false;
    const abort=()=>{if(finished)return;finished=true;reject(new Error('结算演出已取消'));};
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(value=>{
      signal?.removeEventListener('abort',abort);
      if(finished){try{onLate(value);}catch{}return;}finished=true;resolve(value);
    },error=>{signal?.removeEventListener('abort',abort);if(!finished){finished=true;reject(error);}});
    if(signal?.aborted)abort();
  });
  const destroyApp=()=>{try{app.destroy(true,{children:true,texture:false,textureSource:false});}catch{}};
  try {
  if(signal?.aborted)throw new Error('结算演出已取消');
  await guarded(app.init({width,height,autoStart:false,preference:'webgl',antialias:true,resolution:1,preserveDrawingBuffer:true,backgroundColor:0x090507}),destroyApp);
  app.stop();
  const world=new P.Container();world.scale.set(width/960,height/540);world.filterArea=new P.Rectangle(0,0,width,height);app.stage.addChild(world);
  const bg=new P.Sprite(P.Texture.WHITE);bg.anchor.set(.5);bg.position.set(480,270);world.addChild(bg);
  const grade=new P.ColorMatrixFilter();grade.brightness(.25,false);grade.saturate(-.35,true);bg.filters=[grade];
  const veil=new P.Graphics().rect(0,0,960,540).fill({color:0x090811,alpha:.35});world.addChild(veil);
  const glow=new P.Graphics();world.addChild(glow);
  fx=await guarded(createEffekseerLayer({width,height}),value=>value.dispose());
  fxTexture=P.Texture.from(fx.canvas);const fxUnder=new P.Sprite(fxTexture);fxUnder.width=960;fxUnder.height=540;fxUnder.blendMode='add';world.addChild(fxUnder);
  const hero=new P.Container();world.addChild(hero);
  const poses=['charge','dash','release'].map(()=>{const s=new P.Sprite(P.Texture.WHITE);s.anchor.set(.5);hero.addChild(s);return s;});
  const heroGrade=new F.AdjustmentFilter({saturation:1.01,gamma:1.06,brightness:1.02});hero.filters=[heroGrade];
  const fxOver=new P.Sprite(fxTexture);fxOver.width=960;fxOver.height=540;fxOver.blendMode='add';world.addChild(fxOver);
  const shock=new F.ShockwaveFilter({center:{x:width*.41,y:height*.49},amplitude:11,wavelength:100,brightness:1.1,speed:width*1.3,radius:width*.95});
  const zoom=new F.ZoomBlurFilter({center:{x:width*.41,y:height*.49},strength:0,innerRadius:width*.12,radius:width,maxKernelSize:24});world.filters=[shock,zoom];
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
  font=new FontFace('V4Brush',`url(${url('../cinematic/MaShanZheng-subset.woff2')})`);await guarded(font.load());document.fonts.add(font);
  let scene,theme,disposed=false,loadId=0;
  const fit=(s,x,y,w,r=0)=>{s.position.set(x,y);s.width=w;s.height=w*s.texture.height/s.texture.width;s.rotation=r;};
  const alpha=(s,v)=>{s.alpha=clamp(v);s.visible=s.alpha>.001;};
  async function setScene(next){
    if(disposed)throw new Error('播放器已释放');
    const ticket=++loadId,t=THEMES[next.theme];if(!t)throw new Error(`未知主题 ${next.theme}`);
    const paths=[t.background,...['charge','dash','release'].map(p=>`assets/${next.theme}-${p}.webp`)];
    // Keep keys stable if a service worker takes control while textures load.
    const resolved=paths.map(url);
    const textures=await guarded(P.Assets.load(resolved.map(src=>({src,loadParser:'loadTextures'}))));
    if(disposed||ticket!==loadId)return false;
    bg.texture=textures[resolved[0]];bg.width=1040;bg.height=585;
    poses.forEach((s,i)=>s.texture=textures[resolved[i+1]]);
    scene=next;theme=t;fx.reset();return true;
  }

  function drawPoses(ms){
    const [a,b,c]=poses,g=smooth(ms/650),r=clamp((ms-660)/410),v=r**2.3;
    const hold=Number(scene.motion?.holdMs)||100;
    const poseMs=ms<1180?ms:ms<1180+hold?1180:ms-hold,o=out((poseMs-1120)/650);
    alpha(a,(1-smooth((ms-640)/90))*smooth(ms/160));alpha(b,smooth((ms-650)/50)*(1-smooth((ms-1070)/50)));alpha(c,smooth((ms-1100)/55));
    switch(scene.theme){
      case 'phoenix':fit(a,mix(300,345,g),mix(330,280,g),mix(720,630,g),-.11-g*.035);fit(b,mix(320,1080,v),mix(280,80,v),mix(740,1350,r),-.09);fit(c,mix(440,370,o),mix(253,280,o),mix(1120,850,o),mix(-.065,-.025,o));break;
      case 'whale':fit(a,365,mix(365,330,g),mix(700,620,g),mix(.08,-.06,g));fit(b,mix(360,460,v),mix(480,80,v),mix(710,1120,r),mix(.12,-.28,r));fit(c,mix(410,370,o),mix(230,285,o),mix(1080,850,o),mix(-.15,-.035,o));break;
      case 'cosmos':fit(a,370,285,mix(660,530,g),g*.09);fit(b,370,280,mix(560,1140,v),mix(-.18,.18,r));fit(c,370,275,mix(1020,810,o),mix(.13,0,o));break;
      case 'lotus':fit(a,370,mix(355,325,g),mix(500,550,g));fit(b,370,mix(330,245,r),mix(550,860,r),-.04*Math.sin(r*Math.PI));fit(c,375,mix(260,282,o),mix(980,740,o));break;
      case 'sovereign':fit(a,370,290,mix(460,580,g));fit(b,370,290,mix(580,1250,v));fit(c,360,285,mix(1030,790,o));break;
      case 'gate':fit(a,370,mix(185,150,g),mix(600,650,g),-.02);fit(b,370,mix(-180,330,v),mix(700,930,r));fit(c,365,mix(310,285,o),mix(960,800,o),mix(.035,0,o));break;
      case 'scroll':fit(a,365,280,mix(480,540,g),mix(-.2,-.08,g));fit(b,370,280,mix(570,1010,r),mix(-.24,.05,r));fit(c,365,285,mix(1040,850,o),mix(.035,-.02,o));break;
      case 'forest':fit(a,365,mix(340,315,g),mix(660,610,g),-.025);fit(b,mix(350,840,v),mix(340,90,v),mix(690,1080,r),-.12);fit(c,mix(420,365,o),mix(250,280,o),mix(1020,850,o),mix(-.06,-.02,o));break;
    }
    const m=scene.motion||{},intensity=Number(m.intensity)||1;
    // Variants differ in approach direction, echo count and motif timing, while
    // retaining the approved three-pose composition and its legible hold.
    if(scene.id!=='daisuushii'){
      const shift=Math.sin((ms/4200)*Math.PI)*(Number(m.direction)||1)*Math.min(20,8*intensity);
      hero.scale.x=m.mirror?-1:1;hero.x=(m.mirror?740:0)+shift;hero.y=0;
    }else{hero.scale.x=1;hero.position.set(0,0);}
    if(ms>1900){const settle=clamp((ms-1900)/1800);c.x-=settle*12;c.y-=settle*5;c.rotation-=settle*.012;}
    return {r,v,o,intensity};
  }

  function render(timeMs,{clean=false,label,seal}={}){
    if(disposed||!scene)throw new Error('请先加载一个番型');
    const actual=Math.max(0,Math.min(DURATION,Number(timeMs)||0)),m=scene.motion||{};
    const start=m.chargeMs||650,hit=m.impactMs||1120,end=hit+(m.releaseMs||650)+(m.holdMs||100);
    const ms=scene.id==='daisuushii'?actual:actual<start?actual/start*650:actual<hit?650+(actual-start)/(hit-start)*470:actual<end?1120+(actual-hit)/(end-hit)*750:1870+(actual-end)/(4200-end)*2330;
    const {r,v,o,intensity}=drawPoses(ms),invalid=m.outcome==='invalid';
    if(invalid){poses[0].visible=poses[1].visible=false;poses[2].visible=true;poses[2].alpha=smooth(ms/300);fit(poses[2],365,285,820,-.02);heroGrade.saturation=.12;}else heroGrade.saturation=1.01;
    bg.x=480+(ms<1200?v*12:12*(1-o));
    const after=Math.exp(-Math.max(0,ms-1170)/135),strength=Math.min(1.2,intensity);
    world.position.set(ms>1080&&ms<1460?Math.sin(ms*.13)*after*7*strength:0,ms>1080&&ms<1460?Math.cos(ms*.17)*after*4*strength:0);
    shock.enabled=!invalid&&ms>=1140&&ms<1800;shock.time=Math.max(0,(ms-1140)/1000);shock.amplitude=11*strength;
    zoom.strength=(ms>720&&ms<1100?.12*Math.sin(r*Math.PI):0)+(ms>=1120&&ms<1400?.15*(1-clamp((ms-1120)/280)):0);zoom.enabled=!invalid&&zoom.strength>.002;
    heroGrade.brightness=invalid?.65:ms>1050&&ms<1175?1.45:1.02;
    glow.clear();if(ms>1000)for(let i=8;i>=0;i--)glow.ellipse(375,260,115+i*22,105+i*18).fill({color:scene.color||theme.accent,alpha:.008*(1+i*.15)*smooth((ms-1020)/180)});
    fx.render(Math.min(4000,ms));fxTexture.source.update();fxUnder.alpha=invalid?0:.48*strength;fxOver.alpha=invalid?0:ms<1000?.16:.55*(1-smooth((ms-1500)/350));
    app.render();ctx.drawImage(app.canvas,0,0,width,height);ctx.save();ctx.scale(width/960,height/540);
    if(!invalid){drawMotif(ms);drawParticles(ms);}else if(ms>850){ctx.strokeStyle='#8e3444';ctx.lineWidth=6;ctx.globalAlpha=.75*smooth((ms-850)/200);ctx.beginPath();ctx.moveTo(210,200);ctx.lineTo(450,370);ctx.moveTo(450,200);ctx.lineTo(210,370);ctx.stroke();ctx.globalAlpha=1;}
    const vignette=ctx.createRadialGradient(390,260,110,480,270,610);vignette.addColorStop(0,'transparent');vignette.addColorStop(1,'rgba(8,3,8,.7)');ctx.fillStyle=vignette;ctx.fillRect(0,0,960,540);
    if(!invalid&&ms>=1066&&ms<1133){ctx.fillStyle=`rgba(255,244,224,${ms<1100?.58:.18})`;ctx.fillRect(0,0,960,540);}
    if(!clean)drawTitle(ms,label??scene.label,seal??scene.seal);
    const fade=1-smooth(ms/160)*smooth((DURATION-ms)/500);if(fade>0){ctx.fillStyle=`rgba(9,5,7,${fade})`;ctx.fillRect(0,0,960,540);}
    ctx.restore();return canvas;
  }

  function drawMotif(ms){
    const type=theme.particles,m=scene.motion||{},count=Math.max(2,Math.min(13,Number(m.echoes)||4));
    ctx.save();ctx.globalCompositeOperation='screen';ctx.strokeStyle=scene.accent||theme.accent;ctx.fillStyle=scene.color||theme.accent;
    if(ms>500&&ms<1400){const q=clamp((ms-500)/900);ctx.globalAlpha=Math.sin(q*Math.PI)*.24;
      for(let i=0;i<22;i++){const y=random(i+10)*640-50,x=(ms*.9+i*131)%1400-250,len=80+random(i+20)*220;ctx.lineWidth=.5+random(i+9);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-len,y+len*.23);ctx.stroke();}
    }
    const q=(ms-1120)/1000;
    if(q>=0&&q<1.7){
      if(type==='water'||type==='petal'){for(let i=0;i<count;i++){const u=q-i*.07;if(u<0)continue;ctx.globalAlpha=Math.max(0,1-u/1.6)*.3;ctx.lineWidth=2-i*.13;ctx.beginPath();ctx.ellipse(360,380,60+u*330,15+u*90,0,0,Math.PI*2);ctx.stroke();}}
      if(type==='gold'||type==='stone'){for(let i=0;i<count;i++){const u=q-i*.045;if(u<0)continue;ctx.globalAlpha=Math.max(0,1-u/1.1)*.28;ctx.lineWidth=1.4;const x=170+i*400/(count-1);ctx.beginPath();ctx.moveTo(x,410);ctx.lineTo(x+(x-370)*u*.6,410-u*410);ctx.stroke();}}
      if(type==='star'){for(let i=0;i<3;i++){ctx.globalAlpha=(1-q/1.7)*.25;ctx.strokeStyle=['#edae9f','#9bd6ce','#efe6bd'][i];ctx.beginPath();ctx.ellipse(370,270,130+q*180,50+q*50,i*Math.PI/3+q*.3,0,Math.PI*2);ctx.stroke();}}
    }
    if(type==='ink'&&ms>=1500){
      const symbols=scene.id==='tsuuiisou'?'東南西北白發中':scene.id==='all_jiang'?'二五八':scene.id==='chiitoitsu'?'雙雙雙雙雙雙雙':scene.id==='ryanpeikou'?'同同雙雙':scene.id==='chinroutou'?'一九一九':scene.id==='honroutou'?'一九東南西北':scene.id==='normal'?'和':String(scene.label).replace(/[\s·]/g,'').slice(0,7);
      const glyphs=[...symbols],step=Math.min(66,400/Math.max(1,glyphs.length-1));
      ctx.globalCompositeOperation='source-over';ctx.textAlign='center';ctx.textBaseline='middle';
      glyphs.forEach((ch,i)=>{const u=out((ms-1500-i*75)/280);ctx.save();ctx.globalAlpha=.78*u;ctx.translate(360+(i-(glyphs.length-1)/2)*step,275+(1-u)*18);ctx.rotate(-.025);ctx.strokeStyle='#85382e';ctx.fillStyle='#793127';ctx.lineWidth=1.6;ctx.strokeRect(-23,-30,46,60);ctx.font='38px V4Brush';ctx.fillText(ch,0,1);ctx.restore();});
    }
    ctx.restore();
  }

  function drawParticles(ms){
    if(ms<1120)return;const q=(ms-1120)/1000,type=theme.particles;
    ctx.save();ctx.globalCompositeOperation=type==='ink'?'source-over':'screen';
    for(let i=0;i<52;i++){const life=1.1+random(i+61)*2;if(q>life)continue;
      const speed=60+random(i+1)*180,a=random(i+38)*Math.PI*2,x=380+Math.cos(a)*q*speed,y=260+Math.sin(a)*q*speed+q*q*(type==='leaf'||type==='petal'?16:32);
      ctx.globalAlpha=(1-q/life)*(.2+random(i+6)*.42);ctx.fillStyle=i%3?(scene.color||theme.accent):(scene.accent||theme.accent);ctx.save();ctx.translate(x,y);ctx.rotate(a+q*(random(i+2)-.5));
      if(type==='stone'||type==='ink'){const s=1+random(i+3)*3;ctx.fillRect(-s,-s,s*2,s);}
      else if(type==='star'){const s=1+random(i+3)*3;ctx.beginPath();ctx.moveTo(0,-s*2);ctx.lineTo(s*.4,-s*.4);ctx.lineTo(s*2,0);ctx.lineTo(s*.4,s*.4);ctx.lineTo(0,s*2);ctx.lineTo(-s*.4,s*.4);ctx.lineTo(-s*2,0);ctx.lineTo(-s*.4,-s*.4);ctx.closePath();ctx.fill();}
      else{ctx.beginPath();ctx.ellipse(0,0,type==='leaf'?2.5:.6+random(i+31)*1.7,(type==='petal'||type==='leaf'?5:2)+random(i+18)*3,0,0,Math.PI*2);ctx.fill();}ctx.restore();
    }ctx.restore();
  }

  function drawTitle(ms,label,seal='和牌'){
    if(ms<1450)return;const q=out((ms-1450)/400);ctx.save();ctx.globalAlpha=q;
    const shade=ctx.createLinearGradient(560,0,960,0);shade.addColorStop(0,'transparent');shade.addColorStop(1,'rgba(9,4,9,.91)');ctx.fillStyle=shade;ctx.fillRect(560,0,400,540);
    const text=String(label).replace(/\s*·\s*/g,'·'),chars=[...text],two=chars.length>4,size=two?Math.min(74,310/Math.ceil(chars.length/2)):Math.min(118,370/chars.length),rows=two?Math.ceil(chars.length/2):chars.length;
    const step=size*.98,startY=270-(rows-1)*step/2;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='#221016';ctx.shadowBlur=12;
    chars.forEach((ch,i)=>{const column=two?Math.floor(i/rows):0,row=i%rows,k=out((ms-1490-i*55)/280);ctx.save();ctx.globalAlpha=k;ctx.translate(two?847-column*(size*.95):807,startY+row*step+(1-k)*24);ctx.rotate(-.035);ctx.scale(1+.14*(1-k),1+.14*(1-k));const ink=ctx.createLinearGradient(0,-size/2,0,size/2);ink.addColorStop(0,'#fff8e4');ink.addColorStop(.65,scene.accent||'#f4d391');ink.addColorStop(1,scene.color||'#bd8852');ctx.fillStyle=ink;ctx.font=`${size}px V4Brush`;ctx.fillText(ch,0,0);ctx.restore();});
    ctx.globalAlpha=q;ctx.shadowBlur=0;const sealText=[...String(seal||'和牌')].slice(0,2);ctx.fillStyle=scene.id==='false_hu'?'#614653':'#96332f';ctx.fillRect(683,235,33,64);ctx.strokeStyle='#d5ae7f';ctx.strokeRect(687,239,25,56);ctx.fillStyle='#ffe4ac';ctx.font='21px V4Brush';sealText.forEach((ch,i)=>ctx.fillText(ch,700,255+i*24));
    ctx.font='11px system-ui';ctx.fillStyle='#c8ac8c';ctx.letterSpacing='3px';const subtitle=String(scene.subtitle||'').split(/[·，]/);ctx.fillText(subtitle[0]||'',800,66);ctx.fillText(subtitle[1]||'',800,474);ctx.letterSpacing='0px';ctx.restore();
  }
  return {canvas,setScene,render,reset:()=>fx.reset(),dispose(){if(disposed)return;disposed=true;loadId++;fx.dispose();app.destroy(true,{children:true,texture:false,textureSource:false});fxTexture.destroy(true);document.fonts.delete(font);}};
  } catch(error) {
    // Initialization may fail after a GL context exists; retain the original
    // load error while releasing every resource that was already created.
    try {fx?.dispose();} catch {}
    try {app.destroy(true,{children:true,texture:false,textureSource:false});} catch {}
    try {fxTexture?.destroy(true);} catch {}
    if(font)document.fonts.delete(font);
    throw error;
  }
}
