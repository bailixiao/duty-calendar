// 🛠 回報網站問題（2026/11/26，apps-script/SiteReport.gs、worker/src/hq.js）
//   SiteReportPage.show：各區後台「⚙️ 更多 → 🛠 回報網站問題」— 寫問題、附截圖（自動附手機、瀏覽器、版本），下面看回報過的和負責人的回覆。
//   SiteReportPage.hqShow：宏教分壇後台「🛠 各區回報」— 各區送上來的（直接回報、轉上來的意見回饋），改狀態、寫回覆（送回那一區）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const ST_TAG = { 新的: 'tag-warn', 處理中: '', 修好了: 'tag-new', 不用改: '' };
  const tm = (s) => { const t = String(s || ''); return `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`; };
  const lines = (s) => esc(s).replace(/\n/g, '<br>');

  // ---------- 各區 ----------
  async function show(body, guard) {
    body.innerHTML = '<p class="panel-empty">讀取中⋯</p>';
    let d;
    try { d = await Api.admin('adminSiteReportList', {}, true); } catch (e) { if (!guard(e)) body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    const items = d.items || [];
    const device = Feedback.deviceInfo();
    body.innerHTML = `
      <h2 class="admin-sub">🛠 回報網站問題<span class="h2-sub">網站本身的問題，寫給網站負責人</span></h2>
      <p class="hint">按了沒反應、畫面跑掉、資料不對、看不懂怎麼用⋯⋯都可以寫。我們區自己的設定（勤務、名單）請在後台改；家人們寫的意見在「💬 意見回饋」，也可以從那裡轉上來。</p>
      <form class="sr-form" data-sr-form novalidate>
        <label class="form-row"><span>遇到什麼問題？</span><textarea class="input" name="text" rows="5" maxlength="1000" placeholder="例：在統計頁按「年度報表」，畫面一直轉圈圈；用 iPhone 才會這樣"></textarea></label>
        ${Feedback.shotRowHtml()}
        <p class="hint">會自動附上：哪一區、你的帳號、這台手機（${esc(device)}）、網站版本 ${esc(Feedback.appVersion())}。</p>
        <div class="form-error" data-err hidden></div>
        <button type="submit" class="btn btn-primary btn-block">送給網站負責人</button>
      </form>
      <h3 class="sr-h3">回報過的（${items.length}）</h3>
      ${items.length ? `<ul class="fb-list">${items.map((x) => `
        <li class="fb-item${x.status === '新的' ? '' : ' is-read'}">
          <p class="fb-meta"><b>${x.kind === 'feedback' ? '📤 轉上去的意見' : '🛠 ' + esc(x.by)}</b><span>${esc(tm(x.at))}</span><span class="tag ${ST_TAG[x.status] || ''}">${esc(x.status)}</span></p>
          <p class="fb-text">${lines(x.text)}</p>
          ${x.note ? `<p class="fb-note">補充：${esc(x.note)}</p>` : ''}
          ${Feedback.shotsView(x.shots)}
          ${x.reply ? `<p class="sr-reply">💬 負責人回覆（${esc(tm(x.replyAt))}）：${lines(x.reply)}</p>` : x.status === '新的' ? '<p class="hint">負責人還沒看。</p>' : ''}
        </li>`).join('')}</ul>` : '<p class="panel-empty">還沒有回報過。</p>'}`;
    const f = body.querySelector('[data-sr-form]');
    const pick = Feedback.shotPicker(f);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const er = f.querySelector('[data-err]');
      const text = f.elements.text.value.trim();
      if (text.length < 2) { er.textContent = '請寫一下遇到什麼問題'; er.hidden = false; return; }
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      btn.textContent = pick.count() ? '傳截圖中⋯' : '送出中⋯';
      try {
        const shots = await pick.upload((p) => Api.admin('adminReportShot', p));
        await Api.admin('adminSiteReport', { text, shots, device, version: Feedback.appVersion() });
        alert('✅ 已經送給網站負責人了，有回覆會寫在下面，也會通知收「系統通知」的手機。');
        show(body, guard);
      } catch (e) { btn.disabled = false; btn.textContent = '送給網站負責人'; if (!guard(e)) { er.textContent = e.message || '沒有送出，請再試一次'; er.hidden = false; } }
    });
  }

  // ---------- 宏教分壇 ----------
  let filter = 'open'; // open：新的＋處理中；all：全部
  async function hqShow(body, guard) {
    body.innerHTML = '<p class="panel-empty">讀取中⋯</p>';
    let d;
    try { d = await Api.admin('hqReportList', {}); } catch (e) { if (!guard(e, body)) body.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; return; }
    draw(body, guard, d);
  }
  function draw(body, guard, d) {
    const items = d.items || [];
    const canEdit = d.role === '總管理者';
    const isOpen = (x) => x.status === '新的' || x.status === '處理中';
    const shown = filter === 'all' ? items : items.filter(isOpen);
    body.innerHTML = `
      <h2 class="admin-sub">🛠 各區回報<span class="h2-sub">各區管理者回報網站本身的問題</span></h2>
      <p class="hint">各區在「🛠 回報網站問題」直接寫的，和從「💬 意見回饋」轉上來的家人意見。改狀態、寫回覆會送回那一區（那一區收「系統通知」的手機會收到）。</p>
      <div class="seg no-print">${[['open', `還沒處理好（${items.filter(isOpen).length}）`], ['all', `全部（${items.length}）`]].map(([k, l]) => `<label class="seg-item"><input type="radio" name="srf" value="${k}"${filter === k ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      ${shown.length ? `<ul class="fb-list">${shown.map((x, i) => `
        <li class="fb-item${x.status === '新的' ? ' is-unread' : ''}">
          <p class="fb-meta"><b>${esc(x.regionName)}</b><span>${esc(tm(x.at))}</span><span class="tag ${ST_TAG[x.status] || ''}">${esc(x.status)}</span></p>
          <p class="sr-who">${x.kind === 'feedback' ? `📤 家人${x.name ? '「' + esc(x.name) + '」' : ''}寫的意見，由 ${esc(x.by)} 轉上來` : `🛠 ${esc(x.by)}${x.role && x.role !== x.by ? `（${esc(x.role)}）` : ''}回報`}</p>
          <p class="fb-text">${lines(x.text)}</p>
          ${x.note ? `<p class="fb-note">補充：${esc(x.note)}</p>` : ''}
          ${Feedback.shotsView(x.shots, x.region)}
          <p class="sr-info">${esc([x.page && '頁面 ' + x.page, x.device, x.version && '版本 ' + x.version].filter(Boolean).join('・'))}</p>
          ${x.reply ? `<p class="sr-reply">💬 回覆（${esc(x.replyBy)} ${esc(tm(x.replyAt))}${x.replySent === false ? '・<b>那一區暫時沒收到，再按一次狀態就會重送</b>' : ''}）：${lines(x.reply)}</p>` : ''}
          ${canEdit ? `<div class="care-btns">
            ${['處理中', '修好了', '不用改'].filter((s) => s !== x.status).map((s) => `<button type="button" class="btn btn-small${s === '修好了' ? ' btn-primary' : ''}" data-sr-st="${i}|${s}">${{ 處理中: '🔧 處理中', 修好了: '✓ 修好了', 不用改: '不用改' }[s]}</button>`).join('')}
            <button type="button" class="btn btn-small" data-sr-reply="${i}">💬 ${x.reply ? '改' : '寫'}回覆</button>
          </div>` : ''}
        </li>`).join('')}</ul>` : `<p class="panel-empty">${filter === 'all' ? '還沒有區回報過。' : '都處理好了 😊'}</p>`}
      <p class="hint">想用手機收到新的回報：在「📣 分派」頁最下面開啟分壇通知。</p>`;
    body.querySelectorAll('input[name=srf]').forEach((r) => r.addEventListener('change', () => { filter = r.value; draw(body, guard, d); }));
    const save = async (x, payload, b) => {
      if (b) b.disabled = true;
      try {
        const nd = await Api.admin('hqReportSet', Object.assign({ region: x.region, id: x.id }, payload));
        if (nd.sent === false) alert('存好了，但那一區暫時連不上，回覆還沒送到。等一下再按一次就會重送。');
        draw(body, guard, nd);
      } catch (e) { if (b) b.disabled = false; if (!guard(e)) alert(e.message || '沒有存起來'); }
    };
    body.querySelectorAll('[data-sr-st]').forEach((b) => b.addEventListener('click', () => {
      const [i, status] = b.dataset.srSt.split('|');
      save(shown[Number(i)], { status }, b);
    }));
    body.querySelectorAll('[data-sr-reply]').forEach((b) => b.addEventListener('click', () => {
      const x = shown[Number(b.dataset.srReply)];
      const reply = prompt('回覆給' + x.regionName + '（例：已經修好了，請把網頁關掉再打開）', x.reply || '');
      if (reply === null) return;
      save(x, { reply, status: x.status === '新的' ? '處理中' : undefined }, b);
    }));
  }

  window.SiteReportPage = { show, hqShow };
})();
