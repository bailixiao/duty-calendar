// 勤務草稿的編輯卡片（「貼上草稿」視窗用）：AI 從照片整理好、或貼上的草稿，每一筆都用欄位直接修改，不用看程式碼。
//   - 名字自動對照成員名單：完全相同 ✅；寫錯字或沒寫姓（Fmt.sameName 只對到一位）就換成全名並標示「已對照」，可以改回；
//     對不到的標「名單上沒有」讓管理者確認（照樣可以新增）。
//   - 只寫農曆日期（lunarDate，例如「九月十五」）時，由網站換算成今天以後最近的國曆日期。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const NATURES = ['勤務', '支援', '烹飪', '活動'];
  // 類別與各類別的性質（同 apps-script/DutyRules.gs 的 NATURES_BY_CATEGORY_）；道務、教育沒有了愿項目，只有一個「參加」
  const CATEGORIES = ['勤務', '道務', '教育'];
  const NATURES_BY_CAT = { 勤務: NATURES, 道務: ['法會', '課程', '會議'], 教育: ['課程', '活動'] };
  const isSimple = (c) => c === '道務' || c === '教育';

  // ---------- 農曆 → 國曆 ----------

  function normLunar(s) {
    return String(s || '').replace(/農曆|\s/g, '').replace('冬月', '十一月').replace('臘月', '十二月').replace('腊月', '十二月');
  }

  /** 今天以後（含）最近一個農曆日期是 text 的國曆日期；找不到回傳 '' */
  function solarFromLunar(text, today) {
    const want = normLunar(text);
    if (!want || !window.LunarUtil) return '';
    let d = today;
    for (let i = 0; i < 400; i++) {
      const l = LunarUtil.lunarOf(d);
      if (l.full === want || l.full === want.replace(/^閏/, '')) return d;
      d = Fmt.addDays(d, 1);
    }
    return '';
  }

  // ---------- 名字對照 ----------

  /** 回傳 { name, status: 'ok'|'matched'|'unknown'|'ambiguous', original?, candidates? } */
  function matchName(raw, members) {
    const name = String(raw || '').replace(/[\s　]+/g, '');
    if (!members || !members.length) return { name, status: 'none' };
    if (members.some((m) => m.name === name)) return { name, status: 'ok' };
    const cands = members.filter((m) => Fmt.sameName(m.name, name)).map((m) => m.name);
    if (cands.length === 1) return { name: cands[0], status: 'matched', original: name };
    if (cands.length > 1) return { name, status: 'ambiguous', candidates: cands };
    return { name, status: 'unknown' };
  }

  // ---------- 資料整理 ----------

  function clean(d, today, members) {
    const x = {
      name: String(d.name || ''),
      category: CATEGORIES.indexOf(d.category) !== -1 ? d.category : '勤務',
      nature: '',
      teachers: String(d.teachers || ''),
      merge: String(d.merge || ''),
      lecturers: String(d.lecturers || ''),
      leaders: String(d.leaders || ''),
      assistants: String(d.assistants || ''),
      mode: d.mode === '公告型' ? '公告型' : '報名型',
      start: d.start || '',
      end: d.end || '',
      startTime: d.startTime || '',
      endTime: d.endTime || '',
      location: d.location || '',
      attire: d.attire || '',
      description: d.description || '',
      deadline: d.deadline || '',
      multi: d.multi === true || d.multi === '是',
      positions: (Array.isArray(d.positions) && d.positions.length ? d.positions : [{ name: '了愿', min: 2, max: '' }])
        .map((p) => ({ name: String(p.name || ''), min: p.min === '' || p.min === undefined ? '' : String(p.min), max: p.max === '' || p.max === undefined || p.max === null ? '' : String(p.max) })),
      notes: Array.isArray(d.uncertain) ? d.uncertain.slice() : [],
      people: {} // 了愿項目名稱 → [{ name, status, original?, candidates? }]
    };
    const natures = NATURES_BY_CAT[x.category];
    x.nature = natures.indexOf(d.nature) !== -1 ? d.nature : natures[0];
    if (isSimple(x.category) && !(Array.isArray(d.positions) && d.positions.length)) x.positions = [{ name: '參加', min: '0', max: '' }];
    if (!x.start && d.lunarDate) {
      x.start = solarFromLunar(d.lunarDate, today);
      x.notes.push(x.start ? `照片寫農曆「${d.lunarDate}」，已換算成國曆 ${Fmt.rocDate(x.start)}，請確認` : `照片寫農曆「${d.lunarDate}」，換算不出國曆日期，請自己填`);
    }
    if (!x.end) x.end = x.start;
    const assign = d.assign && typeof d.assign === 'object' ? d.assign : {};
    Object.keys(assign).forEach((pos) => {
      x.people[pos] = (Array.isArray(assign[pos]) ? assign[pos] : []).filter(Boolean).map((n) => matchName(n, members));
    });
    return x;
  }

  /** 送出用：去掉編輯用的欄位，people 轉回 assign */
  function toDuty(x) {
    const assign = {};
    x.positions.forEach((p) => {
      const list = [...new Set((x.people[p.name] || []).map((e) => e.name).filter(Boolean))]; // 重複的只送一次
      if (list.length) assign[p.name] = list;
    });
    const d = {
      name: x.name.trim(), category: x.category || '勤務', nature: x.nature, mode: x.mode, start: x.start, end: x.end || x.start,
      teachers: x.category === '教育' ? String(x.teachers || '').trim() : '',
      merge: String(x.merge || '').trim(),
      lecturers: x.category === '道務' ? String(x.lecturers || '').trim() : '',
      leaders: x.category === '道務' ? String(x.leaders || '').trim() : '',
      assistants: x.category === '道務' ? String(x.assistants || '').trim() : '',
      startTime: x.startTime, endTime: x.endTime, location: x.location.trim(), attire: x.attire.trim(),
      description: x.description.trim(), deadline: x.deadline, multi: x.multi,
      positions: x.positions.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), min: p.min, max: p.max }))
    };
    if (Object.keys(assign).length) d.assign = assign;
    return d;
  }

  // ---------- 畫面 ----------

  function chip(e, ci, dup) {
    const label = {
      ok: '<small class="nm-ok">✅ 名單上有</small>',
      matched: `<small class="nm-matched">已對照（原寫「${esc(e.original)}」）<button type="button" class="link-btn" data-undo="${ci}">改回</button></small>`,
      ambiguous: `<small class="nm-warn">⚠️ 名單上有好幾位：${(e.candidates || []).map((c) => `<button type="button" class="link-btn" data-pick="${ci}" data-name="${esc(c)}">${esc(c)}</button>`).join('、')}</small>`,
      unknown: '<small class="nm-warn">⚠️ 名單上沒有，請確認名字</small>',
      none: ''
    }[e.status] || '';
    if (dup) return `<li class="nm-chip nm-unknown"><span class="nm-name">${esc(e.name)}</span><small class="nm-warn">⚠️ 跟上面重複了${e.original ? '（原寫「' + esc(e.original) + '」）' : ''}，不需要的話按 × 刪掉</small><button type="button" class="nm-del" data-del="${ci}" aria-label="移除">×</button></li>`;
    return `<li class="nm-chip nm-${e.status}"><span class="nm-name">${esc(e.name)}</span>${label}<button type="button" class="nm-del" data-del="${ci}" aria-label="移除 ${esc(e.name)}">×</button></li>`;
  }

  function cardHtml(x, i) {
    const f = (label, html) => `<label class="de-field"><span>${label}</span>${html}</label>`;
    const inp = (key, type, extra) => `<input class="input" type="${type || 'text'}" data-k="${key}" value="${esc(x[key])}" ${extra || ''}>`;
    return `
      <div class="draft-card de-card" data-i="${i}">
        <div class="de-head">
          <h3>第 ${i + 1} 筆</h3>
          <button type="button" class="btn btn-small btn-quiet-danger" data-remove>刪除這筆</button>
        </div>
        ${x.notes.length ? `<div class="de-notes">⚠️ 請特別確認：<ul>${x.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        ${f('名稱', inp('name'))}
        <div class="de-row">
          ${f('類別', `<select class="input" data-k="category">${CATEGORIES.map((n) => `<option${n === x.category ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
          ${x.category === '教育' ? f('師資', inp('teachers', 'text', 'placeholder="好幾位用「、」隔開"')) : ''}
        </div>
        <div class="de-row">
          ${f('性質', `<select class="input" data-k="nature">${(NATURES_BY_CAT[x.category] || NATURES).map((n) => `<option${n === x.nature ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
          ${f('模式', `<select class="input" data-k="mode">${['報名型', '公告型'].map((n) => `<option${n === x.mode ? ' selected' : ''}>${n}</option>`).join('')}</select>`)}
        </div>
        <div class="de-row">
          ${f('開始日', inp('start', 'date'))}
          ${f('結束日', inp('end', 'date'))}
        </div>
        <div class="de-row">
          ${f('開始時間', inp('startTime', 'time'))}
          ${f('結束時間', inp('endTime', 'time'))}
        </div>
        ${f('地點', inp('location', 'text', 'list="opt-location"'))}
        ${f('服裝', inp('attire', 'text', 'list="opt-attire"'))}
        <div class="de-row">
          ${f('報名截止日（選填）', inp('deadline', 'date'))}
          <label class="de-check"><input type="checkbox" data-k="multi"${x.multi ? ' checked' : ''}> 一人可兼任好幾項</label>
        </div>
        ${f('說明', `<textarea class="input" rows="3" data-k="description">${esc(x.description)}</textarea>`)}
        <p class="draft-sub">了愿項目與已排的人</p>
        ${x.positions.map((p, pi) => `
          <div class="de-pos" data-pi="${pi}">
            <div class="de-pos-row">
              <input class="input" data-p="name" value="${esc(p.name)}" placeholder="項目名稱">
              <input class="input de-num" data-p="min" value="${esc(p.min)}" inputmode="numeric" placeholder="最少">
              <input class="input de-num" data-p="max" value="${esc(p.max)}" inputmode="numeric" placeholder="最多">
              <button type="button" class="nm-del" data-pos-del aria-label="刪除這個項目">×</button>
            </div>
            <ul class="nm-list">${(x.people[p.name] || []).map((e, ci, all) => chip(e, ci, all.findIndex((o) => o.name === e.name) < ci)).join('')}</ul>
            <div class="de-add-person"><input class="input" data-person placeholder="加人（選填）"><button type="button" class="btn btn-small" data-person-add>加入</button></div>
          </div>`).join('')}
        <button type="button" class="link-btn" data-pos-add>＋ 新增項目</button>
      </div>`;
  }

  /**
   * 在 container 裡顯示可編輯的草稿。opts.members：成員名單（[{ name }]），opts.onChange(items)：每次修改後呼叫（暫存用）。
   * 回傳 { count, duties()（送出用）, errors()（缺名稱或日期的提醒）, items()（暫存用） }
   */
  function mount(container, raw, opts) {
    const today = Fmt.toDateStr(new Date());
    const members = (opts.members || []).filter((m) => m.active !== false);
    let items = raw.map((d) => (d.people ? d : clean(d, today, members)));
    const changed = () => { if (opts.onChange) opts.onChange(items); };

    function render() {
      container.innerHTML = items.length ? items.map(cardHtml).join('') : '<p class="panel-empty">沒有草稿了</p>';
      if (opts.onCount) opts.onCount(items.length);
    }

    container.addEventListener('input', (ev) => {
      const card = ev.target.closest('.de-card');
      if (!card) return;
      const x = items[Number(card.dataset.i)];
      const k = ev.target.dataset.k;
      if (k) x[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
      if (k === 'category') {
        const ns = NATURES_BY_CAT[x.category] || NATURES;
        if (ns.indexOf(x.nature) === -1) x.nature = ns[0];
        if (isSimple(x.category) && x.positions.length !== 1) x.positions = [{ name: '參加', min: '0', max: '' }];
        render();
        changed();
        return;
      }
      const pEl = ev.target.closest('.de-pos');
      if (pEl && ev.target.dataset.p) {
        const p = x.positions[Number(pEl.dataset.pi)];
        if (ev.target.dataset.p === 'name') { // 改項目名稱：已排的人跟著換到新名稱
          x.people[ev.target.value] = x.people[p.name] || [];
          if (ev.target.value !== p.name) delete x.people[p.name];
        }
        p[ev.target.dataset.p] = ev.target.value;
      }
      changed();
    });
    container.addEventListener('change', (ev) => { if (ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT') container.dispatchEvent(new Event('input', { bubbles: true })); });

    container.addEventListener('click', (ev) => {
      const card = ev.target.closest('.de-card');
      if (!card) return;
      const i = Number(card.dataset.i);
      const x = items[i];
      const pEl = ev.target.closest('.de-pos');
      const p = pEl ? x.positions[Number(pEl.dataset.pi)] : null;
      const list = p ? (x.people[p.name] = x.people[p.name] || []) : null;
      const t = ev.target;
      if (t.matches('[data-remove]')) items.splice(i, 1);
      else if (t.matches('[data-pos-add]')) x.positions.push({ name: '', min: '', max: '' });
      else if (t.matches('[data-pos-del]')) { delete x.people[p.name]; x.positions.splice(Number(pEl.dataset.pi), 1); }
      else if (t.matches('[data-del]')) list.splice(Number(t.dataset.del), 1);
      else if (t.matches('[data-undo]')) { const e = list[Number(t.dataset.undo)]; list[Number(t.dataset.undo)] = { name: e.original, status: 'unknown' }; }
      else if (t.matches('[data-pick]')) list[Number(t.dataset.pick)] = { name: t.dataset.name, status: 'ok' };
      else if (t.matches('[data-person-add]')) {
        const input = pEl.querySelector('[data-person]');
        if (!input.value.trim()) return;
        list.push(matchName(input.value, members));
      } else return;
      render();
      changed();
    });
    container.addEventListener('keydown', (ev) => { // 加人的輸入框：Enter 不要送出整個表單
      if (ev.key === 'Enter' && ev.target.matches('[data-person]') && !ev.isComposing) ev.preventDefault();
    });

    render();
    changed();
    return {
      get count() { return items.length; },
      items: () => items,
      duties: () => items.map(toDuty),
      errors: () => items.map((x, i) => (!x.name.trim() ? `第 ${i + 1} 筆沒有名稱` : !x.start ? `第 ${i + 1} 筆（${x.name}）沒有日期` : '')).filter(Boolean)
    };
  }

  window.DraftEditor = { mount, matchName, solarFromLunar };
})();
