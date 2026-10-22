import { GAME_RULES_VERSION, GAME_SCORE_MODEL_VERSION, V5_RULES_VERSION, V5_SCORE_MODEL_VERSION, V6_RULES_VERSION, V6_SCORE_MODEL_VERSION, V7_RULES_VERSION, V7_SCORE_MODEL_VERSION, V8_RULES_VERSION, V8_SCORE_MODEL_VERSION, V9_RULES_VERSION, V9_SCORE_MODEL_VERSION, isSupportedGameVersion } from './game-schema.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(globalThis.location?.search || '');
const state = {
  mode: params.get('mode') === 'riichi' ? 'riichi' : 'mcr',
  scope: params.get('scope') === 'sandbox' ? 'sandbox' : 'production',
  version: params.get('rules_version') && params.get('score_model_version')
    ? { rules_version: params.get('rules_version'), score_model_version: params.get('score_model_version') } : null,
  data: null, loading: false, requestId: 0, controller: null, sampleBusy: false,
};
const numberFormat = new Intl.NumberFormat('zh-CN');
const percentFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const integer = value => Number.isFinite(value) ? numberFormat.format(value) : '—';
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : '—';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const versionKey = version => version ? JSON.stringify([version.rules_version, version.score_model_version]) : '';
export const sampleVersions = Object.freeze({ rules_version: GAME_RULES_VERSION, score_model_version: GAME_SCORE_MODEL_VERSION });
const sampleRelease = GAME_RULES_VERSION.replaceAll('_', '-');
const sampleStorageKey = mode => `jade-run:analytics:sandbox:last-fixture-v9:${mode}`;
let testClientPromise = null;

