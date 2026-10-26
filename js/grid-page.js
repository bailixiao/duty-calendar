// 職司表大頁面（#/grid/<勤務ID>）：12人小組這類多天輪值的獨立頁面，可以單獨分享網址。
// 上方大標題與階段、滿版職司表（一欄一天、一列一個了愿項目）、職司說明、最下面的「我要報名」（不浮動，手機才不會擋到表格）。
// 報名資料和勤務頁是同一份，每 30 秒自動更新。表格的 HTML 也給勤務頁共用（GridPage.tableHtml）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const REFRESH_MS = 30000;
  let root = null;
  let token = 0;
  let timer = null;
  let data = null;
  let updatedAt = null;

  /** 職司表的表格（勤務頁與大頁面共用） */
  function tableHtml(d) {
    const g = RosterGrid.build(d);
    // 明天以後某一天這個項目已經沒有空格、但還沒額滿：多一列空格，點了可以報名
    g.groups.forEach((grp) => {
      const max = grp.position.max;
      if (g.dates.some((x) => x.date > d.today && grp.cells[x.date].length >= grp.rows && (max === null || max === undefined || grp.cells[x.date].length < max))) grp.rows += 1;
    });
    const head = g.dates.map((x) => `<th scope="col" class="${x.today ? 'is-today' : ''}">${Fmt.shortDate(x.date).replace('（', '<br>(').replace('）', ')')}${x.today ? '<small>今天</small>' : ''}</th>`).join('');
    const totals = g.dates.map((x) => `<td class="${x.today ? 'is-today' : ''}">${x.total} 人</td>`).join('');
    const body = g.groups.map((grp, gi) => Array.from({ length: grp.rows }, (_, r) => `
      <tr class="${r === 0 ? 'grid-first' : ''} grid-g${gi % 2}">
        ${r === 0 ? `<th scope="rowgroup" rowspan="${grp.rows}" class="grid-pos"><span>${esc(grp.position.name)}</span></th>` : ''}
        <td class="grid-n">${r + 1}</td>
        ${g.dates.map((x) => {
          const s = grp.cells[x.date][r];
          if (!s) return `<td class="grid-empty${x.today ? ' is-today' : ''}" data-date="${x.date}" data-pos="${esc(grp.position.id)}">—</td>`;
          return `<td class="${x.today ? 'is-today' : ''}" data-date="${x.date}" data-pos="${esc(grp.position.id)}" data-sid="${esc(s.id)}"><span class="grid-name${s.leader ? ' is-leader' : ''}" data-sid="${esc(s.id)}">${s.leader ? '<span class="grid-star" title="組長">★</span>' : ''}${esc(s.name)}${s.accompany ? '<small>陪同</small>' : ''}${s.note ? `<button type="button" class="grid-note" data-note="${esc(s.id)}" aria-label="${esc(s.name)}的註記">註</button>` : ''}</span></td>`;
        }).join('')}
      </tr>`).join('')).join('');
    return `
      <div class="grid-wrap">
        <table class="roster-grid">
          <thead><tr><th scope="col" colspan="2" class="grid-corner">日期</th>${head}</tr>
            <tr class="grid-total"><th scope="row" colspan="2" class="grid-corner">人數</th>${totals}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  /** 點「註」：在名字旁邊跳出小泡泡（名字、日期、註記）；點別的地方或 × 關掉 */
  let pop = null;
  function closeNote() {
    if (pop) { pop.remove(); pop = null; }
  }
  document.addEventListener('click', (ev) => {
    if (pop && !pop.contains(ev.target) && !ev.target.closest('[data-note]') && !ev.target.closest('.grid-name[data-sid]') && !ev.target.closest('.grid-empty.is-open')) closeNote();
  });
  window.addEventListener('hashchange', closeNote);
  window.addEventListener('resize', closeNote);

  /** el 裡的「註」可以點；editable＝大張職司表（可以改註記） */
  function bindNotes(el, d, editable) {
    el.querySelectorAll('.grid-wrap').forEach((w) => w.addEventListener('scroll', closeNote, { passive: true }));
    el.querySelectorAll('[data-note]').forEach((btn) => btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const s = (d.signups || []).find((x) => x.id === btn.dataset.note);
      if (s) openPop(btn, s, d, editable);
    }));
  }

  /** 空格「—」：明天以後的可以點一下直接打名字報名（2026/10/26） */
  function bindAdd(el, d) {
    el.querySelectorAll('td.grid-empty[data-date]').forEach((td) => {
      if (td.dataset.date <= d.today) return; // 當天和以前不能自己報名
      td.classList.add('is-open');
      td.title = '點一下報名這一格';
      td.addEventListener('click', (ev) => { ev.stopPropagation(); openAddPop(td, d); });
    });
  }

  function placePop(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const below = r.bottom + 10 + h < window.innerHeight;
    pop.style.left = left + window.scrollX + 'px';
    pop.style.top = (below ? r.bottom + 10 : Math.max(8, r.top - h - 10)) + window.scrollY + 'px';
    pop.style.setProperty('--arrow', Math.min(Math.max(16, r.left + r.width / 2 - left), w - 16) + 'px');
    pop.classList.add(below ? 'is-below' : 'is-above');
  }

  /** 空格旁邊的小視窗：打名字、選身分（成員名單上登記過的自動帶入），按「報名」 */
  function openAddPop(td, d) {
    const key = 'add|' + td.dataset.date + '|' + td.dataset.pos;
    const same = pop && pop.dataset.id === key;
    closeNote();
    if (same) return;
    const date = td.dataset.date;
    const posId = td.dataset.pos;
    const posName = (d.positions.find((x) => x.id === posId) || {}).name || '';
    let identity = '';
    let saved = '';
    try { saved = localStorage.getItem('duty-calendar:mine-name') || ''; } catch (e) { /* 無痕模式 */ }
    pop = document.createElement('div');
    pop.className = 'note-pop is-edit add-pop';
    pop.dataset.id = key;
    pop.setAttribute('role', 'dialog');
    pop.innerHTML = `
      <button type="button" class="note-pop-x" aria-label="關閉">×</button>
      <p class="note-pop-head"><strong>報名這一格</strong><span>${esc(Fmt.shortDate(date))}${posName ? '・' + esc(posName) : ''}</span></p>
      <label class="note-pop-label" for="add-pop-name">名字</label>
      <input class="input note-pop-input" id="add-pop-name" maxlength="20" value="${esc(saved)}" placeholder="打一個字就會跳出名字" autocomplete="off">
      <div class="add-pop-sug" data-sug aria-live="polite"></div>
      <div class="add-pop-id" role="radiogroup" aria-label="身分">${['道親', '壇辦', '未求道'].map((x) => `<button type="button" class="seg-btn" data-id="${x}">${x}</button>`).join('')}</div>
      <p class="add-pop-hint">成員名單上登記過身分的，不用選。</p>
      <div class="note-pop-actions"><button type="button" class="btn btn-primary btn-small" data-add-go>報名</button><span class="note-pop-msg" data-add-msg></span></div>`;
    document.body.appendChild(pop);
    const box = pop;
    box.querySelector('.note-pop-x').addEventListener('click', closeNote);
    const nameEl = box.querySelector('#add-pop-name');
    const msg = box.querySelector('[data-add-msg]');
    // 打字就從成員名單提示名字（同報名表單），點一下帶入名字和身分
    const sugBox = box.querySelector('[data-sug]');
    const pickId = (id) => { identity = id || ''; box.querySelectorAll('[data-id]').forEach((x) => x.classList.toggle('is-on', !!id && x.dataset.id === id)); };
    let sugTimer = null;
    let sugToken = 0;
    nameEl.addEventListener('input', () => {
      clearTimeout(sugTimer);
      const q = nameEl.value.replace(/[\s　]+/g, '');
      if (!q) { sugBox.innerHTML = ''; return; }
      sugTimer = setTimeout(async () => {
        const t = ++sugToken;
        try {
          const list = ((await Api.searchMembers(q)).members || []).slice(0, 8);
          if (t !== sugToken || !box.isConnected) return;
          sugBox.innerHTML = list.map((m, i) => `<button type="button" class="suggestion" data-sug-i="${i}">${esc(m.name)}${m.temple && m.dup ? `<small>${esc(m.temple)}</small>` : ''}</button>`).join('');
          sugBox.querySelectorAll('[data-sug-i]').forEach((b) => b.addEventListener('click', (ev) => {
            ev.stopPropagation(); // 名單清掉後按鈕不在小視窗裡了，不要被當成點外面而關掉
            const m = list[Number(b.dataset.sugI)];
            nameEl.value = m.name;
            sugBox.innerHTML = '';
            pickId(['道親', '壇辦', '未求道'].indexOf(m.identity) !== -1 ? m.identity : '');
            msg.textContent = m.identity ? '已帶入成員名單的身分' : '';
          }));
        } catch (e) { /* 查不到就自己打完整名字 */ }
      }, 250);
    });
    const go = box.querySelector('[data-add-go]');
    const submit = async () => {
      const name = nameEl.value.replace(/[\s　]+/g, '');
      if (name.length < 2) { msg.textContent = '請輸入完整的名字'; return; }
      go.disabled = true;
      msg.textContent = '報名中⋯';
      try {
        let id = identity;
        if (!id) { // 沒選身分：看成員名單有沒有登記
          const m = ((await Api.searchMembers(name)).members || []).filter((x) => x.name === name && !x.dup)[0];
          id = m && m.identity ? m.identity : '';
        }
        if (!id) { go.disabled = false; msg.textContent = '請選身分（道親、壇辦或未求道）'; return; }
        await Api.retryBusy(() => Api.signup({ dutyId: d.id, positionId: posId, positionIds: [posId], dates: [date], entries: [{ name, identity: id, dates: [date], positionIds: [posId] }] }), () => { msg.textContent = '使用的人較多，排隊中⋯'; });
        try { localStorage.setItem('duty-calendar:mine-name', name); } catch (e) { /* 無痕模式 */ }
        closeNote();
        if (window.CalendarPage) CalendarPage.refresh();
        const fresh = await DutyCache.fetch(d.id);
        if (root && data && fresh.id === data.id) { data = fresh; updatedAt = new Date(); render(); }
        const flashBox = root && root.querySelector('[data-grid-flash]');
        if (flashBox) flashBox.innerHTML = `<p class="notice notice-success">✅ ${esc(name)} 報名好了：${esc(Fmt.shortDate(date))}${posName ? '・' + esc(posName) : ''}</p>`;
      } catch (err) {
        go.disabled = false;
        const detail = err.details && err.details.length ? err.details.map((x) => x.message).join('；') : '';
        msg.textContent = detail || err.message || '報名失敗，請再試一次';
      }
    };
    box.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => pickId(b.dataset.id)));
    go.addEventListener('click', submit);
    nameEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); submit(); } });
    placePop(td);
    nameEl.focus();
  }

  /** 名字旁邊的小視窗：看註記；editable 而且今天以後的，可以直接改 */
  function openPop(btn, s, d, editable) {
      const same = pop && pop.dataset.id === s.id;
      closeNote();
      if (same) return; // 再點一次同一個＝關掉
      const canEdit = editable && (s.date >= d.today || Api.isAdmin());
      const posName = (d.positions.find((x) => x.id === s.positionId) || {}).name || '';
      pop = document.createElement('div');
      pop.className = 'note-pop' + (canEdit ? ' is-edit' : '');
      pop.dataset.id = s.id;
      pop.setAttribute('role', 'dialog');
      pop.innerHTML = `
        <button type="button" class="note-pop-x" aria-label="關閉">×</button>
        <p class="note-pop-head"><strong>${esc(s.name)}</strong><span>${esc(Fmt.shortDate(s.date))}${posName ? '・' + esc(posName) : ''}</span></p>
        ${canEdit ? `<label class="note-pop-label" for="note-pop-input">註記</label>
          <input class="input note-pop-input" id="note-pop-input" maxlength="100" value="${esc(s.note || '')}" placeholder="例：8:00-19:00、代理人">
          <div class="note-pop-actions"><button type="button" class="btn btn-primary btn-small" data-note-save>存註記</button><span class="note-pop-msg" data-note-msg></span></div>`
          : `<p class="note-pop-text">${s.note ? esc(s.note) : '<span class="muted">沒有註記</span>'}</p>`}
        ${editable && (s.date > d.today || Api.isAdmin()) ? '<button type="button" class="btn btn-quiet-danger btn-small note-pop-cancel" data-signup-cancel>取消這筆報名</button>' : ''}`;
      document.body.appendChild(pop);
      pop.querySelector('.note-pop-x').addEventListener('click', closeNote);
      // 取消報名：先確認（顯示名字、日期、項目），明天以後的才可以；管理者登入時都可以
      const cancelBtn = pop.querySelector('[data-signup-cancel]');
      if (cancelBtn) cancelBtn.addEventListener('click', async () => {
        closeNote();
        const ok = await Confirm.open({
          title: `確定要取消「${s.name}」的報名嗎？`,
          rows: [['姓名', s.name + (s.accompany ? '（陪同）' : '')], ['日期', Fmt.rocDate(s.date)], ['項目', posName]],
          note: '請確認是自己或幫忙報名的家人，不要取消到別人的。',
          confirmText: '確定取消報名', cancelText: '不要取消', danger: true
        });
        if (!ok) return;
        Busy.show('取消中⋯');
        try {
          if (Api.isAdmin()) await Api.admin('adminCancel', { signupId: s.id });
          else await Api.retryBusy(() => Api.cancel(s.id), () => Busy.show('使用的人較多，正在排隊⋯'));
          Busy.hide();
          if (window.CalendarPage) CalendarPage.refresh();
          const fresh = await DutyCache.fetch(d.id);
          if (root && data && fresh.id === data.id) { data = fresh; updatedAt = new Date(); render(); }
          const flashBox = root && root.querySelector('[data-grid-flash]');
          if (flashBox) flashBox.innerHTML = `<p class="notice notice-success">已取消 ${esc(s.name)}：${esc(Fmt.shortDate(s.date))}${posName ? '・' + esc(posName) : ''}</p>`;
        } catch (err) {
          Busy.hide();
          alert(err.message || '取消失敗，請再試一次');
        }
      });
      const save = pop.querySelector('[data-note-save]');
      if (save) {
        const inputEl = pop.querySelector('.note-pop-input');
        const doSave = async () => {
          const msg = pop.querySelector('[data-note-msg]');
          save.disabled = true;
          msg.textContent = '儲存中⋯';
          try {
            const payload = { signupId: s.id, note: inputEl.value.trim() };
            if (Api.isAdmin()) await Api.admin('adminGridNote', payload); else await Api.gridNote(payload);
            s.note = inputEl.value.trim();
            closeNote();
            const fresh = await DutyCache.fetch(d.id);
            if (root && data && fresh.id === data.id) { data = fresh; updatedAt = new Date(); render(); }
          } catch (err) {
            save.disabled = false;
            msg.textContent = err.message || '儲存失敗，請再試一次';
          }
        };
        save.addEventListener('click', doSave);
        inputEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doSave(); } });
      }
      // 放在名字下方，靠近「註」；超出畫面就往內推，下方放不下就放上方
      const r = btn.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      const below = r.bottom + 10 + h < window.innerHeight;
      pop.style.left = left + window.scrollX + 'px';
      pop.style.top = (below ? r.bottom + 10 : r.top - h - 10) + window.scrollY + 'px';
      pop.style.setProperty('--arrow', Math.min(Math.max(16, r.left + r.width / 2 - left), w - 16) + 'px');
      pop.classList.add(below ? 'is-below' : 'is-above');
  }

  /**
   * 職司說明加上版面：
   *   「【烹飪】」開頭的一行 → 一區（左邊圖示＋名稱，依名稱配圖示）
   *   **粗體** → 粗體；「>」開頭的一行 → 小標重點（例：> 職司完整不空窗：前一天晚上 → 當天）
   *   其他行照原樣（換行保留）
   */
  const ICONS = [[/烹飪|廚/, '🍳'], [/維安|值夜|夜/, '🛡️'], [/清潔|打掃/, '🧹'], [/作息|時間|拜香|早課/, '🕑'], [/提醒|注意/, '💡'], [/交通|接送/, '🚗']];
  function richDesc(text) {
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const sections = [];
    let cur = { title: '', lines: [] };
    String(text || '').split(/\r?\n/).forEach((line) => {
      const m = line.trim().match(/^【(.+?)】\s*(.*)$/);
      if (m) {
        if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur);
        cur = { title: m[1], lines: m[2] ? [m[2]] : [] };
      } else cur.lines.push(line);
    });
    if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur);
    return sections.map((sec) => {
      const lines = sec.lines.join('\n').trim().split('\n');
      const body = lines.map((l) => {
        const t = l.trim();
        if (!t) return '<span class="rd-gap"></span>';
        if (/^[>＞]/.test(t)) return `<span class="rd-key">${inline(t.replace(/^[>＞]\s*/, ''))}</span>`;
        return `<span class="rd-line">${inline(t)}</span>`;
      }).join('');
      if (!sec.title) return `<div class="rd-sec rd-plain"><div class="rd-body">${body}</div></div>`;
      const icon = (ICONS.find(([re]) => re.test(sec.title)) || [null, '📌'])[1];
      return `<div class="rd-sec"><div class="rd-head"><span class="rd-icon" aria-hidden="true">${icon}</span>${esc(sec.title)}</div><div class="rd-body">${body}</div></div>`;
    }).join('');
  }

  function show(id) {
    root = document.getElementById('view-grid');
    token += 1;
    const t = token;
    data = window.DutyCache && DutyCache.get(id);
    if (data) render();
    else root.innerHTML = '<p class="panel-empty">載入職司表中⋯</p>';
    load(id, t);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.getElementById('view-grid') || root.hidden) { clearInterval(timer); return; }
      if (document.visibilityState === 'visible') load(id, t);
    }, REFRESH_MS);
  }

  async function load(id, t) {
    try {
      const fresh = await DutyCache.fetch(id);
      if (t !== token) return;
      data = fresh;
      updatedAt = new Date();
      render();
    } catch (err) {
      if (t !== token || data) return;
      root.innerHTML = `<p class="panel-empty">${esc(err.message || '讀取失敗，請稍後再試')}</p>`;
    }
  }

  function dateRange(d) {
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}(${Fmt.weekday(s)})`;
    return d.start === d.end ? md(d.start) : `${md(d.start)}～${md(d.end)}`;
  }

  /** 過了定案日、又不是管理者：只能看 */
  const isLocked = (d) => !!(d.gridLock && d.today > d.gridLock && !Api.isAdmin());
  const lockText = (d) => `${Number(d.gridLock.slice(5, 7))}/${Number(d.gridLock.slice(8, 10))}`;

  function render() {
    const d = data;
    if (d.layout !== '職司表') { // 不是職司表的勤務：直接去勤務頁
      location.replace(`#/duty/${encodeURIComponent(d.id)}`);
      return;
    }
    const stages = RosterGrid.parseStages(RosterGrid.stagesText(d), d.start, d.today); // 階段留空就自動推算
    const keep = root.querySelector('.grid-wrap');
    const scrollX = keep ? keep.scrollLeft : null;
    root.innerHTML = `
      <header class="gp-hero">
        <p class="gp-when">${esc(dateRange(d))}</p>
        <h1 class="gp-title">${esc(d.name)}</h1>
        ${d.location ? `<p class="gp-place">📍 ${esc(d.location)}${Fmt.timeRange(d) ? `　🕑 ${esc(Fmt.timeRange(d))}` : ''}</p>` : ''}
        ${stages.length ? `<ol class="gp-stages">${stages.map((s) => `
          <li class="gp-stage gp-stage-${s.state}">
            <span class="gp-stage-when"><span class="gp-stage-n">${s.n}</span>${esc(s.when)}</span>
            <span class="gp-stage-text">${esc(s.text)}</span>
          </li>`).join('')}</ol>` : ''}
      </header>
      <div data-grid-flash></div>
      <p class="gp-updated">${updatedAt ? `最近更新：${updatedAt.toLocaleTimeString('zh-TW', { hour12: false })}` : '更新中⋯'}<span class="gp-legend"><span class="grid-star">★</span> 組長　<span class="grid-note gp-legend-note">註</span> 點了看註記</span></p>
      <section class="gp-section">
        <h2 class="gp-h2">職司表</h2>
        ${d.signups ? tableHtml(d) : '<p class="muted">載入職司表中⋯</p>'}
        ${isLocked(d) ? `<p class="notice grid-locked">🔒 職司已在 ${lockText(d)} 定案，要調整請聯絡管理者。點名字可以看註記，點空格「—」可以直接報名。</p>` : `<p class="hint">表格可以左右滑動。<strong>點空格「—」</strong>可以直接打名字報名；<strong>點一下名字</strong>可以看、改註記或取消；<strong>按住名字拖到別的格子</strong>可以調整（手機先按住一下再拖），拖到有人的格子會兩人互換，放下後會先問您。${d.gridLock ? `${lockText(d)} 定案後只有管理者能調整。` : ''}${Api.isAdmin() ? '（您已登入後台，定案後也可以調整）' : ''}</p>`}
      </section>
      ${d.description ? `
      <section class="gp-section">
        <h2 class="gp-h2">職司說明</h2>
        <div class="rich-desc">${richDesc(d.description)}</div>
        ${d.attire ? `<p class="gp-desc"><strong>服裝：</strong>${esc(d.attire)}</p>` : ''}
      </section>` : ''}
      <a class="btn btn-primary btn-block gp-signup-btn" href="#/duty/${encodeURIComponent(d.id)}" data-signup>我要報名</a>
      <p class="gp-foot">每 30 秒自動更新　<a href="#/">回行事曆</a></p>`;
    const wrap = root.querySelector('.grid-wrap');
    // 日期、人數兩列固定在上面：第二列要知道第一列多高
    if (wrap) { const h1 = wrap.querySelector('thead tr'); if (h1) wrap.style.setProperty('--gh', h1.offsetHeight + 'px'); }
    if (wrap && scrollX !== null) wrap.scrollLeft = scrollX; // 自動更新時保留左右滑的位置
    else if (wrap) { // 第一次打開：滑到今天那欄
      const today = wrap.querySelector('th.is-today');
      if (today) wrap.scrollLeft = Math.max(0, today.offsetLeft - 120);
    }
    bindNotes(root, d, !isLocked(d));
    bindAdd(root, d);
    if (!isLocked(d)) bindDrag(root, d);
    root.querySelector('[data-signup]').addEventListener('click', () => {
      // 到勤務頁後直接捲到報名表單
      sessionStorage.setItem('duty-calendar:to-signup', d.id);
    });
  }

  // ---------- 拖曳調整：按住名字拖到別的格子（空格＝改過去，有人＝互換） ----------

  let drag = null;
  function cellAt(x, y) {
    const t = document.elementFromPoint(x, y);
    return t ? t.closest('td[data-date]') : null;
  }
  function endDrag() {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.ghost) drag.ghost.remove();
    if (drag.name) drag.name.classList.remove('is-dragging');
    if (drag.over) drag.over.classList.remove('is-drop');
    document.body.classList.remove('grid-dragging');
    drag = null;
  }
  function startDrag(x, y) {
    drag.active = true;
    drag.name.classList.add('is-dragging');
    document.body.classList.add('grid-dragging');
    const g = document.createElement('div');
    g.className = 'grid-ghost';
    g.textContent = drag.label;
    document.body.appendChild(g);
    drag.ghost = g;
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* 不支援 */ } }
    moveDrag(x, y);
  }
  function moveDrag(x, y) {
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
    const td = cellAt(x, y);
    if (drag.over && drag.over !== td) drag.over.classList.remove('is-drop');
    drag.over = td && td !== drag.from ? td : null;
    if (drag.over) drag.over.classList.add('is-drop');
  }
  // 拖曳中不要讓手機捲動畫面（要在 touchmove 擋，pointer 事件擋不住）
  document.addEventListener('touchmove', (ev) => { if (drag && drag.active) ev.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (ev) => { if (drag) ev.preventDefault(); });
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dist = Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y);
    if (!drag.active) {
      if (!drag.touch && dist > 6) startDrag(ev.clientX, ev.clientY);
      else if (drag.touch && dist > 10) endDrag(); // 手指還沒按住就滑動＝在捲表格
      return;
    }
    moveDrag(ev.clientX, ev.clientY);
  });
  window.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const d = drag;
    const target = d.active ? cellAt(ev.clientX, ev.clientY) : null;
    endDrag();
    if (target && target !== d.from) confirmMove(d.data, d.sid, target);
    else if (!d.active) { // 點一下名字（沒有拖）＝看／改註記
      const s = (d.data.signups || []).find((x) => x.id === d.sid);
      if (s) openPop(d.name, s, d.data, !isLocked(d.data));
    }
  });
  window.addEventListener('pointercancel', endDrag);

  function bindDrag(el, d) {
    const wrap = el.querySelector('.grid-wrap');
    if (!wrap) return;
    wrap.addEventListener('pointerdown', (ev) => {
      const name = ev.target.closest('.grid-name[data-sid]');
      if (!name || ev.target.closest('[data-note]') || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      const s = (d.signups || []).find((x) => x.id === name.dataset.sid);
      if (!s) return;
      if (ev.pointerType === 'mouse') ev.preventDefault(); // 不要選到文字
      drag = { sid: s.id, data: d, name, from: name.closest('td'), label: s.name, x: ev.clientX, y: ev.clientY, touch: ev.pointerType !== 'mouse', active: false };
      if (drag.touch) drag.timer = setTimeout(() => { if (drag && !drag.active) startDrag(drag.x, drag.y); }, 350);
    });
  }

  async function confirmMove(d, sid, td) {
    const a = (d.signups || []).find((x) => x.id === sid);
    if (!a) return;
    const date = td.dataset.date;
    const pos = td.dataset.pos;
    const b = td.dataset.sid ? d.signups.find((x) => x.id === td.dataset.sid) : null;
    if (b && b.id === a.id) return;
    if (!b && a.date === date && a.positionId === pos) return;
    const posName = (id) => (d.positions.find((x) => x.id === id) || {}).name || '';
    const where = (dt, pid) => `${Fmt.shortDate(dt)} ${posName(pid)}`;
    const ok = await Confirm.open(b ? {
      title: '這兩位要互換嗎？',
      rows: [[a.name, `${where(a.date, a.positionId)} → ${where(b.date, b.positionId)}`], [b.name, `${where(b.date, b.positionId)} → ${where(a.date, a.positionId)}`]],
      confirmText: '確定互換', cancelText: '不要'
    } : {
      title: '要這樣調整嗎？',
      rows: [['姓名', a.name], ['原本', where(a.date, a.positionId)], ['改到', where(date, pos)]],
      confirmText: '確定調整', cancelText: '不要'
    });
    if (!ok) return;
    Busy.show('調整中⋯');
    try {
      const payload = { signupId: a.id, date, positionId: pos, swapId: b ? b.id : '' };
      if (Api.isAdmin()) await Api.admin('adminGridMove', payload); else await Api.gridMove(payload);
      const fresh = await DutyCache.fetch(d.id);
      Busy.hide();
      if (root && fresh.id === (data && data.id)) { data = fresh; updatedAt = new Date(); render(); }
    } catch (err) {
      Busy.hide();
      alert((err.message || '調整失敗，請再試一次') + (err.details ? '\n' + err.details.map((x) => x.message).join('\n') : ''));
    }
  }

  window.GridPage = { show, tableHtml, bindNotes, richDesc };
})();
