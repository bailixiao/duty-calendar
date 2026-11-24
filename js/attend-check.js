// 📋 出席確認（2026/11/24）：活動過了，管理者看過名單（沒來的改未到、有來沒報名的補登）按「✓ 出席確認好了」，
//   統計、關懷名單、年度報表才準。改出席、補登、點名也自動算確認（Attendance.gs attendOkMark_）。
//   mount()：後台近期勤務最上面「最近 14 天還沒確認出席」；dutyHtml()／bindDuty()：勤務名單頁的按鈕。
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
  let open = false; // 名單打開著（重畫後保持）

  async function mount(box, guard) {
    if (!box) return;
    let d;
    try { d = await Api.admin('adminAttendPending', {}, true); } catch (e) { if (!(guard && guard(e))) box.innerHTML = ''; return; }
    const draw = () => {
      if (!box.isConnected) return;
      const items = d.items || [];
      if (!items.length) { box.innerHTML = ''; return; }
      const shown = open ? items : items.slice(0, 5);
      box.innerHTML = `
        <section class="attend-check notice notice-info" role="status">
          <p><strong>📋 最近 ${d.days} 天有 ${items.length} 場還沒確認出席</strong></p>
          <p class="hint">點進去看名單：沒來的按「改未到」、有來沒報名的「補登」，看過沒問題按「✓ 出席確認好了」。統計、關懷名單、年度報表才會準。</p>
          <ul class="attend-list">${shown.map((x, i) => `
            <li><a href="#/admin/duty/${encodeURIComponent(x.dutyId)}?date=${x.date}"><span class="attend-date">${md(x.date)}</span> ${esc(x.name)}<small>${x.count} 人${x.absent ? `・未到 ${x.absent}` : ''}</small></a>
              <button type="button" class="btn btn-small" data-attend-ok="${i}">✓ 沒問題</button></li>`).join('')}</ul>
          ${items.length > 5 ? `<button type="button" class="btn btn-small" data-attend-more>${open ? '▴ 收起來（只看前 5 場）' : `▾ 全部打開（還有 ${items.length - 5} 場）`}</button>` : ''}
        </section>`;
      const more = box.querySelector('[data-attend-more]');
      if (more) more.addEventListener('click', () => { open = !open; draw(); });
      box.querySelectorAll('[data-attend-ok]').forEach((b) => b.addEventListener('click', async () => {
        const x = shown[Number(b.dataset.attendOk)];
        b.disabled = true;
        try {
          await Api.admin('adminAttendOk', { items: [{ dutyId: x.dutyId, date: x.date }] });
          d.items = d.items.filter((y) => y !== x);
          draw();
        } catch (e) { b.disabled = false; if (!(guard && guard(e))) alert(e.message || '儲存失敗'); }
      }));
    };
    draw();
  }

  /** 勤務名單頁：過了的日期顯示「✓ 出席確認好了」或「已確認（誰 日期）・取消」 */
  function dutyHtml(d, date, canEdit) {
    if (d.mode === '公告型' || date > d.today) return '';
    const ok = (d.attendOk || {})[date];
    if (ok) return `<p class="attend-ok-line">✓ 出席已確認（${esc(ok.by)} ${esc(md(String(ok.at).slice(0, 10)))}）${canEdit ? ' <button type="button" class="link-btn" data-attend-undo>取消確認</button>' : ''}</p>`;
    return canEdit ? '<button type="button" class="btn btn-primary btn-block" data-attend-confirm>✓ 這天的出席確認好了（沒來的已改未到、有來的已補登）</button>' : '';
  }

  function bindDuty(body, d, date, rerender, guard) {
    const go = async (undo) => {
      try {
        const r = await Api.admin('adminAttendOk', { items: [{ dutyId: d.id, date }], undo });
        d.attendOk = Object.assign({}, d.attendOk);
        if (undo) delete d.attendOk[date]; else d.attendOk[date] = r.ok[0];
        if (window.AdminPage && AdminPage.clearMemo) AdminPage.clearMemo();
        rerender();
      } catch (e) { if (!(guard && guard(e))) alert(e.message || '儲存失敗'); }
    };
    const c = body.querySelector('[data-attend-confirm]');
    if (c) c.addEventListener('click', () => go(false));
    const u = body.querySelector('[data-attend-undo]');
    if (u) u.addEventListener('click', () => go(true));
  }

  /**
   * 📌 要處理的事（2026/11/24，Todo.gs adminTodo_）：新成員待確認、場地申請待審、取消／改期申請、修繕待處理。
   * 有件數的才列，點一下到那一頁；都沒有就不顯示。出席確認在下面另外一塊（mount）。
   */
  async function mountTodo(box, guard) {
    if (!box) return;
    let t;
    try { t = await Api.admin('adminTodo', {}, true); } catch (e) { if (!(guard && guard(e))) box.innerHTML = ''; return; }
    if (!box.isConnected) return;
    const venueWord = (window.SITE && SITE.venue) || '場地';
    const items = [
      [t.members, '🆕', '位新成員待確認（報名時自動加入的新名字）', '#/admin/members'],
      [t.venue, '🏠', `筆${venueWord}借用申請待審核`, '#/admin/venue'],
      [t.venueAsk, '🔁', `筆${venueWord}借用的取消／改期申請`, '#/admin/venue'],
      [t.repairs, '🔧', '件修繕待處理', '#/admin/venue'],
      [t.feedback, '💬', '則意見回饋還沒看', '#/admin/feedback']
    ].filter((x) => x[0] > 0);
    box.innerHTML = items.length ? `
      <section class="todo-card" role="status">
        <p class="todo-title">📌 要處理的事</p>
        <ul class="todo-list">${items.map(([n, icon, text, href]) => `<li><a href="${href}">${icon} <b>${n}</b> ${esc(text)}<span aria-hidden="true">›</span></a></li>`).join('')}</ul>
      </section>` : '';
  }

  root.AttendCheck = { mount, mountTodo, dutyHtml, bindDuty };
})(window);
