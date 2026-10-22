import {createSettlementAudio} from './audio.js';

const EVENTS=new Set(['hand_reveal','tile_score','pattern_reveal','relic_trigger','multiplier_update','hand_total','round_result','false_hu','no_yaku','incomplete']);
const WEIGHTS={hand_reveal:.8,tile_score:.55,pattern_reveal:.8,relic_trigger:.65,multiplier_update:.65,hand_total:1.05,round_result:.85,false_hu:1,no_yaku:1,incomplete:1};
const TITLES={hand_reveal:'和牌成立',tile_score:'牌面底分',pattern_reveal:'番型揭示',relic_trigger:'奇物联动',multiplier_update:'倍率汇聚',hand_total:'一手成山',round_result:'关卡结算',false_hu:'诈胡 · 扣分',no_yaku:'无役 · 0分',incomplete:'未完成 · 扣分'};
const CHECK_RESULTS={
  false_hu:{label:'诈胡',seal:'失',detail:'无法和牌 · 本次罚分',caption:'结构位置已满 · 检查结果',penalty:true},
  no_yaku:{label:'无役',seal:'零',detail:'结构成立 · 本次不得分',caption:'结构成立 · 未满足役种',penalty:false},
  incomplete:{label:'未完成',seal:'未',detail:'牌山与候选耗尽 · 未满14结构位置',caption:'未满14结构位置 · 资源耗尽',penalty:true},
};
const presentationText=(s,key,fallback)=>typeof s?.presentation?.[key]==='string'?s.presentation[key]:fallback;
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=String(text);return el;};
const text=(x,fallback='—')=>x===undefined||x===null?fallback:String(x);
const tier=x=>Math.max(0,Math.min(2,Number.isFinite(x)?x:0));
const asset=src=>new URL(src,import.meta.url).href;
function picture(src,label,cls){
  const holder=make('span',cls),img=make('img');img.alt=label;img.draggable=false;
  const fallback=make('span','jr-image-fallback',label);fallback.hidden=true;
  img.addEventListener('error',()=>{img.hidden=true;fallback.hidden=false;},{once:true});
  if(src)img.src=src;else{img.hidden=true;fallback.hidden=false;}
  holder.append(img,fallback);return holder;
}
export function validateSnapshot(s){
  if(!s||!['agari','false_hu','no_yaku','incomplete'].includes(s.handResult)||!Array.isArray(s.hand?.tiles)||!Array.isArray(s.steps)||!s.totals)throw new Error('快照缺少手牌、步骤或最终结果');
  if(typeof s.totals.passed!=='boolean')throw new Error('快照缺少权威过关结果');
  const ids=new Set(s.hand.tiles.map(t=>t.id));
  if(ids.size!==s.hand.tiles.length)throw new Error('牌实例 ID 重复');
  const grouped=(s.hand.decomposition||[]).flatMap(g=>g.tileIds);
  if(['agari','no_yaku'].includes(s.handResult)&&(grouped.length!==ids.size||new Set(grouped).size!==ids.size||grouped.some(id=>!ids.has(id))))throw new Error('最终拆分未完整覆盖实牌');
  if(s.handResult!=='agari'&&s.steps.map(e=>e.event).join(',')!==`hand_reveal,${s.handResult},round_result`)throw new Error('检查快照缺少对应检查、结果与关卡结算顺序');
  const allIds=new Set([...s.hand.tiles,...(s.hand.heldTiles||[])].map(t=>t.id));
  if(allIds.size!==s.hand.tiles.length+(s.hand.heldTiles||[]).length)throw new Error('实牌和留牌实例 ID 重复');
  if(s.steps.some(e=>!EVENTS.has(e.event)||(e.tileIds||[]).some(id=>!allIds.has(id))))throw new Error('步骤事件或牌实例无效');
  for(const field of ['baseText','multiplierText','handScoreText','processScoreText','penaltyText','roundScoreText','runScoreBeforeText','runScoreText','targetText'])if(typeof s.totals[field]!=='string')throw new Error('最终数字必须为格式化文本：'+field);
  return true;
}
export class SettlementPlayer{
  constructor(root,{audio,tileUrl,relicUrl}={}){
    if(!root)throw new Error('需要播放器容器');
    this.root=root;this.audio=audio||createSettlementAudio();this.ownsAudio=!audio;
    this.tileUrl=tileUrl||(t=>asset('../art/tiles/'+t.face+'.svg'));
    this.relicUrl=relicUrl||(r=>asset(r.imageUrl));
    this.frame=0;this.running=false;this.destroyed=false;this.clock=0;this.index=-1;this.finish=null;this.generation=0;this.completionDelivered=true;
    this.tiles=new Map();this.patternNodes=new Map();this.relicNodes=new Map();this.options={muted:true,speed:1,reducedMotion:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false};
  }
  async unlockAudio(){return this.audio.unlock();}
  setMuted(value){this.options.muted=!!value;this.audio.setMuted(!!value);}
  setSpeed(value){this.options.speed=Math.max(.5,Math.min(4,Number(value)||1));}
  setPaused(value){this.options.paused=!!value;}
  setReducedMotion(value){
    this.options.reducedMotion=!!value;this.root.classList.toggle('jr-reduced',!!value);
    if(value)this.clearEffects();
  }
  cancel(status='replaced'){
    this.generation++;
    cancelAnimationFrame(this.frame);this.frame=0;this.running=false;this.audio.stopAll();this.clearEffects();
    if(this.finish){this.finish({status,settlementId:this.snapshot?.settlementId});this.finish=null;}
  }
  dispose(){if(this.destroyed)return;this.cancel('disposed');if(this.ownsAudio)this.audio.dispose();this.root.replaceChildren();this.root.className='';this.destroyed=true;}
  play(snapshot,options={}){
    if(this.destroyed)return Promise.resolve({status:'disposed'});
    this.cancel();this.options={...this.options,...options};this.setSpeed(this.options.speed);this.setMuted(this.options.muted);
    this.snapshot=snapshot;this.completionDelivered=false;
    this.clock=0;this.index=-1;this.cutInUsed=false;
    try{this.snapshot=typeof structuredClone==='function'?structuredClone(snapshot):JSON.parse(JSON.stringify(snapshot));validateSnapshot(this.snapshot);this.build();}
    catch(error){this.buildFallback(error);return this.complete('fallback');}
    this.setReducedMotion(this.options.reducedMotion);
    const tiers=this.snapshot.tiers||{},enhanced=Math.max(tier(tiers.scoreTier),tier(tiers.multiplierTier),tier(tiers.patternTier))>0;
    const budget=Math.max(1,Number(options.durationMs)||(this.snapshot.handResult!=='agari'?1800:enhanced?6800:4400));
    const weights=this.snapshot.steps.map(s=>WEIGHTS[s.event]);const total=weights.reduce((a,b)=>a+b,0)||1;
    let start=0;this.timeline=weights.map(w=>{const row={at:start,duration:budget*w/total};start+=row.duration;return row;});this.duration=start;
    this.configureTimeline?.();
    this.running=true;this.previous=performance.now();
    const promise=new Promise(resolve=>{this.finish=resolve;});
    const generation=this.generation;
    const tick=now=>{
      if(!this.running||generation!==this.generation)return;
      this.clock+=this.options.paused?0:(now-this.previous)*this.options.speed;this.previous=now;
      let target=this.index;while(target+1<this.timeline.length&&this.timeline[target+1].at<=this.clock)target++;
      try{for(let i=this.index+1;i<=target;i++){this.applyStep(this.snapshot.steps[i],i,i===target);if(!this.running||generation!==this.generation)return;this.index=i;}
        this.progress.style.width=Math.min(100,this.clock/this.duration*100)+'%';
        this.renderFrame?.(this.clock);
        if(this.clock>=this.duration){this.showFinal();this.complete('completed');return;}
      }catch(error){this.showFinal();this.notice.textContent='演出已简化，最终结果保持不变。';this.complete('fallback');return;}
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);return promise;
  }
  complete(status){
    const result={status,settlementId:this.snapshot?.settlementId};
    if(this.completionDelivered)return Promise.resolve(result);
    this.completionDelivered=true;
    this.running=false;cancelAnimationFrame(this.frame);this.frame=0;
    if(status!=='completed')this.audio.stopAll();
    if(this.finish){this.finish(result);this.finish=null;}
    if(['completed','skipped','fallback'].includes(status)){try{this.options.onComplete?.(result);}catch{}}
    return Promise.resolve(result);
  }
  skip(){if(!this.running||!this.snapshot||this.destroyed||this.completionDelivered)return;cancelAnimationFrame(this.frame);this.audio.stopAll();this.clearEffects();this.showFinal();if(this.notice)this.notice.textContent='已跳至完整结算';this.complete('skipped');}
  build(){
    const s=this.snapshot;this.root.replaceChildren();this.root.className='jr-settlement';this.tiles.clear();this.patternNodes.clear();this.relicNodes.clear();
    const check=CHECK_RESULTS[s.handResult],ungrouped=['false_hu','incomplete'].includes(s.handResult);this.root.classList.toggle('jr-false-hu',s.handResult==='false_hu');this.root.classList.toggle('jr-incomplete',s.handResult==='incomplete');this.root.classList.toggle('jr-check-result',!!check);this.root.classList.toggle('jr-long-values',s.totals.baseText.length>12);this.root.style.setProperty('--base-ch',String(s.totals.baseText.length));this.root.style.setProperty('--score-ch',String(Math.max(3,(check?.penalty?s.totals.penaltyText:s.totals.handScoreText).length)));
    this.root.dataset.scoreTier=check?0:tier(s.tiers?.scoreTier);this.root.dataset.multiplierTier=check?0:tier(s.tiers?.multiplierTier);this.root.dataset.patternTier=check?0:tier(s.tiers?.patternTier);
    const header=make('div','jr-stage-heading');this.phase=make('span','jr-phase','等待揭示');
    header.append(make('span','jr-mode',s.mode==='riichi'?'日麻役种':'国标番型'),this.phase);this.root.append(header);
    this.scene=make('div','jr-scene');this.root.append(this.scene);
    this.seal=make('div','jr-win-seal',check?'检':'和');this.seal.setAttribute('aria-hidden','true');this.scene.append(this.seal);
    this.patternHero=make('div','jr-pattern-hero');this.heroLabel=make('strong','',check?'牌面检查':'和牌');this.heroValue=make('span','',check?check.caption:'一手入境');
    this.patternHero.append(this.heroLabel,this.heroValue);this.scene.append(this.patternHero);
    const handHeader=make('div','jr-hand-caption');
    const kongCount=s.hand.declaredKongs?.length||0;
    handHeader.append(make('span','',check?check.caption:'成型 14 / 14'),make('span','',kongCount+' 杠 · 实牌 '+s.hand.tiles.length+' 张'));
    this.scene.append(handHeader);
    const hand=make('div','jr-hand');hand.setAttribute('aria-label',check?'本次检查的实牌':'最终和牌拆分');
    const tileById=new Map(s.hand.tiles.map(t=>[t.id,t]));
    const groups=ungrouped?s.hand.tiles.map(t=>({type:'ungrouped',tileIds:[t.id]})):s.hand.decomposition;
    for(const group of groups){
      const wrap=make('div','jr-group');wrap.dataset.type=group.type;
      const row=make('div','jr-group-tiles');
      for(const id of group.tileIds){
        const t=tileById.get(id),node=picture(this.tileUrl(t),t.label,'jr-tile');
        node.dataset.tileId=id;node.title=t.label;
        if(t.wildcard){node.classList.add('jr-wild');node.append(make('b','jr-wild-mark','定'));}
        this.tiles.set(id,node);row.append(node);
      }
      const caption=make('span','jr-group-label',group.label||({sequence:'顺子',triplet:'刻子',kong:'杠',pair:'雀头',ungrouped:''}[group.type]));caption.title=group.label||'';
      if(group.description)caption.append(make('small','jr-group-description',group.description));
      wrap.append(row,caption);hand.append(wrap);
    }
    this.scene.append(hand);
    this.assignment=make('div','jr-assignment');
    for(const a of s.hand.wildcardAssignments||[])this.assignment.append(make('span','','万能定色 · '+a.label));
    this.scene.append(this.assignment);
    this.formula=make('div','jr-formula');this.base=make('strong','','0');this.multiplier=make('strong','','1');
    const baseBox=make('div','jr-base-box');baseBox.append(make('span','',presentationText(s,'baseLabel','完整牌底分')),this.base);
    const multiBox=make('div','jr-multi-box');multiBox.append(make('span','',presentationText(s,'multiplierLabel','最终倍率')),this.multiplier);
    this.formula.append(baseBox,make('span','jr-times','×'),multiBox);this.scene.append(this.formula);
    this.formula.hidden=!!check;
    this.operation=make('div','jr-operation',check?'检查牌面与本关结果':presentationText(s,'formulaNote','牌面、番型与奇物，将汇入这一手。'));this.scene.append(this.operation);
    this.scoreWrap=make('div','jr-score-wrap');this.scoreWrap.append(make('span','jr-score-label',check?(check.penalty?'本次罚分':'本次得分'):'本次和牌'));
    this.score=make('strong','jr-hand-score','—');this.score.style.setProperty('--score-size',Math.min(76,630/Math.max(8,s.totals.handScoreText.length))+'px');
    this.scoreWrap.append(this.score);this.scene.append(this.scoreWrap);
    this.patternList=make('div','jr-pattern-list');
    for(const p of check?[]:s.patterns||[]){const chip=make('span','jr-pattern-chip');chip.dataset.tier=tier(p.tier);chip.append(make('b','',p.label),make('span','',p.valueText));this.patternNodes.set(p.id,chip);this.patternList.append(chip);}
    this.scene.append(this.patternList);
    this.relicList=make('div','jr-relic-list');
    for(const r of check?[]:s.relics||[]){const el=make('div','jr-relic');el.dataset.relicId=r.id;el.append(picture(this.relicUrl(r),r.label,'jr-relic-art'),make('span','',r.label));this.relicNodes.set(r.id,el);this.relicList.append(el);}
    this.scene.append(this.relicList);
    this.result=make('div','jr-result');this.result.hidden=true;
    const resultTop=make('div','jr-result-top');this.resultLabel=make('strong');this.round=make('strong','jr-round-score');
    resultTop.append(this.resultLabel,this.round);this.result.append(resultTop);
    this.sum=make('p','jr-sum');this.result.append(this.sum);
    const meter=make('div','jr-target-meter');this.targetBar=make('i');meter.append(this.targetBar);this.result.append(meter);
    this.targetLabel=make('span','jr-target-label');this.result.append(this.targetLabel);this.scene.append(this.result);
    this.notice=make('div','jr-notice','');this.notice.setAttribute('role','status');this.notice.setAttribute('aria-live','polite');this.root.append(this.notice);
    const track=make('div','jr-progress');this.progress=make('i');track.append(this.progress);this.root.append(track);
    const details=make('details','jr-details');details.append(make('summary','','展开完整结算明细'));
    this.ledger=make('ol','jr-ledger');
    for(const step of s.steps){const row=make('li');row.dataset.stepId=step.id;row.append(make('span','',this.stepLabel(step)),make('strong','',this.stepValue(step)));this.ledger.append(row);}
    details.append(this.ledger);this.root.append(details);
    this.connection=document.createElementNS('http://www.w3.org/2000/svg','svg');this.connection.classList.add('jr-connection');this.connection.setAttribute('aria-hidden','true');this.root.append(this.connection);
    this.particles=make('div','jr-particles');this.particles.setAttribute('aria-hidden','true');this.root.append(this.particles);
  }
  patternCaption(pattern){return this.snapshot.mode==='riichi'&&pattern.classification==='yakuman'?(pattern.valueText.includes('役满')?pattern.valueText:'役满 · '+pattern.valueText):pattern.valueText;}
  stepLabel(step){
    const p=this.snapshot.patterns?.find(p=>p.id===step.sourceId),r=this.snapshot.relics?.find(r=>r.id===step.relicId);
    return p?p.label:r?r.label:step.label||this.eventTitle(step.event)||step.event;
  }
  eventTitle(event){return event==='tile_score'?presentationText(this.snapshot,'baseLabel',TITLES[event]):event==='multiplier_update'?presentationText(this.snapshot,'multiplierLabel',TITLES[event]):TITLES[event];}
  stepValue(step){
    if(CHECK_RESULTS[step.event])return CHECK_RESULTS[step.event].penalty?'−'+this.snapshot.totals.penaltyText:this.snapshot.totals.handScoreText;
    if(step.event==='hand_total')return this.snapshot.totals.handScoreText;
    if(step.event==='round_result')return this.snapshot.totals.runScoreText;
    const prefix=step.operation==='multiply'?'×':step.operation==='add'?'+':'';
    const unit=step.target==='base'?presentationText(this.snapshot,'baseLabel','底分'):step.target==='multiplier'?presentationText(this.snapshot,'multiplierLabel','倍率'):'';
    return (step.deltaText&&step.operation!=='set'?prefix+step.deltaText+' → ':'')+unit+' '+(step.afterText||'');
  }
  animate(el,keyframes,options){
    if(this.options.reducedMotion||!el?.animate)return;
    el.animate(keyframes,{...options,duration:(options.duration||450)/this.options.speed});
  }
  applyStep(step,index,audible){
    this.clearHighlights();this.root.dataset.event=step.event;this.phase.textContent=this.eventTitle(step.event);this.notice.textContent='';
    this.ledger.children[index]?.classList.add('is-seen');
    for(const id of step.tileIds||[])this.tiles.get(id)?.classList.add('is-lit');
    if(step.target==='base'&&step.afterText!==undefined)this.base.textContent=step.afterText;
    if(step.target==='multiplier'&&step.afterText!==undefined)this.multiplier.textContent=step.afterText;
    this.operation.textContent=this.stepLabel(step)+(step.deltaText&&step.operation!=='set'?' · '+this.stepValue(step):'');
    let soundTier=0;
    if(step.event==='hand_reveal'){
      if(this.snapshot.handResult!=='agari')this.phase.textContent='牌面检查';
      this.root.classList.add('jr-revealed');this.animate(this.seal,[{opacity:0,transform:'scale(1.15)'},{opacity:1,transform:'scale(1)'}],{duration:600});
    }
    if(CHECK_RESULTS[step.event])this.renderCheckResult();
    if(step.event==='tile_score')this.animate(this.base,[{opacity:.4,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:280});
    if(step.event==='pattern_reveal'){
      const pattern=this.snapshot.patterns?.find(p=>p.id===step.sourceId),chip=this.patternNodes.get(step.sourceId);chip?.classList.add('is-seen','is-active');
      soundTier=tier(this.snapshot.tiers?.patternTier);
      if(pattern&&soundTier>0&&!this.cutInUsed&&tier(pattern.tier)>0){
        this.cutInUsed=true;this.heroLabel.textContent=pattern.label;
        this.heroValue.textContent=this.patternCaption(pattern);
        this.patternHero.classList.add('is-emphasis');this.animate(this.patternHero,[{opacity:.3,transform:'translateY(10px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:550});
      }
    }
    if(step.event==='relic_trigger'){
      const relic=this.relicNodes.get(step.relicId);relic?.classList.add('is-active');
      if(relic){this.drawLink(relic,step.target==='base'?this.base:this.multiplier);this.animate(relic,[{transform:'translateY(0)'},{transform:'translateY(-7px)'},{transform:'translateY(0)'}],{duration:450});}
      soundTier=tier(step.emphasis||this.snapshot.tiers?.multiplierTier);
    }
    if(step.event==='multiplier_update'){
      soundTier=tier(this.snapshot.tiers?.multiplierTier);this.formula.dataset.charge=soundTier;this.animate(this.multiplier,[{transform:'scale(.92)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],{duration:500});
    }
    if(step.event==='hand_total'){
      soundTier=tier(this.snapshot.tiers?.scoreTier);this.score.textContent=this.snapshot.totals.handScoreText;this.scoreWrap.classList.add('is-landed');
      this.animate(this.score,[{opacity:.2,transform:'translateY(10px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1.04)'},{opacity:1,transform:'scale(1)'}],{duration:600});
      if(soundTier>0)this.burst(soundTier);
    }
    if(step.event==='round_result')this.renderResult();
    if(audible){
      const check=this.snapshot.handResult!=='agari';
      const name=check?(step.event==='false_hu'?'false_hu':'hand_check'):step.event==='round_result'?(this.snapshot.totals.passed?'round_pass':'round_fail'):step.event;
      this.audio.play(name,{tier:check?0:soundTier,speed:this.options.speed});
    }
    try{this.options.onStep?.({id:step.id,event:step.event,index});}catch{}
  }
  drawLink(from,to){
    if(this.options.reducedMotion)return;
    const bounds=this.root.getBoundingClientRect(),a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
    const x1=a.left+a.width/2-bounds.left,y1=a.top-bounds.top,x2=b.left+b.width/2-bounds.left,y2=b.bottom-bounds.top;
    const line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('d','M '+x1+' '+y1+' Q '+x1+' '+(y2+30)+' '+x2+' '+y2);line.setAttribute('fill','none');line.setAttribute('stroke','#dcba79');line.setAttribute('stroke-width','1.5');line.setAttribute('stroke-dasharray','4 7');this.connection.replaceChildren(line);
    this.animate(this.connection,[{opacity:0},{opacity:.65},{opacity:0}],{duration:560,fill:'forwards'});
  }
  burst(level){
    if(this.options.reducedMotion)return;
    this.particles.replaceChildren();const n=level===2?20:10;
    for(let i=0;i<n;i++){
      const dot=make('i'),angle=(i/n)*Math.PI*2,x=Math.cos(angle)*(80+level*20),y=Math.sin(angle)*70;
      dot.style.left='50%';dot.style.top='56%';this.particles.append(dot);
      this.animate(dot,[{opacity:0,transform:'translate(0,0) scale(.4)'},{opacity:.7,offset:.2},{opacity:0,transform:'translate('+x+'px,'+y+'px) scale(.2)'}],{duration:700,fill:'forwards'});
    }
  }
  clearHighlights(){for(const node of this.tiles.values())node.classList.remove('is-lit');for(const node of this.relicNodes.values())node.classList.remove('is-active');for(const node of this.patternNodes.values())node.classList.remove('is-active');this.connection?.replaceChildren();}
  clearEffects(){this.root.getAnimations?.({subtree:true}).forEach(a=>a.cancel());this.particles?.replaceChildren();this.connection?.replaceChildren();}
  renderResult(){
    const t=this.snapshot.totals,check=CHECK_RESULTS[this.snapshot.handResult],passed=!!t.passed;this.result.hidden=false;this.result.dataset.passed=String(passed);
    this.resultLabel.textContent=check?(passed?'仍然达标 · 过关':'未达标 · 本关失败'):passed?'越过这一重山':'本关未达标';this.round.textContent=t.runScoreText;
    this.sum.textContent='累计 '+t.runScoreBeforeText+(check?.penalty?' − 罚分 '+t.penaltyText:check?' ＋ 本次得分 '+t.handScoreText:' ＋ 和牌分 '+t.handScoreText)+' = '+t.runScoreText+' · 本关净贡献 '+t.roundScoreText;
    const ratio=Number.isFinite(t.progressRatio)?Math.max(0,Math.min(1,t.progressRatio)):0;
    this.targetBar.style.width=ratio*100+'%';this.targetLabel.textContent='挑战累计 / 本关门槛 '+t.targetText;
  }
  showFinal(){
    if(!this.scene)return;
    this.clearEffects();this.clearHighlights();this.root.classList.add('jr-revealed','jr-finished');this.root.dataset.event='round_result';
    this.base.textContent=this.snapshot.totals.baseText;this.multiplier.textContent=this.snapshot.totals.multiplierText;this.score.textContent=this.snapshot.totals.handScoreText;
    this.scoreWrap.classList.add('is-landed');for(const node of this.patternNodes.values())node.classList.add('is-seen');
    this.formula.dataset.charge=this.snapshot.handResult==='agari'?tier(this.snapshot.tiers?.multiplierTier):0;
    const pattern=this.snapshot.patterns?.find(p=>tier(p.tier)>0);
    if(this.snapshot.handResult==='agari'&&pattern&&tier(this.snapshot.tiers?.patternTier)>0){this.heroLabel.textContent=pattern.label;this.heroValue.textContent=this.patternCaption(pattern);this.patternHero.classList.add('is-emphasis');}
    for(const node of this.ledger.children)node.classList.add('is-seen');this.progress.style.width='100%';this.phase.textContent='结算完成';
    this.operation.textContent=presentationText(this.snapshot,'formulaNote','底分 × 最终倍率，向下取整得和牌分');this.renderResult();
    if(CHECK_RESULTS[this.snapshot.handResult])this.renderCheckResult();
  }
  renderCheckResult(){
    const check=CHECK_RESULTS[this.snapshot.handResult];
    this.seal.textContent=check.seal;this.heroLabel.textContent=check.label;this.heroValue.textContent=check.detail;this.score.textContent=check.penalty?'−'+this.snapshot.totals.penaltyText:this.snapshot.totals.handScoreText;this.scoreWrap.classList.add('is-landed');
    this.operation.textContent='累计 '+this.snapshot.totals.runScoreBeforeText+' → '+this.snapshot.totals.runScoreText;this.phase.textContent=this.result.hidden?TITLES[this.snapshot.handResult]:'结算完成';
  }
  buildFallback(error){
    this.root.replaceChildren();this.root.className='jr-settlement jr-fallback';this.scene=null;
    const check=CHECK_RESULTS[this.snapshot?.handResult];
    this.root.append(make('h2','',check?check.label+'结算':'结算结果'),make('p','','演出数据暂不可用，以下为主逻辑提供的最终结果。'));
    const t=this.snapshot?.totals||{};
    for(const [labelKey,valueKey] of [['baseLabel','baseText'],['multiplierLabel','multiplierText']])if(typeof this.snapshot?.presentation?.[labelKey]==='string'){const row=make('p','jr-fallback-row');row.append(make('span','',this.snapshot.presentation[labelKey]),make('strong','',text(t[valueKey])));this.root.append(row);}
    if(typeof this.snapshot?.presentation?.formulaNote==='string')this.root.append(make('p','',this.snapshot.presentation.formulaNote));
    for(const [label,key] of [[check?'本次得分':'和牌分','handScoreText'],['过程分','processScoreText'],['本次罚分','penaltyText'],['本关净贡献','roundScoreText'],['挑战累计','runScoreText'],['累计门槛','targetText']]){
      const row=make('p','jr-fallback-row');row.append(make('span','',label),make('strong','',text(t[key])));this.root.append(row);
    }
    this.root.append(make('p','',typeof t.passed==='boolean'?(t.passed?'已达标':'未达标'):'结果状态暂不可用'));this.audio.stopAll();
  }
}

export function renderFormationStatus(root,state,{tileElements=[]}={}){
  const statuses={pending:{icon:'○',label:'待补牌'},exchange:{icon:'↔',label:'需要换牌'},blocked:{icon:'◇',label:'无法直接和牌'},unknown:{icon:'…',label:'暂无法完整评估'}};
  const item=statuses[state.status]||statuses.unknown;root.replaceChildren();root.className='jr-risk';root.dataset.status=state.status;
  root.setAttribute('role','status');root.setAttribute('aria-live','polite');
  root.append(make('span','jr-risk-icon',item.icon));const body=make('div');body.append(make('strong','',state.label||item.label),make('p','',state.detail||''));root.append(body);
  for(const el of tileElements){el.classList.toggle('jr-risk-tile',(state.tileIds||[]).includes(el.dataset.tileId));}
}
