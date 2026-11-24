// 💬 意見回饋（2026/11/24，Feedback.gs）：
//   - 家人們：「❓ 常見問題」最下面「寫給管理者」→ 視窗寫內容（名字選填）送出。
//   - 後台：⚙️ 更多 →「💬 意見回饋」（只有總管理者），新的在前；標成已讀／已處理，寫處理說明。
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAME_KEY = 'duty-calendar:mine-name';

  /** 常見問題最下面的那一塊 */
  function boxHtml() {
    return `<section class="feedback-box">
      <p class="feedback-title">💬 有問題、建議，或哪裡不好用？</p>
      <p class="hint">找不到答案、或想到可以更好的地方，直接寫給管理者 🙏</p>
      <button type="button" class="btn btn-primary" data-feedback>✍️ 寫給管理者</button>
    </section>`;
  }

  function bind(root) {
    const b = root.querySelector('[data-feedback]');
    if (b) b.addEventListener('click', open);
  }

  function open() {
    let name = '';
    try { name = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* 沒關係 */ }
    const m = Modal.open(`<h2 class="modal-title">💬 寫給管理者</h2>
      <form class="modal-form" data-fb-form novalidate>
        <label class="form-row"><span>想說的話</span><textarea class="input" name="text" rows="5" maxlength="500" placeholder="例：報名的時候找不到我的名字；希望行事曆可以⋯"></textarea></label>
        <label class="form-row"><span>您的名字（選填，管理者想多了解時比較好找您）</span><input class="input" name="name" maxlength="20" autocomplete="off" value="${esc(name)}"></label>
        <p class="hint">不用留電話。需要回覆的話，管理者會在 LINE 群組或當面跟您說。</p>
        <div class="form-error" data-err hidden></div>
        <div class="modal-actions"><button type="submit" class="btn btn-primary btn-block">送出</button><button type="button" class="btn btn-block" data-close>返回</button></div>
      </form>`);
    const f = m.el.querySelector('[data-fb-form]');
    if (window.MemberSuggest) MemberSuggest.attach(f.elements.name);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const er = f.querySelector('[data-err]');
      const text = f.elements.text.value.trim();
      if (text.length < 2) { er.textContent = '請寫一下想說的話'; er.hidden = false; return; }
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await Api.sendFeedback({ text, name: f.elements.name.value.trim(), page: location.hash.slice(0, 80) });
        m.el.querySelector('.modal-title').textContent = '✅ 已經送給管理者了';
        f.innerHTML = '<p>謝謝您 🙏 管理者會看過並處理。</p><div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close>好</button></div>';
        m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      } catch (e) { btn.disabled = false; er.textContent = e.message || '沒有送出，請再試一次'; er.hidden = false; }
    });
  }

  // ---------- 後台 ----------
  const STATUS_TAG = { 未讀: 'tag-warn', 已讀: '', 已處理: 'tag-new' };
  let filter = 'open'; // open：未讀＋已讀；all：全部

  function adminShow(body, guard) {
    AdminPage.swr('feedback', () => Api.admin('adminFeedbackList', {}, true), (data, stale) => render(body, guard, data, stale), body);
  }

  function render(body, guard, data, stale) {
    const items = data.items || [];
    const shown = filter === 'all' ? items : items.filter((x) => x.status !== '已處理');
    const md = (at) => `${Number(at.slice(5, 7))}/${Number(at.slice(8, 10))} ${at.slice(11, 16)}`;
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <h2 class="admin-sub">💬 意見回饋<span class="h2-sub">家人們在「常見問題」最下面寫給管理者的</span></h2>
      <div class="seg no-print">${[['open', `還沒處理（${items.filter((x) => x.status !== '已處理').length}）`], ['all', `全部（${items.length}）`]].map(([k, l]) => `<label class="seg-item"><input type="radio" name="fbf" value="${k}"${filter === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      ${shown.length ? `<ul class="fb-list">${shown.map((x) => `
        <li class="fb-item${x.status === '未讀' ? ' is-unread' : ''}">
          <p class="fb-meta"><b>${esc(x.name || '沒留名字')}</b><span>${esc(md(x.at))}</span><span class="tag ${STATUS_TAG[x.status] || ''}">${esc(x.status)}</span></p>
          <p class="fb-text">${esc(x.text).replace(/\n/g, '<br>')}</p>
          ${x.note ? `<p class="fb-note">處理說明：${esc(x.note)}（${esc(x.by)}）</p>` : ''}
          <div class="care-btns">
            ${x.status === '未讀' ? `<button type="button" class="btn btn-small" data-fb="${esc(x.id)}|已讀">👀 看過了</button>` : ''}
            ${x.status !== '已處理' ? `<button type="button" class="btn btn-small btn-primary" data-fb="${esc(x.id)}|已處理">✓ 處理好了</button>` : `<button type="button" class="btn btn-small" data-fb="${esc(x.id)}|已讀">改回還沒處理</button>`}
            <button type="button" class="btn btn-small" data-fb-note="${esc(x.id)}">📝 ${x.note ? '改' : '寫'}處理說明</button>
          </div>
        </li>`).join('')}</ul>` : `<p class="panel-empty">${filter === 'all' ? '還沒有人寫意見。' : '都處理好了 😊'}</p>`}
      <p class="hint">送出時，收「系統通知」的手機會收到「💬 有新的意見回饋」。電話不收；要回覆的話請在 LINE 群組或當面說。</p>`;
    body.querySelectorAll('input[name=fbf]').forEach((r) => r.addEventListener('change', () => { filter = r.value; render(body, guard, data, false); }));
    const save = async (payload) => {
      try {
        const d = await Api.admin('adminFeedbackSet', payload);
        AdminPage.clearMemo();
        render(body, guard, d, false);
      } catch (e) { if (!guard(e)) alert(e.message || '沒有存起來'); }
    };
    body.querySelectorAll('[data-fb]').forEach((b) => b.addEventListener('click', () => { const [id, status] = b.dataset.fb.split('|'); b.disabled = true; save({ id, status }); }));
    body.querySelectorAll('[data-fb-note]').forEach((b) => b.addEventListener('click', () => {
      const x = items.find((y) => y.id === b.dataset.fbNote);
      const note = prompt('處理說明（例：已經跟他說明怎麼報名了）', x.note || '');
      if (note === null) return;
      save({ id: x.id, note, status: note.trim() && x.status === '未讀' ? '已讀' : undefined });
    }));
  }

  window.Feedback = { boxHtml, bind, open, adminShow };
})();
