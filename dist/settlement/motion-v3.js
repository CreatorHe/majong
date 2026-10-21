// Exact 96-frame derivatives of the delivered GIFs, without baked titles or scores.
// Only current playable themes are shipped. Assets never unlock a scoring pattern.
export const MOTION_DURATION = 4800;
export const MOTION_THEMES = Object.freeze(Object.fromEntries([
  'daisuushii', 'daisangen', 'chuuren', 'kokushi', 'suukantsu', 'tsuuiisou', 'ryuuiisou',
].map(id => [id, Object.freeze({
  video: new URL(`./motion-v3/${id}.mp4`, import.meta.url).href,
  poster: new URL(`./motion-v3/${id}.webp`, import.meta.url).href,
})])));

/** Media follows the settlement clock; it never drives score steps or completion. */
export class MotionVideo {
  constructor(host, source) { this.host=host;this.source=source;this.video=null;this.disposed=false;this.failed=false;this.cancelled=false; }
  render(progress, options={}) {
    this.last={progress,options};
    const active=!this.disposed&&!this.cancelled&&!this.failed&&!options.reducedMotion&&!options.poster&&options.phase!=='result'&&progress<1;
    if(!active){this.release();return;}
    if(!this.video){
      const video=document.createElement('video');this.video=video;
      video.className='jr-cine-video';video.muted=true;video.defaultMuted=true;video.playsInline=true;video.loop=false;video.preload='auto';video.hidden=true;
      video.setAttribute('aria-hidden','true');video.setAttribute('playsinline','');video.setAttribute('muted','');
      video.addEventListener('loadeddata',()=>{if(this.video===video&&!this.disposed)this.render(this.last.progress,this.last.options);},{once:true});
      video.addEventListener('error',()=>{if(this.video===video){this.failed=true;this.release();}},{once:true});
      this.host.append(video);video.src=this.source;video.load();
    }
    const video=this.video;if(video.readyState<2)return;
    video.hidden=false;
    const desired=Math.min((MOTION_DURATION-50)/1000,Math.max(0,progress)*MOTION_DURATION/1000);
    if(Math.abs(video.currentTime-desired)>.18)video.currentTime=desired;
    video.playbackRate=Math.max(.5,Math.min(4,options.speed||1));
    if(options.paused){video.pause();return;}
    if(video.paused&&!this.pending){
      this.pending=video;
      Promise.resolve(video.play()).then(()=>{
        if(this.video!==video||this.disposed||this.cancelled||this.last.options.paused)video.pause();
      }).catch(()=>{if(this.video===video){this.failed=true;this.release();}}).finally(()=>{if(this.pending===video)this.pending=null;});
    }
  }
  release(){
    const video=this.video;this.video=null;this.pending=null;
    if(!video)return;
    video.pause();video.removeAttribute('src');video.load();video.remove();
  }
  cancel(){this.cancelled=true;this.release();}
  dispose(){this.disposed=true;this.release();}
}
