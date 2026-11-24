// 📋 出席確認（2026/11/24）：活動過了，管理者看過名單（沒來的改未到、有來沒報名的補登）按「✓ 出席確認好了」，
//   統計、關懷名單、年度報表才準。改出席、補登、點名也自動算確認（Attendance.gs attendOkMark_）。
//   mountHome()：後台首頁「📌 要處理的事」（出席確認是其中一行，點開才列）；dutyHtml()／bindDuty()：勤務名單頁的按鈕。
(function (root) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`;
  let open = false; // 出席名單全部打開著（重畫後保持）

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
   * 後台首頁瘦身（2026/11/24）：「要處理的事」和「出席確認」合成一張卡。
   *   出席確認只佔一行「📋 N 場活動還沒確認出席 ▾」，點開才列名單（前 5 場＋全部打開）。
   *   都沒有事就整塊不顯示。
   */
  let attendOpen = false;
  async function mountHome(box, guard, opts) {
    if (!box) return;
    const o = opts || {};
    const [tr, ar] = await Promise.all([
      o.todo === false ? null : Api.admin('adminTodo', {}, true).catch((e) => { if (guard) guard(e); return null; }),
      o.attend === false ? null : Api.admin('adminAttendPending', {}, true).catch((e) => { if (guard) guard(e); return null; })
    ]);
    const t = tr || {};
    const d = ar || { items: [] };
    const venueWord = (window.SITE && SITE.venue) || '場地';
    const draw = () => {
      if (!box.isConnected) return;
      const items = [
        [t.members, '🆕', '位新成員待確認（報名時自動加入的新名字）', '#/admin/members'],
        [t.venue, '🏠', `筆${venueWord}借用申請待審核`, '#/admin/venue'],
        [t.venueAsk, '🔁', `筆${venueWord}借用的取消／改期申請`, '#/admin/venue'],
        [t.repairs, '🔧', '件修繕待處理', '#/admin/venue'],
        [t.feedback, '💬', '則意見回饋還沒看', '#/admin/feedback']
      ].filter((x) => x[0] > 0);
      const pend = d.items || [];
      if (!items.length && !pend.length) { box.innerHTML = ''; return; }
      const shown = open ? pend : pend.slice(0, 5);
      box.innerHTML = `
        <section class="todo-card" role="status">
          <p class="todo-title">📌 要處理的事</p>
          <ul class="todo-list">${items.map(([n, icon, text, href]) => `<li><a href="${href}">${icon} <b>${n}</b> ${esc(text)}<span aria-hidden="true">›</span></a></li>`).join('')}
            ${pend.length ? `<li class="todo-attend">
              <button type="button" class="todo-toggle" data-attend-toggle aria-expanded="${attendOpen}">📋 <b>${pend.length}</b> 場活動還沒確認出席（最近 ${d.days} 天）<span aria-hidden="true">${attendOpen ? '▴' : '▾'}</span></button>
              ${attendOpen ? `<div class="attend-check">
                <p class="hint">點進去看名單：沒來的「改未到」、有來沒報名的「補登」；沒問題按「✓ 沒問題」。統計、關懷名單才會準。</p>
                <ul class="attend-list">${shown.map((x, i) => `
                  <li><a href="#/admin/duty/${encodeURIComponent(x.dutyId)}?date=${x.date}"><span class="attend-date">${md(x.date)}</span> ${esc(x.name)}<small>${x.count} 人${x.absent ? `・未到 ${x.absent}` : ''}</small></a>
                    <button type="button" class="btn btn-small" data-attend-ok="${i}">✓ 沒問題</button></li>`).join('')}</ul>
                ${pend.length > 5 ? `<button type="button" class="btn btn-small" data-attend-more>${open ? '▴ 收起來（只看前 5 場）' : `▾ 全部打開（還有 ${pend.length - 5} 場）`}</button>` : ''}
              </div>` : ''}
            </li>` : ''}</ul>
        </section>`;
      const tg = box.querySelector('[data-attend-toggle]');
      if (tg) tg.addEventListener('click', () => { attendOpen = !attendOpen; draw(); });
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

  root.AttendCheck = { mountHome, dutyHtml, bindDuty };
})(window);