export function reportPresentation(data) {
  const v2 = data.rules_version === 'free_play_v2' && data.score_model_version === 'cumulative_v2';
  const v3 = data.rules_version === 'free_play_v3' && data.score_model_version === 'exponential_v3';
  const v4 = data.rules_version === 'free_play_v4' && data.score_model_version === 'exponential_v3';
  const v5 = data.rules_version === V5_RULES_VERSION && data.score_model_version === V5_SCORE_MODEL_VERSION;
  const v6 = data.rules_version === V6_RULES_VERSION && data.score_model_version === V6_SCORE_MODEL_VERSION;
  const v7 = data.rules_version === V7_RULES_VERSION && data.score_model_version === V7_SCORE_MODEL_VERSION;
  const v8 = data.rules_version === V8_RULES_VERSION && data.score_model_version === V8_SCORE_MODEL_VERSION;
  const v9 = data.rules_version === V9_RULES_VERSION && data.score_model_version === V9_SCORE_MODEL_VERSION;
  const fourCore = v5 || v6 || v7 || v8;
  const exponential = v3 || v4;
  const extendedShapes = exponential || fourCore || v9;
  const freePlay = isSupportedGameVersion(data.rules_version, data.score_model_version);
  const summary = data.summary || {};
  const settlements = data.settlements || {};
  return {
    v2, v3, v4, v5, v6, v7, v8, v9, freePlay,
    handLabel: v9 ? '有番型的完整和牌' : freePlay ? '合法完整和牌' : '旧版完整成型',
    scoreLabel: freePlay ? '最高和牌分' : '旧版最高整关分',
    maxScore: freePlay ? summary.max_win_score ?? null : summary.max_round_score ?? null,
    maxNet: freePlay ? settlements.max_round_score ?? null : null,
    maxCumulative: freePlay ? settlements.max_cumulative_score ?? null : null,
    passRate: freePlay ? settlements.pass_rate ?? null : null,
    subtitle: v9 ? '按有番型的完整和牌统计' : freePlay ? '按可判定的合法完整和牌统计' : '旧版口径 · 按预选路线分别统计',
    noYaku: v9 ? settlements.no_yaku ?? 0 : null,
    incomplete: v9 ? settlements.incomplete ?? 0 : null,
    terminalNotice: v9
      ? '过关按终局累计分判断。日麻无役为 0 分且无罚分，未完成扣目标的 10%；两者都不计诈胡或合法和牌分母。'
      : '过关按终局累计分判断；诈胡仍达标计入过关，始终不计入番型。',
    notice: v9
      ? '九张成批 v9 · 无核心，每批 9 张候选，出牌后余牌全弃并刷新。按固定基数 1000 与番数档位倍率结算，没有过程分或发币；改点、换色、万能与补缺工具按实际持有记录。'
      : v8
      ? '起手构筑 v8 · 改点、换色和万能仅在准备阶段可用。每关 5 次普通换牌，准备与组牌共用，每次 1～5 张；满 14 未结算也可换候选，最终留牌参与结算。高番补缺每关一次：准备阶段改点或换色共耗 2 墨，组牌阶段未满 14 可弃换至多 3 张。'
      : v7
      ? '起手构筑 v7 · 整趟挑战可弃牌一次，弃去 1～2 张非杠成型牌，不立即摸牌、得分或耗墨。天机算筹自带固定点数、三花色万能，仍共用每关一次的 2 墨改牌额度。沿用 v6 四核心计分，两个规则版本独立统计。'
      : v6
      ? '起手构筑 v6 · 核心与升降笔占起始 2 槽。每关 2 墨，共可改牌 1 次，准备与组牌共用；两区非杠牌均可改，满 14 个结构位置且未结算仍可用普通工具修复。补缺编辑同耗 2 墨。'
      : v5
      ? '起手构筑 v5 · 原版四核心计分。普通工具仅在准备阶段使用；基础 4 墨，改点、换色及补缺编辑耗 1 墨，万能耗 2 墨。准备阶段可换牌 5 次，4 槽最多装备 1 核心。'
      : v4
      ? '自由出牌 v4 · 12 张候选，出几张补几张；基础 7 次换牌，第三关减 2 次，借东风加 2 次。沿用指数计分与番型，但与 v3 分开统计。'
      : v3
      ? '自由出牌 v3 · 指数计分。基础番型与奇物番型分别记账；未开放番型不进入统计。合法未达标计入番型，诈胡仍达标只计入过关。'
      : v2 ? '自由出牌 v2 · 累计计分。合法未达标计入番型，诈胡仍达标只计入过关；与 v3 / v4 指数计分分别统计。'
      : '旧版记录 · 按当时的预选路线与整关得分统计，不与自由出牌版本合并。',
    explanation: v9
      ? '出现率 = 含该计分番型的和牌手数 ÷ 同模式、同版本的有番型完整和牌手数。只有完整观测的 win 进入分母；无役、未完成、诈胡和不完整观测均排除。普通、七对和特殊牌形是系统最终拆解，不按拆解另分分母。合法未过关仍计入，每手同番型最多一次，多番占比之和可超过 100%。最高和牌分只计和牌收益；本关净分计收益或罚分；累计分含此前各关。各纪录分别取最大值，不一定来自同一手。按当前番数档位结算，不直接累计番数作分数；报告只展示实际上报的总分，不重新计算。'
      : freePlay
      ? `出现率 = 含该计分番型的手数 ÷ 可判定的合法完整和牌手数。${extendedShapes ? '普通、七对和特殊牌形都是系统最终拆解' : '普通与七对是系统最终拆解'}，分母不按拆解筛选。合法未过关也计入；诈胡与不完整观测不计入。每手同番型最多一次，多番占比之和可超过 100%。最高和牌分只计终局和牌收益；本关净分含过程分、和牌分与罚分；累计分含此前各关。各项纪录分别取最高值，不一定来自同一手，也不是番型单独贡献。${extendedShapes ? `只纳入已开放的基础与奇物番型；${fourCore ? '四核心' : '指数'}计分纪录仅在同一规则和计分版本内比较。` : ''}${v6 || v7 || v8 ? '本页直接展示实际上报的总分，不再次放大或重算。' : ''}`
      : '旧版出现率 = 含该计分番型的手数 ÷ 适用预选路线的有效完整成型手数。各行分母可能不同；完整成型但未过关仍计入。每手同番型最多一次，多番占比之和可超过 100%。旧版整关得分沿用历史口径，不能拆分或对比新版和牌分、本关净分与累计分。',
  };
}

export function patternScore(pattern, data) {
  return reportPresentation(data).freePlay ? pattern.max_win_score ?? null : pattern.max_round_score ?? null;
}

function previousFixture(mode) {
  try {
    const fixture = JSON.parse(localStorage.getItem(sampleStorageKey(mode)));
    return Array.isArray(fixture) && fixture.length === 9 && fixture.every(item => item?.context?.mode === mode && item.context.rules_version === sampleVersions.rules_version && item.context.score_model_version === sampleVersions.score_model_version && item.context.hand_id === item.payload?.settlement_id && ['hand_completed', 'round_settled'].includes(item.event_name)) ? fixture : null;
  } catch { return null; }
}

