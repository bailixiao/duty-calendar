// 後台「近期勤務」最上面的「🆕 最新報名」：最近 3 天誰報名、取消、改期（apps-script/SignupDigest.gs），
// 和「每天晚上 8 點報名彙整」手機通知的開關。勤務／道務／教育帳號只看到自己類別。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const SHOW = 8; // 先列幾筆，其他按「看全部」
  const ICON = { '報名': '＋', '取消': '－', '改期': '↔' };
  let memo = null; // { at, data }：同一次打開近期勤務不重複讀

  function timeText(t) {
    // 「2026-10-25 14:03:22」→「10/25 14:03」
    const m = String(t).match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
    return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}` : String(t);
  }

  function itemHtml(x) {
    const where = [x.date ? Fmt.shortDate(x.date) : '', x.dutyName, x.position ? x.position + (x.accompany ? '（陪同）' : '') : ''].filter(Boolean).join('・');
    const body = x.action === '改期' ? esc(x.summary.replace(/^[^｜]*｜/, '')) : esc(where || x.summary);
    return `<li class="rs-item rs-${x.action === '報名' ? 'add' : x.action === '取消' ? 'cancel' : 'move'}">
        <span class="rs-icon" aria-hidden="true">${ICON[x.action] || '・'}</span>
        <span class="rs-main"><strong>${esc(x.name)}</strong> ${esc(x.action)}<small class="rs-where">${body}</small></span>
        <span class="rs-time">${esc(timeText(x.time))}</span>
      </li>`;
  }

  function render(box, data, guard) {
    const items = data.items;
    const todayItems = items.filter((x) => String(x.time).slice(0, 10) === data.today);
    const count = (a) => todayItems.filter((x) => x.action === a).length;
    const head = todayItems.length ? ['報名', '取消', '改期'].filter((a) => count(a)).map((a) => `${count(a)} 筆${a}`).join('、') : '今天還沒有人報名或取消';
    box.innerHTML = `
      <details class="recent-signups"${items.length ? ' open' : ''}>
        <summary><strong>🆕 最新報名</strong><span class="h2-sub">今天：${esc(head)}</span></summary>
        ${items.length ? `<ul class="rs-list">${items.slice(0, SHOW).map(itemHtml).join('')}</ul>
          ${items.length > SHOW ? `<button type="button" class="link-btn" data-rs-more>看全部 ${items.length} 筆（最近 ${data.days} 天）</button>` : ''}`
          : `<p class="muted">最近 ${data.days} 天沒有人報名、取消或改期。</p>`}
        <div class="rs-watch" data-rs-watch></div>
      </details>`;
    const more = box.querySelector('[data-rs-more]');
    if (more) more.addEventListener('click', () => { box.querySelector('.rs-list').innerHTML = items.map(itemHtml).join(''); more.remove(); });
    drawWatch(box.querySelector('[data-rs-watch]'), guard);
  }

  /** 每天晚上 8 點的報名彙整（這支手機） */
  async function drawWatch(el, guard) {
    const st = window.PushPage ? PushPage.canNotify() : 'unsupported';
    if (st !== 'ok') { el.innerHTML = '<p class="hint">🔔 每天晚上的報名彙整：這支手機還不能收通知（iPhone 要先加到主畫面；或通知被封鎖）。</p>'; return; }
    const paint = (on) => {
      el.innerHTML = on
        ? '<p class="venue-watch-on">🔔 這支手機每天晚上 8 點會收到報名彙整（今天沒人報名就不通知） <button type="button" class="link-btn" data-off>關閉</button></p>'
        : '<p class="hint">🔔 想每天晚上 8 點在手機收到「今天誰報名、誰取消」？</p><button type="button" class="btn" data-on>開啟報名彙整通知</button>';
      const on2 = el.querySelector('[data-on]');
      const off = el.querySelector('[data-off]');
      if (on2) on2.addEventListener('click', () => set(true));
      if (off) off.addEventListener('click', () => set(false));
    };
    const set = async (value) => {
      try {
        const endpoint = await PushPage.ensureSub();
        paint((await Api.admin('adminSignupDigestWatch', { endpoint, on: value })).on);
      } catch (e) {
        if (guard && guard(e)) return;
        el.insertAdjacentHTML('beforeend', `<p class="form-error">${esc(e.message || '設定失敗')}</p>`);
      }
    };
    const sub = await PushPage.currentSub();
    if (!sub) { paint(false); return; }
    try { paint((await Api.admin('adminSignupDigestWatch', { endpoint: sub.endpoint }, true)).on); } catch (e) { paint(false); }
  }

  /** 在 box 裡顯示；fresh＝重新讀（打開近期勤務時），否則用剛剛讀到的 */
  async function mount(box, guard, fresh) {
    if (!box) return;
    if (memo && !fresh && Date.now() - memo.at < 60000) { render(box, memo.data, guard); return; }
    box.innerHTML = '<p class="muted rs-loading">讀取最新報名中⋯</p>';
    try {
      const data = await Api.admin('adminRecentSignups', {}, true);
      memo = { at: Date.now(), data };
      if (box.isConnected) render(box, data, guard);
    } catch (e) {
      if (guard && guard(e)) return;
      box.innerHTML = '';
    }
  }

  window.RecentSignups = { mount, timeText };
})();
