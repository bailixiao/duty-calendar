// 管理後台：勤務管理（規格第 8 節管理者後台第 2 項）。
//   #/admin/duties              勤務列表（月份篩選、搜尋名稱）
//   #/admin/duties/new          新增勤務（單日／連續多天／農曆規則）
//   #/admin/duties/new?from=ID  另存成新勤務（以現有勤務為範本）
//   #/admin/duties/edit/ID      編輯勤務（存檔時可一起套用到其他同名勤務）
(function () {
  'use strict';

  const esc = Fmt.esc;
  // 畫面用詞：道務、教育帳號叫「活動」（見 AdminPage.term）
  const T = () => (window.AdminPage && AdminPage.term ? AdminPage.term() : '勤務');

  // 與 apps-script/Config.gs 的 OPTIONS 相同（只是輸入提示，也可以自己打字）
  const NATURES = ['勤務', '支援', '烹飪', '活動'];
  const GROUP_TYPES = ['勤務了愿組', '打掃組', '拜香輪值組'];
  const LOCATIONS = ['宏宗', '區中心', '彌勒山', '厚德樓', '樹林頭活動地'];
  const ATTIRES = [
    '夏季制服（短袖白襯衫、藍色長褲、打領帶）',
    '冬季制服（長袖白襯衫、藍色長褲、西裝、打領帶）',
    '一般制服（POLO 衫、藍色長褲）',
    '白色 POLO 衫',
    '自行穿著'
  ];
  // 同名勤務一次改的欄位（與 apps-script/DutyRules.gs 的 BULK_FIELDS_ 相同）
  const BULK_FIELDS = [
    ['name', '名稱'], ['nature', '性質'], ['mode', '模式'], ['time', '時段'], ['location', '地點'],
    ['group', '負責組'], ['attire', '服裝'], ['description', '說明'], ['positions', '了愿項目']
  ];
  const MAX_LUNAR_DAYS = 800;

  let flash = '';

  function afterWrite() {
    AdminPage.clearMemo();
    if (window.CalendarPage) CalendarPage.refresh();
  }

  function rocMonth(ym) {
    return `${Number(ym.slice(0, 4)) - 1911} 年 ${Number(ym.slice(5, 7))} 月`;
  }

  function dateRange(d) {
    return d.start === d.end ? Fmt.rocDate(d.start) : `${Fmt.rocDate(d.start)} – ${Fmt.shortDate(d.end)}`;
  }

  /**
   * 新增勤務（表單、農曆規則、批次匯入、草稿共用）。
   *   - 已有同名同日的勤務：伺服器回 DUPLICATE，跳確認視窗，確定才加 allowDuplicate 重送。
   *   - 回應卡住（網路錯誤）：重新讀勤務列表，若這幾筆都已經建好，就當作成功（避免再按一次變成重複）。
   * 回傳 { ids } 或 null（使用者取消）；其他錯誤照樣丟出。
   */
  async function createDuties(duties) {
    const send = (allowDuplicate) => Api.admin('adminCreateDuties', allowDuplicate ? { duties, allowDuplicate: true } : { duties });
    try {
      return await send(false);
    } catch (err) {
      if (err.code === 'DUPLICATE') {
        Busy.hide();
        const ok = await Confirm.open({
          title: `已經有一樣的${T()}了，還要新增嗎？`,
          rows: (err.details || []).slice(0, 8).map((d, i) => [i ? '' : '同名同日', d.message]),
          note: `如果剛才按過一次，很可能已經建好了，請先回${T()}管理看看。`,
          confirmText: '還是要新增', cancelText: '不要新增'
        });
        if (!ok) return null;
        Busy.show('新增中⋯');
        return send(true);
      }
      if (err.code === 'NETWORK') {
        try {
          const list = await Api.admin('adminDutyList', {}, true);
          const found = duties.map((d) => list.duties.filter((x) => x.name === String(d.name).trim() && x.start === d.start).pop());
          if (found.every(Boolean)) return { ids: found.map((x) => x.id) };
        } catch (e) { /* 查不到就照原本的錯誤處理 */ }
      }
      throw err;
    }
  }

  // ---------- 貼上草稿 ----------

  /** PDF 等檔案讀成 base64（不含 data: 開頭） */
  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('檔案讀不出來，請換一個'));
      r.readAsDataURL(file);
    });
  }

  /** 照片縮小成長邊 1600px 的 JPEG（上傳快、AI 也看得清楚），回傳 { mime, data(base64) } */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1600;
        const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('這張照片讀不出來，請換 jpg 或 png')); };
      img.src = url;
    });
  }
  // 草稿：AI 從照片整理的，或貼上的一段 JSON（一筆勤務、勤務陣列，或 { duties: [...] }，可帶 assign: { 項目: [姓名] }）。
  // 每一筆都用 DraftEditor 的卡片直接修改，再一起新增。整理好的草稿暫存在這個分頁（sessionStorage），關掉視窗再開還在。
  const DRAFT_KEY = 'duty-calendar:draft';

  function savedDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }

  function saveDraft(items) {
    try {
      if (items && items.length) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ items, at: Date.now() }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch (e) { /* 無痕模式等，忽略 */ }
  }

  function openDraft() {
    const m = Modal.open(`
      <h2 class="modal-title">從照片新增${T()}</h2>
      <div class="draft-photo">
        <label class="btn btn-block btn-photo">📷 選照片或拍照<input type="file" accept="image/*" multiple hidden data-photo></label>
        <input class="input" type="text" data-hint placeholder="補充說明（選填）例：這是 11 月的">
        <p class="modal-note">一次最多 3 張；電腦也可以把照片拖進來，或截圖後按 Ctrl+V 貼上。只整理教全區的部分。照片會交給 Google Gemini 讀取，整理好後可以在下面直接修改，確認後才新增。</p>
        <div class="draft-thumbs" data-thumbs></div>
      </div>
      <div data-ai-note></div>
      <div data-editor></div>
      <details class="draft-advanced">
        <summary>進階：貼上文字草稿</summary>
        <textarea class="day-text draft-text" rows="6" data-draft placeholder='{"name": "…", "start": "2026-10-24", …}'></textarea>
        <button type="button" class="btn btn-block" data-read>讀取文字草稿</button>
      </details>
      <datalist id="opt-location">${LOCATIONS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="opt-attire">${ATTIRES.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <div class="form-error" data-error hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-block btn-primary" data-create hidden>確認新增</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    const el = m.el;
    el.classList.add('modal-wide');
    el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const err = (msg) => { const b = el.querySelector('[data-error]'); b.textContent = msg; b.hidden = !msg; };
    const note = (html) => { el.querySelector('[data-ai-note]').innerHTML = html; };
    const createBtn = el.querySelector('[data-create]');
    // 成員名單（名字對照用）：打開視窗就先在背景讀
    const membersP = Api.admin('adminMembers', {}, true).then((r) => r.members || []).catch(() => []);
    let editor = null;

    async function showEditor(raw, msg) {
      const members = await membersP;
      const box = el.querySelector('[data-editor]');
      const fresh = box.cloneNode(false); // 換一個新的容器，舊的事件不會重複
      box.replaceWith(fresh);
      editor = DraftEditor.mount(fresh, raw, {
        members,
        onChange: saveDraft,
        onCount: (n) => {
          createBtn.hidden = !n;
          createBtn.textContent = `確認新增 ${n} 筆`;
          if (!n) saveDraft(null);
        }
      });
      if (msg) note(msg);
    }

    const last = savedDraft();
    if (last && last.items && last.items.length) {
      const t = new Date(last.at);
      showEditor(last.items, `<div class="notice" role="status"><p>這是剛才整理到一半的草稿（${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}），可以繼續修改。<button type="button" class="link-btn" data-clear>清除，重新開始</button></p></div>`)
        .then(() => {
          const c = el.querySelector('[data-clear]');
          if (c) c.addEventListener('click', () => { saveDraft(null); el.querySelector('[data-editor]').innerHTML = ''; note(''); createBtn.hidden = true; editor = null; });
        });
    }

    el.querySelector('[data-photo]').addEventListener('change', (ev) => {
      const files = [...ev.target.files];
      ev.target.value = '';
      fromPhotos(files);
    });
    // 電腦：截圖後 Ctrl+V 貼上，或把照片拖進視窗
    el.addEventListener('paste', (ev) => {
      const files = [...(ev.clipboardData ? ev.clipboardData.files : [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      ev.preventDefault();
      fromPhotos(files);
    });
    el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.classList.add('is-dragover'); });
    el.addEventListener('dragleave', (ev) => { if (ev.target === el) el.classList.remove('is-dragover'); });
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('is-dragover');
      fromPhotos([...ev.dataTransfer.files].filter((f) => /^image\//.test(f.type)));
    });

    async function fromPhotos(all) {
      const files = all.slice(0, 3);
      if (!files.length) return;
      err('');
      // 先顯示縮圖，確認選對照片
      el.querySelector('[data-thumbs]').innerHTML = files.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
      const started = Date.now();
      const tick = () => Busy.show('AI 正在讀照片⋯', `已經等了 ${Math.round((Date.now() - started) / 1000)} 秒（通常 10～30 秒），請不要關閉畫面`);
      tick();
      const timer = setInterval(tick, 1000);
      try {
        const images = await Promise.all(files.map(shrinkImage));
        const res = await Api.admin('adminDraftFromImages', { images, hint: el.querySelector('[data-hint]').value });
        clearInterval(timer);
        Busy.hide();
        await showEditor(res.duties, `<div class="notice notice-success" role="status"><p><strong>AI 整理好 ${res.duties.length} 筆（${Math.round((Date.now() - started) / 1000)} 秒）</strong></p><p>請看下面每一筆，有錯直接改；名字已自動對照成員名單。確認後按最下面的「確認新增」。</p></div>`);
      } catch (e) {
        clearInterval(timer);
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); AdminPage.guard(e); return; }
        err(e.message || 'AI 讀取失敗，請稍後再試');
      }
    }

    el.querySelector('[data-read]').addEventListener('click', () => {
      err('');
      let data;
      try {
        data = JSON.parse(el.querySelector('[data-draft]').value.trim());
      } catch (e) {
        return err('草稿格式不對，請確認整段都有貼到（從第一個 { 或 [ 到最後一個 } 或 ]）');
      }
      const list = Array.isArray(data) ? data : Array.isArray(data.duties) ? data.duties : [data];
      if (!list.length || list.some((d) => !d || !d.name)) return err('每一筆都要有 name（名稱）');
      el.querySelector('.draft-advanced').open = false;
      showEditor(list, `<div class="notice" role="status"><p>已讀取 ${list.length} 筆，請看下面每一筆，確認後按「確認新增」。</p></div>`);
    });

    createBtn.addEventListener('click', async () => {
      if (!editor || !editor.count) return;
      const problems = editor.errors();
      if (problems.length) return err(problems.join('；'));
      err('');
      const duties = editor.duties();
      Busy.show('新增中⋯');
      try {
        const res = await createDuties(duties);
        if (!res) { Busy.hide(); return; }
        Busy.hide();
        saveDraft(null);
        m.close();
        afterWrite();
        flash = AdminPage.notice('success', `已新增 ${res.ids.length} 筆${T()}`, duties.map((d) => d.name).join('、'));
        location.hash = res.ids.length === 1 ? '#/admin/duties/edit/' + encodeURIComponent(res.ids[0]) : '#/admin/duties';
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); AdminPage.guard(e); return; }
        err((e.message || '新增失敗') + ((e.details || []).length ? '：' + e.details.map((x) => x.message).join('；') : ''));
      }
    });
  }

  // ---------- 列表 ----------

  const listState = { filter: 'future', q: '' };

  function list(body, guard) {
    AdminPage.swr('dutyList', () => Api.admin('adminDutyList', {}, true), (data, stale) => renderList(body, data, stale), body);
  }

  function renderList(body, data, stale) {
    const months = [...new Set(data.duties.map((d) => d.start.slice(0, 7)))];
    const monthOptions = [['future', '今天以後'], ['past', '已過去（補登人員）'], ['all', '全部']].concat(months.map((m) => [m, rocMonth(m)]));
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${flash}
      <div class="admin-actions">
        <a class="btn btn-primary" href="#/admin/duties/new">＋ 新增${T()}</a>
        <a class="btn" href="#/admin/import">批次匯入</a>
        <button type="button" class="btn" data-draft-open>📷 從照片新增</button>
      </div>
      <div class="list-filter">
        <select class="input" data-filter aria-label="月份">
          ${monthOptions.map(([v, label]) => `<option value="${v}"${v === listState.filter ? ' selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
        <input class="input" type="search" data-q placeholder="搜尋${T()}名稱" value="${esc(listState.q)}">
      </div>
      <div data-rows></div>`;
    flash = '';

    const rows = body.querySelector('[data-rows]');
    function draw() {
      const q = listState.q.trim();
      const items = data.duties.filter((d) => {
        if (listState.filter === 'future' && d.end < data.today) return false;
        if (listState.filter === 'past' && d.end >= data.today) return false;
        if (/^\d{4}-\d{2}$/.test(listState.filter) && d.start.slice(0, 7) !== listState.filter) return false;
        return !q || d.name.indexOf(q) !== -1;
      });
      if (listState.filter === 'past') items.reverse(); // 已過去：最近的排最前面
      rows.innerHTML = items.length ? `
        <p class="muted">共 ${items.length} 筆${listState.filter === 'past' ? '・點進去就是報名名單，選日期後按「＋ 補登」加人' : ''}</p>
        <div class="card-list">
          ${items.map((d) => `
            <a class="duty-card${d.mode === '公告型' ? ' kind-notice' : ''}" href="${d.end < data.today && d.mode !== '公告型' ? `#/admin/duty/${encodeURIComponent(d.id)}?date=${d.end}` : `#/admin/duties/edit/${encodeURIComponent(d.id)}`}">
              <span class="card-main">
                <span class="card-title">${esc(d.name)}</span>
                <span class="card-meta">${esc([dateRange(d), d.startTime, d.location, d.group].filter(Boolean).join('・'))}</span>
              </span>
              <span class="badge ${d.mode === '公告型' ? 'badge-notice' : d.signups ? 'badge-ok' : 'badge-full'}">${d.mode === '公告型' ? '公告' : `${d.signups} 筆報名`}</span>
            </a>`).join('')}
        </div>` : `<p class="panel-empty">沒有符合的${T()}</p>`;
    }
    draw();
    body.querySelector('[data-filter]').addEventListener('change', (ev) => { listState.filter = ev.target.value; draw(); });
    body.querySelector('[data-draft-open]').addEventListener('click', openDraft);
    body.querySelector('[data-q]').addEventListener('input', (ev) => { listState.q = ev.target.value; draw(); });
  }

  // ---------- 表單 ----------

  /**
   * 新增或編輯。id：編輯的勤務；fromId：另存新勤務的範本。
   * 編輯與範本都先向伺服器讀原始資料（了愿項目的最少、最多照 Sheet 原樣）。
   */
  async function form(body, guard, opts) {
    const t = Date.now();
    form.token = t;
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let source = null;
    let groups = [];
    try {
      if (opts.id || opts.fromId) {
        source = await Api.admin('adminDutyForEdit', { id: opts.id || opts.fromId }, true);
        groups = source.groups;
      } else {
        const listData = await Api.admin('adminDutyList', {}, true);
        groups = listData.groups;
      }
    } catch (err) {
      guard(err, body);
      return;
    }
    if (form.token !== t) return;
    DutyForm(body, { editing: !!opts.id, source, groups, guard });
  }

  const CATEGORIES = ['勤務', '道務', '教育'];
  // 每個類別可選的性質（與 apps-script/DutyRules.gs 的 NATURES_BY_CATEGORY_ 相同）
  const NATURES_BY_CAT = { 勤務: ['勤務', '支援', '烹飪', '活動'], 道務: ['法會', '課程'], 教育: ['課程', '活動'] };
  // 道務、教育是自由參加的法會、課程、活動：沒有負責組、沒有了愿項目，只有名額（不限／限幾人）
  const isSimple = (cat) => cat === '道務' || cat === '教育';
  const DM_MAX = 5;
  const PDF_MAX_BYTES = 5 * 1024 * 1024;

  /** 勤務／道務／教育帳號固定是自己的類別；總管理者預設「勤務」 */
  function myCategory() {
    const role = Api.adminWho().role;
    return CATEGORIES.indexOf(role) !== -1 ? role : '勤務';
  }

  function emptyDuty() {
    return {
      name: '', nature: NATURES_BY_CAT[myCategory()][0], mode: '報名型', category: myCategory(), dm: [], start: '', end: '', startTime: '', endTime: '',
      location: '', groupType: '', group: '', attire: '', description: '', deadline: '', layout: '', stages: '',
      positions: [{ name: '', slot: '', min: '', max: '' }]
    };
  }

  function DutyForm(body, ctx) {
    const editing = ctx.editing;
    const original = ctx.source ? JSON.parse(JSON.stringify(ctx.source.duty)) : null;
    const s = ctx.source ? JSON.parse(JSON.stringify(ctx.source.duty)) : emptyDuty();
    if (!editing && ctx.source) {
      // 另存新勤務：不帶 ID、日期清空、了愿項目當作新的
      delete s.id;
      s.start = '';
      s.end = '';
      s.positions = s.positions.map((p) => ({ name: p.name, slot: p.slot, min: p.min, max: p.max }));
    }
    const st = {
      dateType: s.start && s.end && s.start !== s.end ? 'range' : 'single',
      lunar: { from: '', to: '', first: true, fifteenth: true, leap: true, prefix: true, groupMode: 'fixed', rotation: [], rotationStart: 0 }
    };
    const signupTotal = editing ? ctx.source.signups : 0;
    if (!Array.isArray(s.dm)) s.dm = [];
    // 表單用詞跟著這筆的類別：道務、教育叫「活動」
    const F = () => (isSimple(s.category) ? '活動' : T());
    // 名額（道務、教育）：用第一個了愿項目的「最多」；空白＝不限
    st.quotaMax = (s.positions[0] && s.positions[0].max) || '';
    st.quota = st.quotaMax ? 'limit' : 'none';
    const today = Fmt.toDateStr(new Date());

    function groupsOf(type) {
      return ctx.groups.filter((g) => g.type === type).map((g) => g.name);
    }

    function render() {
      const lunar = st.dateType === 'lunar';
      const isNotice = s.mode === '公告型';
      const simple = isSimple(s.category);
      const natures = NATURES_BY_CAT[s.category] || NATURES_BY_CAT['勤務'];
      if (natures.indexOf(s.nature) === -1) s.nature = natures[0];
      body.innerHTML = `
        <a class="back-link" href="#/admin/duties">‹ ${T()}管理</a>
        <h2 class="detail-title">${editing ? '編輯' + F() : ctx.source ? '另存成新' + F() : '新增' + F()}</h2>
        ${editing && signupTotal ? `<div class="notice notice-success"><p>這個${F()}已有 ${signupTotal} 筆報名。有人報名的項目不能刪除、有人報名的日期不能移出期間。</p></div>` : ''}
        <form class="admin-form" novalidate>
          <fieldset class="form-block">
            <legend>基本資料</legend>
            <label class="form-row"><span>名稱</span>
              <input class="input" name="name" value="${esc(s.name)}" placeholder="例：彌勒山志工輪值" required></label>
            ${lunar ? '<p class="hint">勾「名稱前面加上農曆日期」時，這裡只填後半段，例如「拜香輪值」。</p>' : ''}
            <div class="form-row"><span>類別</span>${Api.adminWho().role === '總管理者' ? segmented('category', CATEGORIES, s.category || '勤務') : `<strong>${esc(myCategory())}</strong>`}</div>
            <div class="form-row"><span>性質</span>${segmented('nature', natures, s.nature)}</div>
            <div class="form-row"><span>模式</span>${segmented('mode', ['報名型', '公告型'], s.mode)}</div>
            ${isNotice ? '<p class="hint">公告型：只顯示輪值組，不需報名、沒有了愿項目。</p>' : ''}
          </fieldset>

          <fieldset class="form-block">
            <legend>日期</legend>
            <div class="form-row"><span>日期型態</span>${segmented('dateType',
              editing ? [['single', '單日'], ['range', '連續多天']] : [['single', '單日'], ['range', '連續多天'], ['lunar', '農曆規則']], st.dateType)}</div>
            ${lunar ? lunarFields() : `
              <label class="form-row"><span>${st.dateType === 'range' ? '開始日' : '日期'}</span>
                <input class="input" type="date" name="start" value="${esc(s.start)}"></label>
              ${st.dateType === 'range' ? `<label class="form-row"><span>結束日</span>
                <input class="input" type="date" name="end" value="${esc(s.end)}"></label>` : ''}`}
            <label class="form-row"><span>報名截止日（可空白）</span>
              <input class="input" type="date" name="deadline" value="${esc(s.deadline || '')}"></label>
            <p class="hint">空白＝${F()}前一天都能報名。填了日期，過了那天網頁就不能再報名（管理者仍可補登）。</p>
          </fieldset>

          <fieldset class="form-block">
            <legend>時段與地點</legend>
            <div class="form-row form-row-pair">
              <label><span>開始時間</span><input class="input" type="time" name="startTime" value="${esc(s.startTime)}"></label>
              <label><span>結束時間</span><input class="input" type="time" name="endTime" value="${esc(s.endTime)}"></label>
            </div>
            <p class="hint">結束時間早於開始時間代表到隔天（例：21:00 – 08:00）。</p>
            <label class="form-row"><span>地點</span>
              <input class="input" name="location" list="opt-location" value="${esc(s.location)}"></label>
            <label class="form-row"><span>服裝</span>
              <input class="input" name="attire" list="opt-attire" value="${esc(s.attire)}"></label>
            <datalist id="opt-location">${LOCATIONS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
            <datalist id="opt-attire">${ATTIRES.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
          </fieldset>

          ${simple ? '' : `<fieldset class="form-block">
            <legend>負責組</legend>
            <label class="form-row"><span>分組類型</span>
              <select class="input" name="groupType">
                <option value="">（不指定）</option>
                ${GROUP_TYPES.map((x) => `<option${x === s.groupType ? ' selected' : ''}>${esc(x)}</option>`).join('')}
              </select></label>
            ${s.groupType ? (lunar ? rotationFields() : `
              <label class="form-row"><span>負責組</span>
                <select class="input" name="group">
                  <option value="">（不指定）</option>
                  ${groupsOf(s.groupType).map((x) => `<option${x === s.group ? ' selected' : ''}>${esc(x)}</option>`).join('')}
                </select></label>`) : ''}
          </fieldset>`}

          ${isNotice ? '' : simple ? `
          <fieldset class="form-block">
            <legend>名額</legend>
            ${segmented('quotaMode', [['none', '不限名額'], ['limit', '限定人數']], st.quota)}
            ${st.quota === 'limit' ? `<label class="form-row"><span>最多幾人</span><input class="input" name="quotaMax" inputmode="numeric" value="${esc(st.quotaMax)}" placeholder="例：30"></label>` : '<p class="hint">不限人數，大家都可以報名。</p>'}
          </fieldset>` : `
          <fieldset class="form-block">
            <legend>了愿項目與名額</legend>
            <p class="hint">「最少」留空預設 2 人；「最多」留空代表不限。</p>
            <label class="check"><input type="checkbox" name="multi"${s.multi === true || s.multi === '是' ? ' checked' : ''}> 同一人可以兼任多個了愿項目（同一天可報好幾項）</label>
            <ul class="pos-edit">
              ${s.positions.map((p, i) => `
                <li class="pos-row">
                  <label class="pos-name"><span>名稱</span><input class="input" data-pos="${i}" data-k="name" value="${esc(p.name)}" placeholder="例：志工"></label>
                  <label><span>時段</span><input class="input" data-pos="${i}" data-k="slot" value="${esc(p.slot)}" placeholder="可空白"></label>
                  <label><span>最少</span><input class="input" data-pos="${i}" data-k="min" value="${esc(p.min)}" inputmode="numeric" placeholder="2"></label>
                  <label><span>最多</span><input class="input" data-pos="${i}" data-k="max" value="${esc(p.max)}" inputmode="numeric" placeholder="不限"></label>
                  ${p.signups ? `<span class="pos-lock">已有 ${p.signups} 筆報名</span>` : `<button type="button" class="btn btn-small btn-quiet-danger" data-del-pos="${i}" aria-label="刪除這個了愿項目">刪除</button>`}
                </li>`).join('')}
            </ul>
            <button type="button" class="btn btn-small" data-add-pos>＋ 加一個了愿項目</button>
          </fieldset>

          <fieldset class="form-block">
            <legend>職司表（12人小組這類多天輪值）</legend>
            <label class="check"><input type="checkbox" name="layout"${s.layout === '職司表' ? ' checked' : ''}> 用職司表顯示：一欄一天、一列一個了愿項目，報名的人自動排進去</label>
            ${s.layout === '職司表' ? `<label class="form-row"><span>階段（留空會自動推算）</span><textarea class="input textarea" name="stages" rows="4" placeholder="一行一個，例：&#10;即日起~9/13｜向區中心報名了愿日期&#10;9/14~9/18｜職司初安排&#10;9/27~10/4｜12人小組輪值">${esc(s.stages || '')}</textarea></label>
            <p class="hint">家人們的頁面上方會顯示成進度條，自動亮起現在這個階段。${s.start ? `留空時依第一天自動推算：<br>${esc(RosterGrid.autoStages(s.start)).replace(/\n/g, '<br>')}` : '留空時會依第一天自動推算。'}<br>組長 ★ 和註記在報名名單上設定。</p>` : ''}
          </fieldset>`}

          <fieldset class="form-block">
            <legend>DM（照片或 PDF）</legend>
            <p class="hint">家人們打開這個${F()}就看得到。最多 ${DM_MAX} 個；照片會自動縮小，PDF 一個最大 5MB。</p>
            ${s.dm.length ? `<ul class="dm-edit">${s.dm.map((x, i) => `<li>${/^image\//.test(x.mime) ? `<img src="${esc(Api.fileUrl(x.id))}" alt="">` : '<span class="dm-pdf">PDF</span>'}<span class="dm-name">${esc(x.name || '')}</span><button type="button" class="btn btn-small btn-quiet-danger" data-dm-del="${i}">移除</button></li>`).join('')}</ul>` : ''}
            ${s.dm.length < DM_MAX ? '<label class="btn btn-block">＋ 加照片或 PDF<input type="file" accept="image/*,application/pdf" multiple hidden data-dm-file></label>' : ''}
          </fieldset>

          <fieldset class="form-block">
            <legend>說明</legend>
            <textarea class="input textarea" name="description" rows="4" placeholder="工作項目、注意事項⋯">${esc(s.description)}</textarea>
          </fieldset>

          ${lunar ? '<div data-preview></div>' : ''}
          <div class="form-error" data-error hidden></div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">${lunar ? '產生並預覽' : editing ? '存檔' : '新增' + F()}</button>
            ${editing ? `
              <a class="btn btn-block" href="#/admin/duties/new?from=${encodeURIComponent(s.id)}">另存成新${F()}</a>
              <a class="btn btn-block" href="#/admin/duty/${encodeURIComponent(s.id)}">查看報名名單</a>
              <button type="button" class="btn btn-block btn-quiet-danger" data-delete${signupTotal ? ' disabled' : ''}>刪除${F()}</button>
              ${signupTotal ? `<p class="hint">還有報名的${F()}不能刪除，要先取消或改期這些報名。</p>` : ''}` : ''}
          </div>
        </form>`;
      bind();
    }

    function segmented(name, options, value) {
      return `<div class="seg" role="radiogroup">${options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return `<label class="seg-item"><input type="radio" name="${name}" value="${esc(v)}"${v === value ? ' checked' : ''}><span>${esc(label)}</span></label>`;
      }).join('')}</div>`;
    }

    function lunarFields() {
      const l = st.lunar;
      return `
        <div class="form-row form-row-pair">
          <label><span>從（國曆）</span><input class="input" type="date" name="lunarFrom" value="${esc(l.from)}"></label>
          <label><span>到（國曆）</span><input class="input" type="date" name="lunarTo" value="${esc(l.to)}"></label>
        </div>
        <div class="checks">
          <label class="check"><input type="checkbox" name="lunarFirst"${l.first ? ' checked' : ''}> 初一</label>
          <label class="check"><input type="checkbox" name="lunarFifteenth"${l.fifteenth ? ' checked' : ''}> 十五</label>
          <label class="check"><input type="checkbox" name="lunarLeap"${l.leap ? ' checked' : ''}> 閏月也要</label>
          <label class="check"><input type="checkbox" name="lunarPrefix"${l.prefix ? ' checked' : ''}> 名稱前面加上農曆日期</label>
        </div>`;
    }

    function rotationFields() {
      const l = st.lunar;
      const names = groupsOf(s.groupType);
      if (!l.rotation.length) l.rotation = names.slice();
      return `
        <div class="form-row"><span>指定方式</span>${segmented('groupMode', [['fixed', '每次同一組'], ['rotate', '依序輪流']], l.groupMode)}</div>
        ${l.groupMode === 'fixed' ? `
          <label class="form-row"><span>負責組</span>
            <select class="input" name="group">
              <option value="">（不指定）</option>
              ${names.map((x) => `<option${x === s.group ? ' selected' : ''}>${esc(x)}</option>`).join('')}
            </select></label>` : `
          <div class="form-row"><span>參加輪流的組</span>
            <div class="checks">${names.map((x) => `<label class="check"><input type="checkbox" name="rotation" value="${esc(x)}"${l.rotation.indexOf(x) !== -1 ? ' checked' : ''}> ${esc(x)}</label>`).join('')}</div></div>
          <label class="form-row"><span>第一次由哪一組</span>
            <select class="input" name="rotationStart">
              ${l.rotation.map((x, i) => `<option value="${i}"${i === l.rotationStart ? ' selected' : ''}>${esc(x)}</option>`).join('')}
            </select></label>`}`;
    }

    /** 把畫面上的值讀回 s／st（重畫前呼叫，避免打的字不見） */
    function sync() {
      const f = body.querySelector('form');
      if (!f) return;
      const val = (n) => (f.elements[n] ? f.elements[n].value : undefined);
      ['name', 'startTime', 'endTime', 'location', 'attire', 'description', 'start', 'end', 'groupType', 'group', 'deadline', 'stages'].forEach((k) => {
        if (val(k) !== undefined) s[k] = val(k);
      });
      const radio = (n) => { const el = f.querySelector(`input[name="${n}"]:checked`); return el ? el.value : undefined; };
      if (radio('nature')) s.nature = radio('nature');
      if (radio('category')) s.category = radio('category');
      if (radio('quotaMode')) st.quota = radio('quotaMode');
      if (val('quotaMax') !== undefined) st.quotaMax = val('quotaMax');
      if (radio('mode')) s.mode = radio('mode');
      if (radio('dateType')) st.dateType = radio('dateType');
      if (radio('groupMode')) st.lunar.groupMode = radio('groupMode');
      if (f.elements.multi) s.multi = f.elements.multi.checked;
      if (f.elements.layout) s.layout = f.elements.layout.checked ? '職司表' : '';
      if (f.elements.lunarFrom) {
        st.lunar.from = val('lunarFrom');
        st.lunar.to = val('lunarTo');
        st.lunar.first = f.elements.lunarFirst.checked;
        st.lunar.fifteenth = f.elements.lunarFifteenth.checked;
        st.lunar.leap = f.elements.lunarLeap.checked;
        st.lunar.prefix = f.elements.lunarPrefix.checked;
      }
      if (f.querySelector('input[name="rotation"]')) {
        st.lunar.rotation = [...f.querySelectorAll('input[name="rotation"]:checked')].map((x) => x.value);
        st.lunar.rotationStart = Math.min(Number(val('rotationStart')) || 0, Math.max(st.lunar.rotation.length - 1, 0));
      }
      f.querySelectorAll('[data-pos]').forEach((el) => { s.positions[Number(el.dataset.pos)][el.dataset.k] = el.value; });
    }

    function bind() {
      const f = body.querySelector('form');
      // 會改變表單結構的選項：讀回目前的值後重畫
      f.addEventListener('change', (ev) => {
        const n = ev.target.name;
        if (['mode', 'dateType', 'groupType', 'groupMode', 'rotation', 'category', 'quotaMode', 'layout'].indexOf(n) === -1) return;
        sync();
        if (n === 'groupType') { s.group = ''; st.lunar.rotation = []; st.lunar.rotationStart = 0; }
        if (n === 'dateType' && st.dateType === 'range' && !s.end) s.end = s.start;
        render();
      });
      const dmFile = f.querySelector('[data-dm-file]');
      if (dmFile) dmFile.addEventListener('change', async (ev) => {
        const files = [...ev.target.files].slice(0, DM_MAX - s.dm.length);
        ev.target.value = '';
        if (!files.length) return;
        sync();
        Busy.show('上傳中⋯', '請不要關閉畫面');
        try {
          for (const file of files) {
            const isPdf = file.type === 'application/pdf';
            if (isPdf && file.size > PDF_MAX_BYTES) throw new Error(`「${file.name}」超過 5MB，請先壓縮`);
            const img = isPdf ? null : await shrinkImage(file);
            const data = isPdf ? await readBase64(file) : img.data;
            const res = await Api.admin('adminUploadFile', { mime: isPdf ? 'application/pdf' : img.mime, name: file.name, data });
            s.dm.push({ id: res.id, name: file.name, mime: isPdf ? 'application/pdf' : img.mime });
          }
          Busy.hide();
        } catch (e) {
          Busy.hide();
          if (e.code === 'UNAUTHORIZED') { ctx.guard(e); return; }
          alertError(e.message || '上傳失敗，請稍後再試');
        }
        render();
      });
      f.querySelectorAll('[data-dm-del]').forEach((b) => b.addEventListener('click', () => { sync(); s.dm.splice(Number(b.dataset.dmDel), 1); render(); }));
      function alertError(msg) { const box = f.querySelector('[data-error]'); box.textContent = msg; box.hidden = false; }
      const add = f.querySelector('[data-add-pos]');
      if (add) add.addEventListener('click', () => {
        sync();
        s.positions.push({ name: '', slot: '', min: '', max: '' });
        render();
        const inputs = body.querySelectorAll('[data-k="name"]');
        inputs[inputs.length - 1].focus();
      });
      f.querySelectorAll('[data-del-pos]').forEach((b) => b.addEventListener('click', () => {
        sync();
        s.positions.splice(Number(b.dataset.delPos), 1);
        render();
      }));
      const del = f.querySelector('[data-delete]');
      if (del) del.addEventListener('click', removeDuty);
      f.addEventListener('submit', (ev) => {
        ev.preventDefault();
        sync();
        if (st.dateType === 'lunar') previewLunar();
        else save();
      });
    }

    function showError(html) {
      const box = body.querySelector('[data-error]');
      box.innerHTML = html;
      box.hidden = false;
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /** 送給伺服器的勤務資料 */
    function payload(overrides) {
      const out = {
        name: s.name, nature: s.nature, mode: s.mode, category: s.category || myCategory(),
        start: s.start, end: st.dateType === 'range' ? s.end : s.start,
        startTime: s.startTime, endTime: s.endTime, location: s.location,
        groupType: isSimple(s.category) ? '' : s.groupType, group: !isSimple(s.category) && s.groupType ? s.group : '', attire: s.attire, description: s.description, deadline: s.deadline || '',
        dm: s.dm,
        layout: s.mode === '公告型' || isSimple(s.category) ? '' : (s.layout || ''),
        stages: s.mode === '公告型' || isSimple(s.category) || s.layout !== '職司表' ? '' : (s.stages || ''),
        multi: s.mode === '公告型' ? false : !!(s.multi === true || s.multi === '是'),
        positions: s.mode === '公告型' ? [] : isSimple(s.category)
          ? [{ id: s.positions[0] && s.positions[0].id, name: (s.positions[0] && s.positions[0].name) || '參加', slot: '', min: '0', max: st.quota === 'limit' ? String(st.quotaMax || '').trim() : '' }]
          : s.positions.filter((p) => p.id || p.name.trim() || p.min || p.max)
          .map((p) => ({ id: p.id, name: p.name, slot: p.slot, min: p.min, max: p.max }))
      };
      return Object.assign(out, overrides);
    }

    function errorList(err) {
      return `<strong>${esc(err.message)}</strong>${(err.details || []).length
        ? '<br>' + err.details.map((d) => esc(d.message)).join('<br>') : ''}`;
    }

    // ---- 單日／多天：存檔 ----

    async function save() {
      if (!s.start) return showError('請選日期');
      if (!editing) {
        Busy.show('新增中⋯');
        try {
          const res = await createDuties([payload()]);
          if (!res) { Busy.hide(); return; }
          Busy.hide();
          afterWrite();
          flash = AdminPage.notice('success', '已新增' + F(), `${s.name}・${Fmt.rocDate(s.start)}`);
          location.hash = '#/admin/duties/edit/' + encodeURIComponent(res.ids[0]);
        } catch (err) {
          Busy.hide();
          if (!ctx.guard(err)) showError(errorList(err));
        }
        return;
      }
      const bulk = await askBulk();
      if (bulk === null) return;
      Busy.show('存檔中⋯');
      try {
        const res = await Api.admin('adminUpdateDuty', Object.assign({ id: s.id, duty: payload() }, bulk));
        Busy.hide();
        afterWrite();
        const warn = res.warnings.length ? `<p>注意：${res.warnings.map(esc).join('；')}</p>` : '';
        flash = `<div class="notice notice-success" role="status"><p><strong>已存檔${res.updated > 1 ? `（連同其他 ${res.updated - 1} 筆同名${F()}）` : ''}</strong></p>${warn}</div>`;
        DutyAdminPage.reload();
      } catch (err) {
        Busy.hide();
        if (!ctx.guard(err)) showError(errorList(err));
      }
    }

    /** 和原本比，改了哪些可以一起套用的欄位 */
    function changedFields() {
      const now = payload();
      const o = original;
      const posKey = (ps) => JSON.stringify(ps.map((p) => [p.id || '', p.name.trim(), String(p.slot || '').trim(), String(p.min || '').trim(), String(p.max || '').trim()]));
      const changed = {
        name: now.name.trim() !== o.name,
        nature: now.nature !== o.nature,
        mode: now.mode !== o.mode,
        time: now.startTime !== o.startTime || now.endTime !== o.endTime,
        location: now.location.trim() !== o.location,
        group: now.groupType !== o.groupType || now.group !== o.group,
        attire: now.attire.trim() !== o.attire,
        description: now.description.trim() !== o.description,
        positions: posKey(now.positions) !== posKey(o.positions)
      };
      return BULK_FIELDS.filter(([k]) => changed[k]);
    }

    /**
     * 有其他同名勤務（今天以後）且改了可套用的欄位時，問要不要一起改。
     * 回傳 {}（只改這筆）、{ alsoIds, fields }（一起改）、null（返回不存）。
     */
    function askBulk() {
      const siblings = ctx.source.siblings.filter((x) => x.end >= today);
      const fields = changedFields();
      if (!siblings.length || !fields.length) return Promise.resolve({});
      return new Promise((resolve) => {
        let result = null;
        const m = Modal.open(`
          <h2 class="modal-title">也套用到其他同名${F()}嗎？</h2>
          <p class="modal-note">日期不會改。勾選要一起改的欄位和${F()}：</p>
          <div class="checks checks-col">${fields.map(([k, label]) => `<label class="check"><input type="checkbox" data-field="${k}" checked> ${esc(label)}</label>`).join('')}</div>
          <div class="bulk-list">
            <label class="check"><input type="checkbox" data-all checked> <strong>全選（${siblings.length} 筆）</strong></label>
            ${siblings.map((x) => `<label class="check"><input type="checkbox" data-sib="${esc(x.id)}" checked> ${esc(Fmt.shortDate(x.start))} ${esc(x.name)}${x.location ? '・' + esc(x.location) : ''}</label>`).join('')}
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-block btn-primary" data-both>一起套用</button>
            <button type="button" class="btn btn-block" data-only>只存這一筆</button>
            <button type="button" class="btn btn-block btn-ghost" data-back>返回修改</button>
          </div>`, () => resolve(result));
        const el = m.el;
        const sibs = () => [...el.querySelectorAll('[data-sib]')];
        const updateLabel = () => {
          const n = sibs().filter((x) => x.checked).length;
          el.querySelector('[data-both]').textContent = n ? `一起套用（另外 ${n} 筆）` : '一起套用';
        };
        el.querySelector('[data-all]').addEventListener('change', (ev) => { sibs().forEach((x) => { x.checked = ev.target.checked; }); updateLabel(); });
        sibs().forEach((x) => x.addEventListener('change', updateLabel));
        updateLabel();
        el.querySelector('[data-both]').addEventListener('click', () => {
          const alsoIds = sibs().filter((x) => x.checked).map((x) => x.dataset.sib);
          const chosen = [...el.querySelectorAll('[data-field]:checked')].map((x) => x.dataset.field);
          result = alsoIds.length && chosen.length ? { alsoIds, fields: chosen } : {};
          m.close();
        });
        el.querySelector('[data-only]').addEventListener('click', () => { result = {}; m.close(); });
        el.querySelector('[data-back]').addEventListener('click', () => m.close());
      });
    }

    async function removeDuty() {
      const ok = await Confirm.open({
        title: `確定要刪除這個${F()}嗎？`,
        rows: [[F(), s.name], ['日期', dateRange({ start: original.start, end: original.end })]],
        note: '刪除後無法還原（操作紀錄會留下刪除前的資料）。',
        confirmText: '確定刪除',
        cancelText: '不要刪除',
        danger: true
      });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try {
        await Api.admin('adminDeleteDuty', { id: s.id });
        Busy.hide();
        afterWrite();
        flash = AdminPage.notice('success', '已刪除' + F(), `${original.name}・${Fmt.rocDate(original.start)}`);
        location.hash = '#/admin/duties';
      } catch (err) {
        Busy.hide();
        if (!ctx.guard(err)) showError(errorList(err));
      }
    }

    // ---- 農曆規則：產生、預覽、建立 ----

    /** 依農曆規則列出日期與名稱、負責組 */
    function lunarItems() {
      const l = st.lunar;
      if (!l.from || !l.to) return { error: '請選起訖日期' };
      if (l.to < l.from) return { error: '「到」不能早於「從」' };
      const dates = Fmt.datesBetween(l.from, l.to);
      if (dates.length > MAX_LUNAR_DAYS) return { error: '日期範圍太長（最多約兩年）' };
      if (!l.first && !l.fifteenth) return { error: '請勾「初一」或「十五」' };
      if (s.groupType && l.groupMode === 'rotate' && !l.rotation.length) return { error: '請勾選參加輪流的組' };
      const items = [];
      dates.forEach((date) => {
        const lu = LunarUtil.lunarOf(date);
        if (!((l.first && lu.isFirst) || (l.fifteenth && lu.isFifteenth))) return;
        if (!l.leap && lu.month.charAt(0) === '閏') return;
        items.push({ date, lunar: lu.full, name: (l.prefix ? lu.full : '') + s.name.trim() });
      });
      items.forEach((it, i) => {
        it.group = !s.groupType ? '' : l.groupMode === 'rotate'
          ? l.rotation[(l.rotationStart + i) % l.rotation.length] : s.group;
      });
      return { items };
    }

    function previewLunar() {
      if (!s.name.trim()) return showError('請填名稱');
      const r = lunarItems();
      const box = body.querySelector('[data-preview]');
      if (r.error) { box.innerHTML = ''; return showError(esc(r.error)); }
      body.querySelector('[data-error]').hidden = true;
      if (!r.items.length) { box.innerHTML = '<div class="notice notice-error"><p>這段期間沒有符合的日期</p></div>'; return; }
      box.innerHTML = `
        <section class="lunar-preview">
          <h3 class="admin-sub">將建立 ${r.items.length} 筆${T()}</h3>
          <ol class="preview-list">${r.items.map((it) => `
            <li><span class="preview-date">${esc(Fmt.rocDate(it.date))}</span>
              <span>${esc(it.name)}</span>${it.group ? `<span class="tag">${esc(it.group)}</span>` : ''}</li>`).join('')}
          </ol>
          <button type="button" class="btn btn-primary btn-block" data-create>確定建立 ${r.items.length} 筆</button>
        </section>`;
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      box.querySelector('[data-create]').addEventListener('click', () => createLunar(r.items));
    }

    async function createLunar(items) {
      Busy.show(`建立 ${items.length} 筆${T()}中⋯`, '請不要關閉畫面');
      try {
        const duties = items.map((it) => payload({ name: it.name, start: it.date, end: it.date, group: it.group }));
        const res = await createDuties(duties);
        if (!res) { Busy.hide(); return; }
        Busy.hide();
        afterWrite();
        flash = AdminPage.notice('success', `已新增 ${res.ids.length} 筆${T()}`, `${items[0].name} 等，${Fmt.rocDate(items[0].date)} – ${Fmt.rocDate(items[items.length - 1].date)}`);
        listState.filter = 'future';
        location.hash = '#/admin/duties';
      } catch (err) {
        Busy.hide();
        if (ctx.guard(err)) return;
        // 錯誤附 index：換成日期，方便看是哪一筆
        if (err.details) err.details = err.details.map((d) => ({ message: (items[d.index] ? Fmt.shortDate(items[d.index].date) + '：' : '') + d.message }));
        showError(errorList(err));
      }
    }

    render();
  }

  // ---------- 路由 ----------

  let current = null;

  /** sub：admin/ 後面的部分（duties、duties/new、duties/new?from=ID、duties/edit/ID） */
  function show(body, guard, sub) {
    current = { body, guard, sub };
    const edit = sub.match(/^duties\/edit\/([^?]+)/);
    if (edit) return form(body, guard, { id: decodeURIComponent(edit[1]) }).then(showFlash);
    const neu = sub.match(/^duties\/new(?:\?from=([^&]+))?/);
    if (neu) return form(body, guard, { fromId: neu[1] ? decodeURIComponent(neu[1]) : '' });
    return list(body, guard);
  }

  /** 存檔或新增後回到編輯頁時，把結果訊息放在最上面 */
  function showFlash() {
    if (!flash) return;
    const title = current.body.querySelector('.detail-title');
    if (title) title.insertAdjacentHTML('afterend', flash);
    flash = '';
  }

  function reload() {
    if (current) show(current.body, current.guard, current.sub);
  }

  window.DutyAdminPage = { show, reload, createDuties, setFlash: (html) => { flash = html; } };
})();
