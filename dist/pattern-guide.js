import { PATTERN_CATALOG, PATTERN_RELIC_NAMES } from './pattern-catalog.js';
import { BALANCE } from './balance.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const modes = { mcr: '国标番型', riichi: '日麻役种' };
const filters = { all: '全部', base: '基础可用', unavailable: '当前不适用' };
const statusOrder = { base: 0, relic: 1, unavailable: 2 };
const basicTerms = [
  ['数牌／花色', '带 1～9 点数的万、筒、条；条也叫索。点数相同、花色不同也是不同牌，例如三万与三筒。'],
  ['字牌', '东、南、西、北是风牌；白、發、中是箭牌，也叫三元牌。字牌没有点数，不能组成顺子。'],
  ['顺子', '同花色的三张连续数牌，例如二万＋三万＋四万；一万＋二筒＋三条不算。'],
  ['刻子', '三张完全相同的牌，例如三张五筒，或三张东。'],
  ['杠', '四张完全相同的牌，并执行“声明杠”。在和牌结构中按一个三张面子计算，实际仍有四张牌。'],
  ['对子／雀头', '对子是两张完全相同的牌，例如两张南；普通和牌中配合四组面子的那一对叫雀头，也叫将。'],
  ['面子', '顺子、刻子或已声明杠的统称。普通和牌需要“四组面子＋一对雀头”；七对、十三幺等特殊牌型另算。'],
  ['幺九牌', '一、九数牌与所有字牌的合称；若写“一九数牌”，则不包含字牌。'],
];
// Extra terms stay beside the conditions that use them. Explanations are visible
// on touch screens and do not change the catalogue or its scoring rules.
const conditionTerms = [
  [/门清|门前清|鸣牌|吃碰/, '门清＝没有吃、碰或明杠；吃／碰是用他人弃牌凑顺子／刻子，鸣牌是这类公开取牌操作的统称。'],
  [/暗刻|暗杠|明杠/, '暗刻＝自己摸齐的三张同牌；暗杠＝自己摸齐四张后开杠。明杠使用他人弃牌，或在碰出的刻子上补第四张。'],
  [/自摸|荣和/, '自摸＝用自己摸到的牌和牌；荣和＝用他人的弃牌和牌。'],
  [/听牌|听张|只听|待牌|两面待|单骑|单钓|九面|十三面/, '听牌＝只差一张即可和牌；单骑／单钓＝等待雀头的另一张；两面待如二三万等一万或四万。'],
  [/圈风|场风|自风|门风|座位风/, '圈风／场风＝当前一圈的风位；自风／门风＝玩家座位的风位，均为东、南、西、北之一。'],
  [/组合龙/, '组合龙＝三种花色分别取 147、258、369，例如一四七万＋二五八筒＋三六九条。'],
  [/赤五/, '赤五＝带特殊标记的五万、五筒或五条。'],
  [/立直/, '立直＝传统日麻中，门清听牌后宣告锁定手牌的操作。'],
  [/巡/, '一巡＝各家依次进行一次摸牌、出牌的轮次。'],
];
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
const options = ({ mode = 'mcr', filter = 'all', query = '', relics = [] } = {}) => ({
  mode: Object.hasOwn(modes, mode) ? mode : 'mcr',
  filter: Object.hasOwn(filters, filter) ? filter : 'all',
  query: String(query ?? ''),
  relics: new Set(Array.isArray(relics) ? relics : relics instanceof Set ? [...relics] : []),
});

function valueLabel(pattern, mode) {
  if (pattern.valueText) return pattern.valueText;
  if (pattern.category === '双倍役满') return '双倍役满';
  if (pattern.classification === 'yakuman') return '役满';
  return `${pattern.fan} ${mode === 'mcr' ? '番' : '翻'}`;
}

function renderCard(pattern, mode, relics) {
  const owned = pattern.status === 'relic' && relics.has(pattern.relicId);
  const status = pattern.status === 'base' ? '基础可用' : pattern.status === 'unavailable' ? '当前不适用' : owned ? '奇物已持有' : '需奇物解锁';
  const category = mode === 'mcr' && pattern.status !== 'relic' ? '国标番型' : pattern.category;
  const relicName = PATTERN_RELIC_NAMES[pattern.relicId] ?? pattern.relicId;
  return `<article class="pattern-card pattern-card--${esc(pattern.status)}${owned ? ' pattern-card--owned' : ''}">
    <div class="pattern-card-top"><span class="pattern-category">${esc(category)}</span><span class="pattern-status">${status}</span></div>
    <div class="pattern-card-title"><h3>${esc(pattern.name)}</h3><strong>${esc(valueLabel(pattern, mode))}</strong></div>
    <p class="pattern-condition">${esc(pattern.condition)}</p>
    ${conditionTerms.filter(([match]) => match.test(`${pattern.condition} ${pattern.reason ?? ''}`)).map(([, description]) => `<p class="pattern-term-note">${esc(description)}</p>`).join('')}
    ${pattern.excludes?.length ? `<p class="pattern-excludes"><span>不重复计入</span>${esc(pattern.excludes.join('、'))}</p>` : ''}
    ${pattern.status === 'relic' ? `<p class="pattern-relic"><span>所需奇物</span><b>${esc(relicName)}</b><em>${owned ? '本次挑战已持有，成型后生效' : '本次挑战尚未持有'}</em></p>` : ''}
    ${pattern.status === 'unavailable' ? `<p class="pattern-unavailable"><span>本作说明</span>${esc(pattern.reason)}</p>` : ''}
  </article>`;
}

