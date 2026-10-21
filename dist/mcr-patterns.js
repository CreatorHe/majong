import { suit, rank, groupType } from './hand-rules.js';

// WMO Mahjong Competition Rules, 2021 distribution; see docs/MCR_PATTERN_AUDIT.md.
// The catalogue is also the UI's source of truth. Missing game context is never inferred.
const context = {
  concealed: '本作不区分刻子/杠的明暗；不能把最终刻子或已声明杠自动视为暗刻、暗杠并赠送额外高番，暂不启用。',
  method: '本作没有荣和/自摸与他家供牌过程；单人组牌不自动满足门清、自摸或求人奖励，暂不启用。',
  wall: '本作没有对局牌河、海底或补杠和牌时机。',
  wind: '本作没有圈风和自风。',
  wait: '本作不指定最后和牌张及和牌前的唯一听张。',
};
const entries = [
  ['大四喜',88,'东、南、西、北各有一组刻子或杠。'],
  ['大三元',88,'白、發、中各有一组刻子或杠。'],
  ['绿一色',88,'全部牌仅取自二、三、四、六、八索与發。'],
  ['九莲宝灯',88,'本作按牌面识别：无杠，同色 1112345678999 再加同色任意一张；不另送门清或不求人番。'],
  ['四杠',88,'四个已声明的杠，加一个雀头。'],
  ['连七对',88,'同一花色连续七个点数，各组成一对。'],
  ['十三幺',88,'六种一九数牌和七种字牌齐全，其中一种再多一张。'],
  ['清幺九',64,'全手只含一、九数牌。'],
  ['小四喜',64,'三种风牌组成刻子/杠，第四种作雀头。'],
  ['小三元',64,'两种箭牌组成刻子/杠，第三种作雀头。'],
  ['字一色',64,'全手均为东南西北白發中。'],
  ['四暗刻',64,'四组暗刻，暗杠也算暗刻。',context.concealed],
  ['一色双龙会',64,'同花色两组 123、两组 789，雀头为 55。'],
  ['一色四同顺',48,'四个完全相同的顺子。'],
  ['一色四节高',48,'同花色四组刻子/杠，点数逐组加一。'],
  ['一色四步高',32,'同花色四组顺子，起点逐组加一或逐组加二。'],
  ['三杠',32,'恰有三个已声明的杠。'],
  ['混幺九',32,'全手只含一、九数牌和字牌，两类均有。'],
  ['七对',24,'七个对子；国标允许四张相同牌作为两个对子。'],
  ['七星不靠',24,'七种字牌齐全，另七张数牌互异且属于一套组合龙。'],
  ['全双刻',24,'四组刻子/杠和雀头，全是二、四、六、八数牌。'],
  ['清一色',24,'只使用万、筒、索中的一种花色。'],
  ['一色三同顺',24,'三个完全相同的顺子。'],
  ['一色三节高',24,'同花色三组刻子/杠，点数逐组加一。'],
  ['全大',24,'全手点数只含七、八、九。'],
  ['全中',24,'全手点数只含四、五、六。'],
  ['全小',24,'全手点数只含一、二、三。'],
  ['清龙',16,'同一花色的 123、456、789 三组顺子。'],
  ['三色双龙会',16,'两种花色各有 123 与 789，第三种花色的 55 作雀头。'],
  ['一色三步高',16,'同花色三组顺子，起点逐组加一或逐组加二。'],
  ['全带五',16,'四个面子和雀头每组都含数牌五。'],
  ['三同刻',16,'三种花色各有相同点数的刻子/杠。'],
  ['三暗刻',16,'三组暗刻，暗杠也算暗刻。',context.concealed],
  ['全不靠',12,'十四张互异牌；数牌来自一套组合龙，字牌任取互异的五至七种。'],
  ['组合龙',12,'万、筒、索分别承载 147、258、369（花色可交换），共九张；另有面子和雀头，或与全不靠组合。'],
  ['大于五',12,'全手点数只含六、七、八、九。'],
  ['小于五',12,'全手点数只含一、二、三、四。'],
  ['三风刻',12,'三种风牌各有一组刻子/杠。'],
  ['花龙',8,'三种花色分别组成 123、456、789。'],
  ['推不倒',8,'只用筒 1234589、索 245689 与白。'],
  ['三色三同顺',8,'万、筒、索各有同样起点的顺子。'],
  ['三色三节高',8,'三种花色各有一组刻子/杠，点数合为三个连续数。'],
  ['无番和',8,'本作适配：合法和牌且没有任何其他当前可用的国标番型。'],
  ['妙手回春',8,'以牌墙最后一张牌自摸和牌。',context.wall],
  ['海底捞月',8,'荣和牌墙最后一张牌所引出的舍牌。',context.wall],
  ['杠上开花',8,'开杠后以补牌自摸和牌。',context.wall],
  ['抢杠和',8,'以他家补杠的牌荣和。',context.wall],
  ['双暗杠',8,'两个暗杠。',context.concealed],
  ['碰碰和',6,'四个面子全为刻子或杠。'],
  ['混一色',6,'只用一种数牌花色，且含字牌。'],
  ['三色三步高',6,'三种花色各有一个顺子，起点合为三个连续数。'],
  ['五门齐',6,'万、筒、索、风牌、箭牌五类都有。'],
  ['全求人',6,'四组面子均吃碰明杠，最后荣和单钓雀头。',context.method],
  ['双箭刻',6,'两种箭牌各组成刻子/杠。'],
  ['全带幺',4,'普通结构的四个面子和雀头，每组都含一九牌或字牌。'],
  ['不求人',4,'没有吃碰明杠，以自摸完成和牌。',context.method],
  ['双明杠',4,'两个明杠。',context.concealed],
  ['和绝张',4,'和牌张的另三张已在牌桌明示。',context.wall],
  ['箭刻',2,'白、發、中任一种的刻子/杠，每组单独计。'],
  ['圈风刻',2,'当前圈风的刻子/杠。',context.wind],
  ['门风刻',2,'当前自风的刻子/杠。',context.wind],
  ['门前清',2,'未吃碰明杠，最终以荣和完成。',context.method],
  ['平和',2,'四组顺子与数牌雀头；组合龙的余下面子为顺子且雀头为数牌时也可计。'],
  ['四归一',2,'同种牌恰有四张，分散在顺子、刻子或对子内，未声明为杠；每种计一次。'],
  ['双同刻',2,'两种花色有相同点数的刻子/杠。'],
  ['双暗刻',2,'两组暗刻，暗杠也算暗刻。',context.concealed],
  ['暗杠',2,'一个暗杠。',context.concealed],
  ['断幺',2,'全手只含二至八数牌。'],
  ['一般高',1,'两组完全相同的顺子。'],
  ['喜相逢',1,'两种花色各有同样起点的顺子。'],
  ['连六',1,'同花色两组顺子首尾相接，例如 123 与 456。'],
  ['老少副',1,'同花色的 123 与 789。'],
  ['幺九刻',1,'一、九数牌或风牌的刻子/杠，每组单独计。'],
  ['明杠',1,'一个明杠。',context.concealed],
  ['缺一门',1,'恰使用两种数牌花色，可含字牌。'],
  ['无字',1,'全手没有字牌。'],
  ['边张',1,'只听 123 的三或 789 的七，并以此和牌。',context.wait],
  ['坎张',1,'只听顺子中间的一张，并以此和牌。',context.wait],
  ['单钓将',1,'只听雀头需要的单张，并以此和牌。',context.wait],
  ['自摸',1,'以自己摸入的牌完成和牌。',context.method],
  ['花牌',1,'每张补出的花牌加一分。','本作牌库没有花牌，也没有补花流程。'],
];

