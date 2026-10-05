// 管理後台：場地借用（#/admin/venue）。總管理者、場管帳號審核（同意／不同意／取消）；唯讀等只能看。
// 一筆申請可能有好幾個時段（同一個申請編號），一起顯示、一起審核。電話只在這裡看得到。
(function () {
  'use strict';

  const esc = Fmt.esc;

  function canDecide() {
    return ['總管理者', '場管'].indexOf(Api.adminWho().role) !== -1;
  }

  function show(body, guard) {
    AdminPage.swr('venue', () => Api.admin('adminVenue', {}, true), (data, stale) => render(body, guard, data, stale), body);
  }

  /** 同一個申請編號、同一個狀態的時段合成一張 */
  function groups(list) {
    const map = new Map();
    list.forEach((r) => {
      const k = r.group + '|' + r.status;
      if (!map.has(k)) map.set(k, Object.assign({}, r, { ids: [], slots: [] }));
      const g = map.get(k);
      g.ids.push(r.id);
      g.slots.push(r.slot);
    });
    return [...map.values()];
  }

  function card(g, actions) {
    const tel = String(g.phone || '').replace(/[^\d+]/g, '');
    return `
      <li class="venue-req is-${g.status === '已同意' ? 'ok' : g.status === '待審核' ? 'wait' : 'no'}">
        <div class="vr-head"><strong>${esc(Fmt.shortDate(g.date))}　${g.slots.map(esc).join('、')}</strong><span class="vr-status">${esc(g.status)}</span></div>
        <dl class="vr-info">
          <div><dt>用途</dt><dd>${esc(g.purpose)}${g.people ? `（約 ${esc(g.people)} 人）` : ''}</dd></div>
          <div><dt>申請人</dt><dd>${esc(g.name)}　${tel ? `<a href="tel:${esc(tel)}">${esc(g.phone)}</a>` : ''}</dd></div>
          <div><dt>申請時間</dt><dd>${esc(g.createdAt)}</dd></div>
          ${g.decidedAt ? `<div><dt>審核</dt><dd>${esc(g.decidedAt)}${g.decidedBy ? `（${esc(g.decidedBy)}）` : ''}${g.note ? `・${esc(g.note)}` : ''}</dd></div>` : ''}
        </dl>
        ${actions && canDecide() ? `<div class="vr-actions">${actions(g)}</div>` : ''}
      </li>`;
  }

  function render(body, guard, data, stale) {
    const today = data.today;
    const all = groups(data.requests);
    const pending = all.filter((g) => g.status === '待審核' && g.date >= today);
    const approved = all.filter((g) => g.status === '已同意' && g.date >= today);
    const others = all.filter((g) => pending.indexOf(g) === -1 && approved.indexOf(g) === -1);
    // 待審核的時段如果已經被同意給別人，提醒
    const takenKey = new Set(data.requests.filter((r) => r.status === '已同意').map((r) => r.date + '|' + r.slot));
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <h2 class="admin-sub">待審核 <span class="badge ${pending.length ? 'badge-short' : 'badge-ok'}">${pending.length} 筆</span></h2>
      ${pending.length ? `<ul class="venue-reqs">${pending.map((g) => card(g, (x) => {
        const clash = x.slots.filter((s) => takenKey.has(x.date + '|' + s));
        return `${clash.length ? `<p class="vr-warn">⚠️ ${clash.map(esc).join('、')}已經借給別人了</p>` : ''}
          <button type="button" class="btn btn-primary" data-ok="${esc(x.ids.join(','))}"${clash.length === x.slots.length ? ' disabled' : ''}>同意</button>
          <button type="button" class="btn btn-quiet-danger" data-no="${esc(x.ids.join(','))}">不同意</button>`;
      })).join('')}</ul>` : '<p class="muted">目前沒有待審核的申請。</p>'}

      <h2 class="admin-sub">已借出（今天以後）</h2>
      ${approved.length ? `<ul class="venue-reqs">${approved.map((g) => card(g, (x) => `<button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${esc(x.ids.join(','))}">取消借用</button>`)).join('')}</ul>` : '<p class="muted">還沒有。</p>'}

      ${others.length ? `<details class="venue-others"><summary>其他（不同意、已取消、已過去的）${others.length} 筆</summary>
        <ul class="venue-reqs">${others.reverse().map((g) => card(g)).join('')}</ul></details>` : ''}
      <p class="hint">同意後，家人們的行事曆會出現「區中心 已借出」（用途、借用人姓名；不顯示電話）。請記得打電話告訴申請人結果。</p>`;

    const decide = async (ids, decision, note) => {
      Busy.show('處理中⋯');
      try {
        const res = await Api.admin('adminVenueDecide', { ids: ids.split(','), decision, note: note || '' });
        Busy.hide();
        AdminPage.clearMemo();
        if (window.CalendarPage) CalendarPage.refresh();
        render(body, guard, res, false);
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        alert((err.message || '處理失敗') + (err.details ? '\n' + err.details.map((d) => d.message).join('\n') : ''));
      }
    };
    body.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.ok, '已同意')));
    body.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => askReason('不同意這個申請', (note) => decide(b.dataset.no, '不同意', note))));
    body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => askReason('取消這個借用', (note) => decide(b.dataset.cancel, '已取消', note))));
  }

  function askReason(title, onOk) {
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">${esc(title)}</h2>
        <label class="form-row"><span>原因（可空白，申請人查詢時看得到）</span><input class="input" name="note" maxlength="100" placeholder="例：當天區中心有活動"></label>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-danger">確定</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', (ev) => { ev.preventDefault(); const note = f.elements.note.value.trim(); m.close(); onOk(note); });
  }

  window.VenueAdminPage = { show };
})();
