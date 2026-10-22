import { PATTERN_CATALOG, PATTERN_RELIC_NAMES } from './pattern-catalog.js';
import { BALANCE } from './balance.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const modes = { mcr: '国标番型', riichi: '日麻役种' };
const filters = { all: '全部', base: '基础可用', relic: '奇物解锁', unavailable: '当前不适用' };
const statusOrder = { base: 0, relic: 1, unavailable: 2 };
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
const options = ({ mode = 'mcr', filter = 'all', query = '', relics = [] } = {}) => ({
  mode: Object.hasOwn(modes, mode) ? mode : 'mcr',
  filter: Object.hasOwn(filters, filter) ? filter : 'all',
  query: String(query ?? ''),
  relics: new Set(Array.isArray(relics) ? relics : relics instanceof Set ? [...relics] : []),
});

function valueLabel(pattern, mode) {
  if (pattern.valueText) return pattern.valueText;
  if (pattern.category === '双倍役满') return '双倍役满 · 26 翻';
  if (pattern.classification === 'yakuman') return '役满 · 13 翻';
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
    <p class="pattern-guide-intro">${modes[mode]} · 查看本作的成立条件、组合限制与奇物要求。</p>
    <div class="pattern-summary" aria-label="役种支持情况">
      <div><strong>${count('base')}</strong><span>基础可计分</span></div>
      <div><strong>${count('relic')}</strong><span>奇物扩展 · 已持有 ${held}</span></div>
      <div><strong>${count('unavailable')}</strong><span>当前不适用</span></div>
    </div>
    <p class="pattern-mode-note">${mode === 'riichi'
      ? '牌面役暂按门清翻数计奖，后续依试玩调档；不自动赠送门清、暗刻奖励。役满覆盖普通役；未记录的自摸、荣和、暗刻与听牌条件不作推断。宝牌与累计役满档位单独说明，不冒充独立役。'
      : '国标 81 番种逐项列明。基础番型不需要奇物；车轮、连山提供额外加赏。涉及时机、明暗和听牌记录的番型会说明当前不适用原因。'}</p>
    <details class="pattern-score-guide">
      <summary>本作计分与大番核心倍率</summary>
      <p>普通牌型倍率为${mode === 'mcr' ? '1＋总番数÷8' : '1＋总翻数'}，再叠奇物效果。持有天机算筹时改用下表阶梯倍率，两档之间取已达到的档位；基础番型本身不需要核心解锁。</p>
      <table><thead><tr><th scope="col">总${mode === 'mcr' ? '番' : '翻'}数下限</th><th scope="col">大番核心倍率</th></tr></thead><tbody>${anchors.map(([fan, multiplier]) => `<tr><th scope="row">${fan}</th><td>×${formatted(multiplier)}</td></tr>`).join('')}</tbody></table>
      <p>超过${lastFan}${mode === 'mcr' ? '番' : '翻'}后，倍率按 ${formatted(lastMultiplier)} × 实际${mode === 'mcr' ? '番' : '翻'}数 ÷ ${lastFan} 线性延伸。合法和牌分＝底分×最终倍率，向下取整；预览按实际牌形与奇物择优。</p>
    </details>
    <div class="pattern-toolbar">
      <div class="pattern-filters" aria-label="役种筛选">${Object.entries(filters).map(([key, label]) => `<button type="button" data-act="guide-filter" data-filter="${key}" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}">${label}</button>`).join('')}</div>
      <label class="pattern-search-label" for="pattern-search"><span>搜索役种</span><input type="search" id="pattern-search" value="${esc(query)}" placeholder="名称、条件或奇物" autocomplete="off" spellcheck="false"></label>
    </div>
    <div id="pattern-results">${renderPatternResults(state)}</div>
  </section>`;
}
