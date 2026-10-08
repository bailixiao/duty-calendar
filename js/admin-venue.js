// 管理後台：場地借用（#/admin/venue）。總管理者、場管帳號審核（同意／不同意／取消、申請人的取消申請）；唯讀等只能看。
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

  /** 同一個申請編號、同一個狀態合成一張（可能好幾天、好幾個時段） */
  function groups(list) {
    const map = new Map();
    list.forEach((r) => {
      const k = r.group + '|' + r.status + '|' + (r.cancelAsk ? 'c' : '');
      if (!map.has(k)) map.set(k, Object.assign({}, r, { ids: [], slots: [], dates: [], items: [] }));
      const g = map.get(k);
      g.ids.push(r.id);
      g.items.push(r);
      if (g.slots.indexOf(r.slot) === -1) g.slots.push(r.slot);
      if (g.dates.indexOf(r.date) === -1) g.dates.push(r.date);
    });
    return [...map.values()].map((g) => Object.assign(g, { date: g.dates.slice().sort()[0], last: g.dates.slice().sort().pop() }));
  }

  function dateText(g) {
    const ds = g.dates.slice().sort();
    if (ds.length === 1) return Fmt.shortDate(ds[0]);
    return `${ds.length} 天：${ds.slice(0, 6).map(Fmt.shortDate).join('、')}${ds.length > 6 ? `⋯到 ${Fmt.shortDate(ds[ds.length - 1])}` : ''}`;
  }

  function card(g, actions) {
    const tel = String(g.phone || '').replace(/[^\d+]/g, '');
    return `
      <li class="venue-req is-${g.status === '已同意' ? 'ok' : g.status === '待審核' ? 'wait' : 'no'}">
        <div class="vr-head"><strong>${esc(dateText(g))}<br>${g.slots.map(esc).join('、')}</strong><span class="vr-status">${esc(g.status)}${g.cancelAsk ? '・申請取消' : ''}</span></div>
        <dl class="vr-info">
          <div><dt>用途</dt><dd>${esc(g.purpose)}${g.people ? `（約 ${esc(g.people)} 人）` : ''}</dd></div>
          ${g.applicantNote ? `<div><dt>備註</dt><dd>${esc(g.applicantNote)}</dd></div>` : ''}
          <div><dt>申請人</dt><dd>${esc(g.name)}　${tel ? `<a href="tel:${esc(tel)}">${esc(g.phone)}</a>` : ''}</dd></div>
          <div><dt>申請時間</dt><dd>${esc(g.createdAt)}</dd></div>
          ${g.cancelAsk ? `<div><dt>申請取消</dt><dd>${esc(g.cancelAsk)}</dd></div>` : ''}
          ${g.decidedAt ? `<div><dt>審核</dt><dd>${esc(g.decidedAt)}${g.decidedBy ? `（${esc(g.decidedBy)}）` : ''}${g.note ? `・${esc(g.note)}` : ''}</dd></div>` : ''}
        </dl>
        ${actions && canDecide() ? `<div class="vr-actions">${actions(g)}</div>` : ''}
      </li>`;
  }

  function render(body, guard, data, stale) {
    const today = data.today;
    const all = groups(data.requests);
    const cancelAsks = all.filter((g) => g.cancelAsk);
    const pending = all.filter((g) => !g.cancelAsk && g.status === '待審核' && g.last >= today);
    const approved = all.filter((g) => !g.cancelAsk && g.status === '已同意' && g.last >= today);
    const others = all.filter((g) => cancelAsks.indexOf(g) === -1 && pending.indexOf(g) === -1 && approved.indexOf(g) === -1);
    // 待審核的時段如果已經被同意給別人，提醒
    const takenKey = new Set(data.requests.filter((r) => r.status === '已同意').map((r) => r.date + '|' + r.slot));
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${canDecide() ? '<div class="venue-watch" data-watch></div>' : ''}
      ${cancelAsks.length ? `<h2 class="admin-sub">申請取消 <span class="badge badge-short">${cancelAsks.length} 筆</span></h2>
      <p class="hint">申請人想取消這些時段。同意取消後，行事曆上的「已借出」才會消失；不同意就維持原狀（可以寫原因給申請人看）。</p>
      <ul class="venue-reqs">${cancelAsks.map((g) => card(g, (x) => `<button type="button" class="btn btn-primary" data-cok="${esc(x.ids.join(','))}">同意取消</button>
        <button type="button" class="btn btn-quiet-danger" data-cno="${esc(x.ids.join(','))}">不同意取消</button>`)).join('')}</ul>` : ''}
      <h2 class="admin-sub">待審核 <span class="badge ${pending.length ? 'badge-short' : 'badge-ok'}">${pending.length} 筆</span></h2>
      ${pending.length ? '<div data-repair-warn></div>' : ''}
      ${pending.length ? `<ul class="venue-reqs">${pending.map((g) => card(g, (x) => {
        // 已經借給別人的時段：同意時略過，只同意其他的
        const clash = x.items.filter((r) => takenKey.has(r.date + '|' + r.slot));
        const okIds = x.items.filter((r) => clash.indexOf(r) === -1).map((r) => r.id);
        return `${clash.length ? `<p class="vr-warn">⚠️ ${clash.map((r) => esc(Fmt.shortDate(r.date) + ' ' + r.slot)).join('、')}已經借給別人了${okIds.length ? '，按同意只會同意其他的' : ''}</p>` : ''}
          <button type="button" class="btn btn-primary" data-ok="${esc(okIds.join(','))}"${okIds.length ? '' : ' disabled'}>同意${x.dates.length > 1 ? `（${x.dates.length} 天）` : ''}</button>
          <button type="button" class="btn btn-quiet-danger" data-no="${esc(x.ids.join(','))}">不同意</button>
          ${x.items.length > 1 ? `<details class="vr-each">
            <summary>逐天審核（可以幾天同意、幾天不同意）</summary>
            <p class="hint">勾要處理的日期時段，再按下面的按鈕；沒處理的會留在待審核。</p>
            <div class="vr-each-list">${x.items.map((r) => {
              const taken = clash.indexOf(r) !== -1;
              return `<label class="check${taken ? ' is-taken' : ''}"><input type="checkbox" data-each="${esc(r.id)}"${taken ? ' disabled' : ' checked'}> ${esc(Fmt.shortDate(r.date))} ${esc(r.slot)}${taken ? '（已借給別人）' : ''}</label>`;
            }).join('')}</div>
            <div class="vr-each-quick"><button type="button" class="link-btn" data-each-all>全選</button><button type="button" class="link-btn" data-each-none>都不選</button></div>
            <div class="vr-actions">
              <button type="button" class="btn btn-primary" data-each-ok>同意勾選的</button>
              <button type="button" class="btn btn-quiet-danger" data-each-no>不同意勾選的</button>
            </div>
          </details>` : ''}`;
      })).join('')}</ul>` : '<p class="muted">目前沒有待審核的申請。</p>'}

      <h2 class="admin-sub">已借出（今天以後）</h2>
      ${approved.length ? `<ul class="venue-reqs">${approved.map((g) => card(g, (x) => `<button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${esc(x.ids.join(','))}">取消借用</button>`)).join('')}</ul>` : '<p class="muted">還沒有。</p>'}

      ${others.length ? `<details class="venue-others"><summary>其他（不同意、已取消、已過去的）${others.length} 筆</summary>
        <ul class="venue-reqs">${others.reverse().map((g) => card(g)).join('')}</ul></details>` : ''}
      <p class="hint">同意後，家人們的行事曆會出現「${esc(window.SITE.venue)} 已借出」（用途、借用人姓名；不顯示電話）。請記得打電話告訴申請人結果。</p>
      <section class="repair-admin" data-repairs><h2 class="admin-sub">🔧 修繕</h2><p class="muted">讀取中⋯</p></section>`;
    loadRepairs(body, guard);

    const watchBox = body.querySelector('[data-watch]');
    if (watchBox) drawWatch(watchBox, guard);

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
    body.querySelectorAll('[data-cok]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.cok, '同意取消')));
    body.querySelectorAll('[data-cno]').forEach((b) => b.addEventListener('click', () => askReason('不同意取消（維持原狀）', (note) => decide(b.dataset.cno, '不同意取消', note))));
    body.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.ok, '已同意')));
    body.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => askReason('不同意這個申請', (note) => decide(b.dataset.no, '不同意', note))));
    // 逐天審核：只處理勾選的日期時段
    body.querySelectorAll('.vr-each').forEach((d) => {
      const boxes = () => [...d.querySelectorAll('[data-each]:not(:disabled)')];
      const picked = () => boxes().filter((c) => c.checked).map((c) => c.dataset.each);
      d.querySelector('[data-each-all]').addEventListener('click', () => boxes().forEach((c) => { c.checked = true; }));
      d.querySelector('[data-each-none]').addEventListener('click', () => boxes().forEach((c) => { c.checked = false; }));
      d.querySelector('[data-each-ok]').addEventListener('click', () => {
        const ids = picked();
        if (!ids.length) return alert('請先勾要同意的日期時段');
        decide(ids.join(','), '已同意');
      });
      d.querySelector('[data-each-no]').addEventListener('click', () => {
        const ids = picked();
        if (!ids.length) return alert('請先勾不同意的日期時段');
        askReason(`不同意勾選的 ${ids.length} 個時段`, (note) => decide(ids.join(','), '不同意', note));
      });
    });
    body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => askReason('取消這個借用', (note) => decide(b.dataset.cancel, '已取消', note))));
  }

  // ---------- 修繕（回報的問題、處理進度、費用與廠商） ----------

  const REPAIR_STATUS = ['待處理', '處理中', '已修好'];

  async function loadRepairs(body, guard, fresh) {
    const box = body.querySelector('[data-repairs]');
    if (!box) return;
    let data;
    try {
      data = await Api.admin('adminRepairs', {}, !fresh);
    } catch (err) {
      if (guard(err)) return;
      box.innerHTML = '<h2 class="admin-sub">🔧 修繕</h2><p class="form-error">讀不到修繕資料</p>';
      return;
    }
    drawRepairs(body, guard, data);
  }

  function drawRepairs(body, guard, data) {
    const box = body.querySelector('[data-repairs]');
    if (!box || !box.isConnected) return;
    const open = data.items.filter((r) => r.status !== '已修好');
    const done = data.items.filter((r) => r.status === '已修好');
    // 待審核上方的提醒：還沒修好的問題
    const warn = body.querySelector('[data-repair-warn]');
    if (warn) warn.innerHTML = open.length ? `<p class="vr-warn repair-warn">⚠️ ${esc(window.SITE.venue)}目前有 ${open.length} 個問題還沒修好：${open.slice(0, 4).map((r) => esc((r.location || r.detail ? (r.location || r.detail) + '・' : '') + r.problem.slice(0, 16) + '（' + r.status + '）')).join('、')}${open.length > 4 ? '⋯' : ''}。同意前可以先告訴申請人。</p>` : '';
    const edit = canDecide();
    const card = (r) => `
      <li class="venue-req repair-adm is-${r.status === '已修好' ? 'done' : r.urgency === '有危險' ? 'danger' : 'open'}">
        <div class="vr-head"><strong>${r.urgency === '有危險' ? '⚠️ ' : ''}${esc(r.location ? r.location + (r.detail ? '（' + r.detail + '）' : '') : r.detail || r.problem.slice(0, 16))}</strong><span class="vr-status">${esc(r.status)}</span></div>
        <p class="repair-problem">${esc(r.problem).replace(/\n/g, '<br>')}</p>
        ${r.photos.length ? `<div class="repair-photos">${r.photos.map((id) => `<a href="${esc(Api.fileUrl(id))}" target="_blank" rel="noopener" class="repair-thumb"><img src="${esc(Api.fileUrl(id))}" alt="回報的照片" loading="lazy"></a>`).join('')}</div>` : ''}
        <dl class="vr-info">
          <div><dt>急迫</dt><dd>${esc(r.urgency)}</dd></div>
          <div><dt>回報人</dt><dd>${esc(r.name)}　${r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}</dd></div>
          <div><dt>回報時間</dt><dd>${esc(r.createdAt)}</dd></div>
          ${r.by ? `<div><dt>處理</dt><dd>${esc(r.updatedAt)}（${esc(r.by)}）${r.doneAt ? '・完成 ' + esc(r.doneAt.slice(0, 10)) : ''}</dd></div>` : ''}
          ${!edit && (r.vendor || r.cost) ? `<div><dt>廠商／費用</dt><dd>${esc(r.vendor || '—')}／${r.cost ? esc(r.cost) + ' 元' : '—'}</dd></div>` : ''}
          ${!edit && r.note ? `<div><dt>說明</dt><dd>${esc(r.note)}</dd></div>` : ''}
        </dl>
        ${edit ? `<form class="repair-edit" data-repair="${esc(r.id)}" novalidate>
          <div class="seg">${REPAIR_STATUS.map((s) => `<label class="seg-item"><input type="radio" name="status" value="${s}"${s === r.status ? ' checked' : ''}><span>${s}</span></label>`).join('')}</div>
          <label class="form-row"><span>處理說明（回報人會收到）</span><input class="input" name="note" maxlength="200" value="${esc(r.note || '')}" placeholder="例：已請水電師傅 10/12 來修"></label>
          <div class="form-row-pair">
            <label><span>廠商</span><input class="input" name="vendor" maxlength="40" value="${esc(r.vendor || '')}" placeholder="例：○○水電行"></label>
            <label><span>費用（元）</span><input class="input" name="cost" inputmode="numeric" value="${esc(r.cost || '')}" placeholder="例：1500"></label>
          </div>
          <button type="submit" class="btn btn-primary">儲存</button>
        </form>` : ''}
      </li>`;
    box.innerHTML = `
      <h2 class="admin-sub">🔧 修繕 <span class="badge ${open.length ? 'badge-short' : 'badge-ok'}">${open.length} 個還沒修好</span></h2>
      ${open.length ? `<ul class="venue-reqs">${open.map(card).join('')}</ul>` : '<p class="muted">目前沒有要修的地方 😊</p>'}
      ${done.length ? `<details class="venue-others"><summary>最近 90 天修好的 ${done.length} 筆（費用合計 ${Number(data.costTotal || 0).toLocaleString()} 元）</summary>
        <ul class="venue-reqs">${done.map(card).join('')}</ul></details>` : ''}
      <p class="hint">家人們在借場地頁「🔧 回報需要修繕」回報。改成「處理中」「已修好」時，會通知回報人（他有允許通知的話）。</p>`;
    box.querySelectorAll('[data-repair]').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Busy.show('儲存中⋯');
      try {
        const res = await Api.admin('adminRepairUpdate', { id: f.dataset.repair, status: f.querySelector('[name=status]:checked').value, note: f.elements.note.value, vendor: f.elements.vendor.value, cost: f.elements.cost.value });
        Busy.hide();
        drawRepairs(body, guard, res);
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        alert((err.message || '儲存失敗') + (err.details ? '\n' + err.details.map((d) => d.message).join('\n') : ''));
      }
    }));
  }

  /**
   * 這支手機要不要收「有新的場地申請」通知（總管理者、場管）。
   * 手機已經允許通知（例如開過手機提醒）就自動開啟，不用按；自己按過「關閉」的手機記住不再自動開。
   */
  const OFF_KEY = 'duty-calendar:venue-watch-off';
  const offByUser = () => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch (e) { return false; } };
  const setOffByUser = (v) => { try { if (v) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch (e) { /* 無痕模式 */ } };
  let watchOn = null; // 記住上次查到的狀態，重畫時不閃
  const sysOffByUser = () => { try { return localStorage.getItem('duty-calendar:system-watch-off') === '1'; } catch (e) { return false; } };
  let autoTried = false;

  /** 登入後台時呼叫：允許過通知、沒自己關掉的審核手機，自動開啟（每次開網頁做一次） */
  async function autoWatch() {
    if (autoTried || !canDecide() || !window.PushPage || PushPage.canNotify() !== 'ok') return;
    if (Notification.permission !== 'granted' || offByUser()) return;
    autoTried = true;
    const sub = await PushPage.currentSub();
    if (!sub) return;
    try { watchOn = (await Api.admin('adminVenueWatch', { endpoint: sub.endpoint, on: true }, true)).on; } catch (e) { autoTried = false; }
    if (Api.adminWho().role === '總管理者' && !sysOffByUser()) Api.admin('adminSystemWatch', { endpoint: sub.endpoint, on: true }, true).catch(() => {});
  }

  async function drawWatch(box, guard) {
    const st = window.PushPage ? PushPage.canNotify() : 'unsupported';
    if (st !== 'ok') {
      box.innerHTML = `<p class="hint">🔔 ${st === 'ios-install' ? 'iPhone 要先把本網站「加到主畫面」並從主畫面打開，才能收到場地申請通知。' : st === 'line' ? '在 LINE 裡收不到通知，請改用手機的瀏覽器打開後台。' : st === 'denied' ? '這支手機封鎖了本網站的通知，請到手機設定允許後，才能收到場地申請通知。' : '這個瀏覽器不支援通知。'}</p>`;
      return;
    }
    const paint = () => {
      box.classList.toggle('is-on', !!watchOn);
      box.innerHTML = watchOn
        ? '<p class="venue-watch-on">✅ 這支手機會收到場地申請通知 <button type="button" class="link-btn" data-w-off>關閉</button></p>'
        : '<p>🔔 開啟後，有人送出場地申請或申請取消時，這支手機會收到通知。</p><button type="button" class="btn btn-primary" data-w-on>開啟場地申請通知</button>';
      const on = box.querySelector('[data-w-on]');
      const off = box.querySelector('[data-w-off]');
      if (on) on.addEventListener('click', () => set(true, on));
      if (off) off.addEventListener('click', () => set(false, off));
    };
    const set = async (value, btn) => {
      btn.disabled = true;
      btn.textContent = '設定中⋯';
      try {
        const endpoint = await PushPage.ensureSub();
        watchOn = (await Api.admin('adminVenueWatch', { endpoint, on: value })).on;
        setOffByUser(!value);
        paint();
      } catch (err) {
        if (guard(err)) return;
        paint();
        box.insertAdjacentHTML('beforeend', `<p class="form-error">${esc(err.message || '設定失敗，請稍後再試')}</p>`);
      }
    };
    if (watchOn !== null) paint();
    await autoWatch();
    const sub = await PushPage.currentSub();
    if (!sub) { watchOn = false; if (box.isConnected) paint(); return; }
    try {
      watchOn = (await Api.admin('adminVenueWatch', { endpoint: sub.endpoint }, true)).on;
    } catch (e) { watchOn = false; }
    if (box.isConnected) paint();
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

  window.VenueAdminPage = { show, autoWatch };
})();
