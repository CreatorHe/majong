import { configureGameAnalytics, getGameAnalytics } from './runtime.js';

/** Deliberately separate from app.js: no game actions or save data are inspected. */
export function mountAnalyticsBoot(options = {}) {
  const doc = options.document ?? globalThis.document;
  if (!doc || doc.querySelector('[data-analytics-shell]')) return null;
  if (options.analytics) configureGameAnalytics({ client: options.analytics });
  const client = getGameAnalytics(options.clientOptions);
  if (!client) return null;
  const style = doc.createElement('link');
  style.rel = 'stylesheet'; style.href = new URL('./boot.css', import.meta.url).href;
  doc.head.append(style);
  const shell = doc.createElement('aside');
  shell.dataset.analyticsShell = '';
  shell.className = 'analytics-dock'; shell.setAttribute('aria-label', '番型统计与数据设置');
  shell.innerHTML = '<a href="/analytics/" data-analytics-stats>番型统计 <span aria-hidden="true">↗</span></a><button type="button" data-analytics-settings><i aria-hidden="true"></i><span data-analytics-toggle-label>匿名统计：关</span></button>';
  const dialog = doc.createElement('dialog');
  dialog.className = 'analytics-settings'; dialog.setAttribute('aria-labelledby', 'analytics-settings-title');
  dialog.innerHTML = `
    <div class="analytics-settings-heading"><span>叠雀 · 雀行记录</span><button type="button" data-close aria-label="关闭数据设置">×</button></div>
    <h2 id="analytics-settings-title">让每一程有迹可循</h2>
    <p>正式游戏的匿名统计默认开启，记录出牌、换牌、改牌、奇物选择和每关结算，用于番型次数、得分与趣味报告。如果你之前已关闭，会继续保持关闭。</p>
    <div class="analytics-settings-state" role="status" aria-live="polite"><b data-consent-status></b><span data-delivery-status></span></div>
    <p class="analytics-settings-detail">不采集姓名、联系方式或输入内容。你可以随时关闭，尚未发送的记录会一并清空；已保存到服务器的记录不会因此自动删除。</p>
    <div class="analytics-settings-actions"><button type="button" data-deny>关闭并清空待发送记录</button><button type="button" data-allow>开启匿名统计</button><button type="button" data-retry hidden>重试保存记录</button></div>
    <a class="analytics-settings-report" href="/analytics/">查看番型统计 <span aria-hidden="true">→</span></a>`;
  const reportURL = /^\/hard(?:\/|$)/.test(globalThis.location?.pathname ?? '') ? '/analytics/?variant=hard_v5' : '/analytics/?variant=easy_v9';
  for (const link of [shell.querySelector('[data-analytics-stats]'), dialog.querySelector('.analytics-settings-report')]) link.setAttribute('href', reportURL);
  doc.body.append(shell, dialog);
  let disposed = false;
  const action = (name, event) => client.track('ui_action', {
    action: name, target_id: 'analytics_settings', input_method: event?.detail === 0 ? 'keyboard' : 'pointer', outcome: 'applied', reason_code: null,
  });
  const screen = (name, previous, reason = 'navigation') => client.track('screen_viewed', { screen: name, previous_screen: previous, reason });
  const unsubscribe = client.subscribe(status => {
    const allowed = status.consent === 'allowed';
    const preferenceUnavailable = status.lastError === 'preference_storage_unavailable';
    shell.dataset.enabled = String(allowed);
    shell.querySelector('[data-analytics-toggle-label]').textContent = `匿名统计：${allowed ? '开' : '关'}`;
    const consentLabel = allowed ? '匿名统计已开启' : status.consent === 'denied' ? '匿名统计已关闭' : '匿名统计尚未开启';
    shell.querySelector('[data-analytics-settings]').setAttribute('aria-label', `打开数据设置，${consentLabel}`);
    dialog.querySelector('[data-consent-status]').textContent = consentLabel;
    dialog.querySelector('[data-deny]').textContent = allowed ? '关闭并清空待发送记录' : '保持关闭';
    dialog.querySelector('[data-allow]').hidden = allowed && status.coordination !== 'blocked';
    dialog.querySelector('[data-allow]').textContent = status.coordination === 'blocked' ? '重试此页采集' : '开启匿名统计';
    dialog.querySelector('[data-retry]').hidden = !allowed || (status.delivery !== 'paused' && !status.lastError);
    const detail = preferenceUnavailable ? (allowed ? '本页已开启，但浏览器无法保存开启设置；刷新后会按届时可读取的设置决定是否开启。' : status.consent === 'denied' ? '本页已关闭，但浏览器无法保存关闭设置；刷新后可能恢复默认开启。' : '浏览器无法读取设置，尚未开启匿名统计。你可以手动开启或保持关闭。') :
      !allowed ? (status.consent === 'denied' ? '保持关闭也可以正常游玩和查看全站统计；刷新或再次进入时沿用关闭选择。' : '当前未开启匿名统计；你可以手动开启，也可以保持关闭正常游玩。') :
      status.coordination === 'blocked' ? '另一标签页正在采集，此页暂不重复记录。关闭另一页后可重试。' :
      status.lastError === 'storage_unavailable' || status.lastError === 'storage_clear_failed' ? '浏览器存储暂不可用，已暂停上报。记录暂存在本页，存储恢复后可重试保存；关闭页面可能丢失。' :
      status.storage === 'memory' ? '浏览器无法保存待发送记录，关闭页面后可能丢失。' :
      status.lastError?.endsWith('_401') || status.lastError?.startsWith('renewal_') || status.lastError === 'invalid_renewal' ? '暂时无法恢复上报，记录保留在本机，可重试保存。' :
      status.lastError ? '暂时无法完成上报，待发送记录会保留并重试。' :
      status.delivery === 'sending' ? '正在保存记录…' :
      status.queued ? `${status.queued} 条记录等待保存` :
      status.lastSentAt ? '本次待发送记录已保存' : allowed ? '后续记录将保存到服务器' : '保持关闭也可以正常游玩和查看全站统计';
    dialog.querySelector('[data-delivery-status]').textContent = detail;
  });
  function open(event) {
    void action('analytics_settings_open', event);
    dialog.showModal(); void screen('analytics_settings', 'game_shell');
  }
  function close(event) { void action('analytics_settings_close', event); dialog.close(); }
  const closeHandler = () => { void screen('game_shell', 'analytics_settings'); };
  const allow = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await client.setConsent(true);
      if (disposed) return;
      await action('analytics_consent_allow', event);
      await screen('analytics_settings', null, 'load');
      void client.flush();
    } finally { button.disabled = false; }
  };
  const deny = async () => { await client.setConsent(false); };
  const retry = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await action('analytics_delivery_retry', event); await client.flush(); }
    finally { button.disabled = false; }
  };
  const stats = event => { void action('analytics_stats_open', event); };
  const online = () => { void client.flush(); };
  const visibility = () => { if (doc.visibilityState === 'hidden') void client.flush(); };
  shell.querySelector('[data-analytics-settings]').addEventListener('click', open);
  shell.querySelector('[data-analytics-stats]').addEventListener('click', stats);
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.querySelector('[data-allow]').addEventListener('click', allow);
  dialog.querySelector('[data-deny]').addEventListener('click', deny);
  dialog.querySelector('[data-retry]').addEventListener('click', retry);
  dialog.querySelector('.analytics-settings-report').addEventListener('click', stats);
  dialog.addEventListener('close', closeHandler);
  globalThis.addEventListener?.('online', online);
  doc.addEventListener('visibilitychange', visibility);
  void client.ready.then(() => { if (!disposed) return screen('game_shell', null, 'load'); });
  return { client, unmount() {
    disposed = true; unsubscribe();
    globalThis.removeEventListener?.('online', online); doc.removeEventListener('visibilitychange', visibility);
    shell.remove(); dialog.remove(); style.remove();
  } };
}

if (typeof document !== 'undefined') mountAnalyticsBoot();
