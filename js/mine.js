// 「我的報名」（#/mine）：輸入名字，列出今天起還有效的報名，可取消（一筆或勾選多筆）、改期。
// 取消、改期只能在這裡做（勤務頁名單沒有按鈕，避免誤按到別人的）。
// 名字用 POST 送到伺服器（不放網址）；上次查的名字記在這台瀏覽器，下次自動帶入。
// 打字時跟報名一樣從成員名單提示名字，點一下就查。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const NAME_KEY = 'duty-calendar:mine-name';
  let root = null;
  let token = 0;
  let current = null; // { name, today, items }
  const searchCache = new Map(); // 打的字 → 成員名單符合的名字
  let searchTimer = null;
  let searchToken = 0;

  function savedName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function saveName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* 無痕模式等，忽略 */ }
  }

  function show() {
    root = document.getElementById('view-mine');
    token += 1;
    root.innerHTML = `
      <h1 class="page-title">我的報名</h1>
      <p class="hint">輸入名字，就能看到這個人之後報了哪些勤務、活動，可以取消或改期。</p>
      <form class="mine-form" novalidate>
        <label class="field-label" for="mine-name">名字</label>
        <div class="mine-row">
          <input id="mine-name" class="input" type="text" autocomplete="name" placeholder="例如：王小明" value="${esc(savedName())}">
          <button type="submit" class="btn btn-primary">查詢</button>
        </div>
        <div class="suggestions" data-suggestions aria-live="polite"></div>
        <p class="hint">打一個字就會提示成員名單上的名字，點一下就查。要和報名時寫的名字一樣（例如有沒有寫姓）。</p>
      </form>
      <div data-result aria-live="polite"></div>
      <a class="help-inline" href="#/help?c=取消改期">❓ 不知道怎麼用？看常見問題</a>
      <a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>`;
    const form = root.querySelector('form');
    const input = form.querySelector('input');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      clearSuggestions();
      search(input.value);
    });
    input.addEventListener('focus', () => Api.warmUp(), { once: true });
    input.addEventListener('input', () => onInput(input.value));
    root.querySelector('[data-suggestions]').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-suggest]');
      if (!btn) return;
      input.value = btn.dataset.suggest;
      clearSuggestions();
      search(btn.dataset.suggest);
    });
    current = null;
    if (savedName()) search(savedName());
  }

  // ---------- 名字提示（成員名單） ----------

  function clearSuggestions() {
    clearTimeout(searchTimer);
    searchToken += 1;
    const box = root.querySelector('[data-suggestions]');
    if (box) box.innerHTML = '';
  }

  function renderSuggestions(members, pending) {
    const box = root.querySelector('[data-suggestions]');
    box.innerHTML = members.slice(0, 12).map((m) => `<button type="button" class="suggestion" data-suggest="${esc(m.name)}">${esc(m.name)}</button>`).join('') +
      (pending ? '<span class="muted small">搜尋更多中⋯</span>' : '');
  }

  function onInput(raw) {
    clearTimeout(searchTimer);
    const q = String(raw || '').replace(/[\s　]+/g, '');
    if (!q) { clearSuggestions(); return; }
    if (searchCache.has(q)) { renderSuggestions(searchCache.get(q)); return; }
    // 先用查過的結果在本機篩選先顯示，等伺服器回來再補齊
    const early = new Map();
    searchCache.forEach((list) => list.forEach((m) => { if (m.name.indexOf(q) !== -1) early.set(m.name, m); }));
    if (early.size) renderSuggestions([...early.values()], true);
    searchTimer = setTimeout(async () => {
      const t = ++searchToken;
      if (!early.size) root.querySelector('[data-suggestions]').innerHTML = '<span class="muted small">搜尋中⋯ 也可以直接打完整名字按「查詢」</span>';
      try {
        const res = await Api.searchMembers(q);
        searchCache.set(q, res.members);
        if (t === searchToken) renderSuggestions(res.members);
      } catch (e) {
        if (t === searchToken && !early.size) root.querySelector('[data-suggestions]').innerHTML = '';
      }
    }, 250);
  }

  async function search(raw, flash) {
    const name = String(raw || '').replace(/[\s　]+/g, '');
    const box = root.querySelector('[data-result]');
    if (name.length < 2) {
      box.innerHTML = '<div class="notice notice-error" role="alert"><p>請輸入完整的名字（至少 2 個字）</p></div>';
      return;
    }
    const t = ++token;
    box.innerHTML = '<p class="panel-empty">查詢中⋯</p>';
    try {
      const data = await Api.mySignups(name);
      if (t !== token) return;
      saveName(name);
      current = data;
      render(flash);
    } catch (err) {
      if (t !== token) return;
      box.innerHTML = `<div class="notice notice-error" role="alert"><p>${esc(err.message || '查詢失敗，請稍後再試')}</p></div>`;
    }
  }

  function render(flash) {
    const box = root.querySelector('[data-result]');
    const { name, items } = current;
    if (!items.length) {
      box.innerHTML = `${flash || ''}
        <div class="notice" role="status"><p>查不到<strong>${esc(name)}</strong>今天以後的報名。</p>
        <p class="muted">如果有報名卻查不到，可能報名時名字寫法不一樣（例如沒寫姓），可以到行事曆點進勤務看名單。</p></div>`;
      return;
    }
    const byDate = new Map();
    items.forEach((it) => {
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    });
    const canAny = items.some((it) => it.canChange);
    box.innerHTML = `${flash || ''}
      <h2 class="mine-title">${esc(name)}　共 ${items.length} 筆報名</h2>
      ${canAny ? `<div class="mine-bulk">
        <span>要取消好幾筆：先勾選，再按最下面的按鈕</span>
        <span class="mine-bulk-quick"><button type="button" class="link-btn" data-pick-all>全選</button><button type="button" class="link-btn" data-pick-none>都不選</button></span>
      </div>` : ''}
      ${[...byDate.entries()].map(([date, list]) => `
        <section class="mine-day">
          <h3 class="mine-date">${Fmt.shortDate(date)}${date === current.today ? '<span class="h2-sub">今天</span>' : ''}</h3>
          ${list.map((it) => itemHtml(it)).join('')}
        </section>`).join('')}
      ${canAny ? '<button type="button" class="btn btn-quiet-danger btn-block mine-bulk-go" data-cancel-picked>取消勾選的報名</button>' : ''}`;
    offerPushMe(box, name);
    const find = (id) => current.items.find((x) => x.signupId === id);
    box.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => cancel(find(btn.dataset.cancel))));
    box.querySelectorAll('[data-reschedule]').forEach((btn) => btn.addEventListener('click', () => reschedule(find(btn.dataset.reschedule))));
    const picks = () => [...box.querySelectorAll('[data-pick]')];
    const all = box.querySelector('[data-pick-all]');
    if (all) all.addEventListener('click', () => picks().forEach((c) => { c.checked = true; }));
    const none = box.querySelector('[data-pick-none]');
    if (none) none.addEventListener('click', () => picks().forEach((c) => { c.checked = false; }));
    const go = box.querySelector('[data-cancel-picked]');
    if (go) go.addEventListener('click', () => {
      const list = picks().filter((c) => c.checked).map((c) => find(c.dataset.pick)).filter(Boolean);
      if (!list.length) { alert('請先勾要取消的報名'); return; }
      cancelMany(list);
    });
  }

  function itemHtml(it) {
    const duty = { start: it.start, end: it.end, startTime: it.startTime, endTime: it.endTime };
    const meta = [Fmt.cardTime(duty, it.date), it.location].filter(Boolean).join('・');
    const href = `#/duty/${encodeURIComponent(it.dutyId)}?date=${it.date}`;
    return `
      <div class="mine-item">
        ${it.canChange ? `<label class="mine-pick"><input type="checkbox" data-pick="${esc(it.signupId)}" aria-label="勾選 ${esc(Fmt.shortDate(it.date) + ' ' + it.dutyName)}"></label>` : ''}
        <a class="mine-main" href="${href}">
          <span class="card-title">${esc(it.dutyName)}</span>
          <span class="card-meta">${esc(it.positionName)}${it.accompany ? '（陪同）' : ''}${it.temple ? '・' + esc(it.temple) : ''}</span>
          ${meta ? `<span class="card-meta">${esc(meta)}</span>` : ''}
        </a>
        ${it.canChange ? `
          <div class="mine-actions">
            <button type="button" class="btn btn-quiet-danger" data-cancel="${esc(it.signupId)}">取消</button>
            ${it.nature === '活動' ? '' : `<button type="button" class="btn" data-reschedule="${esc(it.signupId)}">改期</button>`}
          </div>` : `<p class="muted mine-note">當天（含）之後不能自己取消或改期，${esc(Fmt.askAdmin())}</p>`}
        <div class="addcal-row">${AddCal.button({ name: it.dutyName, location: it.location, start: it.start, end: it.end, startTime: it.startTime, endTime: it.endTime, dutyId: it.dutyId, date: it.date })}</div>
      </div>`;
  }

  async function cancel(it) {
    if (!it) return;
    const who = current.name + (it.accompany ? '（陪同）' : '');
    const ok = await Confirm.open({
      title: '確定要取消這筆報名嗎？',
      rows: [['姓名', who], ['日期', Fmt.rocDate(it.date)], ['項目', it.dutyName], ['了愿項目', it.positionName]],
      confirmText: '確定取消報名',
      cancelText: '不要取消',
      danger: true
    });
    if (!ok) return;
    const doneText = `${who}・${Fmt.shortDate(it.date)}・${it.dutyName}・${it.positionName}`;
    const flash = (kind, title, text) => `<div class="notice notice-${kind}" role="${kind === 'error' ? 'alert' : 'status'}">
      <p><strong>${esc(title)}</strong></p>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
    Busy.show('取消中，請稍候⋯', '請不要關閉畫面');
    try {
      await Api.retryBusy(() => Api.cancel(it.signupId),
        () => Busy.show('使用的人較多，正在排隊⋯', '系統會自動重試，請不要關閉畫面'));
      Busy.hide();
      if (window.CalendarPage) CalendarPage.refresh();
      await search(current.name, flash('success', '已取消報名', doneText));
    } catch (err) {
      Busy.hide();
      if (err.code === 'NETWORK' || err.code === 'ALREADY' || err.code === 'NOT_FOUND') {
        // 沒收到回應、或已經取消過：重新查一次，看這筆還在不在
        await search(current.name);
        const still = current && current.items.some((x) => x.signupId === it.signupId);
        render(still ? flash('error', '沒有取消成功', '請再按一次「取消」。') : flash('success', '已取消報名', doneText));
        return;
      }
      render(flash('error', err.message || '取消失敗，請稍後再試', ''));
    }
  }

  /** 開了手機提醒、還沒填「我是誰」：問要不要只提醒這個人的勤務 */
  async function offerPushMe(box, name) {
    if (!window.PushPage || PushPage.myName()) return;
    if ((await PushPage.state()) !== 'on' || !box.isConnected) return;
    const card = document.createElement('div');
    card.className = 'notice push-me-offer';
    card.innerHTML = `<p>🔔 要讓手機提醒<strong>只通知「${esc(name)}」報名的勤務</strong>嗎？（還缺人的也會告訴您）</p>
      <div class="push-card-actions"><button type="button" class="btn btn-primary" data-yes>好的</button><button type="button" class="btn" data-no>不用，全部都提醒</button></div>`;
    box.insertBefore(card, box.querySelector('.mine-title') ? box.querySelector('.mine-title').nextSibling : box.firstChild);
    card.querySelector('[data-no]').addEventListener('click', () => card.remove());
    card.querySelector('[data-yes]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        await PushPage.setMe(name);
        card.innerHTML = `<p>✅ 好的，之後只提醒「${esc(name)}」報名的勤務 😊（可以在「🔔 手機提醒」改）</p>`;
      } catch (e) {
        card.innerHTML = `<p class="form-error">${esc(e.message || '沒有設定成功')}</p>`;
      }
    });
  }

  /** 勾選的好幾筆一起取消：確認一次，逐筆送出，最後重新查詢 */
  async function cancelMany(list) {
    const ok = await Confirm.open({
      title: `確定要取消這 ${list.length} 筆報名嗎？`,
      rows: list.map((it) => [Fmt.shortDate(it.date), it.dutyName + '・' + it.positionName + (it.accompany ? '（陪同）' : '')]),
      confirmText: `確定取消 ${list.length} 筆`,
      cancelText: '不要取消',
      danger: true
    });
    if (!ok) return;
    const done = [];
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      Busy.show(`取消中（${i + 1}／${list.length}）⋯`, '請不要關閉畫面');
      try {
        await Api.retryBusy(() => Api.cancel(it.signupId),
          () => Busy.show('使用的人較多，正在排隊⋯', '系統會自動重試，請不要關閉畫面'));
        done.push(it);
      } catch (err) {
        if (err.code === 'ALREADY' || err.code === 'NOT_FOUND') done.push(it);
        else failed.push([it, err]);
      }
    }
    Busy.hide();
    if (window.CalendarPage) CalendarPage.refresh();
    const line = (it) => `${Fmt.shortDate(it.date)} ${it.dutyName}・${it.positionName}`;
    let msg = '';
    if (done.length) msg += `<div class="notice notice-success" role="status"><p><strong>已取消 ${done.length} 筆報名</strong></p><p>${done.map((it) => esc(line(it))).join('<br>')}</p></div>`;
    if (failed.length) msg += `<div class="notice notice-error" role="alert"><p><strong>${failed.length} 筆沒有取消</strong></p><p>${failed.map(([it, err]) => esc(line(it) + '：' + (err.message || '請再試一次'))).join('<br>')}</p></div>`;
    await search(current.name, msg);
  }

  /** 改期：讀這個勤務的資料後打開改期視窗（和勤務頁同一個） */
  async function reschedule(it) {
    if (!it) return;
    Busy.show('讀取中⋯');
    let duty;
    try {
      duty = await Api.getDuty(it.dutyId);
    } catch (err) {
      Busy.hide();
      render(`<div class="notice notice-error" role="alert"><p>${esc(err.message || '讀取失敗，請稍後再試')}</p></div>`);
      return;
    }
    Busy.hide();
    const signup = { id: it.signupId, date: it.date, positionId: it.positionId, name: current.name, accompany: it.accompany };
    Reschedule.open(signup, duty, async (result) => {
      if (window.CalendarPage) CalendarPage.refresh();
      const text = result.date ? `${Fmt.shortDate(it.date)} ${it.positionName} → ${Fmt.shortDate(result.date)} ${result.positionName || ''}` : '';
      await search(current.name, `<div class="notice notice-success" role="status"><p><strong>已改期</strong></p>${text ? `<p>${esc(it.dutyName + '：' + text)}</p>` : ''}</div>`);
    });
  }

  window.MinePage = { show };
})();