// Returns only the inner HTML of #pattern-results, so typing need not replace
// the input or reopen its containing dialog.
export function renderPatternResults(input = {}) {
  const { mode, filter, query, relics } = options(input);
  const needle = normalize(query);
  const entries = PATTERN_CATALOG[mode].filter(pattern => {
    if (filter !== 'all' && pattern.status !== filter) return false;
    if (!needle) return true;
    return normalize([pattern.id, pattern.name, pattern.condition, pattern.reason, pattern.category, ...(pattern.aliases ?? []), PATTERN_RELIC_NAMES[pattern.relicId]].filter(Boolean).join(' ')).includes(needle);
  }).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.fan - a.fan);
  const detail = query.trim() ? ` · 搜索“${query.trim()}”` : '';
  return `<p class="pattern-result-count" role="status" aria-live="polite">找到 ${entries.length} 项${esc(detail)}</p>${entries.length
    ? `<div class="pattern-grid">${entries.map(pattern => renderCard(pattern, mode, relics)).join('')}</div>`
    : '<div class="pattern-empty"><strong>没有找到对应役种</strong><p>试试更短的名称，或切换到“全部”。也可以搜索奇物名称。</p></div>'}`;
}

export function renderPatternGuide(input = {}) {
  const state = options(input);
  const { mode, filter, query, relics } = state;
  const catalog = PATTERN_CATALOG[mode];
  const count = status => catalog.filter(pattern => pattern.status === status).length;
  const held = catalog.filter(pattern => pattern.status === 'relic' && relics.has(pattern.relicId)).length;
  const anchors = BALANCE.highAnchors[mode], [lastFan, lastMultiplier] = anchors.at(-1);
  const formatted = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
  return `<section class="pattern-guide" aria-labelledby="pattern-guide-title">
    <div class="section-kicker">知牌成局 · 番型图鉴</div>
    <h2 id="pattern-guide-title">这一手，还能怎么叠？</h2>
    <p class="pattern-guide-intro">${modes[mode]} · 查看本作的成立条件、组合限制与计分档位。</p>
    <div class="pattern-summary" aria-label="役种支持情况">
      <div><strong>${count('base')}</strong><span>基础可计分</span></div>

      <div><strong>${count('unavailable')}</strong><span>当前不适用</span></div>
    </div>
    <p class="pattern-mode-note">${mode === 'riichi'
      ? '牌面役按图鉴所列翻数计奖；不自动赠送门清、暗刻奖励。役满覆盖普通役；未记录的自摸、荣和、暗刻与听牌条件不作推断。宝牌与累计役满档位单独说明，不冒充独立役。'
      : '国标 81 番种逐项列明。番型不需要奇物；奇物只辅助组牌，不提供额外计分。涉及时机、明暗和听牌记录的番型会说明当前不适用原因。'}</p>
    <section class="pattern-terms" aria-labelledby="pattern-terms-title">
      <h3 id="pattern-terms-title">先认识这些牌型词语</h3>
      <dl>${basicTerms.map(([term, description]) => `<div><dt>${esc(term)}</dt><dd>${esc(description)}</dd></div>`).join('')}</dl>
      <p>“番型／役种”是可计分的牌型条件，番／翻是其计分数值；本作再按对应模式的公式换算倍率。传统麻将的时机术语会在相关条目旁说明，是否可用以条目标记为准。</p>
    </section>
    <details class="pattern-score-guide">
      <summary>本作计分与牌型倍率</summary>
      <p>所有玩家都按下表计分：固定基数1,000 × 牌型倍率，向下取整。两档之间取已达到的档位，不叠加奇物计分。日麻无役为0分；役满每倍用13翻当量查表，只作本作计分换算。</p>
      <table><thead><tr><th scope="col">总${mode === 'mcr' ? '番' : '翻'}数下限</th><th scope="col">牌型倍率</th></tr></thead><tbody>${anchors.map(([fan, multiplier]) => `<tr><th scope="row">${fan}</th><td>×${formatted(multiplier)}</td></tr>`).join('')}</tbody></table>
      <p>超过${lastFan}${mode === 'mcr' ? '番' : '翻'}后，倍率按 ${formatted(lastMultiplier)} × 实际${mode === 'mcr' ? '番' : '翻'}数 ÷ ${lastFan} 线性延伸。预览按实际牌形择优；役满覆盖普通役，普通13翻不额外追加役满奖励。</p>
    </details>
    <div class="pattern-toolbar">
      <div class="pattern-filters" aria-label="役种筛选">${Object.entries(filters).map(([key, label]) => `<button type="button" data-act="guide-filter" data-filter="${key}" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div>
      <label class="pattern-search-label" for="pattern-search"><span>搜索役种</span><input type="search" id="pattern-search" value="${esc(query)}" placeholder="名称、条件或奇物" autocomplete="off" spellcheck="false"></label>
    </div>
    <div id="pattern-results">${renderPatternResults(state)}</div>
  </section>`;
}
