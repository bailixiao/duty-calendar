// 管理後台（規格第 8 節）：登入、近期勤務、勤務名單管理（含組長電話、取消／改期任何日期）。
// 操作紀錄與名單在 admin-pages.js。
//   #/admin           近期勤務（未登入時顯示登入）
//   #/admin/duty/<id> 勤務名單管理
//   #/admin/duties…   勤務管理：列表、新增、編輯（見 admin-duties.js）
//   #/admin/import    批次匯入（見 admin-import.js）
//   #/admin/members   成員名單管理、#/admin/groups 分組管理（見 admin-people.js）
//   #/admin/stats     統計（見 admin-stats.js）、#/admin/history 匯入歷史資料（見 admin-history.js）
//   #/admin/logs      操作紀錄與還原
//   #/admin/day       名單（今天起一個月，勾日期產生文字）
//   #/admin/push      推播（見 admin-push.js）
//   #/admin/help      教學（常見問題的管理者題目與編輯，見 help.js）
(function () {
  'use strict';

  const esc = Fmt.esc;
  let root = null;
  let token = 0; // 換頁時丟棄舊的回應

  // ---------- 先顯示、再更新 ----------
  // 管理 API 每次約 1.5–2 秒（冷啟動更久）。看過的資料記在記憶體，再進來先立刻顯示，同時在背景更新；
  // 有任何寫入（取消、改期、還原）就全部清掉，並在背景重新抓。
  // 只記在記憶體（有身分、電話的資料不存進手機），關掉網頁就沒了。
  const memo = new Map(); // key → { data, at }
  const pending = new Map(); // key → 讀取中的 Promise（預先讀取與畫面共用，不重複問伺服器）
  const FRESH_MS = 20000; // 20 秒內抓到的直接用，不再問伺服器

  function fetchShared(key, fetcher) {
    if (pending.has(key)) return pending.get(key);
    const p = fetcher().then((data) => {
      pending.delete(key);
      memo.set(key, { data, at: Date.now() });
      return data;
    }, (err) => {
      pending.delete(key);
      throw err;
    });
    pending.set(key, p);
    return p;
  }

  /**
   * key：記憶的名稱；fetcher：向伺服器讀；render(data, stale)：畫面（stale=true 代表先顯示的舊資料）。
   * preview：沒有記憶時可先顯示的資料（例如行事曆已載入的）。
   */
  async function swr(key, fetcher, render, box, preview) {
    const t = token;
    const m = memo.get(key);
    if (m && Date.now() - m.at < FRESH_MS) { render(m.data, false); return; }
    const early = (m && m.data) || preview;
    if (early) render(early, true);
    try {
      const data = await fetchShared(key, fetcher);
      if (t !== token) return;
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
    pending.clear();
    setTimeout(prefetch, 300); // 寫入後在背景重新抓各分頁
  }

  /** 進管理後台就在背景先抓各分頁的資料（同時送出），切換分頁時就不用等 */
  function prefetch() {
    if (!Api.isAdmin() || Api.adminWho().role === '場管') return;
    [['recent', () => Api.admin('adminRecent', { days: 31 }, true)],
      ['members', () => Api.admin('adminMembers', {}, true)],
      ['groups', () => Api.admin('adminGroups', {}, true)],
      ...(Api.adminWho().role === '唯讀' ? [] : [['dutyList', () => Api.admin('adminDutyList', {}, true)]]), // 唯讀帳號看不到勤務管理
      ...(seesLogs() ? [['logs', () => Api.admin('adminLogs', { offset: 0, limit: 50 }, true)]] : []), // 操作紀錄：只有總管理者
      ...(seesRoster() ? [['roster', () => Api.admin('adminRoster', {}, true)]] : []),
      ['stats', () => Api.admin('adminStats', {}, true)]].forEach(([key, fetcher]) => {
      if (!memo.has(key)) fetchShared(key, fetcher).catch(() => {});
    });
  }

  /** 看得到「名單」的帳號：總管理者與勤務／道務／教育（類別帳號只看自己類別） */
  function seesRoster() {
    return ['總管理者', '勤務', '道務', '教育'].indexOf(Api.adminWho().role) !== -1;
  }

  /** 看得到操作紀錄的帳號：只有總管理者 */
  function seesLogs() {
    return Api.adminWho().role === '總管理者';
  }

  /** 畫面上「更新中」的小字 */
  function staleNote(stale) {
    return `<p class="stale-note" data-stale>${stale ? '更新中⋯' : ''}</p>`;
  }

  // ---------- 一次只能一台裝置登入 ----------
  // 別的裝置登入後，這台的通行碼就失效。停在管理後台時每 30 秒、以及切回這個分頁或視窗時問一次伺服器，
  // 失效就自動回登入畫面並說明原因（不用等到按下一個按鈕才發現）。
  let watching = false;
  function watchSession() {
    if (watching) return;
    watching = true;
    const onAdmin = () => location.hash.indexOf('#/admin') === 0;
    const check = () => {
      if (document.hidden || !Api.isAdmin() || !onAdmin()) return;
      Api.admin('adminPing', {}, true).catch((err) => {
        if (err.code !== 'UNAUTHORIZED' || !onAdmin()) return;
        token += 1;
        clearMemo();
        renderLogin(err.message);
      });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check); // 電腦上分頁一直開著、只是切到別的視窗再回來時
    setInterval(check, 30000);
  }

  function show(sub) {
    root = document.getElementById('view-admin');
    token += 1;
    watchSession();
    applyRole();
    if (!Api.isAdmin()) return renderLogin();
    prefetch();
    VenueAdminPage.autoWatch(); // 總管理者、場管：手機允許過通知就自動開啟場地申請通知
    if (sub === 'help') return HelpAdminPage.show(shell('help'), guard); // 📖 教學：所有後台帳號
    if (Api.adminWho().role === '場管' || sub === 'venue') return VenueAdminPage.show(shell('venue'), guard); // 場管帳號只有場地借用（和教學）
    if (sub === 'accounts') return AccountsPage.show(shell('accounts'), guard);
    const m = sub.match(/^duty\/([^?]+)(?:\?date=(\d{4}-\d{2}-\d{2}))?/);
    if (m) return showDuty(decodeURIComponent(m[1]), m[2] || '');
    if (/^duties(\/|\?|$)/.test(sub)) return DutyAdminPage.show(shell('duties'), guard, sub);
    if (sub === 'import') return ImportPage.show(shell('duties'), guard);
    if (sub === 'members') return PeoplePage.members(shell('members'), guard);
    if (sub === 'groups') return PeoplePage.groups(shell('groups'), guard);
    if (sub === 'stats') return StatsPage.show(shell('stats'), guard);
    if (sub === 'history') return HistoryPage.show(shell('stats'), guard);
    if (sub === 'logs' && seesLogs()) return AdminPages.logs(shell('logs'), guard);
    if (sub === 'day' && seesRoster()) return AdminPages.day(shell('day'), guard);
    if (sub === 'push' && seesRoster()) return PushAdminPage.show(shell('push'), guard);
    return showRecent();
  }

  /** 管理頁共用外框：上方分頁＋內容區，回傳內容區元素 */
  function shell(active) {
    const who = Api.adminWho();
    const T = term();
    const tabs = [['', '近期' + T], ['duties', T + '管理'], ['members', '成員'], ['groups', '分組'], ['stats', '統計'], ['logs', '操作紀錄'], ['day', '名單'], ['push', '📣 推播']];
    if (['總管理者', '唯讀'].indexOf(who.role) !== -1) tabs.push(['venue', '場地借用']);
    if (who.role === '總管理者') tabs.push(['accounts', '帳號']);
    if (who.role === '唯讀') tabs.splice(tabs.findIndex((t) => t[0] === 'duties'), 1); // 唯讀帳號：不顯示勤務管理
    if (!seesLogs()) tabs.splice(tabs.findIndex((t) => t[0] === 'logs'), 1); // 操作紀錄只給總管理者
    if (!seesRoster()) ['day', 'push'].forEach((k) => tabs.splice(tabs.findIndex((t) => t[0] === k), 1)); // 名單、推播：總管理者、勤務、道務、教育
    if (who.role === '場管') tabs.splice(0, tabs.length, ['venue', '場地借用']);
    tabs.push(['help', '📖 教學']);
    root.innerHTML = `
      <div class="admin-head">
        <h1 class="admin-title">管理後台</h1>
        <span class="admin-who">${esc(who.account)}${who.role !== who.account ? `<small>（${esc(who.role)}）</small>` : ''}</span>
        <button type="button" class="btn btn-small" data-logout>登出</button>
      </div>
      ${roleNote(who.role)}
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

  /** 角色說明（勤務／道務／教育／唯讀帳號在每頁上方看到） */
  function roleNote(role) {
    if (role === '唯讀') return '<p class="role-note">👀 唯讀帳號：可以查看所有資料，不能修改。</p>';
    if (role === '場管') return `<p class="role-note">🏠 ${esc(window.SITE.venue)}場管帳號：審核家人們的場地借用申請。</p>`;
    if (role === '勤務') return '<p class="role-note">這個帳號管理「勤務」類的勤務；成員、分組只能查看。</p>';
    if (['道務', '教育'].indexOf(role) !== -1) return `<p class="role-note">這個帳號管理「${esc(role)}」類的活動、課程與布達；也可以編輯成員、分組。</p>`;
    return '';
  }

  /** 畫面用詞：道務、教育帳號管的是課程、法會、布達，唯讀帳號三組都看得到，都叫「活動」；總管理者、勤務帳號叫「勤務」 */
  function term() {
    return Api.isAdmin() && ['道務', '教育', '唯讀'].indexOf(Api.adminWho().role) !== -1 ? '活動' : '勤務';
  }

  /** 依角色在 body 加上 class，CSS 會把用不到的按鈕藏起來 */
  function applyRole() {
    const role = Api.isAdmin() ? Api.adminWho().role : '';
    document.body.classList.toggle('role-super', role === '總管理者');
    document.body.classList.toggle('role-readonly', role === '唯讀');
    document.body.classList.toggle('role-cat', ['勤務', '道務', '教育'].indexOf(role) !== -1);
  }

  /** 管理 API 錯誤處理：登入過期就回登入畫面，其他顯示訊息；回傳 true 代表已處理 */
  function guard(err, box) {
    if (err.code === 'UNAUTHORIZED') {
      renderLogin(err.message || '登入已過期，請重新登入');
      return true;
    }
    if (box) box.innerHTML = `<div class="notice notice-error" role="alert"><p>${esc(err.message || '發生錯誤')}</p></div>`;
    return false;
  }

  // ---------- 登入 ----------

  function renderLogin(message) {
    // 回行事曆：標題列左上的「‹」
    root.innerHTML = `
      <form class="admin-login" novalidate>
        <div class="login-head">
          <img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72">
          <h1 class="login-title">管理後台</h1>
          <p class="login-sub">選擇帳號、輸入密碼後登入</p>
        </div>
        ${message ? `<p class="notice notice-error">${esc(message)}</p>` : ''}
        <label class="login-field">
          <span>帳號</span>
          <select id="admin-account" class="input login-input"><option value="總管理者">總管理者</option></select>
        </label>
        <label class="login-field">
          <span>密碼</span>
          <span class="login-pw">
            <input id="admin-password" class="input login-input" type="password" autocomplete="current-password" required>
            <button type="button" class="login-eye" data-eye aria-label="顯示密碼">顯示</button>
          </span>
        </label>
        <div class="form-error" data-error hidden></div>
        <button type="submit" class="btn btn-primary btn-block login-submit">登入</button>
        <p class="login-foot">忘記密碼請聯絡總管理者重設</p>
      </form>`;
    const form = root.querySelector('form');
    const input = form.querySelector('#admin-password');
    const pick = form.querySelector('#admin-account');
    const eye = form.querySelector('[data-eye]');
    eye.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      eye.textContent = showing ? '顯示' : '隱藏';
      eye.setAttribute('aria-label', showing ? '顯示密碼' : '隱藏密碼');
      input.focus();
    });
    const LAST_KEY = 'duty-calendar:admin-account';
    let last = '總管理者';
    try { last = localStorage.getItem(LAST_KEY) || '總管理者'; } catch (e) { /* 無痕模式 */ }
    const fill = (names) => {
      pick.innerHTML = names.map((n) => `<option value="${esc(n)}"${n === last ? ' selected' : ''}>${esc(n)}</option>`).join('');
    };
    fill([last === '總管理者' ? '總管理者' : last].concat(last === '總管理者' ? [] : ['總管理者']));
    Api.loginAccounts().then((res) => fill(res.accounts)).catch(() => { /* 讀不到清單：至少有上次的和總管理者 */ });
    input.focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = form.querySelector('[data-error]');
      if (!input.value) {
        box.textContent = '請輸入密碼';
        box.hidden = false;
        return;
      }
      Busy.show('登入中⋯');
      try {
        await Api.adminLogin(input.value, pick.value);
        try { localStorage.setItem(LAST_KEY, pick.value); } catch (e) { /* 無痕模式 */ }
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
    swr('recent', () => Api.admin('adminRecent', { days: 31 }, true), (data, stale) => renderRecent(body, data, stale), body, preview);
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
        ${['道務', '教育'].indexOf(Api.adminWho().role) !== -1 ? '' : shortDates.size
          ? `<div class="notice notice-error" role="status"><p><strong>近一個月有 ${shortDates.size} 天缺人</strong></p><p>${Fmt.shortDateList(shortDates)}</p>${Share.buttonsHtml()}</div>`
          : '<div class="notice notice-success" role="status"><p><strong>近一個月都不缺人</strong></p></div>'}
        ${[...byDate.entries()].map(([date, items]) => `
          <section class="admin-day">
            <h2 class="admin-day-title">${Fmt.shortDate(date)}${date === data.today ? '<span class="h2-sub">今天</span>' : ''}</h2>
            <div class="card-list">
              ${items.map(({ d, st }) => `
                <div class="recent-item">
                  <a class="duty-card kind-${st.kind}" href="#/admin/duty/${encodeURIComponent(d.id)}?date=${date}">
                    <span class="card-main">
                      <span class="card-title">${esc(d.name)}</span>
                      <span class="card-meta">${esc([d.location, Fmt.cardTime(d, date), d.group].filter(Boolean).join('・'))}</span>
                    </span>
                    <span class="badge badge-${st.kind}">${esc(st.label)}</span>
                  </a>
                  ${d.mode === '公告型' ? '' : `<div class="recent-tools">
                    <label class="check"><input type="checkbox" data-invite-pick="${esc(d.id)}|${date}"> 勾選</label>
                    <button type="button" class="link-btn" data-invite="${esc(d.id)}|${date}">📋 複製通知</button>
                  </div>`}
                </div>`).join('')}
            </div>
          </section>`).join('') || `<p class="panel-empty">近一個月沒有${term()}</p>`}
        ${rows.some((r) => r.d.mode !== '公告型') ? `<div class="invite-bar" data-invite-bar hidden>
          <span data-invite-count></span>
          <button type="button" class="btn btn-primary" data-invite-copy>複製勾選的通知</button>
          <button type="button" class="btn btn-line" data-invite-line>傳到 LINE</button>
        </div>` : ''}`;
      Share.bind(body, () => Share.shortageText(rows.map((r) => ({ duty: r.d, date: r.date, state: r.st }))));
      // 邀請通知：一筆直接複製；勾好幾筆合成一則
      const rowOf = (key) => {
        const [id, date] = key.split('|');
        const r = rows.find((x) => x.d.id === id && x.date === date);
        return r ? { duty: r.d, date } : null;
      };
      const flashBtn = (btn, text, back) => { btn.textContent = text; setTimeout(() => { btn.textContent = back; }, 2500); };
      body.querySelectorAll('[data-invite]').forEach((btn) => btn.addEventListener('click', async () => {
        const r = rowOf(btn.dataset.invite);
        if (!r) return;
        btn.textContent = '產生中⋯';
        flashBtn(btn, (await Share.copyText(await Share.inviteTextFull([r]))) ? '已複製 ✓' : '複製失敗', '📋 複製通知');
      }));
      const bar = body.querySelector('[data-invite-bar]');
      const picked = () => [...body.querySelectorAll('[data-invite-pick]:checked')].map((c) => rowOf(c.dataset.invitePick)).filter(Boolean);
      body.querySelectorAll('[data-invite-pick]').forEach((c) => c.addEventListener('change', () => {
        const n = picked().length;
        bar.hidden = !n;
        bar.querySelector('[data-invite-count]').textContent = `已勾 ${n} 筆`;
      }));
      if (bar) {
        const copyBtn = bar.querySelector('[data-invite-copy]');
        copyBtn.addEventListener('click', async () => { copyBtn.textContent = '產生中⋯'; flashBtn(copyBtn, (await Share.copyText(await Share.inviteTextFull(picked()))) ? '已複製 ✓' : '複製失敗', '複製勾選的通知'); });
        bar.querySelector('[data-invite-line]').addEventListener('click', async () => {
          const w = window.open('', '_blank'); // 先開視窗（等名單時被擋），之後再換網址
          if (w) w.opener = null;
          const url = 'https://line.me/R/msg/text/?' + encodeURIComponent(await Share.inviteTextFull(picked()));
          if (w) w.location.href = url; else location.href = url;
        });
      }
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

    // 勤務當天（含）之前：出席修正（未到、陪同、補登），規格第 8 節管理者後台第 4 項
    const past = date <= d.today;
    const canEdit = !!d.signups && !dutyPage.stale;
    const positions = d.positions.map((p) => {
      const people = d.signups ? d.signups.filter((s) => s.date === date && s.positionId === p.id) : [];
      const count = d.signups ? people.filter((s) => !s.accompany && (!past || s.attend !== '未到')).length : ((d.days[date] && d.days[date].counts[p.id]) || 0);
      return `
        <li class="position">
          <div class="position-head">
            <span class="position-name">${esc(p.name)}</span>
            <span class="badge badge-ok">${past ? '出席 ' : ''}${count}${p.max !== null ? '／' + p.max : ''} 人${!past && count < Fmt.effectiveMin(p) ? `・缺 ${Fmt.effectiveMin(p) - count}` : ''}</span>
          </div>
          ${!d.signups ? '<p class="muted">載入名單中⋯</p>' : people.length ? `<ul class="people">${people.map((s) => `
            <li class="person-row${past && s.attend === '未到' ? ' is-absent' : ''}">
              <span class="person"><span class="person-name">${s.leader ? '<span class="grid-star" title="組長">★</span>' : ''}${esc(s.name)}</span>${s.leader && d.leaderTitle ? `<span class="tag tag-leader">${esc(d.leaderTitle)}</span>` : ''}${s.temple ? `<span class="tag">${esc(s.temple)}</span>` : ''}
                ${s.identity ? `<span class="tag">${esc(s.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
                ${s.accompany ? '<span class="tag">陪同</span>' : ''}
                ${past && s.attend === '未到' ? '<span class="tag tag-warn">未到</span>' : ''}
                ${s.note ? `<span class="tag">註：${esc(s.note)}</span>` : ''}
              </span>
              ${canEdit ? `<span class="person-actions">
                ${past ? `<button type="button" class="btn btn-small" data-attend="${esc(s.id)}">${s.attend === '未到' ? '改出席' : '改未到'}</button>
                  ${s.identity === '壇辦' ? `<button type="button" class="btn btn-small" data-acc="${esc(s.id)}">${s.accompany ? '改了愿' : '改陪同'}</button>` : ''}` : ''}
                ${d.layout === '職司表' || (d.leaderTitle && !s.accompany) ? `<button type="button" class="btn btn-small" data-leader="${esc(s.id)}">${s.leader ? '取消組長' : '★ 設組長'}</button>` : ''}
                ${d.layout === '職司表' ? `<button type="button" class="btn btn-small" data-note="${esc(s.id)}">${s.note ? '改註記' : '加註記'}</button>` : ''}
                ${/[、,，.。．\/／;；|]/.test(s.name) || /^[\u4e00-\u9fff]{2,}([\s　]+[\u4e00-\u9fff]{2,})+$/.test(s.name) ? `<button type="button" class="btn btn-small btn-primary" data-split="${esc(s.id)}">拆成多人</button>` : ''}
                ${d.nature === '活動' ? '' : `<button type="button" class="btn btn-small" data-reschedule="${esc(s.id)}">改期</button>`}
                <button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${esc(s.id)}">取消</button>
              </span>` : ''}
            </li>`).join('')}</ul>` : `<p class="muted">${past ? '沒有人報名' : '還沒有人報名'}</p>`}
          ${canEdit ? `<button type="button" class="btn btn-small" data-walkin="${esc(p.id)}">${past ? '＋ 補登沒報名但有來的人' : '＋ 幫人報名'}</button>` : ''}
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
          <p class="hint">${past ? '出席修正：預設報名＝出席。沒來的人按「改未到」，沒報名但有來的人按「補登」。統計表只算出席、非陪同的人。' : '管理者可以取消、改期任何日期（含當天與過去）的報名；按「＋ 幫人報名」可以直接幫人加上（不受報名截止日限制）。'}</p>
        </section>`}
      <div class="admin-links">
        <a class="btn btn-primary admin-link-btn" href="#/admin/duties/edit/${encodeURIComponent(d.id)}">✏️ 編輯${d.category && d.category !== '勤務' ? '活動' : '勤務'}</a>
        <a class="btn admin-link-btn" href="#/duty/${encodeURIComponent(d.id)}?date=${date}">👀 看家人們看到的頁面</a>
        ${!isNotice && date >= d.today && Api.adminWho().role !== '唯讀' ? `<button type="button" class="btn admin-link-btn" data-rollcall>📋 點名連結（${esc(Fmt.shortDate(date))}）</button>` : ''}
      </div>`;

    body.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => {
      dutyPage.viewDate = b.dataset.date;
      dutyPage.flash = '';
      renderDuty();
    }));
    const rc = body.querySelector('[data-rollcall]');
    if (rc) rc.addEventListener('click', () => rollcallLink(d, date));
    const find = (id) => (d.signups || []).find((s) => s.id === id);
    body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => adminCancel(find(b.dataset.cancel))));
    body.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', async () => {
      const s = find(b.dataset.split);
      if (!(await Confirm.open({ title: '拆成多人嗎？', rows: [['原本', s.name]], note: '會拆成一人一筆報名（同一天、同一個了愿項目）。', confirmText: '拆開' }))) return;
      Busy.show('處理中⋯');
      try {
        const res = await Api.admin('adminSplitSignup', { signupId: s.id });
        Busy.hide();
        dutyPage.flash = notice('success', '已拆成 ' + res.names.length + ' 人', res.names.join('、'));
        clearMemo();
        if (window.CalendarPage) CalendarPage.refresh();
        loadDuty();
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        alert(err.message || '拆開失敗');
      }
    }));
    body.querySelectorAll('[data-attend]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.attend);
      setAttendance(s, { attend: s.attend === '未到' ? '出席' : '未到' }, `${s.name}：${s.attend === '未到' ? '改為出席' : '改為未到'}`);
    }));
    body.querySelectorAll('[data-leader]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.leader);
      setAttendance(s, { leader: !s.leader }, `${s.name}：${s.leader ? '取消組長' : '設為組長 ★'}`);
    }));
    body.querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', () => editNote(find(b.dataset.note))));
    body.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.acc);
      setAttendance(s, { accompany: !s.accompany }, `${s.name}：${s.accompany ? '改為了愿' : '改為陪同'}`);
    }));
    body.querySelectorAll('[data-walkin]').forEach((b) => b.addEventListener('click', () => addAttendee(d.positions.find((p) => p.id === b.dataset.walkin), date)));
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

  async function setAttendance(s, change, label) {
    if (!s) return;
    Busy.show('修正中⋯');
    try {
      await Api.admin('adminSetAttendance', Object.assign({ signupId: s.id }, change));
      Busy.hide();
      dutyPage.flash = notice('success', '已修正', label);
    } catch (err) {
      Busy.hide();
      if (guard(err)) return;
      dutyPage.flash = notice('error', err.message || '修正失敗', '');
    }
    afterChange();
  }

  /** 職司表的註記：家人們點名字旁的「註」看得到 */
  function editNote(s) {
    if (!s) return;
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">${esc(s.name)} 的註記</h2>
        <p class="modal-note">${esc(Fmt.shortDate(s.date))}・家人們在職司表上點「註」就看得到，最多 100 字；清空就是刪除。</p>
        <label class="form-row"><span>註記</span><input class="input" name="note" maxlength="100" value="${esc(s.note || '')}" placeholder="例：前一天晚上到"></label>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    f.elements.note.focus();
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const note = f.elements.note.value.trim();
      m.close();
      setAttendance(s, { note }, `${s.name}：${note ? '註記「' + note + '」' : '刪除註記'}`);
    });
  }

  /** 點名連結：產生（或拿回）這個勤務這一天的點名碼，複製「連結＋點名碼」傳給組長 */
  async function rollcallLink(d, date) {
    Busy.show('產生點名連結⋯');
    let res;
    try {
      res = await Api.admin('adminRollcallLink', { dutyId: d.id, date });
    } catch (err) {
      Busy.hide();
      if (guard(err)) return;
      alert(err.message || '產生失敗');
      return;
    }
    Busy.hide();
    const url = location.origin + location.pathname + '?openExternalBrowser=1#/rollcall/' + encodeURIComponent(res.dutyId) + '?date=' + res.date;
    const text = `📋 ${res.name}（${Fmt.shortDate(res.date)}）點名\n點名連結：${url}\n點名碼：${res.code}\n（連結只有當天能用，沒來的人按「未到」就好，感恩 🙏）`;
    const m = Modal.open(`
      <h2 class="modal-title">📋 點名連結</h2>
      <p>把下面的文字傳給組長，組長打開連結、輸入點名碼就能點名。<strong>只有 ${esc(Fmt.shortDate(res.date))} 當天能用。</strong></p>
      <p class="rc-big-code">點名碼：<strong>${esc(res.code)}</strong></p>
      <textarea class="day-text" rows="5" readonly>${esc(text)}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-copy>複製文字</button>
        <button type="button" class="btn btn-line btn-block" data-line>傳到 LINE</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-copy]').addEventListener('click', async (ev) => { ev.target.textContent = (await Share.copyText(text)) ? '已複製 ✓' : '請長按框內文字複製'; });
    m.el.querySelector('[data-line]').addEventListener('click', () => window.open('https://line.me/R/msg/text/?' + encodeURIComponent(text), '_blank', 'noopener'));
  }

  /** 管理者加人：當天與過去叫「補登」（沒報名但有來的人，記為出席）；未來叫「幫人報名」（不受截止日限制） */
  function addAttendee(p, date) {
    const d = dutyPage.data;
    const past = date <= d.today;
    const word = past ? '補登' : '報名';
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">${past ? '補登出席' : '幫人報名'}</h2>
        <p class="modal-note">${esc(d.name)}・${esc(Fmt.rocDate(date))}・${esc(p.name)}</p>
        <label class="form-row"><span>姓名</span><input class="input" name="name" autocomplete="off" required placeholder="打一兩個字，下面會出現成員名單"></label>
        <div class="suggestions" data-suggestions aria-live="polite"></div>
        <div class="form-row"><span>身分</span><div class="seg">
          <label class="seg-item"><input type="radio" name="identity" value="道親"><span>道親</span></label>
          <label class="seg-item"><input type="radio" name="identity" value="壇辦"><span>壇辦</span></label>
          <label class="seg-item"><input type="radio" name="identity" value="未求道"><span>未求道</span></label>
        </div></div>
        <label class="check" data-acc-row hidden><input type="checkbox" name="accompany"> 陪同（不算人數）</label>
        ${d.layout === '職司表' ? '<label class="form-row"><span>註記（可空白）</span><input class="input" name="note" maxlength="100" placeholder="例：8:00-19:00、代理人"></label>' : ''}
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">${past ? '補登' : '確認報名'}</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    f.elements.name.focus();
    // 成員名單提示：打字時列出名字含有這幾個字的成員（啟用中），點了帶入姓名與身分
    let members = [];
    const cached = memo.get('members');
    (cached ? Promise.resolve(cached.data) : fetchShared('members', () => Api.admin('adminMembers', {}, true)))
      .then((data) => { members = (data.members || []).filter((x) => x.active !== false); onName(); })
      .catch(() => {});
    const sug = f.querySelector('[data-suggestions]');
    const setIdentity = (id) => {
      const r = f.querySelector(`input[name=identity][value="${id}"]`);
      if (r) { r.checked = true; f.dispatchEvent(new Event('change')); }
    };
    function onName() {
      const q = f.elements.name.value.trim();
      const sameName = members.filter((x) => x.name === q);
      const exact = sameName.find((x) => (x.temple || '') === (f.dataset.temple || '')) || (sameName.length === 1 ? sameName[0] : null);
      if (exact && exact.identity) setIdentity(exact.identity); // 名單上已登記的身分自動帶入
      if (exact && sameName.length === 1) f.dataset.temple = exact.temple || '';
      const list = q ? members.filter((x) => (x.name.indexOf(q) !== -1 && (x.name !== q || sameName.length > 1)) || (x.aliases || []).some((a) => a.indexOf(q) !== -1)).slice(0, 8) : [];
      sug.innerHTML = list.map((x) => `<button type="button" class="suggestion" data-suggest="${esc(x.name)}" data-temple="${esc(x.temple || '')}">${esc(x.name)}${(x.aliases || []).length ? `<small>${esc(x.aliases.join('、'))}</small>` : ''}${x.temple ? `<small>${esc(x.temple)}</small>` : ''}${x.identity ? `<small>${esc(x.identity)}</small>` : ''}</button>`).join('');
    }
    f.elements.name.addEventListener('input', () => { f.dataset.temple = ''; onName(); });
    sug.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-suggest]');
      if (!b) return;
      f.elements.name.value = b.dataset.suggest;
      f.dataset.temple = b.dataset.temple || '';
      onName();
    });
    f.addEventListener('change', () => {
      const tan = f.querySelector('input[name=identity]:checked');
      f.querySelector('[data-acc-row]').hidden = !(tan && tan.value === '壇辦');
      if (!(tan && tan.value === '壇辦')) f.elements.accompany.checked = false;
    });
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = f.querySelector('[data-error]');
      const identity = f.querySelector('input[name=identity]:checked');
      const name = f.elements.name.value.trim();
      if (!name || !identity) {
        box.textContent = !name ? '請填姓名' : '請選道親、壇辦或未求道';
        box.hidden = false;
        return;
      }
      m.el.setAttribute('data-locked', '');
      Busy.show(word + '中⋯');
      try {
        const res = await Api.admin('adminAddAttendee', { dutyId: d.id, positionId: p.id, date, name, temple: f.dataset.temple || '', identity: identity.value, accompany: f.elements.accompany.checked, note: f.elements.note ? f.elements.note.value.trim() : '' });
        Busy.hide();
        m.close();
        dutyPage.flash = notice('success', '已' + word, `${name}・${Fmt.shortDate(date)}・${p.name}${res.warnings.length ? '（注意：' + res.warnings.join('；') + '）' : ''}`);
        afterChange();
      } catch (err) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        box.innerHTML = `<strong>${esc(err.message)}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    });
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

  window.AdminPage = { show, notice, guard, swr, clearMemo, staleNote, term };
})();
