// 管理後台（規格第 8 節）：登入、近期勤務、勤務名單管理（含組長電話、取消／改期任何日期）。
// 操作紀錄與名單在 admin-pages.js。
//   #/admin           近期勤務（未登入時顯示登入）
//   #/admin/duty/<id> 勤務名單管理
//   #/admin/duties…   勤務管理：列表、新增、編輯（見 admin-duties.js）
//   #/admin/import    批次匯入（見 admin-import.js）
//   #/admin/members   成員名單管理、#/admin/groups 分組管理（見 admin-people.js）
//   #/admin/stats     統計（見 admin-stats.js）、#/admin/history 匯入歷史資料（見 admin-history.js）
//   #/admin/logs      操作紀錄與還原
//   #/admin/day       📢 通知（邀請報名、名單、總務佈達：產生貼到 LINE 的文字）
//   #/admin/push      推播（見 admin-push.js）
//   #/admin/help      教學（常見問題的管理者題目與編輯，見 help.js）
//   #/admin/more      ⚙️ 更多：操作紀錄、帳號、區設定、教學的入口（2026/11/21 分頁合併）
// 分頁合併（2026/11/21）：上方分頁只留 近期、管理、📢 通知（通知＋推播）、👥 人員（成員＋分組）、
// 📊 統計（統計＋年度總結）、場地借用、⚙️ 更多；合在一起的頁面上方有切換（網址不變，舊連結照樣能用）。
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
    // 宏教分壇（/hq/）：只有「📣 分派」（2026/11/22，js/admin-hq.js）
    if (isHq()) {
      if (sub === 'accounts' && Api.adminWho().role === '總管理者') return AccountsPage.show(shell('accounts'), guard);
      if (sub === 'help') return HelpAdminPage.show(shell('help'), guard);
      return HqAdminPage.show(shell(sub === 'hqstats' ? 'hqstats' : ''), guard, sub);
    }
    prefetch();
    VenueAdminPage.autoWatch(); // 總管理者、場管：手機允許過通知就自動開啟場地申請通知
    if (sub === 'help') return HelpAdminPage.show(shell('help'), guard); // 📖 教學：所有後台帳號
    if (sub === 'more') return showMore(shell('more'));
    if (sub === 'tidy' && Api.adminWho().role === '總管理者') return showTidy(shell('tidy'));
    if (Api.adminWho().role === '場管' || sub === 'venue') return VenueAdminPage.show(shell('venue'), guard); // 場管帳號只有場地借用（和教學）
    if (sub === 'accounts') return AccountsPage.show(shell('accounts'), guard);
    if (sub === 'site' && seesSite()) return SitePage.show(shell('site'), guard);
    const m = sub.match(/^duty\/([^?]+)(?:\?date=(\d{4}-\d{2}-\d{2}))?/);
    if (m) return showDuty(decodeURIComponent(m[1]), m[2] || '');
    if (/^duties(\/|\?|$)/.test(sub)) return DutyAdminPage.show(shell('duties'), guard, sub);
    if (sub === 'import') return ImportPage.show(shell('duties'), guard);
    if (sub === 'members') return PeoplePage.members(shell('members'), guard);
    if (sub === 'groups') return PeoplePage.groups(shell('groups'), guard);
    if (sub === 'youth') return PeoplePage.youth(shell('youth'), guard);
    if (sub === 'hqinbox' && Api.adminWho().role !== '唯讀') return HqInbox.page(shell('hqinbox'), guard);
    if (sub === 'stats') return StatsPage.show(shell('stats'), guard);
    if (sub === 'history') return HistoryPage.show(shell('stats'), guard);
    if (sub === 'report') return ReportPage.show(shell('report'), guard);
    if (sub === 'logs' && seesLogs()) return AdminPages.logs(shell('logs'), guard);
    if (sub === 'day' && seesRoster()) return AdminPages.day(shell('day'), guard, 'invite');
    if (sub === 'roster' && seesRoster()) return AdminPages.day(shell('roster'), guard, 'roster');
    if (sub === 'push' && seesRoster()) return PushAdminPage.show(shell('push'), guard);
    return showRecent();
  }

  /** 「⚙️ 更多」裡的項目（依角色）：[網址, 名稱, 說明] */
  function moreItems() {
    const who = Api.adminWho();
    const list = [];
    if (seesLogs()) list.push(['logs', '📜 操作紀錄', '誰報名、取消、改期、換項目，改了什麼勤務；按錯了可以還原']);
    if (who.role === '總管理者') list.push(['accounts', '👤 帳號', '新增勤務／道務／教育／唯讀帳號、重設密碼、停用']);
    if (seesSite()) list.push(['site', '⚙️ 區設定', '區名、場地、地點選項、功能開關']);
    if (who.role === '總管理者') list.push(['tidy', '🧹 資料整理', '同一種勤務有好幾種名稱，勾起來合成一個（統計才會算在一起）']);
    list.push(['help', '📖 教學', '後台每個功能怎麼用']);
    return list;
  }

  /**
   * 上方分頁（2026/11/21 合併）：[分頁網址, 名稱, 這個分頁包含哪些網址]。
   * 合在一起的頁面（通知＋推播、成員＋分組、統計＋年度總結）上方有切換；不常用的收進「⚙️ 更多」。
   */
  const isHq = () => !!(window.Region && Region.code === 'hq');

  function tabList() {
    const who = Api.adminWho();
    // 分壇：分派、統計；總管理者另外有帳號（新增總務・勤務／道務／教育帳號，2026/11/22）
    if (isHq()) return [['', '📣 分派', ['']], ['hqstats', '📊 統計', ['hqstats']]].concat(who.role === '總管理者' ? [['accounts', '👤 帳號', ['accounts']]] : []);
    const T = term();
    if (who.role === '場管') return [['venue', '場地借用', ['venue']], ['help', '📖 教學', ['help']]];
    const venueOn = !(window.SITE.features && window.SITE.features.venue === false); // 分區：沒有場地可借的區關掉
    const tabs = [['', '近期' + T, ['']]];
    if (who.role !== '唯讀') tabs.push(['hqinbox', '📥 分壇分派', ['hqinbox']]); // 宏教分壇分派（2026/11/22）：有分派才出現，待處理的加 ❗件數（HqInbox.tab）
    if (who.role !== '唯讀') tabs.push(['duties', T + '管理', ['duties']]); // 唯讀帳號：不顯示勤務管理
    if (seesRoster()) tabs.push(['day', '📢 通知', ['day', 'roster', 'push']]); // 通知、推播：總管理者、勤務、道務、教育
    tabs.push(['members', '👥 人員', ['members', 'groups', 'youth']]);
    tabs.push(['stats', '📊 統計', ['stats', 'report']]);
    if (venueOn && ['總管理者', '唯讀'].indexOf(who.role) !== -1) tabs.push(['venue', '場地借用', ['venue']]);
    const more = moreItems();
    // 只有教學一項時直接放教學，不用多按一次
    tabs.push(more.length > 1 ? ['more', '⚙️ 更多', ['more'].concat(more.map((m) => m[0]))] : ['help', '📖 教學', ['help']]);
    return tabs;
  }

  /** 合在一起的頁面上方的切換：[[網址, 名稱]] */
  const SUBNAV = {
    day: [['day', '📣 佈達'], ['roster', '📋 分壇名單'], ['push', '📱 手機推播']],
    roster: [['day', '📣 佈達'], ['roster', '📋 分壇名單'], ['push', '📱 手機推播']],
    push: [['day', '📣 佈達'], ['roster', '📋 分壇名單'], ['push', '📱 手機推播']],
    members: [['members', '成員'], ['groups', '分組'], ['youth', '👨‍👩‍👧 道二代']],
    groups: [['members', '成員'], ['groups', '分組'], ['youth', '👨‍👩‍👧 道二代']],
    youth: [['members', '成員'], ['groups', '分組'], ['youth', '👨‍👩‍👧 道二代']],
    stats: [['stats', '統計'], ['report', '📑 年度總結']],
    report: [['stats', '統計'], ['report', '📑 年度總結']]
  };

  function subnavHtml(active) {
    const items = SUBNAV[active];
    if (items) {
      return `<nav class="admin-subnav" aria-label="切換">${items.map(([k, label]) => `<a href="#/admin/${k}" class="admin-subnav-item${k === active ? ' is-active' : ''}"${k === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
    }
    // 「更多」裡的頁面：上面一個回「更多」的連結
    if (moreItems().length > 1 && moreItems().some((m) => m[0] === active)) return '<a class="back-link" href="#/admin/more">‹ 更多</a>';
    return '';
  }

  /**
   * 🧹 資料整理（總管理者，2026/11/21）：選類別 → 勾要合在一起的名稱 → 打新名稱 →
   * 先列出會改哪幾筆（有年份）→ 按「確定整理」才改。只改名稱，報名、日期、類別都不動。
   */
  async function showTidy(body) {
    const t = token;
    const st = { cat: '勤務', q: '', picked: new Set(), to: '', typed: false, names: [] };
    const ymd = (s) => (s ? Fmt.rocDate(s) : '');
    const span = (x) => (x.first === x.last ? ymd(x.first) : `${ymd(x.first)}～${ymd(x.last)}`);

    function draw(msg) {
      const cats = ['勤務', '道務', '教育'];
      const list = st.names.filter((x) => x.category === st.cat && (!st.q || x.name.indexOf(st.q) !== -1));
      const picked = st.names.filter((x) => x.category === st.cat && st.picked.has(x.name));
      if (picked.length && !st.typed) st.to = picked.slice().sort((a, b) => b.count - a.count)[0].name; // 新名稱先帶筆數最多的那個（自己改過就照自己打的）
      const total = picked.reduce((n, x) => n + (x.name === st.to ? 0 : x.count), 0);
      body.innerHTML = `${msg || ''}
        <h2 class="detail-title">🧹 資料整理</h2>
        <p class="hint">同一種勤務有好幾種名稱時，勾起來合成一個名稱，統計、搜尋才會算在一起。只改名稱，報名、日期、類別都不動；每一筆都會記在操作紀錄。</p>
        <div class="seg" role="radiogroup" aria-label="類別">${cats.map((c) => `<label class="seg-item"><input type="radio" name="tidyCat" value="${c}"${c === st.cat ? ' checked' : ''}><span>${esc(Fmt.catLabel(c))}</span></label>`).join('')}</div>
        <input class="input tidy-q" type="search" data-q placeholder="搜尋名稱（例：打掃、明道班）" value="${esc(st.q)}">
        <p class="muted">共 ${list.length} 種名稱。勾兩個以上要合在一起的（只勾一個＝改名）。</p>
        <div class="tidy-names">${list.map((x) => `<label class="check tidy-name${st.picked.has(x.name) ? ' is-on' : ''}">
          <input type="checkbox" data-name="${esc(x.name)}"${st.picked.has(x.name) ? ' checked' : ''}>
          <span><strong>${esc(x.name)}</strong> <span class="muted">${x.count} 筆・${esc(span(x))}</span></span></label>`).join('') || '<p class="panel-empty">沒有符合的名稱</p>'}</div>
        ${picked.length ? `<div class="tidy-bar">
          <p>已勾 ${picked.length} 個名稱：${picked.map((x) => esc(x.name)).join('、')}</p>
          <label class="form-row"><span>合併後的名稱</span><input class="input" data-to maxlength="60" value="${esc(st.to)}" list="tidy-to-list">
            <datalist id="tidy-to-list">${picked.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist></label>
          <div class="admin-actions">
            <button type="button" class="btn btn-primary" data-preview${total ? '' : ' disabled'}>看會改哪幾筆（${total} 筆）</button>
            <button type="button" class="link-btn" data-clear>都不勾</button>
          </div>
        </div>` : ''}`;
      body.querySelectorAll('input[name="tidyCat"]').forEach((r) => r.addEventListener('change', () => { st.cat = r.value; st.picked.clear(); st.to = ''; st.typed = false; draw(); }));
      const q = body.querySelector('[data-q]');
      q.addEventListener('input', () => { st.q = q.value.trim(); const pos = q.selectionStart; draw(); const q2 = body.querySelector('[data-q]'); q2.focus(); q2.setSelectionRange(pos, pos); });
      body.querySelectorAll('[data-name]').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) st.picked.add(c.dataset.name); else st.picked.delete(c.dataset.name);
        draw();
      }));
      const to = body.querySelector('[data-to]');
      if (to) to.addEventListener('change', () => { st.to = to.value.trim(); st.typed = !!st.to; draw(); });
      const clear = body.querySelector('[data-clear]');
      if (clear) clear.addEventListener('click', () => { st.picked.clear(); st.to = ''; st.typed = false; draw(); });
      const pv = body.querySelector('[data-preview]');
      if (pv) pv.addEventListener('click', () => preview(to.value.trim()));
    }

    async function preview(toName) {
      if (!toName) return alert('請填合併後的名稱');
      st.to = toName;
      const payload = { category: st.cat, from: [...st.picked], to: toName };
      let items;
      try {
        Busy.show('讀取中⋯');
        items = (await Api.admin('adminTidyNames', payload)).items;
        Busy.hide();
      } catch (e) {
        Busy.hide();
        if (guard(e)) return;
        return draw(notice('error', e.message || '讀取失敗', ''));
      }
      if (!items.length) return draw(notice('info', '沒有要改的', `勾的名稱已經都是「${toName}」了。`));
      const ok = await Confirm.open({
        title: `確定要把這 ${items.length} 筆改成「${toName}」嗎？`,
        rows: items.map((x) => [Fmt.rocDate(x.start), x.from]),
        confirmText: '確定整理',
        cancelText: '再想想'
      });
      if (!ok) return;
      Busy.show('整理中⋯');
      try {
        const res = await Api.admin('adminTidyNames', Object.assign({ apply: true }, payload));
        Busy.hide();
        clearMemo();
        if (window.CalendarPage) CalendarPage.refresh();
        st.names = (await Api.admin('adminTidyNames', {}, true)).names;
        st.picked.clear();
        st.to = ''; st.typed = false;
        draw(notice('success', `已整理 ${res.done} 筆，都改成「${toName}」`, '操作紀錄裡可以看到每一筆改了什麼。'));
      } catch (e) {
        Busy.hide();
        if (guard(e)) return;
        draw(notice('error', e.message || '整理失敗，請再試一次', ''));
      }
    }

    try {
      st.names = (await Api.admin('adminTidyNames', {}, true)).names;
      if (t === token) draw();
    } catch (e) {
      if (guard(e)) return;
      body.innerHTML = `<p class="form-error">${esc(e.message || '讀取失敗')}</p>`;
    }
  }

  /**
   * 🚀 開始使用（2026/11/21）：新開通的區，總管理者在後台首頁看到五個步驟，做完的自動打勾。
   * 全部做完、或按「先不要顯示」就不出現（⚙️ 更多 → 📖 教學 也有「開始使用」那一題）。
   */
  let onboardMemo = null;
  async function mountOnboarding(box) {
    if (!box) return;
    const paint = (o) => {
      if (!box.isConnected) return;
      const url = (window.SITE && window.SITE.siteUrl) || location.href.split('#')[0];
      const steps = [
        [o.siteSaved, '① 區設定', '確認區名、地點、場地名稱，和要用哪些功能', '#/admin/site', '去區設定'],
        [o.groups > 0, '② 建分組', '輪值的組別、組長（不用分組可以跳過）', '#/admin/groups', '去分組'],
        [o.members > 0, '③ 加成員', '一個一個加，或「📋 匯入成員資料」一次貼上；有人報名也會自動加進來', '#/admin/members', '去成員'],
        [o.duties > 0, '④ 新增第一個勤務', '「＋ 新增勤務」：自己填、從照片、從 Excel 貼上，或「📚 從教全區借範本」', '#/admin/duties/new', '去新增'],
        [o.shared, '⑤ 把網址傳給家人們', url, '', '']
      ];
      const done = steps.filter((x) => x[0]).length;
      if (o.hidden || done === steps.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<section class="onboard">
        <h2 class="onboard-title">🚀 開始使用 <span class="h2-sub">已完成 ${done}／${steps.length}</span></h2>
        <ol class="onboard-list">${steps.map(([ok, title, desc, href, go], i) => `
          <li class="${ok ? 'is-done' : ''}">
            <span class="onboard-mark" aria-label="${ok ? '做完了' : '還沒做'}">${ok ? '✅' : ''}</span>
            <span class="onboard-main"><strong>${esc(title)}</strong><small>${esc(desc)}</small>
              ${i === 4 ? `<span class="onboard-share"><button type="button" class="btn btn-small" data-ob-copy>複製網址</button><button type="button" class="btn btn-small btn-line" data-ob-line>傳到 LINE</button></span>` : ''}</span>
            ${href && !ok ? `<a class="btn btn-small" href="${href}">${esc(go)} ›</a>` : ''}
          </li>`).join('')}</ol>
        <p class="hint">每一步做完會自動打勾。不知道怎麼做可以看「⚙️ 更多 → 📖 教學」。<button type="button" class="link-btn" data-ob-hide>先不要顯示</button></p>
      </section>`;
      const mark = async (key) => {
        try { onboardMemo = await Api.admin('adminOnboardingMark', { key }); paint(onboardMemo); } catch (e) { guard(e); }
      };
      const text = `📅 ${(window.SITE && window.SITE.name) || '行事曆'}\n要報名、看勤務，打開這個網址：\n${url}\n（可以加到手機主畫面，下次一點就開）`;
      box.querySelector('[data-ob-copy]').addEventListener('click', async (ev) => {
        const ok = await Share.copyText(text);
        ev.target.textContent = ok ? '已複製 ✓' : '複製失敗';
        if (ok) setTimeout(() => mark('shared'), 1200);
      });
      box.querySelector('[data-ob-line]').addEventListener('click', () => {
        window.open('https://line.me/R/msg/text/?' + encodeURIComponent(text), '_blank', 'noopener');
        mark('shared');
      });
      box.querySelector('[data-ob-hide]').addEventListener('click', () => mark('hide'));
    };
    if (onboardMemo) paint(onboardMemo);
    try {
      onboardMemo = await Api.admin('adminOnboarding', {}, true);
      paint(onboardMemo);
    } catch (e) { /* 讀不到就不顯示 */ }
  }

  /** ⚙️ 更多：不常用的功能一頁一個大按鈕 */
  function showMore(body) {
    body.innerHTML = `<div class="more-list">${moreItems().map(([k, label, desc]) => `
      <a class="more-item" href="#/admin/${k}"><strong>${label}</strong><span>${esc(desc)}</span></a>`).join('')}</div>`;
  }

  /** 管理頁共用外框：上方分頁＋內容區，回傳內容區元素 */
  function shell(active) {
    const who = Api.adminWho();
    const tabs = tabList();
    const cur = (tabs.find((t) => t[2].indexOf(active) !== -1) || [active])[0];
    root.innerHTML = `
      <div class="admin-head">
        <h1 class="admin-title">管理後台</h1>
        <span class="admin-who">${esc(who.account)}${who.role !== who.account ? `<small>（${esc(who.role)}）</small>` : ''}</span>
        <button type="button" class="btn btn-small" data-mypw>🔑 改密碼</button>
        <button type="button" class="btn btn-small" data-logout>登出</button>
      </div>
      ${roleNote(who.role)}
      <nav class="admin-tabs" aria-label="管理功能">
        ${tabs.map(([k, label]) => `<a href="#/admin${k ? '/' + k : ''}" class="admin-tab${k === cur ? ' is-active' : ''}"${k === 'hqinbox' ? ' data-hq-tab' + (cur === 'hqinbox' ? '' : ' hidden') : ''}>${label}</a>`).join('')}
      </nav>
      ${subnavHtml(active)}
      <div class="admin-body" data-body><p class="panel-empty">載入中⋯</p></div>`;
    if (window.HqInbox) HqInbox.tab(root.querySelector('[data-hq-tab]'));
    root.querySelector('[data-mypw]').addEventListener('click', changeMyPassword);
    root.querySelector('[data-logout]').addEventListener('click', () => {
      Api.adminLogout();
      location.hash = '#/admin';
      renderLogin();
    });
    return root.querySelector('[data-body]');
  }

  /** 🔑 改自己的密碼（每個帳號都可以；要輸入舊密碼）。這台裝置繼續登入 */
  function changeMyPassword() {
    const who = Api.adminWho();
    const m = Modal.open(`
      <h2 class="modal-title">🔑 改我的密碼</h2>
      <form class="admin-form" novalidate>
        <p class="hint">帳號：${esc(who.account)}</p>
        <label class="form-row"><span>舊密碼（現在用的）</span><input class="input" name="old" type="password" autocomplete="current-password"></label>
        <label class="form-row"><span>新密碼</span><input class="input" name="pw" type="password" autocomplete="new-password"></label>
        <label class="form-row"><span>新密碼再輸入一次</span><input class="input" name="pw2" type="password" autocomplete="new-password"></label>
        <label class="de-check"><input type="checkbox" data-show> 顯示密碼</label>
        <p class="hint">改好後，下次登入請用新密碼。新密碼請自己記好，不要給別人。</p>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">改密碼</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const err = m.el.querySelector('[data-error]');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-show]').addEventListener('change', (ev) => {
      ['old', 'pw', 'pw2'].forEach((k) => { f.elements[k].type = ev.target.checked ? 'text' : 'password'; });
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fail = (t) => { err.textContent = t; err.hidden = false; };
      err.hidden = true;
      const v = (k) => f.elements[k].value;
      if (!v('old')) return fail('請輸入舊密碼');
      if (!v('pw').trim()) return fail('請輸入新密碼');
      if (v('pw') !== v('pw2')) return fail('兩次輸入的新密碼不一樣');
      if (v('pw') === v('old')) return fail('新密碼和舊密碼一樣');
      Busy.show('改密碼中⋯');
      try {
        await Api.admin('adminChangeMyPassword', { oldPassword: v('old'), newPassword: v('pw') });
        Busy.hide();
        m.el.querySelector('.modal-title').textContent = '密碼改好了 ✅';
        f.innerHTML = '<p>下次登入請用新密碼。</p><div class="modal-actions"><button type="button" class="btn btn-block btn-primary" data-close>好</button></div>';
        f.querySelector('[data-close]').addEventListener('click', () => m.close());
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); location.hash = '#/admin'; renderLogin(); return; }
        fail(e.message || '改密碼失敗，請再試一次');
      }
    });
  }

  /** ⚙️ 區設定：其他區的總管理者（教全區的設定寫在程式裡） */
  function seesSite() {
    return !!(window.Region && Region.code) && Api.adminWho().role === '總管理者';
  }

  /** 角色說明（勤務／道務／教育／唯讀帳號在每頁上方看到） */
  function roleNote(role) {
    if (isHq() && role === '唯讀') return '';
    if (isHq()) return ['勤務', '道務', '教育'].indexOf(role) !== -1 ? `<p class="role-note">這個帳號管理「${role === '勤務' ? '總務・勤務' : esc(role)}」的分派；其他類別的看不到。</p>` : '';
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

  let recentFresh = false; // 打開近期勤務時重新讀「最新報名」
  function showRecent() {
    const body = shell('');
    recentFresh = true;
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

      // 放到首頁（2026/11/19）：近期勤務也能直接開關；唯讀不能改，類別帳號只能改自己類別的
      const who = Api.adminWho().role;
      const canPin = (d) => who !== '唯讀' && (['勤務', '道務', '教育'].indexOf(who) === -1 || (d.category || '勤務') === who);
      const pinBtn = (d) => (canPin(d)
        ? `<button type="button" class="link-btn pin-btn${d.pinned ? ' is-on' : ''}" data-pin="${esc(d.id)}">${d.pinned ? '📌 首頁中・拿掉' : '📌 放到首頁'}</button>` : '');

      const byDate = new Map();
      rows.forEach((r) => {
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date).push(r);
      });

      body.innerHTML = `
        ${staleNote(stale)}
        ${Api.adminWho().role === '唯讀' ? '' : '<div data-hq-inbox></div>'}
        ${seesSite() ? '<div data-onboarding></div>' : ''}
        ${Api.adminWho().role === '唯讀' ? '' : '<div data-recent-signups></div>'}
        ${['道務', '教育', '唯讀'].indexOf(Api.adminWho().role) !== -1 ? '' : '<div class="admin-actions"><button type="button" class="btn" data-general-notice>📢 總務佈達（初一十五打掃、拜香輪值）</button></div>'}
        ${['道務', '教育'].indexOf(Api.adminWho().role) !== -1 ? '' : shortDates.size
          ? `<div class="notice notice-error" role="status"><p><strong>近一個月有 ${shortDates.size} 天缺人</strong></p><p>${Fmt.shortDateList(shortDates)}</p>${Share.buttonsHtml()}</div>`
          : '<div class="notice notice-success" role="status"><p><strong>近一個月都不缺人</strong></p></div>'}
        ${rows.some((r) => r.d.mode !== '公告型') ? Share.noNeedHtml() : ''}
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
                  ${d.mode === '公告型' && !canPin(d) ? '' : `<div class="recent-tools">
                    ${d.mode === '公告型' ? '' : `<label class="check"><input type="checkbox" data-invite-pick="${esc(d.id)}|${date}"> 勾選</label>
                    <button type="button" class="link-btn" data-invite="${esc(d.id)}|${date}">📋 複製通知</button>`}
                    ${pinBtn(d)}
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
      Share.bindNoNeed(body);
      RecentSignups.mount(body.querySelector('[data-recent-signups]'), guard, recentFresh);
      mountOnboarding(body.querySelector('[data-onboarding]'));
      HqInbox.mount(body.querySelector('[data-hq-inbox]'), guard);
      const gn = body.querySelector('[data-general-notice]');
      if (gn) gn.addEventListener('click', () => GeneralNotice.open());
      recentFresh = false;
      // 邀請通知：一筆直接複製；勾好幾筆合成一則
      const rowOf = (key) => {
        const [id, date] = key.split('|');
        const r = rows.find((x) => x.d.id === id && x.date === date);
        return r ? { duty: r.d, date } : null;
      };
      // 放到首頁：同一個勤務好幾天都有一列，按一個全部跟著換
      body.querySelectorAll('[data-pin]').forEach((btn) => btn.addEventListener('click', async () => {
        const d = data.duties.find((x) => x.id === btn.dataset.pin);
        if (!d) return;
        btn.disabled = true;
        try {
          d.pinned = (await Api.admin('adminSetPinned', { id: d.id, pinned: !d.pinned })).pinned;
        } catch (e) {
          btn.disabled = false;
          alert(e.message || '沒有改成功，請再試一次');
          return;
        }
        body.querySelectorAll(`[data-pin="${CSS.escape(d.id)}"]`).forEach((b) => {
          b.disabled = false;
          b.classList.toggle('is-on', d.pinned);
          b.textContent = d.pinned ? '📌 首頁中・拿掉' : '📌 放到首頁';
        });
      }));
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

  // 名單頁的「‹ 回去」（2026/11/21）：回到點進來之前的那一頁（勤務管理的篩選、搜尋、捲動位置都保留），不是一律回近期勤務。
  // 在名單頁裡換日期（網址的 ?date= 變了）不算，還是回原本那一頁。
  let dutyFrom = '';
  window.addEventListener('hashchange', (ev) => {
    const old = (String(ev.oldURL || '').split('#')[1] || '');
    if (old.indexOf('/admin') === 0 && old.indexOf('/admin/duty/') !== 0) dutyFrom = '#' + old;
  });
  function dutyBack() {
    const href = dutyFrom || '#/admin';
    const sub = href.replace(/^#\/admin\/?/, '').split(/[/?]/)[0];
    const tab = Api.isAdmin() ? tabList().find((t) => t[2].indexOf(sub) !== -1) : null;
    const label = sub === 'duties' ? term() + '管理' : tab ? tab[1].replace(/^[^一-鿿]+/, '') : '近期' + term(); // 去掉前面的圖示
    return `<a class="back-link" href="${esc(href)}">‹ ${esc(label)}</a>`;
  }

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
    // 負責組的組長與電話：負責組可以好幾組，每組一行（舊版是一個物件）
    const contacts = [].concat(d.groupContact || []).filter((c) => c && (c.leader || c.phone));
    const isNotice = d.mode === '公告型';

    // 勤務當天（含）之前：出席修正（未到、陪同、補登），規格第 8 節管理者後台第 4 項
    const past = date <= d.today;
    const canEdit = !!d.signups && !dutyPage.stale;
    const positions = d.positions.map((p) => {
      const people = d.signups ? d.signups.filter((s) => s.date === date && s.positionId === p.id) : [];
      const count = d.signups ? people.filter((s) => !s.accompany && (!past || s.attend !== '未到')).length : ((d.days[date] && d.days[date].counts[p.id]) || 0);
      // 每個人的按鈕（2026/11/21 精簡）：外面只留常用的（過了的：改出席／未到；名字要拆：拆成多人；取消），其他收進「⋯ 更多」
      const personActions = (s) => {
        const btn = (attr, label, cls) => `<button type="button" class="btn btn-small${cls ? ' ' + cls : ''}" ${attr}="${esc(s.id)}">${label}</button>`;
        const main = [];
        const more = [];
        if (past) main.push(btn('data-attend', s.attend === '未到' ? '改出席' : '改未到'));
        if (/[、,，.。．\/／;；|]/.test(s.name) || /^[\u4e00-\u9fff]{2,}([\s　]+[\u4e00-\u9fff]{2,})+$/.test(s.name)) main.push(btn('data-split', '拆成多人', 'btn-primary'));
        if (past && s.identity === '壇辦') more.push(btn('data-acc', s.accompany ? '改了愿' : '改陪同'));
        if (d.layout === '職司表' || (d.leaderTitle && !s.accompany)) more.push(btn('data-leader', s.leader ? '取消組長' : '★ 設組長'));
        if (d.tickets) more.push(btn('data-tickets', '改張數'));
        if (d.layout === '職司表') more.push(btn('data-note', s.note ? '改註記' : '加註記'));
        if (d.nature !== '活動') more.push(btn('data-reschedule', '改期'));
        if (d.positions.length > 1) more.push(d.multi ? btn('data-adjust', '調整項目') : btn('data-change-pos', '換項目'));
        // 只有一個的話直接放外面，不用多按一次
        const menu = more.length > 1
          ? `<details class="act-menu"><summary class="btn btn-small">⋯ 更多</summary><div class="act-menu-list">${more.join('')}</div></details>`
          : more.join('');
        return `<span class="person-actions">${main.join('')}${menu}${btn('data-cancel', '取消', 'btn-quiet-danger')}</span>`;
      };
      const row = (s) => `
            <li class="person-row${past && s.attend === '未到' ? ' is-absent' : ''}">
              <span class="person"><span class="person-name">${s.leader ? '<span class="grid-star" title="組長">★</span>' : ''}${esc(s.name)}</span>${s.first ? '<span class="tag tag-new">🆕 新朋友</span>' : ''}${s.leader && d.leaderTitle ? `<span class="tag tag-leader">${esc(d.leaderTitle)}</span>` : ''}${s.temple && !d.tickets ? `<span class="tag">${esc(s.temple)}</span>` : ''}
                ${s.identity ? `<span class="tag">${esc(s.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
                ${s.accompany ? '<span class="tag">陪同</span>' : ''}
                ${past && s.attend === '未到' ? '<span class="tag tag-warn">未到</span>' : ''}
                ${s.note ? `<span class="tag">註：${esc(s.note)}</span>` : ''}
                ${d.tickets ? `<span class="tag tag-ticket">${s.tickets || 1} 張${d.price ? '・' + (s.tickets || 1) * d.price + ' 元' : ''}</span>` : ''}
              </span>
              ${canEdit ? personActions(s) : ''}
            </li>`;
      // 登記張數（園遊券）：依佛堂分組，佛堂一行、底下名字和張數、最後佛堂小計與金額
      const ticketList = (list) => Fmt.ticketGroups(list).map((g) => `
          <div class="ticket-group">
            <p class="ticket-temple">${esc(g.temple || '未填佛堂')}</p>
            <ul class="people">${g.people.map(row).join('')}</ul>
            <p class="ticket-sub">小計 <strong>${g.sum}</strong> 張${d.price ? `・${g.sum * d.price} 元` : ''}</p>
          </div>`).join('');
      const listHtml = (list) => (d.tickets ? ticketList(list) : `<ul class="people">${list.map(row).join('')}</ul>`);
      // 分批的勤務（2026/11/6）：依報名時間分第幾批，各批分開列
      const md = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
      const batchList = () => d.batches.map((end, bi) => {
        const list = people.filter((s) => s.batch === bi);
        if (!list.length) return '';
        const sum = Fmt.ticketSum(list);
        return `<div class="batch-group">
            <p class="batch-title">第 ${bi + 1} 批（${bi ? md(Fmt.addDays(d.batches[bi - 1], 1)) : ''}～${md(end)}）<span class="muted">${d.tickets ? `${sum} 張${d.price ? `・${sum * d.price} 元` : ''}` : `${list.filter((s) => !s.accompany).length} 人`}</span></p>
            ${listHtml(list)}
          </div>`;
      }).join('');
      return `
        <li class="position">
          <div class="position-head">
            <span class="position-name">${esc(p.name)}</span>
            <span class="badge badge-ok">${past ? '出席 ' : ''}${count}${p.max !== null ? '／' + p.max : ''} 人${!past && count < Fmt.effectiveMin(p) ? `・缺 ${Fmt.effectiveMin(p) - count}` : ''}</span>
          </div>
          ${d.tickets && people.length ? `<p class="ticket-total">共 <strong>${Fmt.ticketSum(people)}</strong> 張${d.price ? `・面額 ${d.price} 元・合計 <strong>${Fmt.ticketSum(people) * d.price}</strong> 元` : ''}</p>` : ''}
          ${!d.signups ? '<p class="muted">載入名單中⋯</p>' : people.length ? ((d.batches || []).length ? batchList() : listHtml(people)) : `<p class="muted">${past ? '沒有人報名' : '還沒有人報名'}</p>`}
          ${canEdit ? `<button type="button" class="btn btn-small" data-walkin="${esc(p.id)}">${past ? '＋ 補登沒報名但有來的人' : '＋ 幫人報名'}</button>` : ''}
        </li>`;
    }).join('');

    body.innerHTML = `
      ${dutyBack()}
      ${staleNote(dutyPage.stale)}
      <h2 class="detail-title">${esc(d.name)}</h2>
      ${dutyPage.flash}
      <dl class="detail-info">
        <div><dt>日期</dt><dd>${esc(d.start === d.end ? Fmt.rocDate(d.start) : `${Fmt.rocDate(d.start)} – ${Fmt.shortDate(d.end)}`)}</dd></div>
        ${Fmt.timeRange(d) ? `<div><dt>時段</dt><dd>${esc(Fmt.timeRange(d))}</dd></div>` : ''}
        ${d.location ? `<div><dt>地點</dt><dd>${esc(d.location)}</dd></div>` : ''}
        ${d.group ? `<div><dt>負責組</dt><dd>${esc(d.group)}</dd></div>` : ''}
        ${contacts.length ? `<div><dt>${Fmt.leaderWord(d.groupType)}</dt><dd>${contacts.map((c) => `<span class="nw">${contacts.length > 1 ? esc(c.name) + '：' : ''}${esc(c.leader || '')}${c.phone ? `　<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>` : ''}</span>`).join('<br>')}</dd></div>` : ''}
      </dl>
      ${isNotice ? '<p class="hint">公告型勤務不需報名。</p>' : `
        <section class="detail-section">
          <h3 class="admin-sub">報名名單${dates.length > 1 ? `<span class="h2-sub">${Fmt.shortDate(date)}</span>` : ''}</h3>
          ${dates.length > 1 ? `<div class="date-tabs">${dates.map((x) => `<button type="button" class="date-tab${x === date ? ' is-active' : ''}" data-date="${x}"><span class="date-tab-day">${Fmt.shortDate(x)}</span></button>`).join('')}</div>` : ''}
          <ul class="position-list">${positions}</ul>
          <p class="hint">${past ? '出席修正：預設報名＝出席。沒來的人按「改未到」，沒報名但有來的人按「補登」。統計表只算出席、非陪同的人。' : '管理者可以取消、改期任何日期（含當天與過去）的報名；按「＋ 幫人報名」可以直接幫人加上（不受報名截止日限制）。'}</p>
        </section>`}
      ${reportsHtml(d, date)}
      <div class="admin-links">
        <a class="btn btn-primary admin-link-btn" href="#/admin/duties/edit/${encodeURIComponent(d.id)}">✏️ 編輯${d.category && d.category !== '勤務' ? '活動' : '勤務'}</a>
        <a class="btn admin-link-btn" href="#/duty/${encodeURIComponent(d.id)}?date=${date}">👀 看家人們看到的頁面</a>
        ${!isNotice && date >= d.today && Api.adminWho().role !== '唯讀' ? `<button type="button" class="btn admin-link-btn" data-rollcall>📋 點名連結（${esc(Fmt.shortDate(date))}）</button>` : ''}
        ${!isNotice ? '<button type="button" class="btn admin-link-btn" data-thanks>🏅 了愿感謝狀（全部了愿的人一張，存圖片傳 LINE）</button>' : ''}
        ${Api.adminWho().role !== '唯讀' ? `<button type="button" class="btn admin-link-btn" data-report-link>🔢 活動回報碼：給沒報名的人（${esc(Fmt.shortDate(date))}）</button>` : ''}
        ${d.start === d.end && Api.adminWho().role === '總管理者' ? '<button type="button" class="btn admin-link-btn" data-move-duty>📅 整筆搬到別的日期（年份打錯時用）</button>' : ''}
      </div>`;

    body.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => {
      dutyPage.viewDate = b.dataset.date;
      dutyPage.flash = '';
      renderDuty();
    }));
    const rc = body.querySelector('[data-rollcall]');
    if (rc) rc.addEventListener('click', () => rollcallLink(d, date));
    const rl = body.querySelector('[data-report-link]');
    if (rl) rl.addEventListener('click', () => reportLink(d, date));
    const th = body.querySelector('[data-thanks]');
    if (th) th.addEventListener('click', () => ThanksImage.open(d));
    const mv = body.querySelector('[data-move-duty]');
    if (mv) mv.addEventListener('click', () => moveDuty(d));
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
    body.querySelectorAll('[data-tickets]').forEach((b) => b.addEventListener('click', () => editTickets(find(b.dataset.tickets))));
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
    body.querySelectorAll('[data-change-pos]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.changePos);
      Reschedule.changePosition(s, d, (result) => {
        dutyPage.flash = notice('success', '已換項目', `${s.name}：${Fmt.shortDate(s.date)} ${result.fromName} → ${result.positionName}`);
        afterChange();
      }, { submit: (payload) => Api.admin('adminChangePosition', payload) });
    }));
    // 可兼任：這個人那天報的項目一起打勾調整（2026/11/21）
    body.querySelectorAll('[data-adjust]').forEach((b) => b.addEventListener('click', () => {
      const s = find(b.dataset.adjust);
      const key = (x) => String(x.name || '').replace(/[\s　]+/g, '');
      const mine = d.signups.filter((x) => x.date === s.date && !!x.accompany === !!s.accompany && (x.temple || '') === (s.temple || '') && key(x) === key(s));
      Reschedule.adjustPositions({ id: s.id, date: s.date, name: s.name, accompany: s.accompany, positionIds: mine.map((x) => x.positionId) }, d, (result) => {
        dutyPage.flash = notice('success', '已調整項目', `${s.name}：${Fmt.shortDate(s.date)} ${result.positions.join('、') || '（已取消這天的報名）'}`);
        afterChange();
      }, { submit: (payload) => Api.admin('adminAdjustPositions', payload) });
    }));
  }

  // 「⋯ 更多」選單：一次只開一個；點了裡面的按鈕或點外面就收起來
  document.addEventListener('click', (ev) => {
    const inMenu = ev.target.closest && ev.target.closest('.act-menu');
    document.querySelectorAll('.act-menu[open]').forEach((m) => {
      if (m !== inMenu || ev.target.closest('.act-menu-list button')) m.open = false;
    });
  });

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

  /** 登記張數的勤務：改這個人登記的張數（1～99） */
  function editTickets(s) {
    if (!s) return;
    const price = dutyPage.data.price;
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">${esc(s.name)} 的張數</h2>
        <p class="modal-note">${esc(Fmt.shortDate(s.date))}${price ? `・每張 ${price} 元` : ''}</p>
        <label class="form-row"><span>張數（1～999）</span><input class="input" name="tickets" inputmode="numeric" maxlength="3" value="${esc(String(s.tickets || 1))}"></label>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    f.elements.tickets.select();
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const n = Number(f.elements.tickets.value.trim());
      if (!(n >= 1 && n <= 999 && Math.floor(n) === n)) {
        const e = f.querySelector('[data-error]');
        e.textContent = '張數請填 1～999';
        e.hidden = false;
        return;
      }
      m.close();
      setAttendance(s, { tickets: n }, `${s.name}：${n} 張${price ? `（${n * price} 元）` : ''}`);
    });
  }

  /** 活動回報（2026/11/8）：這一天的回報＋同名勤務以前的回報（後台才看得到） */
  function reportsHtml(d, date) {
    if (!d.reports) return '';
    const md = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
    const one = (r, withYear) => `
        <div class="report-card">
          <p class="report-meta">${esc(withYear ? Fmt.rocDate(r.date) : md(r.date))}・${esc(r.name)} 填寫${r.updatedAt ? `<span class="muted">（${esc(r.updatedAt.slice(5, 16).replace('-', '/'))}）</span>` : ''}</p>
          ${[['整體狀況', r.overall], ['遇到的問題', r.problems], ['下次改進', r.improve]].filter((x) => x[1]).map((x) => `<p class="report-field"><strong>${x[0]}</strong><span>${esc(x[1])}</span></p>`).join('')}
          ${r.photos.length ? `<div class="repair-photos">${r.photos.map((id) => `<a href="${esc(Api.fileUrl(id))}" target="_blank" rel="noopener" class="repair-thumb"><img src="${esc(Api.fileUrl(id))}" alt="回報的照片" loading="lazy"></a>`).join('')}</div>` : ''}
        </div>`;
    const mine = d.reports.filter((r) => r.date === date);
    const linked = (d.reportLinks || []).indexOf(date) !== -1;
    const past = d.pastReports || [];
    if (!mine.length && !linked && !past.length && date > d.today) return '';
    return `
      <section class="detail-section report-section">
        <h3 class="admin-sub">📝 活動回報<span class="h2-sub">${esc(Fmt.shortDate(date))}</span></h3>
        ${mine.length ? mine.map((r) => one(r)).join('') : `<p class="muted">${linked ? '已經產生回報連結，還沒有人填。' : '這天還沒有人回報。有報名的家人在勤務頁按「📝 填活動回報」就能填（活動後 30 天內）。'}</p>`}
        ${past.length ? `<details class="report-past"><summary>以前辦「${esc(d.name)}」的回報（${past.length} 份）</summary>${past.map((r) => one(r, true)).join('')}</details>` : ''}
      </section>`;
  }

  /** 活動回報連結：產生（或拿回）這個勤務這一天的回報碼，複製「連結＋回報碼」傳給組長 */
  async function reportLink(d, date) {
    Busy.show('產生回報連結⋯');
    let res;
    try {
      res = await Api.admin('adminReportLink', { dutyId: d.id, date });
    } catch (err) {
      Busy.hide();
      if (guard(err)) return;
      alert(err.message || '產生失敗');
      return;
    }
    Busy.hide();
    const url = Region.home() + '?openExternalBrowser=1#/report/' + encodeURIComponent(res.dutyId) + '?date=' + res.date;
    const text = `📝 ${res.name}（${Fmt.shortDate(res.date)}）活動回報\n回報連結：${url}\n回報碼：${res.code}（打開連結後按「我有回報碼」輸入）\n（活動結束後請填一下整體狀況、遇到的問題、下次可以改進的地方，可以附照片；${res.openDays} 天內都能填、也能修改，感恩 🙏）`;
    const m = Modal.open(`
      <h2 class="modal-title">🔢 活動回報碼</h2>
      <p>有報名的家人不用回報碼，在勤務頁按「📝 填活動回報」、打名字就能填。這組回報碼是給<strong>沒報名但要回報的人</strong>（例：負責的師兄姐、您自己）：把下面的文字傳給他，打開連結、按「我有回報碼」輸入就能填。<strong>從 ${esc(Fmt.shortDate(res.date))} 起 ${res.openDays} 天內能用。</strong></p>
      <p class="rc-big-code">回報碼：<strong>${esc(res.code)}</strong></p>
      <textarea class="day-text" rows="5" readonly>${esc(text)}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-copy>複製文字</button>
        <button type="button" class="btn btn-line btn-block" data-line>傳到 LINE</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => { m.close(); clearMemo(); loadDuty(); });
    m.el.querySelector('[data-copy]').addEventListener('click', async (ev) => { ev.target.textContent = (await Share.copyText(text)) ? '已複製 ✓' : '請長按框內文字複製'; });
    m.el.querySelector('[data-line]').addEventListener('click', () => window.open('https://line.me/R/msg/text/?' + encodeURIComponent(text), '_blank', 'noopener'));
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
    const url = Region.home() + '?openExternalBrowser=1#/rollcall/' + encodeURIComponent(res.dutyId) + '?date=' + res.date;
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

  /**
   * 管理者加人：當天與過去叫「補登」（沒報名但有來的人，記為出席）；未來叫「幫人報名」（不受截止日限制）。
   * 2026/11/22 起可以一次好幾位：像報名一樣用「、」或空白隔開，或點名字提示一個一個加，每位各選身分。
   */
  function addAttendee(p, date) {
    const d = dutyPage.data;
    const past = date <= d.today;
    const word = past ? '補登' : '報名';
    const IDS = ['道親', '壇辦', '未求道'];
    const people = []; // { name, temple, identity, accompany, error }
    let changed = false;
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">${past ? '補登出席' : '幫人報名'}</h2>
        <p class="modal-note">${esc(d.name)}・${esc(Fmt.rocDate(date))}・${esc(p.name)}</p>
        <label class="form-row"><span>姓名</span>
          <span class="add-name-row"><input class="input" name="name" autocomplete="off" placeholder="打一兩個字會出現名單；好幾位用「、」或空白隔開"><button type="button" class="btn" data-add-name>＋ 加入</button></span></label>
        <div class="suggestions" data-suggestions aria-live="polite"></div>
        <ul class="name-list" data-people></ul>
        ${d.tickets ? '<label class="form-row"><span>張數（每位）</span><input class="input" name="tickets" inputmode="numeric" maxlength="2" value="1"></label>' : ''}
        ${d.layout === '職司表' ? '<label class="form-row"><span>註記（可空白，每位都一樣）</span><input class="input" name="note" maxlength="100" placeholder="例：8:00-19:00、代理人"></label>' : ''}
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary" data-submit>${past ? '補登' : '確認報名'}</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`, () => { if (changed) afterChange(); });
    const f = m.el.querySelector('form');
    const input = f.elements.name;
    const sug = f.querySelector('[data-suggestions]');
    const listEl = f.querySelector('[data-people]');
    const box = f.querySelector('[data-error]');
    input.focus();
    // 成員名單：打字時列出名字含有這幾個字的成員（啟用中），點了就加入；名單上登記的身分自動帶入
    let members = [];
    const cached = memo.get('members');
    (cached ? Promise.resolve(cached.data) : fetchShared('members', () => Api.admin('adminMembers', {}, true)))
      .then((data) => { members = (data.members || []).filter((x) => x.active !== false); people.forEach(fromMember); onName(); paint(); })
      .catch(() => {});
    const sameOf = (name) => members.filter((x) => x.name === name || (x.aliases || []).indexOf(name) !== -1);
    const lookup = (name, temple) => {
      const same = sameOf(name);
      if (temple !== undefined) return same.find((x) => (x.temple || '') === temple) || null;
      return same.length === 1 ? same[0] : null;
    };
    /**
     * 成員資料登記的身分（壇辦、道親、點傳師⋯）自動帶入、不用選（2026/11/22）；伺服器也以名單為準。
     * 同名好幾位（不同佛堂）但身分都一樣，也帶入。
     */
    function fromMember(x) {
      // 只打名字、沒打姓（例：玉蘭）：名單上只有一位「〇玉蘭」就換成全名；好幾位就列出來請他點（同報名頁）
      if (!x.typed && x.name.length >= 2 && !sameOf(x.name).length) {
        const given = members.filter((y) => y.name.length > x.name.length && y.name.length <= x.name.length + 2 && y.name.slice(-x.name.length) === x.name);
        if (given.length === 1) { x.typed = x.name; x.name = given[0].name; x.temple = given[0].temple || ''; x.choices = null; }
        else if (given.length > 1) { x.choices = given.slice(0, 8).map((y) => ({ name: y.name, temple: y.temple || '' })); return; }
      }
      const hit = lookup(x.name, x.temple || undefined) || lookup(x.name);
      let id = hit ? hit.identity : '';
      if (!hit) {
        const ids = [...new Set(sameOf(x.name).map((y) => y.identity).filter(Boolean))];
        if (ids.length === 1) id = ids[0];
      }
      if (hit && !x.temple) x.temple = hit.temple || '';
      if (id) { x.identity = id; x.locked = true; if (id !== '壇辦') x.accompany = false; }
    }
    function add(name, temple) {
      name = String(name || '').trim();
      if (!name) return;
      const hit = lookup(name, temple);
      const t = hit ? (hit.temple || '') : (temple || '');
      const realName = hit ? hit.name : name;
      if (people.some((x) => x.name === realName && x.temple === t)) return; // 已經在下面了
      const x = { name: realName, temple: t, identity: '', accompany: false, error: '' };
      fromMember(x);
      people.push(x);
    }
    function addTyped() {
      const parts = SignupForm.splitInput(input.value);
      parts.forEach((x) => add(x));
      input.value = '';
      onName();
      paint();
      return parts.length;
    }
    function paint() {
      listEl.innerHTML = people.map((x, i) => `
        <li class="name-item${x.error || (box.dataset.missing && !x.identity) ? ' is-missing' : ''}">
          <div class="name-top">
            <span class="name-text">${esc(x.name)}${x.temple ? `<small class="name-temple">${esc(x.temple)}</small>` : ''}${x.typed ? `<small class="name-typed">打「${esc(x.typed)}」，已對到成員名單</small>` : ''}</span>
            <button type="button" class="btn-remove" data-remove="${i}" aria-label="移除 ${esc(x.name)}">×</button>
          </div>
          ${x.choices ? `<div class="name-choices"><span>名單上有好幾位「${esc(x.name)}」，是哪一位？</span>${x.choices.map((c, j) => `<button type="button" class="suggestion" data-choose="${i}:${j}">${esc(c.name)}${c.temple ? `<small>${esc(c.temple)}</small>` : ''}</button>`).join('')}<button type="button" class="link-btn" data-choose="${i}:-1">都不是（新朋友）</button></div>` : ''}
          ${x.locked ? `<p class="identity-fixed">身分：<strong>${esc(x.identity)}</strong><span class="muted">（成員資料登記的）</span></p>` : `<div class="seg" role="radiogroup" aria-label="${esc(x.name)} 的身分">${IDS.map((v) => `<label class="seg-item"><input type="radio" name="id-${i}" value="${v}" data-id="${i}"${x.identity === v ? ' checked' : ''}><span>${v}</span></label>`).join('')}</div>`}
          ${x.identity === '壇辦' ? `<label class="check"><input type="checkbox" data-acc="${i}"${x.accompany ? ' checked' : ''}> 陪同（不算人數）</label>` : ''}
          ${x.error ? `<p class="form-error">${esc(x.error)}</p>` : ''}
        </li>`).join('');
      const btn = f.querySelector('[data-submit]');
      btn.textContent = (past ? '補登' : '確認報名') + (people.length > 1 ? `（${people.length} 位）` : '');
    }
    function onName() {
      const q = input.value.trim();
      const list = q && !/[、,，\s]/.test(q) ? members.filter((x) => x.name.indexOf(q) !== -1 || (x.aliases || []).some((a2) => a2.indexOf(q) !== -1)).slice(0, 8) : [];
      sug.innerHTML = list.map((x) => `<button type="button" class="suggestion" data-suggest="${esc(x.name)}" data-temple="${esc(x.temple || '')}">${esc(x.name)}${(x.aliases || []).length ? `<small>${esc(x.aliases.join('、'))}</small>` : ''}${x.temple ? `<small>${esc(x.temple)}</small>` : ''}${x.identity ? `<small>${esc(x.identity)}</small>` : ''}</button>`).join('');
    }
    input.addEventListener('input', () => {
      // 打了「、」或逗號：前面的名字先加入下面
      if (/[、,，;；]/.test(input.value)) {
        const parts = input.value.split(/[、,，;；]/);
        const last = parts.pop();
        SignupForm.splitInput(parts.join('、')).forEach((x) => add(x));
        input.value = last.trimStart();
        paint();
      }
      onName();
    });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTyped(); } });
    f.querySelector('[data-add-name]').addEventListener('click', () => { addTyped(); input.focus(); });
    sug.addEventListener('click', (ev) => {
      const b2 = ev.target.closest('[data-suggest]');
      if (!b2) return;
      add(b2.dataset.suggest, b2.dataset.temple || '');
      input.value = '';
      onName();
      paint();
      input.focus();
    });
    listEl.addEventListener('click', (ev) => {
      const ch = ev.target.closest('[data-choose]');
      if (ch) {
        const [i, j] = ch.dataset.choose.split(':').map(Number);
        const x = people[i];
        if (j >= 0) { const c = x.choices[j]; x.typed = x.name; x.name = c.name; x.temple = c.temple; }
        else x.typed = x.name; // 都不是：照打的名字，不再問
        x.choices = null;
        fromMember(x);
        paint();
        return;
      }
      const r = ev.target.closest('[data-remove]');
      if (!r) return;
      people.splice(Number(r.dataset.remove), 1);
      paint();
    });
    listEl.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.id !== undefined) {
        const x = people[Number(t.dataset.id)];
        x.identity = t.value;
        if (x.identity !== '壇辦') x.accompany = false;
        x.error = '';
        paint();
      } else if (t.dataset.acc !== undefined) {
        people[Number(t.dataset.acc)].accompany = t.checked;
      }
    });
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (input.value.trim()) addTyped();
      box.hidden = true;
      if (!people.length) { box.textContent = '請填姓名'; box.hidden = false; return; }
      const unsure = people.filter((x) => x.choices);
      if (unsure.length) {
        box.textContent = '請點選是哪一位（或「都不是」）：' + unsure.map((x) => x.name).join('、');
        box.hidden = false;
        return;
      }
      const missing = people.filter((x) => !x.identity);
      if (missing.length) {
        box.dataset.missing = '1';
        paint();
        box.textContent = '請選身分（道親、壇辦或未求道）：' + missing.map((x) => x.name).join('、');
        box.hidden = false;
        return;
      }
      m.el.setAttribute('data-locked', '');
      const done = [];
      const warns = [];
      for (let i = 0; i < people.length; i++) {
        const x = people[i];
        Busy.show(`${word}中⋯${people.length > 1 ? `（${i + 1}／${people.length}）` : ''}`);
        try {
          const res = await Api.admin('adminAddAttendee', { dutyId: d.id, positionId: p.id, date, name: x.name, temple: x.temple || '', identity: x.identity, accompany: x.accompany, note: f.elements.note ? f.elements.note.value.trim() : '', tickets: f.elements.tickets ? f.elements.tickets.value.trim() : undefined });
          x.done = true;
          done.push(x.name);
          (res.warnings || []).forEach((w) => warns.push(x.name + '：' + w));
        } catch (err) {
          if (err.code === 'UNAUTHORIZED') { Busy.hide(); m.el.removeAttribute('data-locked'); m.close(); guard(err); return; }
          x.error = err.message + (err.details || []).map((y) => '；' + y.message).join('');
        }
      }
      Busy.hide();
      m.el.removeAttribute('data-locked');
      if (done.length) changed = true;
      const left = people.filter((x) => !x.done);
      dutyPage.flash = done.length ? notice('success', '已' + word + (done.length > 1 ? ` ${done.length} 位` : ''), `${done.join('、')}・${Fmt.shortDate(date)}・${p.name}${warns.length ? '（注意：' + warns.join('；') + '）' : ''}`) : dutyPage.flash;
      if (!left.length) { m.close(); return; }
      // 有人沒成功：留在視窗，成功的拿掉，失敗的標出原因
      people.splice(0, people.length, ...left);
      paint();
      box.textContent = (done.length ? `已${word}：${done.join('、')}。` : '') + `下面 ${left.length} 位沒有${word}成功，看一下原因，改好再按一次，或按返回。`;
      box.hidden = false;
    });
  }

  /** 一天的勤務整筆搬到別的日期（報名一起搬）：舊統計表匯入時年份打錯用，預設前一年同一天（總管理者） */
  function moveDuty(d) {
    const lastYear = `${Number(d.start.slice(0, 4)) - 1}${d.start.slice(4)}`;
    const m = Modal.open(`
      <h2 class="modal-title">📅 整筆搬到別的日期</h2>
      <p class="modal-note">「${esc(d.name)}」（${esc(Fmt.rocDate(d.start))}）連同報名 ${(d.signups || []).length} 筆，一起搬到新的日期。年份打錯（例如去年的紀錄被當成今年）時用。</p>
      <label class="form-row"><span>新的日期</span><input class="input" type="date" data-to value="${lastYear}"></label>
      <p class="form-error" data-err hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-go>搬過去</button>
        <button type="button" class="btn btn-block" data-close>取消</button>
      </div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const go = m.el.querySelector('[data-go]');
    go.addEventListener('click', async () => {
      const to = m.el.querySelector('[data-to]').value;
      const err = m.el.querySelector('[data-err]');
      if (!to) { err.textContent = '請選日期'; err.hidden = false; return; }
      go.disabled = true;
      go.textContent = '搬移中⋯';
      try {
        const r = await Api.admin('adminMoveDuty', { id: d.id, to });
        m.close();
        dutyPage.viewDate = r.to;
        dutyPage.flash = notice('success', '已搬到新的日期', `${Fmt.rocDate(r.from)} → ${Fmt.rocDate(r.to)}・報名 ${r.moved} 筆一起搬`);
        afterChange();
      } catch (e) {
        if (guard(e)) { m.close(); return; }
        err.textContent = e.message || '搬移失敗';
        err.hidden = false;
        go.disabled = false;
        go.textContent = '搬過去';
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