function message(text, tone = '') {
  $('#fetch-message').textContent = text;
  $('#fetch-message').dataset.tone = tone;
}

function updateURL() {
  const query = new URLSearchParams({ mode: state.mode, scope: state.scope });
  if (state.version) {
    query.set('rules_version', state.version.rules_version);
    query.set('score_model_version', state.version.score_model_version);
  }
  history.replaceState(null, '', `${location.pathname}?${query}`);
}

function updateControls() {
  document.querySelectorAll('[data-mode]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)); button.disabled = state.sampleBusy; });
  document.querySelectorAll('[data-scope]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.scope === state.scope)); button.disabled = state.sampleBusy; });
  $('#refresh-button').disabled = state.loading || state.sampleBusy;
  $('#version-select').disabled = state.sampleBusy;
  $('.summary-strip').setAttribute('aria-busy', String(state.loading));
  $('#scope-badge').textContent = state.scope === 'sandbox' ? '测试样本 · 独立统计' : '正式样本';
  $('#scope-badge').dataset.scope = state.scope;
  $('#sample-button').disabled = state.scope !== 'sandbox' || state.sampleBusy;
  $('#repeat-button').disabled = state.scope !== 'sandbox' || state.sampleBusy || !previousFixture(state.mode);
  if (!testClientPromise) $('#stop-button').hidden = !previousFixture('mcr') && !previousFixture('riichi');
  $('#test-scope-hint').textContent = state.scope === 'sandbox'
    ? '写入九张成批 v9 样本；v8、v7、v6、v5、v4、v3、v2 与旧版测试记录仍按版本保留。'
    : '切换到“测试样本”后可写入验收记录。';
}

function renderVersions(data) {
  const select = $('#version-select');
  const versions = Array.isArray(data.versions) ? data.versions.filter(v => typeof v.rules_version === 'string' && typeof v.score_model_version === 'string') : [];
  if (state.version && !versions.some(v => versionKey(v) === versionKey(state.version))) versions.push(state.version);
  select.replaceChildren(new Option('当前玩法 · 九张成批 v9', ''));
  for (const version of versions) select.add(new Option(`${version.rules_version} / ${version.score_model_version}`, versionKey(version)));
  select.value = versionKey(state.version);
  $('#version-caption').textContent = data.rules_version && data.score_model_version
    ? `${data.rules_version} / ${data.score_model_version}` : '尚无版本样本';
}

function renderRows() {
  const rows = $('#pattern-rows');
  rows.replaceChildren();
  if (!state.data) return;
  const search = $('#pattern-search').value.trim().toLocaleLowerCase('zh-CN');
  const sort = $('#sort-select').value;
  const patterns = state.data.patterns.filter(pattern => `${pattern.name} ${pattern.pattern_id}`.toLocaleLowerCase('zh-CN').includes(search));
  const view = reportPresentation(state.data);
  const sortValue = pattern => ({ count: pattern.count, rate: pattern.rate, score: patternScore(pattern, state.data), fan: pattern.fan }[sort]) ?? -Infinity;
  patterns.sort((a, b) => sortValue(b) - sortValue(a) || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  const unit = state.mode === 'mcr' ? '番' : '翻';
  for (const pattern of patterns) {
    const row = document.createElement('tr');
    const rate = Number.isFinite(pattern.rate) ? Math.max(0, Math.min(1, pattern.rate)) : null;
    const hasDenominator = Number.isFinite(pattern.denominator) && pattern.denominator > 0;
    const rateLabel = hasDenominator && rate !== null ? percentFormat.format(rate) : '—';
    const unlock = ['unlock', 'relic'].includes(pattern.kind) ? '<span class="unlock-label">奇物解锁</span>' : '';
    const fan = Number.isFinite(pattern.fan) ? `<span class="pattern-fan">${integer(pattern.fan)} ${unit}</span>` : '';
    const denominator = hasDenominator ? `${integer(pattern.count)} / ${integer(pattern.denominator)} <em>手</em>` : '暂无有效样本';
    const shapeNames = { normal: '普通', pairs: '七对', orphans: state.mode === 'riichi' ? '国士无双' : '十三幺', knitted: '组合龙', unconnected: '不靠' };
    const routeNames = [...new Set(pattern.routes ?? [])].map(route => shapeNames[route]).filter(Boolean);
    const routes = view.freePlay
      ? (routeNames.length ? `${routeNames.join(' / ')}牌形可计分` : '适用牌形见规则')
      : (pattern.routes?.length === 1 ? (pattern.routes[0] === 'pairs' ? '旧版七对路线' : '旧版普通路线') : '旧版两条路线');
    const maxScore = patternScore(pattern, state.data);
    const scoreDetail = view.freePlay && maxScore !== null
      ? `<span class="score-breakdown"><span>最高本关净分 <b>${integer(pattern.max_round_score)}</b></span><span>最高累计分 <b>${integer(pattern.max_cumulative_score)}</b></span></span>` : '';
    row.innerHTML = `<td><span class="pattern-name">${escapeHTML(pattern.name)}</span>${fan}<p class="pattern-description">${unlock}${escapeHTML(pattern.description)}<span class="route-label">${routes}</span></p></td>
      <td><span class="numeric${pattern.count ? '' : ' muted-number'}">${integer(pattern.count)}</span><span class="denominator">每手最多记 1 次</span></td>
      <td><div class="rate-topline"><span class="numeric${rate ? '' : ' muted-number'}">${rateLabel}</span><span class="denominator">${denominator}</span></div><div class="rate-track" aria-hidden="true"><span style="--rate:${hasDenominator && rate !== null ? rate * 100 : 0}%"></span></div></td>
      <td><span class="numeric record-number">${integer(maxScore)}</span><span class="denominator">${maxScore === null ? '暂无纪录' : view.freePlay ? '分 · 和牌收益' : '分 · 旧版整关收益'}</span>${scoreDetail}</td>`;
    rows.append(row);
  }
  $('#pattern-total').textContent = `${patterns.length} 项`;
  $('#search-empty').hidden = patterns.length > 0 || !search;
}

function renderReport(data) {
  renderVersions(data);
  $('#summary-hands').textContent = integer(data.summary.completed_hands);
  $('#summary-occurrences').textContent = integer(data.summary.pattern_occurrences);
  const view = reportPresentation(data);
  $('.summary-strip').dataset.model = view.freePlay ? 'cumulative' : 'legacy';
  document.querySelectorAll('[data-free-play]').forEach(element => { element.hidden = !view.freePlay; });
  document.querySelectorAll('[data-v9]').forEach(element => { element.hidden = !view.v9; });
  $('#summary-hands-label').textContent = view.handLabel;
  $('#summary-max-label').textContent = view.scoreLabel;
  $('#summary-max').textContent = integer(view.maxScore);
  $('#summary-net').textContent = integer(view.maxNet);
  $('#summary-cumulative').textContent = integer(view.maxCumulative);
  $('#summary-pass-rate').textContent = Number.isFinite(view.passRate) ? percentFormat.format(view.passRate) : '—';
  $('#summary-passed').textContent = data.settlements?.total > 0 ? `${integer(data.settlements.passed)} / ${integer(data.settlements.total)} 关达标` : '暂无完整观测终局';
  $('#summary-terminals').textContent = integer(data.settlements?.total);
  $('#summary-false-wins').textContent = integer(data.settlements?.false_win);
  $('#summary-false-passed').textContent = integer(data.settlements?.false_win_passed);
  $('#summary-no-yaku').textContent = integer(view.noYaku);
  $('#summary-incomplete').textContent = integer(view.incomplete);
  $('#terminal-explanation').textContent = view.terminalNotice;
  $('#ledger-subtitle').textContent = view.subtitle;
  $('#collection-copy').textContent = view.notice;
  $('#metric-explanation').textContent = view.explanation;
  $('#pattern-score-heading').textContent = view.freePlay ? '含此番型的最高和牌分' : '含此番型的旧版最高整关分';
  $('#table-caption').textContent = `每个番型的计分出现次数、出现率和${view.scoreLabel}`;
  $('#received-caption').textContent = data.summary.last_received_at
    ? `最近${view.freePlay ? '和牌' : ''}接收 ${dateLabel(data.summary.last_received_at)} · 北京时间` : (view.freePlay ? '尚无合法和牌接收记录' : '尚无完整成型接收记录');
  $('#updated-at').textContent = `更新于 ${dateLabel(data.generated_at)} · 北京时间`;
  $('#empty-state').hidden = data.summary.completed_hands > 0;
  $('#empty-title').textContent = state.scope === 'sandbox' ? '先记一批测试牌局' : view.freePlay ? '等待第一手合法和牌' : '当前旧版暂无完整成型记录';
  $('#empty-copy').textContent = state.scope === 'sandbox'
    ? '当前筛选尚无有效样本。展开下方“采集链路验收”可写入测试数据，检查统计与重复发送。'
    : (view.v9 ? '当前筛选尚无完整观测的有番型和牌。无役、未完成和诈胡仅计入终局摘要，不进入番型分母。' : view.freePlay ? '当前筛选尚无可判定的合法完整和牌。开启游戏的数据采集并完成和牌后，计分番型将在这里积累；诈胡终局仅出现在上方过关统计中。' : '当前筛选没有旧版完整成型记录。切换玩法版本可查看自由出牌记录，各版本分别记账。');
  renderRows();
}

function clearReport() {
  state.data = null;
  ['#summary-hands', '#summary-occurrences', '#summary-max', '#summary-net', '#summary-cumulative', '#summary-pass-rate', '#summary-terminals', '#summary-false-wins', '#summary-false-passed', '#summary-no-yaku', '#summary-incomplete'].forEach(selector => { $(selector).textContent = '—'; });
  $('#summary-passed').textContent = '正在读取终局记录';
  $('#pattern-rows').replaceChildren();
  $('#pattern-total').textContent = '';
  $('#empty-state').hidden = true;
  $('#search-empty').hidden = true;
  $('#version-caption').textContent = '版本读取中';
  $('#received-caption').textContent = '正在读取当前范围';
  $('#updated-at').textContent = '正在更新';
}

async function loadReport() {
  state.controller?.abort();
  const requestId = ++state.requestId;
  state.controller = new AbortController();
  const controller = state.controller;
  const timeout = setTimeout(() => controller.abort('timeout'), 20000);
  state.loading = true;
  clearReport();
  updateControls();
  updateURL();
  message('正在读取服务端记录…');
  const query = new URLSearchParams({ mode: state.mode, scope: state.scope });
  if (state.version) {
    query.set('rules_version', state.version.rules_version);
    query.set('score_model_version', state.version.score_model_version);
  }
  try {
    const response = await fetch(`/api/reports/patterns?${query}`, { signal: state.controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('统计服务尚未连接。请通过包含 API 的服务地址打开此页，再刷新记录。');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error?.message || `读取失败（${response.status}），请稍后刷新。`);
    if (!data.summary || !Array.isArray(data.patterns)) throw new Error('服务器返回的统计格式不完整，请稍后刷新。');
    if (requestId !== state.requestId) return;
    state.data = data;
    renderReport(data);
    message(`${state.scope === 'sandbox' ? '测试' : '正式'}记录已从服务器读取。${state.scope === 'sandbox' ? '此范围与正式统计隔离。' : ''}`);
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (controller.signal.reason === 'timeout') error = new Error('统计服务暂未响应，请稍后刷新记录。');
    else if (error.name === 'AbortError') return;
    message(error.message || '暂时无法读取统计，请检查网络后刷新。', 'error');
    $('#version-caption').textContent = '读取失败';
    $('#received-caption').textContent = '未能取得服务器记录';
    $('#updated-at').textContent = '本次读取未完成';
  } finally {
    clearTimeout(timeout);
    if (requestId === state.requestId) { state.loading = false; updateControls(); }
  }
}

function deliveryMessage(text, tone = '') {
  $('#delivery-status').textContent = text;
  $('#delivery-status').dataset.tone = tone;
}

async function getTestClient() {
  if (!testClientPromise) {
    testClientPromise = import('./client.js').then(({ createAnalytics }) => {
      const client = createAnalytics({ scope: 'sandbox', appRelease: sampleRelease, entry: 'debug', autoFlush: false });
      return client;
    }).catch(error => { testClientPromise = null; throw error; });
  }
  return testClientPromise;
}

export function makeFixture(mode, makeId = () => crypto.randomUUID()) {
  if (!['mcr', 'riichi'].includes(mode)) throw new Error('unsupported_fixture_mode');
  const fullFlush = `${mode}.full_flush`;
  const sevenPairs = `${mode}.seven_pairs`;
  const highWin = mode === 'mcr' ? 1024000 : 768000;
  const lowWin = mode === 'mcr' ? 4000 : 12000;
  const target = 32000;
  const examples = [
    { shape: 'pairs', result: 'win', start: 0, win: highWin, patterns: [fullFlush, sevenPairs], quality: 'complete' },
    { shape: 'normal', result: 'win', start: 0, win: lowWin, patterns: [`${mode}.all_simples`], quality: 'complete' },
    { shape: null, result: 'false_win', start: 35200, win: 0, patterns: [], quality: 'complete' },
    { shape: mode === 'riichi' ? 'normal' : null, result: mode === 'riichi' ? 'no_yaku' : 'false_win', start: mode === 'riichi' ? 32000 : 35200, win: 0, patterns: [], quality: 'complete' },
    { shape: null, result: 'incomplete', start: 100, win: 0, patterns: [], quality: 'complete' },
    { shape: 'pairs', result: 'win', start: 0, win: highWin, patterns: [fullFlush, sevenPairs], quality: 'partial' },
  ];
  return examples.flatMap(example => {
    const settlement_id = makeId();
    const legal = example.result === 'win';
    const faces = example.shape === 'pairs'
      ? [0, 0, 1, 1, 2, 2, 4, 4, 5, 5, 7, 7, 8, 8]
      : example.result === 'no_yaku' ? [0, 1, 2, 12, 13, 14, 24, 25, 26, 6, 6, 6, 27, 27]
      : legal ? [1, 2, 3, 10, 11, 12, 19, 20, 21, 4, 4, 4, 6, 6]
      : example.result === 'incomplete' ? [0, 1, 3, 4, 6, 7, 9, 10, 12]
      : [0, 1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 27, 28];
    const tiles = faces.map((face, i) => ({ id: `sample-tile-${i + 1}`, original: face, face, effective_face: face, wild: false }));
    const tileIds = (start, length) => tiles.slice(start, start + length).map(tile => tile.id);
    const groups = example.shape === 'pairs'
      ? Array.from({ length: 7 }, (_, i) => ({ type: 'pair', tile_ids: tileIds(i * 2, 2) }))
      : [0, 3, 6].map(start => ({ type: 'chow', tile_ids: tileIds(start, 3) }))
        .concat([{ type: 'pung', tile_ids: tileIds(9, 3) }, { type: 'pair', tile_ids: tileIds(12, 2) }]);
    const penalty = ['false_win', 'incomplete'].includes(example.result) ? Math.ceil(target / 10) : 0;
    const delta = example.win - penalty;
    const cumulative = example.start + delta;
    const payload = {
      settlement_id, round_no: 1, legal, result_type: example.result,
      passed: cumulative >= target, process_score: 0, win_score: example.win,
      penalty_score: penalty, score_delta: delta, round_score: delta,
      round_start_score: example.start, cumulative_before: example.start,
      cumulative_after: cumulative, target_score: target, record_quality: example.quality,
      shape: example.shape, tiles, declared_kongs: [], decomposition: example.shape ? { groups } : null,
      credited_pattern_ids: example.patterns, unlock_pattern_ids: [], owned_relic_ids: ['rank_brush'],
    };
    const context = { mode, ...sampleVersions, app_release: sampleRelease, run_id: makeId(), round_attempt_id: makeId(), hand_id: settlement_id };
    const events = [{ event_name: 'round_settled', payload, context }];
    if (legal) events.push({ event_name: 'hand_completed', payload: structuredClone(payload), context: { ...context } });
    return events;
  });
}

export async function flushTestQueue(client) {
  // A previous offline attempt can leave more than one transport batch queued.
  const combined = { accepted: [], duplicate: [], rejected: [] };
  let status = client.getStatus();
  for (let attempts = 0; attempts < 10; attempts += 1) {
    const pending = status.queued;
    status = await client.flush();
    if (status.lastAck) for (const key of Object.keys(combined)) combined[key].push(...status.lastAck[key]);
    if (!status.queued || status.lastError || combined.rejected.length || status.queued >= pending) break;
  }
  return { ...status, lastAck: Object.values(combined).some(items => items.length) ? combined : null };
}

async function sendSamples(repeat) {
  if (state.scope !== 'sandbox' || state.sampleBusy) return;
  state.sampleBusy = true;
  updateControls();
  deliveryMessage(repeat ? '正在重新发送上一批测试记录…' : '正在准备测试记录…');
  try {
    const fixture = repeat ? previousFixture(state.mode) : makeFixture(state.mode);
    if (!fixture) throw new Error('没有可重复发送的记录，请先写入一批测试样本。');
    const client = await getTestClient();
    await client.ready;
    const consentStatus = await client.setConsent(true);
    if (consentStatus.coordination === 'blocked') throw new Error('另一标签页正在采集测试数据，请关闭另一统计页后重试。');
    $('#stop-button').hidden = false;
    let fixtureSaved = true;
    try { localStorage.setItem(sampleStorageKey(state.mode), JSON.stringify(fixture)); } catch { fixtureSaved = false; }
    for (const item of fixture) {
      const queued = await client.track(item.event_name, item.payload, item.context);
      if (!queued.queued) throw new Error(queued.reason === 'collector_busy'
        ? '另一标签页正在采集测试数据，请关闭另一统计页后重试。'
        : `测试记录未入队（${queued.reason || '未知原因'}）。`);
    }
    deliveryMessage('6 次终局、3 条合法和牌事件已进入待发送队列，正在等待服务器回执…');
    const status = await flushTestQueue(client);
    const ack = status.lastAck;
    if (!ack || status.queued || status.lastError || ack.rejected?.length) {
      const retryNote = status.retryAt > Date.now() ? ` 约 ${Math.ceil((status.retryAt - Date.now()) / 1000)} 秒后可重试。` : '';
      const rejected = ack?.rejected?.length ? `服务器拒绝 ${ack.rejected.length} 条：${ack.rejected.map(item => item.reason).join('、')}。` : '';
      throw new Error(`${rejected}尚有 ${status.queued} 条待发送记录，未完成本次确认。${status.lastError ? `（${status.lastError}）` : ''}${retryNote}`);
    }
    const accepted = ack.accepted.length;
    const duplicate = ack.duplicate.length;
    deliveryMessage(`服务器已确认：新接收 ${accepted} 条事件，已合并或重复 ${duplicate} 条，拒绝 ${ack.rejected.length} 条。\n本批含 5 次完整观测终局：2 手有番型和牌、${state.mode === 'riichi' ? '1 次诈胡、1 次无役' : '2 次诈胡'}、1 次未完成；另 1 次不完整观测不入统计。首次采集还会包含会话事件。${fixtureSaved ? '\n可重复发送或刷新页面，检查手数与纪录是否保持。' : '\n浏览器未能保存本批编号，重载后无法重复发送这一批。'}`, 'success');
    state.version = { ...sampleVersions };
    await loadReport();
  } catch (error) {
    deliveryMessage(error.message || '测试发送失败，请检查服务后重试。', 'error');
  } finally {
    state.sampleBusy = false;
    updateControls();
  }
}

function initializeReport() {
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    if (state.mode === button.dataset.mode) return;
    state.mode = button.dataset.mode;
    state.version = null;
    $('#pattern-search').value = '';
    loadReport();
  }));
  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
    if (state.scope === button.dataset.scope) return;
    state.scope = button.dataset.scope;
    state.version = null;
    if (state.scope === 'sandbox') $('#verification-panel').open = true;
    loadReport();
  }));
  $('#version-select').addEventListener('change', event => {
    if (event.target.value) {
      const [rules_version, score_model_version] = JSON.parse(event.target.value);
      state.version = { rules_version, score_model_version };
    } else state.version = null;
    loadReport();
  });
  $('#pattern-search').addEventListener('input', renderRows);
  $('#sort-select').addEventListener('change', renderRows);
  $('#refresh-button').addEventListener('click', loadReport);
  $('#sample-button').addEventListener('click', () => sendSamples(false));
  $('#repeat-button').addEventListener('click', () => sendSamples(true));
  $('#stop-button').addEventListener('click', async () => {
    $('#stop-button').disabled = true;
    try {
      const client = await getTestClient();
      await client.setConsent(false);
      for (const mode of ['mcr', 'riichi']) { try { localStorage.removeItem(sampleStorageKey(mode)); } catch {} }
      deliveryMessage('已停止本次测试采集并清空待发送记录。服务器已接收的测试统计仍保留。');
      $('#stop-button').hidden = true;
      updateControls();
    } catch {
      deliveryMessage('未能完成停止操作，请重试。', 'error');
    } finally { $('#stop-button').disabled = false; }
  });
  if (state.scope === 'sandbox') $('#verification-panel').open = true;
  loadReport();
}
if (typeof document !== 'undefined') initializeReport();
