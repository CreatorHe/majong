import {tileName} from './engine.js';
import {artUrl} from './art-loader.js';

// Vector outlines keep the same engraved tile lettering on every device.
// CC0 artwork and adaptation details: art/tiles/LICENSE.md.
const faces = [
  ...Array.from({length:9},(_,i)=>`Man${i+1}`),
  ...Array.from({length:9},(_,i)=>`Pin${i+1}`),
  ...Array.from({length:9},(_,i)=>`Sou${i+1}`),
  'Ton','Nan','Shaa','Pei','Haku','Hatsu','Chun',
].map(name=>new URL(`./art/tiles/${name}.svg`,import.meta.url).href);

export function face(t){
  const value=typeof t==='object'?t.face:t;
  return `<svg viewBox="0 0 60 74" aria-hidden="true"><image href="${artUrl(faces[value])}" x="7" y="6" width="46" height="62"/></svg>`;
}
export function tile(t,{size='',selected=false,index=null,quiet=false,zone=null,locked=false}={}){
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wild=typeof t==='object'&&t.wild;
  const body=face(t)+(wild?'<span class="wild-badge" aria-hidden="true">万·筒·条</span>':''), cls=`tile ${size} ${selected?'selected':''} ${quiet?'quiet':''} ${wild?'wild-tile':''} ${locked?'locked-tile':''}`;
  const name=escape(tileName(t)+(wild?' · 花色万能':''));
  if(zone&&typeof t==='object'&&!locked)return `<button class="${cls}" data-act="tile" data-zone="${zone}" data-id="${escape(t.id)}" aria-label="${zone==='formed'?'成型区':'备选牌'} ${name}" aria-pressed="${selected}">${body}<span class="tile-check">✓</span></button>`;
  return index===null?`<span class="${cls}" title="${name}${locked?' · 已声明杠':''}" aria-label="${name}">${body}</span>`:`<button class="${cls}" data-act="tile" data-index="${index}" aria-label="手牌 ${index+1} ${name}" aria-pressed="${selected}">${body}<span class="tile-check">✓</span></button>`;
}
