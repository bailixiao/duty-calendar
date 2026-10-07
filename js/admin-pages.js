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
  // 今天起一個月有人報名的日期，勾選（可全選）後產生貼到 LINE 的文字：
  //   教全區
  //   11/14（六）
  //   勤務名稱人員:名字、名字

  function day(body, guard) {
    AdminPage.swr('roster', () => Api.admin('adminRoster', {}, true), (data, stale) => renderRoster(body, data, stale), body);
  }

  function renderRoster(body, data, stale) {
    if (!data.days.length) {
      body.innerHTML = `${AdminPage.staleNote(stale)}<p class="panel-empty">今天起一個月還沒有人報名。</p>`;
      return;
    }
    const tomorrow = Fmt.addDays(data.today, 1);
    const prev = new Set([...body.querySelectorAll('[data-roster-date]:checked')].map((c) => c.value));
    const first = !body.querySelector('[data-roster-date]');
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <p class="hint">勾要產生名單的日期（今天起一個月，有人報名的日子），下面的文字會跟著變，按「複製文字」貼到 LINE。</p>
      <div class="roster-quick"><button type="button" class="link-btn" data-all>全選</button><button type="button" class="link-btn" data-none>都不選</button></div>
      <div class="roster-dates">${data.days.map((d) => {
        const on = first ? d.date === tomorrow : prev.has(d.date);
        return `<label class="check roster-date"><input type="checkbox" data-roster-date value="${d.date}"${on ? ' checked' : ''}>
          <span><strong>${esc(Fmt.shortDate(d.date))}</strong>${d.date === data.today ? '<small>今天</small>' : d.date === tomorrow ? '<small>明天</small>' : ''}<br><small>${esc(d.duties.map((x) => x.name).join('、'))}</small></span></label>`;
      }).join('')}</div>
      <textarea class="day-text" rows="14" aria-label="名單文字（可修改）"></textarea>
      <button type="button" class="btn btn-primary btn-block" data-copy>複製文字</button>
      <p class="hint">可以先在框內修改，再按「複製文字」。名單不含電話。</p>`;
    const area = body.querySelector('textarea');
    const boxes = () => [...body.querySelectorAll('[data-roster-date]')];
    const update = () => {
      const picked = new Set(boxes().filter((c) => c.checked).map((c) => c.value));
      area.value = rosterText(data.days.filter((d) => picked.has(d.date)));
    };
    boxes().forEach((c) => c.addEventListener('change', update));
    body.querySelector('[data-all]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = true; }); update(); });
    body.querySelector('[data-none]').addEventListener('click', () => { boxes().forEach((c) => { c.checked = false; }); update(); });
    body.querySelector('[data-copy]').addEventListener('click', () => copy(area, body.querySelector('[data-copy]')));
    update();
  }

  /** 名單文字：教全區＋每個日期一段，每個勤務一行「名稱人員:名字、名字」 */
  function rosterText(days) {
    if (!days.length) return '';
    const lines = [window.SITE.org];
    days.forEach((d) => {
      lines.push(Fmt.shortDate(d.date));
      d.duties.forEach((x) => lines.push(`${x.name}人員:${x.names.join('、')}`));
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

  window.AdminPages = { logs, day, rosterText };
})();
