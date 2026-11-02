// 管理後台：操作紀錄與還原、名單（今天起一個月勾日期，產生文字並複製，方便貼到 LINE 群組；不含電話）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const PAGE_SIZE = 50;
  const RESTORE_EXPLAIN = {
    '報名': '還原後，這筆報名會被取消。',
    '取消': '還原後，這筆報名會恢復為有效。',
    '改期': '還原後，會取消改期後的那筆，並恢復原本的日期。'
  };

  // ---------- 操作紀錄 ----------

  function logs(body, guard) {
    let offset = 0;
    let items = [];
    let flash = '';
    let actions = [];
    const filters = { q: '', kind: '', from: '', to: '' };
    const filtering = () => !!(filters.q || filters.kind || filters.from || filters.to);
    const params = (o) => Object.assign({ limit: PAGE_SIZE }, filters, o);

    /** 第一頁：先顯示記住的（或背景先抓好的），同時更新 */
    function loadFirst() {
      if (filtering()) { search(); return; }
      AdminPage.swr('logs', () => Api.admin('adminLogs', { offset: 0, limit: PAGE_SIZE }, true), (data, stale) => {
        items = data.logs.slice();
        offset = data.logs.length;
        actions = data.actions || actions;
        render(data.total, stale);
      }, body);
    }

    // 搜尋（在伺服器篩選）：打字停一下才送
    let searchTimer = null;
    let searchToken = 0;
    async function search() {
      const t = ++searchToken;
      const list = body.querySelector('[data-log-list]');
      if (list) list.innerHTML = '<li class="panel-empty">搜尋中⋯</li>';
      try {
        const data = await Api.admin('adminLogs', params({ offset: 0 }), true);
        if (t !== searchToken) return;
        items = data.logs.slice();
        offset = data.logs.length;
        actions = data.actions || actions;
        render(data.total, false);
      } catch (err) {
        guard(err, body);
      }
    }

    async function loadMore() {
      try {
        const data = await Api.admin('adminLogs', params({ offset }), true);
        items = items.concat(data.logs);
        offset += data.logs.length;
        render(data.total, false);
      } catch (err) {
        guard(err, body);
      }
    }

    function render(total, stale) {
      body.innerHTML = `
        ${AdminPage.staleNote(stale)}
        ${flash}
        <div class="log-filter">
          <input class="input" type="search" data-f="q" placeholder="🔍 搜尋名字、勤務、內容" value="${esc(filters.q)}">
          <select class="input" data-f="kind" aria-label="動作"><option value="">全部動作</option>${actions.map((a) => `<option${a === filters.kind ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>
          <label><span>從</span><input class="input" type="date" data-f="from" value="${esc(filters.from)}"></label>
          <label><span>到</span><input class="input" type="date" data-f="to" value="${esc(filters.to)}"></label>
          ${filtering() ? '<button type="button" class="link-btn" data-f-clear>清除搜尋</button>' : ''}
        </div>
        <p class="hint">${filtering() ? `找到 ${total} 筆` : `最新的在最上面。共 ${total} 筆`}。</p>
        <ul class="log-list" data-log-list>
          ${items.map((l) => `
            <li class="log-item${l.restoredAt ? ' is-restored' : ''}">
              <div class="log-head">
                <span class="log-action action-${esc(l.action)}">${esc(l.action)}</span>
                <span class="log-time">${esc(l.time)}</span>
              </div>
              <p class="log-summary">${esc(l.summary)}</p>
              ${l.restoredAt ? `<p class="log-restored">已於 ${esc(l.restoredAt)} 還原</p>` : ''}
              ${l.restorable && !stale ? `<button type="button" class="btn btn-small" data-restore="${l.row}">還原</button>` : ''}
            </li>`).join('') || '<li class="panel-empty">還沒有任何紀錄</li>'}
        </ul>
        ${offset < total ? '<button type="button" class="btn btn-block" data-more>載入更多</button>' : ''}`;
      const more = body.querySelector('[data-more]');
      if (more) more.addEventListener('click', () => { more.disabled = true; more.textContent = '載入中⋯'; loadMore(); });
      body.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener(inp.dataset.f === 'q' ? 'input' : 'change', () => {
        filters[inp.dataset.f] = inp.value.trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => (filtering() ? search() : loadFirst()), inp.dataset.f === 'q' ? 450 : 0);
      }));
      const clr = body.querySelector('[data-f-clear]');
      if (clr) clr.addEventListener('click', () => { Object.keys(filters).forEach((k) => { filters[k] = ''; }); loadFirst(); });
      // 搜尋框重畫後游標留在原位
      const qi = body.querySelector('[data-f=q]');
      if (qi && filters.q && document.activeElement === document.body) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
      body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
        restore(items.find((l) => String(l.row) === b.dataset.restore));
      }));
    }

    async function restore(l) {
      const ok = await Confirm.open({
        title: `確定要還原這筆「${l.action}」嗎？`,
        rows: [['時間', l.time], ['內容', l.summary]],
        note: RESTORE_EXPLAIN[l.action],
        confirmText: '確定還原',
        cancelText: '返回'
      });
      if (!ok) return;
      Busy.show('還原中⋯');
      try {
        const res = await Api.admin('adminRestore', { row: l.row, signupId: l.signupId });
        Busy.hide();
        flash = res.warnings.length
          ? `<div class="notice notice-error" role="status"><p><strong>已還原，但請注意：</strong></p><p>${res.warnings.map(esc).join('<br>')}</p></div>`
          : AdminPage.notice('success', '已還原', l.summary);
        AdminPage.clearMemo();
        if (window.CalendarPage) CalendarPage.refresh();
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        flash = AdminPage.notice('error', err.message || '還原失敗', '');
      }
      loadFirst();
    }

    loadFirst();
  }

  // ---------- 名單 ----------
  // 今天起一個月的勤務或活動（還沒有人報名的也列；初一十五打掃不列），依勤務分開，勾選（可全選）後產生貼到 LINE 的文字：
  //   教全區
  //   【勤務名稱】
  //   11/14（六）：名字、名字

  /** 名單不需要的勤務：初一十五打掃（2026/11/2） */
  const ROSTER_SKIP = /初一十五打掃/;

  /** 把「每天的勤務」改成「每個勤務的日期」：同名的勤務合在一起，依第一次的日期排序 */
  function byDuty(days, cat) {
    const map = new Map();
    days.forEach((d) => d.duties.forEach((x) => {
      if (ROSTER_SKIP.test(x.name)) return;
      if (cat && (x.category || '勤務') !== cat) return; // 分總務／道務／教育（舊資料沒有類別的算總務）
      if (!map.has(x.name)) map.set(x.name, { name: x.name, dates: [] });
      map.get(x.name).dates.push({ date: d.date, names: x.names, notice: x.notice, group: x.group, tickets: x.tickets, temples: x.temples, price: x.price });
    }));
    return [...map.values()];
  }

  // ---------- 📢 通知（2026/11/2）：要貼到 LINE 的文字都在這裡：佈達（邀請報名）、給分壇名單（總務佈達在近期勤務的按鈕） ----------
  const NOTIFY_KEY = 'duty-calendar:notify-tab';

  function day(body, guard) {
    const parts = [['invite', '📣 佈達'], ['roster', '📋 給分壇名單']];
    let cur = 'invite';
    try { cur = localStorage.getItem(NOTIFY_KEY) || cur; } catch (e) { /* 無痕模式：用預設 */ }
    if (!parts.some((p) => p[0] === cur)) cur = 'invite';
    body.innerHTML = `
      <div class="seg notify-seg" role="radiogroup" aria-label="通知種類">${parts.map(([k, label]) => `<label class="seg-item"><input type="radio" name="notify" value="${k}"${k === cur ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
      <div data-notify></div>`;
    const show = (k) => {
      const old = body.querySelector('[data-notify]');
      const box = old.cloneNode(false); // 換新的容器：切換時上一個還在讀的資料不會蓋過來
      old.replaceWith(box);
      if (k === 'invite') InviteBoard.mount(box);
      else AdminPage.swr('roster', () => Api.admin('adminRoster', {}, true), (data, stale) => { if (box.isConnected) renderRoster(box, data, stale); }, box);
    };
    body.querySelectorAll('input[name="notify"]').forEach((r) => r.addEventListener('change', () => {
      try { localStorage.setItem(NOTIFY_KEY, r.value); } catch (e) { /* 不記住也沒關係 */ }
      show(r.value);
    }));
    show(cur);
  }

  /** 給分壇名單：上面選總務／道務／教育（總管理者三類都能選、和佈達記同一個；類別帳號只有自己的類別） */
  function renderRoster(box, data, stale) {
    const cats = InviteBoard.catsFor(Api.adminWho().role);
    const CAT_KEY = 'duty-calendar:notify-cat';
    let cat = cats[0][0];
    try { const saved = localStorage.getItem(CAT_KEY); if (cats.some((c) => c[0] === saved)) cat = saved; } catch (e) { /* 用預設 */ }
    const keep = box.querySelector('[data-roster-body]');
    box.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${cats.length > 1 ? `<div class="seg notify-cat" role="radiogroup" aria-label="哪一類的名單">${cats.map(([v, label]) => `<label class="seg-item"><input type="radio" name="rosterCat" value="${v}"${v === cat ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>` : ''}
      <div data-roster-body></div>`;
    if (keep) box.querySelector('[data-roster-body]').replaceWith(keep); // 自動更新時保留勾選
    box.querySelectorAll('input[name="rosterCat"]').forEach((r) => r.addEventListener('change', () => {
      cat = r.value;
      try { localStorage.setItem(CAT_KEY, cat); } catch (e) { /* 不記住也沒關係 */ }
      const fresh = box.querySelector('[data-roster-body]').cloneNode(false);
      box.querySelector('[data-roster-body]').replaceWith(fresh);
      paintRoster(fresh, data, cat);
    }));
    paintRoster(box.querySelector('[data-roster-body]'), data, cat);
  }

  function paintRoster(body, data, cat) {
    const duties = byDuty(data.days, cat);
    if (!duties.length) {
      body.innerHTML = '<p class="panel-empty">今天起一個月沒有這一類的勤務或活動。</p>';
      return;
    }
    const tomorrow = Fmt.addDays(data.today, 1);
    const prev = new Set([...body.querySelectorAll('[data-roster-duty]:checked')].map((c) => c.value));
    const first = !body.querySelector('[data-roster-duty]');
    const dateTag = (x) => esc(Fmt.shortDate(x.date).replace(/（.）$/, '')) + (x.notice || x.names.length ? '' : '（0）');
    body.innerHTML = `
      <p class="hint">勾要產生名單的勤務（今天起一個月的勤務、活動，初一十五打掃不列；還沒有人報名的寫「還沒有人報名」），下面的文字會跟著變，按「複製文字」貼到 LINE。</p>
      <div class="roster-quick"><button type="button" class="link-btn" data-all>全選</button><button type="button" class="link-btn" data-none>都不選</button></div>
      <div class="roster-dates">${duties.map((g, i) => {
        const on = first ? g.dates.some((x) => x.date === tomorrow) : prev.has(String(i));
        return `<label class="check roster-date"><input type="checkbox" data-roster-duty value="${i}"${on ? ' checked' : ''}>
          <span><strong>${esc(g.name)}</strong><br><small>${g.dates.map(dateTag).join('、')}</small></span></label>`;
      }).join('')}</div>
      <textarea class="day-text" rows="14" aria-label="名單文字（可修改）"></textarea>
      <button type="button" class="btn btn-primary btn-block" data-copy>複製文字</button>
      <p class="hint">可以先在框內修改，再按「複製文字」。名單不含電話。</p>`;
    const area = body.querySelector('textarea');
    const boxes = () => [...body.querySelectorAll('[data-roster-duty]')];
    const update = () => {
      area.value = rosterText(boxes().filter((c) => c.checked).map((c) => duties[Number(c.value)]));
    };
    boxes().forEach((c) => c.addEventListener('change', update));
    body.querySelector('[data-all]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = true; }); update(); });
    body.querySelector('[data-none]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = false; }); update(); });
    body.querySelector('[data-copy]').addEventListener('click', () => copy(area, body.querySelector('[data-copy]')));
    update();
  }

  /** 名單文字：教全區＋每個勤務一段「【名稱】」，每天一行「日期：名字、名字」 */
  function rosterText(duties) {
    if (!duties.length) return '';
    const lines = [window.SITE.org];
    duties.forEach((g) => {
      lines.push(`【${g.name}】`);
      g.dates.forEach((x) => {
        // 登記張數的勤務（園遊券）：依佛堂分組——佛堂一行、下一行名字和張數、再一行佛堂小計；最後寫總張數、合計金額
        if (x.tickets && x.names.length) {
          const money = (n) => (x.price ? `・${n * x.price} 元` : '');
          const groups = new Map();
          x.names.forEach((n) => { const t = (x.temples || {})[n] || ''; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(n); });
          const order = [...groups.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1));
          lines.push(Fmt.shortDate(x.date));
          let sum = 0;
          order.forEach((t) => {
            const names = groups.get(t);
            const sub = names.reduce((n, k) => n + (x.tickets[k] || 1), 0);
            sum += sub;
            lines.push(t || '未填佛堂');
            lines.push(names.map((n) => `${n} ${x.tickets[n] || 1}張`).join('、'));
            lines.push(`小計 ${sub} 張${money(sub)}`);
          });
          lines.push(`共 ${sum} 張${money(sum)}`);
          return;
        }
        lines.push(`${Fmt.shortDate(x.date)}：${x.notice ? (x.group ? x.group + '輪值' : '公告') : x.names.length ? x.names.join('、') : '還沒有人報名'}`);
      });
    });
    return lines.join('\n');
  }

  async function copy(textarea, button) {
    const text = textarea.value;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      textarea.focus();
      textarea.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    }
    button.textContent = ok ? '已複製 ✓' : '請長按框內文字手動複製';
    setTimeout(() => { button.textContent = '複製文字'; }, 2500);
  }

  window.AdminPages = { logs, day, rosterText, byDuty };
})();