const exclusions = {
  大四喜:['三风刻','碰碰和','幺九刻'], 大三元:['双箭刻','箭刻'],
  绿一色:['混一色','缺一门'], 九莲宝灯:['清一色','无字','缺一门','幺九刻'],
  四杠:['三杠','碰碰和'], 连七对:['七对','清一色','无字','缺一门'],
  十三幺:['混幺九','五门齐'], 清幺九:['混幺九','碰碰和','全带幺','幺九刻','无字'],
  小四喜:['三风刻','幺九刻'], 小三元:['双箭刻','箭刻'],
  字一色:['混幺九','碰碰和','全带幺','幺九刻','缺一门'],
  一色双龙会:['七对','清一色','平和','一般高','老少副','缺一门','无字'],
  一色四同顺:['一色三同顺','一般高','四归一'],
  一色四节高:['一色三节高','碰碰和'], 一色四步高:['一色三步高','连六','老少副'],
  混幺九:['碰碰和','全带幺','幺九刻'], 全双刻:['碰碰和','断幺','无字'],
  全大:['大于五','无字'], 全中:['断幺','无字'], 全小:['小于五','无字'],
  三色双龙会:['平和','喜相逢','老少副','无字'], 全带五:['断幺','无字'],
  大于五:['无字'], 小于五:['无字'], 推不倒:['缺一门'], 双箭刻:['箭刻'],
  清一色:['无字','缺一门'], 混一色:['缺一门'], 平和:['无字'], 断幺:['无字'],
};
export const MCR_CATALOG = Object.freeze(entries.map(([name,fan,condition,reason]) => Object.freeze({
  id:name, name, fan, condition, category:`${fan}番`, status:reason?'unavailable':'base',
  ...(reason?{reason}:{}), ...(exclusions[name]?{excludes:exclusions[name]}:{}),
})));
const byId = new Map(MCR_CATALOG.map(p => [p.id,p]));
const isTerminal = t => t < 27 && (rank(t) === 1 || rank(t) === 9);
const isOutside = t => t >= 27 || isTerminal(t);
const allEqual = xs => xs.every(x => x === xs[0]);
const distinct = xs => new Set(xs).size === xs.length;
const consecutive = (xs, step=1) => xs.slice().sort((a,b)=>a-b).every((x,i,a)=>!i || x === a[i-1]+step);
const sameSuit = xs => xs.every(x => x < 27 && suit(x) === suit(xs[0]));
const combinations = (xs,n) => n===0?[[]]:xs.flatMap((x,i)=>combinations(xs.slice(i+1),n-1).map(rest=>[x,...rest]));
const values = hits => hits.reduce((n,p)=>n+byId.get(p).fan,0);

