// 管理後台（規格第 8 節）：登入、近期勤務、勤務名單管理（含組長電話、取消／改期任何日期）。
// 操作紀錄與明日名單在 admin-pages.js。
//   #/admin           近期勤務（未登入時顯示登入）
//   #/admin/duty/<id> 勤務名單管理
//   #/admin/duties…   勤務管理：列表、新增、編輯（見 admin-duties.js）
//   #/admin/logs      操作紀錄與還原
//   #/admin/day       明日名單
(function () {
  'use strict';

  const esc = Fmt.esc;
  let root = null;
  let token = 0; // 換頁時丟棄舊的回應

  // ---------- 先顯示、再更新 ----------
  // 管理 API 每次約 1.5–2 秒（冷啟動更久）。看過的資料記在記憶體，再進來先立刻顯示，同時在背景更新；
  // 有任何寫入（取消、改期、還原）就全部清掉。
  const memo = new Map();

  /**
   * key：記憶的名稱；fetcher：向伺服器讀；render(data, stale)：畫面（stale=true 代表先顯示的舊資料）。
   * preview：沒有記憶時可先顯示的資料（例如行事曆已載入的）。
   */
  async function swr(key, fetcher, render, box, preview) {
    const t = token;
    const early = memo.get(key) || preview;
    if (early) render(early, true);
    try {
      const data = await fetcher();
      if (t !== token) return;
      memo.set(key, data);
      render(data, false);
    } catch (err) {
      if (t !== token) return;
      if (err.code === 'UNAUTHORIZED' || !early) guard(err, box);
      else {
        const s = root.querySelector('[data-stale]');
        if (s) s.textContent = '無法更新，目前顯示的是剛才的資料';
      }
    }
  }

  function clearMemo() {
    memo.clear();
  }

  /** 登入後在背景先抓操作紀錄與明日名單，切換分頁時就不用等 */
  function prefetch() {
    const tomorrow = Fmt.addDays(Fmt.toDateStr(new Date()), 1);
    [['logs', () => Api.admin('adminLogs', { offset: 0, limit: 50 }, true)],
      ['day:' + tomorrow, () => Api.admin('adminDay', { date: tomorrow }, true)]].forEach(([key, fetcher]) => {
      if (!memo.has(key)) fetcher().then((data) => memo.set(key, data)).catch(() => {});
    });
  }

  /** 畫面上「更新中」的小字 */
  function staleNote(stale) {
    return `<p class="stale-note" data-stale>${stale ? '更新中⋯' : ''}</p>`;
  }

  function show(sub) {
    root = document.getElementById('view-admin');
    token += 1;
    if (!Api.isAdmin()) return renderLogin();
    const m = sub.match(/^duty\/([^?]+)(?:\?date=(\d{4}-\d{2}-\d{2}))?/);
    if (m) return showDuty(decodeURIComponent(m[1]), m[2] || '');
    if (/^duties(\/|\?|$)/.test(sub)) return DutyAdminPage.show(shell('duties'), guard, sub);
    if (sub === 'logs') return AdminPages.logs(shell('logs'), guard);
    if (sub === 'day') return AdminPages.day(shell('day'), guard);
    return showRecent();
  }

  /** 管理頁共用外框：上方分頁＋內容區，回傳內容區元素 */
  function shell(active) {
    const tabs = [['', '近期勤務'], ['duties', '勤務管理'], ['logs', '操作紀錄'], ['day', '明日名單']];
    root.innerHTML = `
      <div class="admin-head">
        <h1 class="admin-title">管理後台</h1>
        <button type="button" class="btn btn-small" data-logout>登出</button>
      </div>
      <nav class="admin-tabs" aria-label="管理功能">
        ${tabs.map(([k, label]) => `<a href="#/admin${k ? '/' + k : ''}" class="admin-tab${k === active ? ' is-active' : ''}">${label}</a>`).join('')}
      </nav>
      <div class="admin-body" data-body><p class="panel-empty">載入中⋯</p></div>`;
    root.querySelector('[data-logout]').addEventListener('click', () => {
      Api.adminLogout();
      location.hash = '#/admin';
      renderLogin();
    });
    return root.querySelector('[data-body]');
  }

  /** 管理 API 錯誤處理：登入過期就回登入畫面，其他顯示訊息；回傳 true 代表已處理 */
  function guard(err, box) {
    if (err.code === 'UNAUTHORIZED') {
      renderLogin('登入已過期，請重新登入');
      return true;
    }
    if (box) box.innerHTML = `<div class="notice notice-error" role="alert"><p>${esc(err.message || '發生錯誤')}</p></div>`;
    return false;
  }

  // ---------- 登入 ----------

  function renderLogin(message) {
    root.innerHTML = `
      <a class="back-link" href="#/">‹ 回行事曆</a>
      <form class="admin-login" novalidate>
        <h1 class="admin-title">管理者登入</h1>
        ${message ? `<p class="notice notice-error">${esc(message)}</p>` : ''}
        <label class="field-label" for="admin-password">管理密碼</label>
        <input id="admin-password" class="input" type="password" autocomplete="current-password" required>
        <div class="form-error" data-error hidden></div>
        <button type="submit" class="btn btn-primary btn-block">登入</button>
      </form>`;
    const form = root.querySelector('form');
    const input = form.querySelector('input');
    input.focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = form.querySelector('[data-error]');
      if (!input.value) {
        box.textContent = '請輸入管理密碼';
        box.hidden = false;
        return;
      }
      Busy.show('登入中⋯');
      try {
        await Api.adminLogin(input.value);
        Busy.hide();
        show(location.hash.replace(/^#\/admin\/?/, ''));
      } catch (err) {
        Busy.hide();
        box.textContent = err.message || '登入失敗';
        box.hidden = false;
        input.select();
      }
    });
  }

  // ---------- 近期勤務 ----------

  function showRecent() {
    const body = shell('');
    // 行事曆已載入的資料可以先顯示（內容與 adminRecent 相同）
    const today = Fmt.toDateStr(new Date());
    const preview = window.CalendarPage && CalendarPage.peekRange(today, Fmt.addDays(today, 13));
    swr('recent', () => Api.admin('adminRecent', { days: 14 }, true), (data, stale) => renderRecent(body, data, stale), body, preview);
    prefetch();
  }

  function renderRecent(body, data, stale) {
    {
      const rows = [];
      data.duties.forEach((d) => Object.keys(d.days).length
        ? Object.keys(d.days).forEach((date) => rows.push({ d, date, st: Fmt.dayState(d, d.days[date]) }))
        : rows.push({ d, date: d.start >= data.today ? d.start : data.today, st: Fmt.dayState(d, null) }));
      rows.sort((a, b) => a.date.localeCompare(b.date) || a.d.name.localeCompare(b.d.name, 'zh-Hant'));
      const shortDates = new Set(rows.filter((r) => r.st.kind === 'short').map((r) => r.date));

      const byDate = new Map();
      rows.forEach((r) => {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date).push(r);
      });

      body.innerHTML = `
        ${staleNote(stale)}
        ${shortDates.size
          ? `<div class="notice notice-error" role="status"><p><strong>近 14 天有 ${shortDates.size} 天缺人</strong></p><p>${[...shortDates].map(Fmt.shortDate).join('、')}</p></div>`
          : '<div class="notice notice-success" role="status"><p><strong>近 14 天都不缺人</strong></p></div>'}
        ${[...byDate.entries()].map(([date, items]) => `
          <section class="admin-day">
            <h2 class="admin-day-title">${Fmt.shortDate(date)}${date === data.today ? '<span class="h2-sub">今天</span>' : ''}</h2>
            <div class="card-list">
              ${items.map(({ d, st }) => `
                <a class="duty-card kind-${st.kind}" href="#/admin/duty/${encodeURIComponent(d.id)}?date=${date}">
                  <span class="card-main">
                    <span class="card-title">${esc(d.name)}</span>
                    <span class="card-meta">${esc([d.location, Fmt.cardTime(d, date), d.group].filter(Boolean).join('・'))}</span>
                  </span>
                  <span class="badge badge-${st.kind}">${esc(st.label)}</span>
                </a>`).join('')}
            </div>
          </section>`).join('') || '<p class="panel-empty">近 14 天沒有勤務</p>'}`;
    }
  }

  // ---------- 勤務名單管理 ----------

  const dutyPage = { id: null, data: null, viewDate: null, flash: '' };

  async function showDuty(id, date) {
    dutyPage.id = id;
    dutyPage.viewDate = date;
    dutyPage.flash = '';
    shell('');
    await loadDuty();
  }

  function loadDuty() {
    const body = root.querySelector('[data-body]');
    // 沒有記憶時，先用行事曆資料顯示勤務資訊（名單等讀到再補）
    const preview = window.CalendarPage && CalendarPage.peekDuty(dutyPage.id);
    if (preview) preview.signups = null;
    return swr('duty:' + dutyPage.id, () => Api.admin('adminDuty', { id: dutyPage.id }, true), (data, stale) => {
      dutyPage.data = data;
      dutyPage.stale = stale;
      const dates = Fmt.datesBetween(data.start, data.end);
      if (dates.indexOf(dutyPage.viewDate) === -1) dutyPage.viewDate = dates.find((x) => x >= data.today) || dates[0];
      renderDuty();
    }, body, preview);
  }

  function renderDuty() {
    const d = dutyPage.data;
    const body = root.querySelector('[data-body]');
    const dates = Fmt.datesBetween(d.start, d.end);
    const date = dutyPage.viewDate;
    const contact = d.groupContact;
    const isNotice = d.mode === '公告型';

    const positions = d.positions.map((p) => {
      const people = d.signups ? d.signups.filter((s) => s.date === date && s.positionId === p.id) : [];
      const count = d.signups ? people.filter((s) => !s.accompany).length : ((d.days[date] && d.days[date].counts[p.id]) || 0);
      return `
        <li class="position">
          <div class="position-head">
            <span class="position-name">${esc(p.name)}</span>
            <span class="badge badge-ok">${count}${p.max !== null ? '／' + p.max : ''} 人${count < Fmt.effectiveMin(p) ? `・缺 ${Fmt.effectiveMin(p) - count}` : ''}</span>
          </div>
          ${!d.signups ? '<p class="muted">載入名單中⋯</p>' : people.length ? `<ul class="people">${people.map((s) => `
            <li class="person-row">
              <span class="person">${esc(s.name)}
                ${s.identity ? `<span class="tag">${esc(s.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
                ${s.accompany ? '<span class="tag">陪同</span>' : ''}
              </span>
              ${dutyPage.stale ? '' : `<span class="person-actions">
                <button type="button" class="btn btn-small" data-reschedule="${esc(s.id)}">改期</button>
                <button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${esc(s.id)}">取消</button>
              </span>`}
            </li>`).join('')}</ul>` : '<p class="muted">還沒有人報名</p>'}
        </li>`;
    }).join('');

    body.innerHTML = `
      <a class="back-link" href="#/admin">‹ 近期勤務</a>
      ${staleNote(dutyPage.stale)}
      <h2 class="detail-title">${esc(d.name)}</h2>
      ${dutyPage.flash}
      <dl class="detail-info">
        <div><dt>日期</dt><dd>${esc(d.start === d.end ? Fmt.rocDate(d.start) : `${Fmt.rocDate(d.start)} – ${Fmt.shortDate(d.end)}`)}</dd></div>
        ${Fmt.timeRange(d) ? `<div><dt>時段</dt><dd>${esc(Fmt.timeRange(d))}</dd></div>` : ''}
        ${d.location ? `<div><dt>地點</dt><dd>${esc(d.location)}</dd></div>` : ''}
        ${d.group ? `<div><dt>負責組</dt><dd>${esc(d.group)}</dd></div>` : ''}
        ${contact && (contact.leader || contact.phone) ? `<div><dt>組長</dt><dd>${esc(contact.leader || '')}${contact.phone ? `　<a href="tel:${esc(contact.phone.replace(/[^\d+]/g, ''))}">${esc(contact.phone)}</a>` : ''}</dd></div>` : ''}
      </dl>
      ${isNotice ? '<p class="hint">公告型勤務不需報名。</p>' : `
        <section class="detail-section">
          <h3 class="admin-sub">報名名單${dates.length > 1 ? `<span class="h2-sub">${Fmt.shortDate(date)}</span>` : ''}</h3>
          ${dates.length > 1 ? `<div class="date-tabs">${dates.map((x) => `<button type="button" class="date-tab${x === date ? ' is-active' : ''}" data-date="${x}"><span class="date-tab-day">${Fmt.shortDate(x)}</span></button>`).join('')}</div>` : ''}
          <ul class="position-list">${positions}</ul>
          <p class="hint">管理者可以取消、改期任何日期（含當天與過去）的報名。</p>
        </section>`}
      <p class="admin-links"><a href="#/admin/duties/edit/${encodeURIComponent(d.id)}">編輯勤務 ›</a><a href="#/duty/${encodeURIComponent(d.id)}?date=${date}">查看一般使用者看到的頁面 ›</a></p>`;

    body.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => {
      dutyPage.viewDate = b.dataset.date;
      dutyPage.flash = '';
      renderDuty();
    }));
    const find = (id) => (d.signups || []).find((s) => s.id === id);
    body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => adminCancel(find(b.dataset.cancel))));
    body.querySelectorAll('[data-reschedule]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.reschedule);
      Reschedule.open(s, d, (result) => {
        dutyPage.flash = notice('success', '已改期', `${s.name}：${Fmt.shortDate(s.date)} → ${Fmt.shortDate(result.date)} ${result.positionName}`);
        afterChange();
      }, { submit: (payload) => Api.admin('adminReschedule', payload) });
    }));
  }

  function notice(kind, title, text) {
    return `<div class="notice notice-${kind}" role="status"><p><strong>${esc(title)}</strong></p>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
  }

  function afterChange() {
    clearMemo();
    if (window.CalendarPage) CalendarPage.refresh();
    loadDuty();
  }

  async function adminCancel(s) {
    if (!s) return;
    const d = dutyPage.data;
    const p = d.positions.find((x) => x.id === s.positionId);
    const ok = await Confirm.open({
      title: '確定要取消這筆報名嗎？',
      rows: [['姓名', s.name + (s.accompany ? '（陪同）' : '')], ['日期', Fmt.rocDate(s.date)], ['勤務', d.name], ['了愿項目', p ? p.name : '']],
      note: '取消後可在「操作紀錄」還原。',
      confirmText: '確定取消報名',
      cancelText: '不要取消',
      danger: true
    });
    if (!ok) return;
    Busy.show('取消中⋯');
    try {
      await Api.admin('adminCancel', { signupId: s.id });
      Busy.hide();
      dutyPage.flash = notice('success', '已取消報名', `${s.name}・${Fmt.shortDate(s.date)}・${p ? p.name : ''}`);
    } catch (err) {
      Busy.hide();
      if (guard(err)) return;
      dutyPage.flash = notice('error', err.message || '取消失敗', err.code === 'NETWORK' ? '網路不穩，請看下方名單確認是否已取消。' : '');
    }
    afterChange();
  }

  window.AdminPage = { show, notice, guard, swr, clearMemo, staleNote };
})();
