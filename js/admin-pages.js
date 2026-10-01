// 管理後台：操作紀錄與還原、明日名單（產生文字並複製，方便貼到 LINE 群組；不含電話）。
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

    /** 第一頁：先顯示記住的（或背景先抓好的），同時更新 */
    function loadFirst() {
      AdminPage.swr('logs', () => Api.admin('adminLogs', { offset: 0, limit: PAGE_SIZE }, true), (data, stale) => {
        items = data.logs.slice();
        offset = data.logs.length;
        render(data.total, stale);
      }, body);
    }

    async function loadMore() {
      try {
        const data = await Api.admin('adminLogs', { offset, limit: PAGE_SIZE }, true);
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
        <p class="hint">最新的在最上面。共 ${total} 筆。</p>
        <ul class="log-list">
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

  // ---------- 明日名單 ----------

  function day(body, guard) {
    const tomorrow = Fmt.addDays(Fmt.toDateStr(new Date()), 1);
    body.innerHTML = `
      <div class="day-pick">
        <label class="field-label" for="day-date">日期</label>
        <div class="name-row">
          <input id="day-date" class="input" type="date" value="${tomorrow}">
          <button type="button" class="btn" data-make>產生名單</button>
        </div>
      </div>
      <div data-result></div>`;
    const input = body.querySelector('#day-date');
    const result = body.querySelector('[data-result]');

    function make() {
      const date = input.value;
      if (!date) return;
      result.innerHTML = '<p class="panel-empty">載入中⋯</p>';
      AdminPage.swr('day:' + date, () => Api.admin('adminDay', { date }, true), (data, stale) => {
        if (input.value !== date) return;
        const text = dayText(data);
        result.innerHTML = `
          ${AdminPage.staleNote(stale)}
          <textarea class="day-text" rows="16" aria-label="名單文字（可修改）">${esc(text)}</textarea>
          <button type="button" class="btn btn-primary btn-block" data-copy>複製文字</button>
          <p class="hint">可以先在框內修改，再按「複製文字」，然後貼到 LINE 群組。名單不含電話。</p>`;
        result.querySelector('[data-copy]').addEventListener('click', () => copy(result.querySelector('textarea'), result.querySelector('[data-copy]')));
      }, result);
    }

    body.querySelector('[data-make]').addEventListener('click', make);
    input.addEventListener('change', make);
    make();
  }

  /** 產生貼到 LINE 的文字 */
  function dayText(data) {
    const lines = [`【${Fmt.rocDate(data.date)} 勤務名單】`];
    if (!data.duties.length) {
      lines.push('', '這天沒有勤務。');
      return lines.join('\n');
    }
    data.duties.forEach((d) => {
      const time = Fmt.cardTime(d, data.date);
      lines.push('', `■ ${d.name}${d.mode === '公告型' ? '（公告）' : ''}`);
      const meta = [d.location, time].filter(Boolean).join('・');
      if (meta) lines.push(meta);
      if (d.mode === '公告型') {
        const g = d.groupInfo || {};
        lines.push(`輪值：${g.name || d.group || ''}` + (g.leader ? `　組長：${g.leader}` : '') + (g.assistant ? `　佐理：${g.assistant}` : ''));
        if (g.members && g.members.length) lines.push(`組員：${g.members.join('、')}`);
        return;
      }
      if (d.group && d.name.indexOf('12人小組') === -1) lines.push(`負責：${d.group}`);
      d.positions.forEach((p) => {
        const names = p.people.map((x) => x.name + (x.accompany ? '（陪同）' : ''));
        const count = p.people.filter((x) => !x.accompany).length;
        const short = count < Fmt.effectiveMin(p) ? `（缺 ${Fmt.effectiveMin(p) - count} 人）` : '';
        lines.push(`${p.name}：${names.length ? names.join('、') : '（尚無）'}${short}`);
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

  window.AdminPages = { logs, day, dayText };
})();