function chowPair(a,b) {
  if (suit(a) !== suit(b)) return rank(a) === rank(b) ? '喜相逢' : null;
  if (a === b) return '一般高';
  if (Math.abs(a-b) === 3) return '连六';
  if (Math.abs(a-b) === 6) return '老少副';
  return null;
}
function chowTriple(ts) {
  const rs = ts.map(rank);
  if (sameSuit(ts)) {
    if (allEqual(ts)) return '一色三同顺';
    if (consecutive(ts,3)) return '清龙';
    if (consecutive(ts) || consecutive(ts,2)) return '一色三步高';
  } else if (distinct(ts.map(suit))) {
    if (allEqual(rs)) return '三色三同顺';
    if (consecutive(rs)) return '三色三步高';
    if (rs.slice().sort((a,b)=>a-b).join() === '1,4,7') return '花龙';
  }
  return null;
}
function pungPair(a,b) {
  if (a < 27 && b < 27 && suit(a) !== suit(b) && rank(a) === rank(b)) return '双同刻';
  if (a >= 31 && b >= 31 && a !== b) return '双箭刻';
  return null;
}
function pungTriple(ts) {
  if (ts.every(t=>t>=31) && distinct(ts)) return '大三元';
  if (ts.every(t=>t>=27 && t<31) && distinct(ts)) return '三风刻';
  if (sameSuit(ts) && consecutive(ts)) return '一色三节高';
  if (ts.every(t=>t<27) && distinct(ts.map(suit))) {
    if (allEqual(ts.map(rank))) return '三同刻';
    if (consecutive(ts.map(rank))) return '三色三节高';
  }
  return null;
}

