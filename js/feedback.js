// 💬 意見回饋（2026/11/24，Feedback.gs）：
//   - 家人們：「❓ 常見問題」最下面「寫給管理者」→ 視窗寫內容（名字選填）送出。
//   - 後台：⚙️ 更多 →「💬 意見回饋」（只有總管理者），新的在前；標成已讀／已處理，寫處理說明。
//   - 截圖（2026/11/26）：最多 3 張，先縮小再上傳（家人們 feedbackUpload，管理者回報 adminReportShot）；shotPicker 給 site-report.js 共用。
//   - 📤 轉給網站負責人（2026/11/26，SiteReport.gs）：網站本身的問題轉到宏教分壇後台「🛠 各區回報」。
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAME_KEY = 'duty-calendar:mine-name';
  const MAX_SHOTS = 3;

  /** 截圖縮成長邊 1800px 的 JPEG（字還看得清楚，檔案小） */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不到這張圖')); };
      img.src = url;
    });
  }

  /** 選截圖的那一列 */
  const shotRowHtml = (label) => `<div class="form-row"><span>${esc(label || '截圖（選填，最多 3 張；畫面怪怪的拍下來最好懂）')}</span>
      <div class="shot-pick" data-shot-list></div>
      <label class="btn btn-small shot-add" data-shot-add>📷 加截圖<input type="file" accept="image/*" multiple hidden data-shot-input></label></div>`;
  /** 綁好選截圖：回傳 { upload(fn) → 檔案代號陣列 }；fn＝上傳一張的 API */
  function shotPicker(root) {
    const list = root.querySelector('[data-shot-list]');
    const add = root.querySelector('[data-shot-add]');
    const input = root.querySelector('[data-shot-input]');
    const shots = []; // dataURL
    const draw = () => {
      list.innerHTML = shots.map((s, i) => `<span class="shot-thumb"><img src="${s}" alt="截圖 ${i + 1}"><button type="button" class="shot-del" data-shot-del="${i}" aria-label="拿掉截圖 ${i + 1}">✕</button></span>`).join('');
      add.hidden = shots.length >= MAX_SHOTS;
      list.querySelectorAll('[data-shot-del]').forEach((b) => b.addEventListener('click', () => { shots.splice(Number(b.dataset.shotDel), 1); draw(); }));
    };
    input.addEventListener('change', async () => {
      for (const f of [...input.files].slice(0, MAX_SHOTS - shots.length)) {
        try { shots.push(await shrink(f)); } catch (e) { alert(e.message); }
      }
      input.value = '';
      draw();
    });
    draw();
    return {
      count: () => shots.length,
      async upload(fn) {
        const ids = [];
        for (const s of shots) ids.push((await fn({ mime: 'image/jpeg', data: s.split(',')[1] })).id);
        return ids;
      }
    };
  }
  /** 截圖縮圖（點了開大圖）；region＝存在哪一區（分壇看各區的用），省略＝這一區 */
  function shotsView(ids, region) {
    if (!ids || !ids.length) return '';
    const url = (id) => {
      if (region === undefined) return Api.fileUrl(id);
      const base = window.APP_CONFIG.API_URL;
      const u = region && region !== 'main' ? base + (base.indexOf('?') === -1 ? '?' : '&') + 'region=' + encodeURIComponent(region) : base;
      return u + (u.indexOf('?') === -1 ? '?' : '&') + 'action=file&id=' + encodeURIComponent(id);
    };
    return `<div class="shot-pick">${ids.map((id, i) => `<a class="shot-thumb" href="${esc(url(id))}" target="_blank" rel="noopener"><img src="${esc(url(id))}" alt="截圖 ${i + 1}" loading="lazy"></a>`).join('')}</div>`;
  }
  /** 這台手機、瀏覽器、網站版本（回報網站問題時自動附上，方便負責人找原因） */
  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') + ' iOS ' + ((ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1).join('.') || '')
      : /Android/.test(ua) ? 'Android ' + ((ua.match(/Android ([\d.]+)/) || [])[1] || '') : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : '其他';
    const br = /Line\//.test(ua) ? 'LINE 內建瀏覽器' : /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '其他瀏覽器';
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? '・主畫面' : '';
    return `${os.trim()}・${br}${standalone}・${screen.width}×${screen.height}`;
  }
  const appVersion = () => ((document.querySelector('meta[name="app-version"]') || {}).content || '');

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
        ${shotRowHtml()}
        <p class="hint">不用留電話。需要回覆的話，管理者會在 LINE 群組或當面跟您說。</p>
        <div class="form-error" data-err hidden></div>
        <div class="modal-actions"><button type="submit" class="btn btn-primary btn-block">送出</button><button type="button" class="btn btn-block" data-close>返回</button></div>
      </form>`);
    const f = m.el.querySelector('[data-fb-form]');
    if (window.MemberSuggest) MemberSuggest.attach(f.elements.name);
    const pick = shotPicker(f);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const er = f.querySelector('[data-err]');
      const text = f.elements.text.value.trim();
      if (text.length < 2) { er.textContent = '請寫一下想說的話'; er.hidden = false; return; }
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        btn.textContent = pick.count() ? '傳截圖中⋯' : '送出中⋯';
        const shots = await pick.upload((p) => Api.feedbackUpload(p));
        await Api.sendFeedback({ text, name: f.elements.name.value.trim(), page: location.hash.slice(0, 80), shots });
        m.el.querySelector('.modal-title').textContent = '✅ 已經送給管理者了';
        f.innerHTML = '<p>謝謝您 🙏 管理者會看過並處理。</p><div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-close>好</button></div>';
        m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      } catch (e) { btn.disabled = false; btn.textContent = '送出'; er.textContent = e.message || '沒有送出，請再試一次'; er.hidden = false; }
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
          ${shotsView(x.shots)}
          ${x.forwarded ? `<p class="fb-note">📤 已轉給網站負責人：<b>${esc(x.forwarded.status)}</b>${x.forwarded.reply ? '・' + esc(x.forwarded.reply) : ''}</p>` : ''}
          ${x.note ? `<p class="fb-note">處理說明：${esc(x.note)}（${esc(x.by)}）</p>` : ''}
          <div class="care-btns">
            ${x.status === '未讀' ? `<button type="button" class="btn btn-small" data-fb="${esc(x.id)}|已讀">👀 看過了</button>` : ''}
            ${x.status !== '已處理' ? `<button type="button" class="btn btn-small btn-primary" data-fb="${esc(x.id)}|已處理">✓ 處理好了</button>` : `<button type="button" class="btn btn-small" data-fb="${esc(x.id)}|已讀">改回還沒處理</button>`}
            <button type="button" class="btn btn-small" data-fb-note="${esc(x.id)}">📝 ${x.note ? '改' : '寫'}處理說明</button>
            ${x.forwarded ? '' : `<button type="button" class="btn btn-small" data-fb-up="${esc(x.id)}">📤 轉給網站負責人</button>`}
          </div>
        </li>`).join('')}</ul>` : `<p class="panel-empty">${filter === 'all' ? '還沒有人寫意見。' : '都處理好了 😊'}</p>`}
      <p class="hint">送出時，收「系統通知」的手機會收到「💬 有新的意見回饋」。電話不收；要回覆的話請在 LINE 群組或當面說。</p>
      <p class="hint">是<b>網站本身</b>的問題（按了沒反應、畫面跑掉、看不懂怎麼用）就按「📤 轉給網站負責人」；負責人回覆後會寫在這一則下面，也會通知收「系統通知」的手機。</p>`;
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
    body.querySelectorAll('[data-fb-up]').forEach((b) => b.addEventListener('click', async () => {
      const note = prompt('轉給網站負責人：要補充說明嗎？（可以空白，例：好幾位家人都遇到）', '');
      if (note === null) return;
      b.disabled = true;
      try {
        await Api.admin('adminSiteReport', { fbId: b.dataset.fbUp, note, version: appVersion() });
        AdminPage.clearMemo();
        const d = await Api.admin('adminFeedbackList', {}, true);
        render(body, guard, d, false);
      } catch (e) { b.disabled = false; if (!guard(e)) alert(e.message || '沒有轉成功，請再試一次'); }
    }));
  }

  window.Feedback = { boxHtml, bind, open, adminShow, shotRowHtml, shotPicker, shotsView, deviceInfo, appVersion };
})();
