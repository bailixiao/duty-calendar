// 宏教分壇分派（2026/11/22）
//   HqAdminPage：分壇的後台（/hq/）—「📣 分派」清單、開／改分派、總表（各區狀態、名額、報名人數、名字、匯出 Excel、提醒文字）
//   HqInbox：各區的後台 — 首頁的「📥 分壇分派」提醒、收件匣頁（看內容、放到本區行事曆、本區不參加）
// 後端：worker/src/hq.js（分壇）、apps-script/Hq.gs（各區）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const CATS = [['勤務', '總務・勤務'], ['道務', '道務'], ['教育', '教育']];
  const NATURES = { 勤務: ['勤務', '支援', '烹飪', '活動'], 道務: ['法會', '課程', '會議'], 教育: ['課程', '活動'] };
  const STATUS = {
    new: ['還沒看', 'st-new'], seen: ['看過了，還沒放', 'st-seen'], published: ['已放到行事曆', 'st-ok'], declined: ['不參加', 'st-no'],
    withdrawn: ['已收回', 'st-no'], 'not-open': ['還沒開通', 'st-off'], none: ['沒收到', 'st-off'], error: ['連不上', 'st-off']
  };
  const catLabel = (c) => (CATS.find((x) => x[0] === c) || [c, c])[1];
  const when = (c) => [Fmt.shortDate(c.start) + (c.end && c.end !== c.start ? '～' + Fmt.shortDate(c.end) : ''), c.startTime ? c.startTime + (c.endTime ? '–' + c.endTime : '') : '', c.location].filter(Boolean).join('・');
  const quotaText = (c, q) => (c.quotaMode === 'none' ? '不限' : q ? q + ' 位' : c.quotaMode === 'self' ? '各區自己報' : '不限');
  const errHtml = (e) => `${esc(e.message || '發生錯誤')}${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
  const loadXlsx = () => (window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('無法載入 Excel 工具，請檢查網路')); document.head.appendChild(s); }));

  // =====================================================================
  // 分壇的後台
  // =====================================================================

  async function show(body, guard, sub) {
    const m = (sub || '').match(/^hq\/(new|edit\/([^/]+)|([^/]+))$/);
    if (m && m[1] === 'new') return form(body, guard, null);
    if (m && m[2]) return form(body, guard, decodeURIComponent(m[2]));
    if (m && m[3]) return summary(body, guard, decodeURIComponent(m[3]));
    return list(body, guard);
  }

  async function list(body, guard) {
    let data;
    try { data = await Api.admin('hqList', {}); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
    const name = (code) => (data.targets.find((t) => t.code === code) || { name: code }).name;
    const openN = data.targets.filter((t) => t.open).length;
    body.innerHTML = `
      <div class="notice"><p>📣 <strong>分派</strong>：開一個活動送給各區。各區的<strong>總務・勤務／道務／教育組長</strong>會在後台先看到，看過按「放到本區行事曆」才會出現在那一區的行事曆，家人在自己區報名；這裡的總表看得到每一區的狀態、人數和名字。</p>
      <p class="muted">13 區已開通 ${openN} 區；還沒開通的區收不到。</p></div>
      <div class="admin-actions"><a class="btn btn-primary" href="#/admin/hq/new">＋ 開新的分派</a></div>
      ${data.campaigns.length ? `<div class="card-list">${data.campaigns.map((c) => {
        const ok = c.regions.filter((r) => c.delivery && c.delivery[r] === 'ok').length;
        return `<a class="duty-card hq-card" href="#/admin/hq/${encodeURIComponent(c.id)}">
          <span class="card-main"><span class="card-title">${esc(c.title)}</span>
          <span class="card-meta">${esc(catLabel(c.category))}・${esc(when(c))}</span>
          <span class="card-meta">送給 ${c.regions.length} 區（${esc(c.regions.map(name).join('、'))}）・送到 ${ok} 區</span></span></a>`;
      }).join('')}</div>` : '<p class="panel-empty">還沒有分派。按「＋ 開新的分派」開始。</p>'}`;
  }

  async function form(body, guard, id) {
    let data;
    try { data = await Api.admin('hqList', {}); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
    const old = id ? data.campaigns.find((c) => c.id === id) : null;
    if (id && !old) { body.innerHTML = '<p class="panel-empty">找不到這個分派，可能已經刪掉了。<a href="#/admin">回分派清單</a></p>'; return; }
    const c = old || { title: '', category: '勤務', nature: '', start: '', end: '', startTime: '', endTime: '', location: '', attire: '', description: '', positions: [{ name: '參加' }], deadline: '', quotaMode: 'none', quotas: {}, regions: data.targets.filter((t) => t.open).map((t) => t.code) };
    const st = { category: c.category, quotaMode: c.quotaMode };
    const draw = () => {
      body.innerHTML = `
        <p><a href="${old ? '#/admin/hq/' + encodeURIComponent(old.id) : '#/admin'}">‹ 返回</a></p>
        <h2>${old ? '✏️ 修改分派' : '＋ 開新的分派'}</h2>
        ${old ? '<p class="notice">存檔後會重新送給各區：已經放到行事曆的區，內容會跟著改；組長後台會看到「分壇有更新」。</p>' : ''}
        <form class="admin-form hq-form" novalidate>
          <label class="form-row"><span>名稱</span><input class="input" name="title" maxlength="40" value="${esc(c.title)}" placeholder="例：總壇運動會觀禮" required></label>
          <div class="form-row"><span>類別（送給各區哪一組的組長）</span><div class="seg">${CATS.map(([v, l]) => `<label class="seg-item"><input type="radio" name="category" value="${v}"${st.category === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
          <label class="form-row"><span>性質</span><select class="input" name="nature">${NATURES[st.category].map((n) => `<option${n === c.nature ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
          <div class="form-grid-2">
            <label class="form-row"><span>日期</span><input class="input" type="date" name="start" value="${esc(c.start)}" required></label>
            <label class="form-row"><span>結束日（一天的不用填）</span><input class="input" type="date" name="end" value="${esc(c.end && c.end !== c.start ? c.end : '')}"></label>
            <label class="form-row"><span>開始時間</span><input class="input" name="startTime" value="${esc(c.startTime)}" placeholder="例：0830"></label>
            <label class="form-row"><span>結束時間</span><input class="input" name="endTime" value="${esc(c.endTime)}" placeholder="例：1200"></label>
          </div>
          <label class="form-row"><span>地點</span><input class="input" name="location" maxlength="40" value="${esc(c.location)}"></label>
          <label class="form-row"><span>服裝（可空白）</span><input class="input" name="attire" maxlength="40" value="${esc(c.attire)}"></label>
          <label class="form-row"><span>說明</span><textarea class="input textarea" name="description" rows="5" maxlength="2000">${esc(c.description)}</textarea></label>
          <label class="form-row"><span>了愿項目（好幾項用「、」或換行分開；只有一項＝大家都報這個）</span><input class="input" name="positions" value="${esc((c.positions || []).map((p) => p.name).join('、'))}" placeholder="例：參加；或：接待、維安、引導"></label>
          <label class="form-row"><span>報名截止日（可空白）</span><input class="input" type="date" name="deadline" value="${esc(c.deadline)}"></label>
          <fieldset class="form-block">
            <legend>送給哪幾區</legend>
            <div class="hq-regions">${data.targets.map((t) => `<label class="check"><input type="checkbox" name="regions" value="${t.code}"${c.regions.indexOf(t.code) !== -1 ? ' checked' : ''}> ${esc(t.name)}${t.open ? '' : '<small class="muted">（還沒開通，收不到）</small>'}</label>`).join('')}</div>
            <button type="button" class="link-btn" data-all-regions>全選已開通的</button>
          </fieldset>
          <fieldset class="form-block">
            <legend>名額</legend>
            <div class="seg">${[['none', '不限'], ['assigned', '分壇分配'], ['self', '各區自己報']].map(([v, l]) => `<label class="seg-item"><input type="radio" name="quotaMode" value="${v}"${st.quotaMode === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
            ${st.quotaMode === 'assigned' ? `<p class="hint">每區填幾位（空白＝那一區不限）。只有一個了愿項目時，名額就是那一項最多幾位。</p>
              <div class="hq-quotas">${data.targets.filter((t) => c.regions.indexOf(t.code) !== -1 || !old).map((t) => `<label class="form-row" data-quota-row="${t.code}"><span>${esc(t.name)}</span><input class="input" name="q-${t.code}" inputmode="numeric" maxlength="4" value="${esc((c.quotas || {})[t.code] || '')}"></label>`).join('')}</div>` : ''}
            ${st.quotaMode === 'self' ? '<p class="hint">各區組長放到行事曆時自己填要幾位，總表看得到。</p>' : ''}
          </fieldset>
          <div class="form-error" data-error hidden></div>
          <div class="form-actions"><button type="submit" class="btn btn-primary btn-block">${old ? '存檔並重新送出' : '送出給各區'}</button></div>
        </form>`;
      const f = body.querySelector('form');
      const sync = () => {
        ['title', 'nature', 'start', 'end', 'startTime', 'endTime', 'location', 'attire', 'description', 'deadline'].forEach((k) => { c[k] = f.elements[k].value; });
        c.positions = f.elements.positions.value.split(/[\n、,，]+/).map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
        c.regions = [...f.querySelectorAll('input[name=regions]:checked')].map((x) => x.value);
        c.quotas = Object.assign({}, c.quotas);
        f.querySelectorAll('[data-quota-row]').forEach((row) => { c.quotas[row.dataset.quotaRow] = row.querySelector('input').value.trim(); });
      };
      f.querySelectorAll('input[name=category]').forEach((r) => r.addEventListener('change', () => { sync(); st.category = r.value; c.nature = ''; draw(); }));
      f.querySelectorAll('input[name=quotaMode]').forEach((r) => r.addEventListener('change', () => { sync(); st.quotaMode = r.value; draw(); }));
      body.querySelector('[data-all-regions]').addEventListener('click', () => { data.targets.forEach((t) => { const x = f.querySelector(`input[name=regions][value=${t.code}]`); if (x) x.checked = t.open; }); });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        sync();
        const t = (v) => { const x = Fmt.parseTime(v); return x === null ? v : x; };
        const campaign = Object.assign({}, c, { id: old ? old.id : undefined, category: st.category, quotaMode: st.quotaMode, startTime: t(c.startTime), endTime: t(c.endTime), end: c.end || c.start });
        const box = body.querySelector('[data-error]');
        box.hidden = true;
        Busy.show('送出中⋯');
        try {
          const r = await Api.admin('hqSave', { campaign });
          Busy.hide();
          location.hash = '#/admin/hq/' + encodeURIComponent(r.campaign.id);
        } catch (e) {
          Busy.hide();
          if (guard(e)) return;
          box.innerHTML = errHtml(e);
          box.hidden = false;
        }
      });
    };
    draw();
  }

  async function summary(body, guard, id) {
    body.innerHTML = '<p class="panel-empty">問各區的狀況中⋯</p>';
    let data;
    try { data = await Api.admin('hqSummary', { id }); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p><p><a href="#/admin">回分派清單</a></p>`; return; }
    const c = data.campaign;
    const rows = data.regions;
    // 還沒開通、還沒收到的區：名額照分壇分配的寫
    rows.forEach((r) => { if (!r.quota && c.quotaMode === 'assigned' && c.quotas && c.quotas[r.code]) r.quota = c.quotas[r.code]; });
    const qOf = (r) => (r.quota && r.status !== 'not-open' && r.status !== 'declined' ? Number(r.quota) : 0);
    const totalQ = rows.reduce((n, r) => n + qOf(r), 0);
    const totalN = rows.reduce((n, r) => n + (r.count || 0), 0);
    const statusHtml = (r) => { const [l, cls] = STATUS[r.status] || [r.status, '']; return `<span class="hq-st ${cls}">${l}</span>${r.status === 'declined' && r.declineReason ? `<small>${esc(r.declineReason)}</small>` : ''}${r.syncError ? `<small class="form-error">更新失敗：${esc(r.syncError)}</small>` : ''}`; };
    body.innerHTML = `
      <p><a href="#/admin">‹ 分派清單</a></p>
      <h2>${esc(c.title)}</h2>
      <p class="muted">${esc(catLabel(c.category))}・${esc(when(c))}${c.deadline ? '・報名截止 ' + esc(Fmt.shortDate(c.deadline)) : ''}・名額：${esc({ none: '不限', assigned: '分壇分配', self: '各區自己報' }[c.quotaMode])}</p>
      <div class="admin-actions">
        <a class="btn" href="#/admin/hq/edit/${encodeURIComponent(c.id)}">✏️ 修改</a>
        <button type="button" class="btn" data-xlsx>⬇ 匯出 Excel</button>
        <button type="button" class="btn" data-remind>📋 提醒還沒處理的區</button>
        <button type="button" class="btn btn-quiet-danger" data-del>🗑 刪除分派</button>
      </div>
      <div class="hq-total"><strong>${totalN}</strong> 位已報名${totalQ ? `／名額 ${totalQ} 位${totalN < totalQ ? `，還差 <strong>${totalQ - totalN}</strong> 位` : ''}` : ''}</div>
      <div class="hq-table-wrap"><table class="hq-table">
        <thead><tr><th>區</th><th>狀態</th><th>名額</th><th>已報名</th><th>還差</th></tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr class="${r.people && r.people.length ? 'has-people' : ''}" data-row="${i}">
            <td>${esc(r.name)}</td><td>${statusHtml(r)}</td><td>${esc(quotaText(c, r.quota))}</td>
            <td>${r.status === 'published' ? `<button type="button" class="link-btn" data-people="${i}">${r.count} 位 ›</button>` : '—'}</td>
            <td>${r.status === 'published' && qOf(r) ? (qOf(r) > r.count ? `<strong>${qOf(r) - r.count}</strong>` : '✅') : '—'}</td>
          </tr>`).join('')}</tbody></table></div>
      <p class="hint">「還沒看」「看過了，還沒放」的區，家人還報不了名；按「📋 提醒還沒處理的區」複製一段文字傳給那一區的組長。名字不含電話；陪同不算人數。</p>`;
    body.querySelectorAll('[data-people]').forEach((b) => b.addEventListener('click', () => {
      const r = rows[Number(b.dataset.people)];
      const pm = Modal.open(`<h2 class="modal-title">${esc(r.name)}：${r.count} 位</h2>
        <div class="hq-table-wrap"><table class="hq-table"><thead><tr><th>姓名</th><th>身分</th><th>佛堂</th><th>項目</th></tr></thead>
        <tbody>${r.people.map((p) => `<tr><td>${esc(p.name)}${p.accompany ? '<small>陪同</small>' : ''}</td><td>${esc(p.identity)}</td><td>${esc(p.temple)}</td><td>${esc(p.position)}${c.end !== c.start ? '<small>' + esc(Fmt.shortDate(p.date)) + '</small>' : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
      pm.el.querySelector('[data-close]').addEventListener('click', () => pm.close());
    }));
    body.querySelector('[data-remind]').addEventListener('click', () => {
      const todo = rows.filter((r) => r.status === 'new' || r.status === 'seen');
      const text = `🙏【宏教分壇分派】${c.title}\n${when(c)}\n\n${todo.length ? todo.map((r) => r.name).join('、') + ' 還沒放到行事曆，請' + catLabel(c.category) + '組長到後台首頁「📥 分壇分派」看一下，放到本區行事曆（或寫原因不參加）。' : '各區都處理好了，感恩 🙏'}`;
      const m = Modal.open(`<h2 class="modal-title">📋 提醒還沒處理的區</h2><p class="modal-note">${todo.length ? `${todo.length} 區還沒處理。複製下面的文字傳給他們的組長：` : '各區都處理好了。'}</p>
        <textarea class="day-text" rows="6" readonly>${esc(text)}</textarea>
        <div class="modal-actions"><button type="button" class="btn btn-primary btn-block" data-copy>複製文字</button><button type="button" class="btn btn-line btn-block" data-line>傳到 LINE</button><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      m.el.querySelector('[data-copy]').addEventListener('click', async (ev) => { ev.target.textContent = (await Share.copyText(text)) ? '已複製 ✓' : '請長按框內文字複製'; });
      m.el.querySelector('[data-line]').addEventListener('click', () => window.open('https://line.me/R/msg/text/?' + encodeURIComponent(text), '_blank', 'noopener'));
    });
    body.querySelector('[data-xlsx]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        await loadXlsx();
        const wb = XLSX.utils.book_new();
        const head = [['區', '狀態', '名額', '已報名', '還差', '不參加原因']].concat(rows.map((r) => [r.name, (STATUS[r.status] || [r.status])[0], quotaText(c, r.quota), r.status === 'published' ? r.count : '', r.status === 'published' && qOf(r) ? Math.max(0, qOf(r) - r.count) : '', r.declineReason || '']));
        head.push(['合計', '', totalQ || '', totalN, totalQ ? Math.max(0, totalQ - totalN) : '', '']);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(head), '總計');
        rows.filter((r) => r.people && r.people.length).forEach((r) => {
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['姓名', '身分', '佛堂', '了愿項目', '日期', '陪同']].concat(r.people.map((p) => [p.name, p.identity, p.temple, p.position, p.date, p.accompany ? '是' : '']))), r.name.slice(0, 31));
        });
        XLSX.writeFile(wb, `${c.title}_各區報名_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } catch (e) { alert(e.message || '匯出失敗'); }
      btn.disabled = false;
    });
    body.querySelector('[data-del]').addEventListener('click', async () => {
      const ok = await Confirm.open({ title: '確定要刪除這個分派嗎？', rows: [['名稱', c.title], ['日期', when(c)]], note: '各區的收件匣會標「分壇已收回」。已經放到行事曆、有人報名的，那一區的活動會留著，由組長自己決定。', confirmText: '確定刪除', cancelText: '不要刪除', danger: true });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try { await Api.admin('hqDelete', { id: c.id }); Busy.hide(); location.hash = '#/admin'; } catch (e) { Busy.hide(); if (!guard(e)) alert(e.message); }
    });
  }

  window.HqAdminPage = { show };

  // =====================================================================
  // 各區：📥 分壇分派
  // =====================================================================

  let inboxMemo = null;
  const pendingOf = (x) => x.status === 'new' || x.status === 'seen' || x.updated;

  /** 後台首頁最上面：有待處理的才顯示 */
  async function mount(box, guard) {
    if (!box) return;
    const paint = (d) => {
      if (!box.isConnected || !d) return;
      const todo = d.items.filter(pendingOf);
      if (!d.items.length) { box.innerHTML = ''; return; }
      box.innerHTML = todo.length ? `<div class="notice hq-inbox-note" role="status">
          <p>📥 <strong>${esc(d.hqName)}分派：${todo.length} 件待處理</strong></p>
          <ul>${todo.slice(0, 5).map((x) => `<li>${x.updated && x.status === 'published' ? '🔄 ' : ''}${esc(Fmt.shortDate(x.c.start))}　${esc(x.c.title)}<small>（${esc(catLabel(x.c.category))}${x.updated && x.status === 'published' ? '，分壇有更新' : ''}）</small></li>`).join('')}</ul>
          <a class="btn btn-primary" href="#/admin/hqinbox">去看看 ›</a></div>`
        : `<p class="hq-inbox-link"><a href="#/admin/hqinbox">📥 ${esc(d.hqName)}分派（${d.items.length} 件）›</a></p>`;
    };
    paint(inboxMemo);
    try { inboxMemo = await Api.admin('adminHqInbox', {}, true); paint(inboxMemo); } catch (e) { /* 讀不到就不顯示 */ }
  }

  /** 收件匣頁 */
  async function page(body, guard) {
    let d;
    try { d = inboxMemo = await Api.admin('adminHqInbox', {}); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
    const groupsP = Api.admin('adminGroups', {}, true).then((x) => x.groups || []).catch(() => []);
    const draw = () => {
      body.innerHTML = `
        <p><a href="#/admin">‹ 回近期勤務</a></p>
        <h2>📥 ${esc(d.hqName)}分派</h2>
        <p class="hint">分壇送來的活動，看過按「📅 放到本區行事曆」才會出現在本區的行事曆，家人才能報名；不參加請按「本區不參加」寫原因（分壇看得到）。內容由分壇統一改。</p>
        ${d.items.length ? `<div class="card-list">${d.items.map((x, i) => {
          const [l, cls] = STATUS[x.status] || [x.status, ''];
          return `<button type="button" class="duty-card hq-card" data-open="${i}">
            <span class="card-main"><span class="card-title">${esc(x.c.title)}</span>
            <span class="card-meta">${esc(catLabel(x.c.category))}・${esc(when(x.c))}・名額 ${esc(quotaText(x.c, x.quota))}</span>
            <span class="card-meta"><span class="hq-st ${cls}">${l}</span>${x.status === 'published' ? `　${x.count} 位報名` : ''}${x.updated ? '　<span class="hq-st st-new">分壇有更新</span>' : ''}</span></span></button>`;
        }).join('')}</div>` : '<p class="panel-empty">目前沒有分壇分派。</p>'}`;
      body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(d.items[Number(b.dataset.open)])));
    };
    async function act(action, payload, busy) {
      Busy.show(busy);
      try { const r = await Api.admin(action, payload); Busy.hide(); d = inboxMemo = r; return r; } catch (e) { Busy.hide(); if (guard(e)) return null; throw e; }
    }
    async function open(x) {
      if (x.status === 'new' || x.updated) { try { await act('adminHqSeen', { id: x.id }, '讀取中⋯'); x = d.items.find((y) => y.id === x.id) || x; draw(); } catch (e) { /* 標不了已讀不影響 */ } }
      const groups = await groupsP;
      const types = [...new Set(groups.map((g) => g.type))];
      const c = x.c;
      const can = x.status !== 'withdrawn';
      const m = Modal.open(`
        <h2 class="modal-title">📣 ${esc(c.title)}</h2>
        <dl class="modal-rows">
          <div><dt>類別</dt><dd>${esc(catLabel(c.category))}</dd></div>
          <div><dt>時間</dt><dd>${esc(when(c))}</dd></div>
          ${c.attire ? `<div><dt>服裝</dt><dd>${esc(c.attire)}</dd></div>` : ''}
          <div><dt>了愿項目</dt><dd>${esc((c.positions || []).map((p) => p.name).join('、') || '參加')}</dd></div>
          <div><dt>名額</dt><dd>${esc(quotaText(c, x.quota))}</dd></div>
          ${c.deadline ? `<div><dt>報名截止</dt><dd>${esc(Fmt.shortDate(c.deadline))}</dd></div>` : ''}
          <div><dt>狀態</dt><dd>${esc((STATUS[x.status] || [x.status])[0])}${x.status === 'published' ? `（${x.count} 位報名）` : ''}${x.declineReason ? '：' + esc(x.declineReason) : ''}</dd></div>
        </dl>
        ${c.description ? `<p class="hq-desc">${esc(c.description).replace(/\n/g, '<br>')}</p>` : ''}
        ${x.status === 'withdrawn' ? '<p class="notice">分壇已經收回這個分派。已經放到行事曆的活動還在，要不要留由本區決定（沒人報名的可以到勤務管理刪除）。</p>' : ''}
        ${x.syncError ? `<p class="form-error">分壇的更新沒有套用成功：${esc(x.syncError)}</p>` : ''}
        ${can ? `<form class="admin-form" novalidate>
          ${c.quotaMode === 'self' ? `<label class="form-row"><span>本區要幾位（分壇要各區自己報名額）</span><input class="input" name="quota" inputmode="numeric" maxlength="4" value="${esc(x.quota || '')}"></label>` : ''}
          <label class="form-row"><span>本區補充說明（可空白，例：集合時間、地點、聯絡人）</span><textarea class="input textarea" name="note" rows="3" maxlength="500">${esc(x.note || '')}</textarea></label>
          ${types.length ? `<div class="form-grid-2"><label class="form-row"><span>負責組（可空白）</span><select class="input" name="groupType"><option value="">（不指定）</option>${types.map((t) => `<option${t === x.groupType ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label class="form-row"><span>&nbsp;</span><select class="input" name="group"></select></label></div>` : ''}
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-block">${x.status === 'published' ? '更新本區的補充' : '📅 放到本區行事曆'}</button>
            ${x.status === 'published' ? `<a class="btn btn-block" href="#/admin/duty/${encodeURIComponent(x.dutyId)}">看報名名單</a>` : ''}
            ${x.status !== 'declined' ? '<button type="button" class="btn btn-block btn-quiet-danger" data-decline>本區不參加</button>' : ''}
            <button type="button" class="btn btn-block" data-close>返回</button>
          </div></form>` : '<div class="modal-actions"><button type="button" class="btn btn-block" data-close>返回</button></div>'}`);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      const f = m.el.querySelector('form');
      if (!f) return;
      const gSel = f.elements.group;
      const fillGroups = () => { if (!gSel) return; const t = f.elements.groupType.value; gSel.innerHTML = `<option value="">（不指定）</option>${groups.filter((g) => g.type === t).map((g) => `<option${g.name === x.group ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}`; gSel.disabled = !t; };
      if (gSel) { fillGroups(); f.elements.groupType.addEventListener('change', fillGroups); }
      const box = f.querySelector('[data-error]');
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        box.hidden = true;
        try {
          const r = await act('adminHqPublish', { id: x.id, note: f.elements.note.value, quota: f.elements.quota ? f.elements.quota.value : undefined, groupType: f.elements.groupType ? f.elements.groupType.value : '', group: gSel ? gSel.value : '' }, x.status === 'published' ? '更新中⋯' : '放到行事曆中⋯');
          if (!r) return;
          m.close();
          draw();
          body.insertAdjacentHTML('afterbegin', `<div class="notice notice-success" role="status"><p>✅ ${x.status === 'published' ? '已更新' : '已放到本區行事曆'}：${esc(c.title)}　<a href="#/admin/duty/${encodeURIComponent(r.dutyId)}">看名單 ›</a></p></div>`);
          if (window.CalendarPage) CalendarPage.refresh();
          AdminPage.clearMemo();
        } catch (e) { box.innerHTML = errHtml(e); box.hidden = false; }
      });
      const dec = f.querySelector('[data-decline]');
      if (dec) dec.addEventListener('click', async () => {
        const reason = window.prompt('本區不參加的原因（分壇看得到）：', '');
        if (reason === null) return;
        try {
          const r = await act('adminHqDecline', { id: x.id, reason }, '處理中⋯');
          if (!r) return;
          m.close();
          draw();
          if (window.CalendarPage) CalendarPage.refresh();
        } catch (e) { box.innerHTML = errHtml(e); box.hidden = false; }
      });
    }
    draw();
  }

  window.HqInbox = { mount, page };
})();