// Each selected edge consumes one relationship. A forest enforces 套算一次:
// a fourth meld may add one edge, never close a cycle. Repeated fan names may
// not share a meld (不得相同). At most six edges exist, so enumerate exactly.
function bestPairRelationships(ts, relation) {
  const edges = combinations(ts.map((_,i)=>i),2).flatMap(([a,b])=>{
    const fan = relation(ts[a],ts[b]); return fan ? [{a,b,fan}] : [];
  });
  let best = [];
  for (let bits=1; bits<(1<<edges.length); bits++) {
    const parents = ts.map((_,i)=>i), used = new Map(), hits=[];
    const find = i => parents[i]===i?i:find(parents[i]);
    let valid=true;
    for (let i=0; i<edges.length && valid; i++) if(bits & (1<<i)) {
      const {a,b,fan}=edges[i], already=used.get(fan)||new Set();
      if (find(a)===find(b) || already.has(a) || already.has(b)) {valid=false;break;}
      parents[find(a)]=find(b); already.add(a);already.add(b);used.set(fan,already);hits.push(fan);
    }
    if (valid && values(hits)>values(best)) best=hits;
  }
  return best;
}
function meldRelationships(ts, kind) {
  const relation=kind==='chow'?chowPair:pungPair;
  const triple=kind==='chow'?chowTriple:pungTriple;
  if (ts.length===4) {
    if (kind==='chow' && sameSuit(ts)) {
      if (allEqual(ts)) return ['一色四同顺'];
      if (consecutive(ts)||consecutive(ts,2)) return ['一色四步高'];
    }
    if (kind==='pung') {
      if(ts.slice().sort((a,b)=>a-b).join()==='27,28,29,30')return ['大四喜'];
      if(sameSuit(ts)&&consecutive(ts))return ['一色四节高'];
    }
  }
  let best = bestPairRelationships(ts,relation);
  for (const indices of combinations(ts.map((_,i)=>i),3)) {
    const fan=triple(indices.map(i=>ts[i])); if(!fan)continue;
    const free=ts.findIndex((_,i)=>!indices.includes(i));
    const extras=free<0?[]:indices.map(i=>relation(ts[i],ts[free])).filter(Boolean);
    const extra=extras.sort((a,b)=>byId.get(b).fan-byId.get(a).fan)[0];
    const hits=extra?[fan,extra]:[fan];
    if(values(hits)>values(best))best=hits;
  }
  return best;
}

export function mcrPatterns(groups, pair, shape='normal') {
  const all=groups.flat().concat(pair);
  if(!all.length || !all.every(t=>Number.isInteger(t)&&t>=0&&t<34))return [];
  const normal=shape==='normal', seven=shape==='pairs', knitted=shape==='knitted';
  if(normal&&(groups.length!==4||pair.length!==2))return [];
  if(seven&&(groups.length!==7||groups.some(g=>g.length!==2||g[0]!==g[1])))return [];
  const totals=new Map(), hit=(name,n=1)=>{if(n>0)totals.set(name,(totals.get(name)||0)+n);};
  const result=()=>[...totals].filter(([,n])=>n>0).map(([id,n])=>{
    const p=byId.get(id);return {id,name:n>1?`${p.name} ×${n}`:p.name,fan:p.fan*n,tier:p.fan>=64?2:p.fan>=24?1:0,...(n>1?{count:n}:{} )};
  }).sort((a,b)=>b.fan-a.fan||MCR_CATALOG.findIndex(p=>p.id===a.id)-MCR_CATALOG.findIndex(p=>p.id===b.id));
  const counts=Array(34).fill(0);all.forEach(t=>counts[t]++);
  const nums=all.filter(t=>t<27), suits=new Set(nums.map(suit)), honors=all.some(t=>t>=27);
  if(shape==='orphans') {hit('十三幺');return result();}
  if(shape==='unconnected') {
    hit(all.filter(t=>t>=27).length===7?'七星不靠':'全不靠');
    if(nums.length===9)hit('组合龙');
    return result();
  }
  const chows=groups.filter(g=>groupType(g)==='chow').map(g=>Math.min(...g));
  const pungs=groups.filter(g=>['pung','kong'].includes(groupType(g))).map(g=>g[0]);
  const kongs=groups.filter(g=>groupType(g)==='kong').map(g=>g[0]);
  const terminalPungs=pungs.filter(t=>isTerminal(t)||(t>=27&&t<31));
  const dragons=pungs.filter(t=>t>=31), winds=pungs.filter(t=>t>=27&&t<31);
  const dragonFaces=new Set(dragons), windFaces=new Set(winds);
  if(seven) {
    if(suits.size===1&&!honors&&consecutive(groups.map(g=>g[0]))) {
      hit('连七对');if(all.every(t=>rank(t)>1&&rank(t)<9))hit('断幺');return result();
    }
    hit('七对');
  } else if(normal||knitted) {
    if(knitted)hit('组合龙');
    const allChows=(normal&&chows.length===4)||(knitted&&chows.length===1);
    if(allChows&&pair[0]<27)hit('平和');
    if(normal&&pungs.length===4)hit('碰碰和');
    if(kongs.length===4)hit('四杠');else if(kongs.length===3)hit('三杠');
    if(normal&&chows.length===4&&rank(pair[0])===5) {
      const cs=new Set(chows.map(suit));
      if(cs.size===1&&suit(chows[0])===suit(pair[0])&&chows.filter(t=>rank(t)===1).length===2&&chows.filter(t=>rank(t)===7).length===2)hit('一色双龙会');
      else if(cs.size===2&&!cs.has(suit(pair[0]))&&[...cs].every(s=>chows.some(t=>suit(t)===s&&rank(t)===1)&&chows.some(t=>suit(t)===s&&rank(t)===7)))hit('三色双龙会');
    }
    if(!totals.has('一色双龙会')&&!totals.has('三色双龙会'))meldRelationships(chows,'chow').forEach(x=>hit(x));
    meldRelationships(pungs,'pung').forEach(x=>hit(x));
    if(windFaces.size===3&&pair[0]>=27&&pair[0]<31&&!windFaces.has(pair[0]))hit('小四喜');
    if(dragonFaces.size===2&&pair[0]>=31&&!dragonFaces.has(pair[0]))hit('小三元');
    hit('箭刻',dragons.length);hit('幺九刻',terminalPungs.length);
    if(normal) {
      const packs=[...groups,pair];
      if(packs.every(g=>g.some(isOutside)))hit('全带幺');
      if(packs.every(g=>g.some(t=>t<27&&rank(t)===5)))hit('全带五');
      if(pungs.length===4&&all.every(t=>t<27&&rank(t)%2===0))hit('全双刻');
      if(kongs.length===0&&!honors&&suits.size===1&&all.length===14) {
        const start=Math.floor(all[0]/9)*9, need=[3,1,1,1,1,1,1,1,3];
        if(need.every((n,i)=>counts[start+i]>=n))hit('九莲宝灯');
      }
    }
  } else return [];
  if(suits.size===1)hit(honors?'混一色':'清一色');
  if(suits.size===2)hit('缺一门');
  if(!honors)hit('无字');
  if(suits.size===3&&all.some(t=>t>=27&&t<31)&&all.some(t=>t>=31))hit('五门齐');
  if(all.every(t=>t<27&&rank(t)>1&&rank(t)<9))hit('断幺');
  const green=new Set([19,20,21,23,25,32]);
  const reversible=new Set([9,10,11,12,13,16,17,19,21,22,23,25,26,31]);
  if(all.every(t=>green.has(t)))hit('绿一色');
  if(all.every(t=>reversible.has(t)))hit('推不倒');
  if(!nums.length)hit('字一色');
  else if(all.every(isTerminal))hit('清幺九');
  else if(all.every(isOutside))hit('混幺九');
  if(!honors) {
    if(all.every(t=>rank(t)>=7))hit('全大');
    else if(all.every(t=>rank(t)>=6))hit('大于五');
    if(all.every(t=>rank(t)<=3))hit('全小');
    else if(all.every(t=>rank(t)<=4))hit('小于五');
    if(all.every(t=>rank(t)>=4&&rank(t)<=6))hit('全中');
  }
  hit('四归一',counts.filter((n,t)=>n===4&&!kongs.includes(t)).length);
  if(totals.has('三风刻'))totals.set('幺九刻',Math.max(0,(totals.get('幺九刻')||0)-3));
  for(const name of [...totals.keys()])for(const lower of exclusions[name]||[])totals.delete(lower);
  if(![...totals.values()].some(n=>n>0))hit('无番和');
  return result();
}
