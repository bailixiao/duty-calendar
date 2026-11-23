// 管理後台：成員名單管理（#/admin/members）、分組管理（#/admin/groups）。規格第 8 節管理者後台第 7 項。
// 成員不刪除，改用「停用」。分組改名時，勤務的負責組與成員的組別會一併更新。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const GROUP_TYPES = ['勤務了愿組', '打掃組', '拜香輪值組'];
  let flash = '';

  function notice(html) {
    flash = html;
  }

  function errorHtml(err) {
    return `<strong>${esc(err.message || '發生錯誤')}</strong>${(err.details || []).length ? '<br>' + err.details.map((d) => esc(d.message)).join('<br>') : ''}`;
  }

  /** 對話框裡的表單：送出時呼叫 onSubmit(form)，成功就關閉；失敗把錯誤顯示在框內 */
  function formModal(html, onSubmit, guard, extra) {
    const m = Modal.open(`<form class="modal-form" novalidate>${html}
      <div class="form-error" data-error hidden></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-block btn-primary">存檔</button>
        ${extra || ''}
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div></form>`);
    const f = m.el.querySelector('form');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const showErr = (err) => {
      const box = f.querySelector('[data-error]');
      box.innerHTML = errorHtml(err);
      box.hidden = false;
      box.scrollIntoView({ block: 'center' });
    };
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      m.el.setAttribute('data-locked', '');
      Busy.show('存檔中⋯');
      try {
        await onSubmit(f);
        Busy.hide();
        m.close();
      } catch (err) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        showErr(err);
      }
    });
    return { m, f, showErr };
  }

  function afterWrite(reload) {
    AdminPage.clearMemo();
    if (window.CalendarPage) CalendarPage.refresh();
    reload();
  }

  /**
   * 匯入成員資料（2026/11/22 起可以選檔案）：Excel、Word（.docx）、PDF，或貼上從 Excel 複製的表格、Claude 整理的文字。
   * 自動找出姓名、佛堂、年齡（出生年）、身分、清口、國外（MemberFile.detect），對錯了可以自己改；
   * 依名字（或別名）幫成員補上有給的欄位，不會清掉原本的資料。檔案只在瀏覽器裡讀，不會上傳。
   */
  function importMembers(guard, reload) {
    const md = Modal.open(`
      <h2 class="modal-title">📋 匯入成員資料</h2>
      <p class="modal-note">選 <strong>Excel、Word、PDF</strong> 檔，或把表格貼在下面，會自動找出<strong>姓名、佛堂、年齡（出生年、生日）、身分、清口、國外、父母、學校、興趣</strong>，依名字幫成員補上。只更新有給的欄位，不會清掉原本的資料。</p>
      <label class="btn btn-block">📂 選檔案（Excel、Word、PDF，可以好幾個）<input type="file" accept=".xlsx,.xls,.xlsm,.csv,.ods,.docx,.doc,.pdf" multiple hidden data-file></label>
      <details class="import-paste"><summary>或貼上表格／文字</summary>
        <textarea class="input day-text" rows="6" data-text placeholder="從 Excel 複製整張表貼上（第一列是標題：姓名、佛堂、年齡⋯），或貼上 Claude 整理的文字"></textarea>
        <button type="button" class="btn btn-small" data-read-text>讀這段文字</button>
      </details>
      <p class="hint">檔案只在這台手機／電腦上讀，不會上傳。掃描成圖片的 PDF 讀不到字，請改用 Excel／Word。</p>
      <div data-sources></div>
      <div data-out></div>
      <label class="check" data-add-row hidden><input type="checkbox" data-add> 名單上找不到的，直接新增成員</label>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-go disabled>確定匯入</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    const el = md.el;
    let sources = []; // { label, rows, det }
    let items = [];
    let done = false;
    el.querySelector('[data-close]').addEventListener('click', () => md.close());
    const out = el.querySelector('[data-out]');
    const srcBox = el.querySelector('[data-sources]');
    const known = () => new Set(memberList.flatMap((m) => [m.name].concat(m.aliases || [])));
    const FIELD_LABEL = { name: '姓名', temple: '佛堂', age: '年齡', birth: '出生年', identity: '身分', vegetarian: '清口', overseas: '國外', parents: '父母', parents2: '父母（另一欄）', school: '學校', interest: '興趣' };
    const show = (it) => [it.temple, it.age ? it.age + ' 歲' : (it.birthYear ? it.birthYear + ' 年生' : ''), it.birthday ? '生日 ' + Number(it.birthday.slice(0, 2)) + '/' + Number(it.birthday.slice(3)) : '', it.identity, it.vegetarian ? '清口' : '', it.overseas, it.parents ? '父母：' + it.parents.join('、') : '', it.school, it.interest].filter(Boolean).join('・');

    function paint() {
      items = [];
      srcBox.innerHTML = sources.map((src, si) => {
        if (!src.det) return `<div class="import-src"><h3>${esc(src.label)}</h3><p class="form-error">找不到姓名那一欄。請確認第一列有「姓名」標題，或改用貼上。</p></div>`;
        const list = MemberFile.toItems(src.rows, src.det, { overseas: (window.SITE && SITE.overseas) || undefined });
        items = items.concat(list);
        const opts = (k) => `<option value="">（沒有）</option>${src.det.headers.map((h, c) => `<option value="${c}"${src.det.map[k] === c ? ' selected' : ''}>${esc(h)}</option>`).join('')}`;
        return `<div class="import-src">
          <h3>${esc(src.label)}：讀到 ${list.length} 位</h3>
          <div class="import-map">${MemberFile.FIELD_KEYS.map((k) => `<label><span>${FIELD_LABEL[k]}</span><select class="input" data-map="${si}:${k}">${opts(k)}</select></label>`).join('')}</div>
          <p class="hint">自動對的欄位，不對可以改。</p>
        </div>`;
      }).join('');
      if (!sources.length) { out.innerHTML = ''; el.querySelector('[data-go]').disabled = true; return; }
      const k = known();
      const miss = items.filter((x) => !k.has(x.name));
      const useful = items.filter((x) => Object.keys(x).length > 1).length;
      out.innerHTML = items.length ? `<p>共 ${items.length} 位：名單上找得到 ${items.length - miss.length} 位${miss.length ? `，<strong>找不到 ${miss.length} 位</strong>` : ''}；有資料可以補的 ${useful} 位。</p>
        <div class="import-preview"><table><thead><tr><th>姓名</th><th>會補上</th></tr></thead><tbody>${items.slice(0, 30).map((x) => `<tr class="${k.has(x.name) ? '' : 'is-miss'}"><td>${esc(x.name)}${k.has(x.name) ? '' : '<small>找不到</small>'}</td><td>${esc(show(x)) || '<span class="muted">（沒有資料）</span>'}</td></tr>`).join('')}</tbody></table>
        ${items.length > 30 ? `<p class="hint">只列前 30 位，其他 ${items.length - 30} 位一起匯入。</p>` : ''}</div>` : '<p class="form-error">沒有讀到名字。</p>';
      el.querySelector('[data-add-row]').hidden = !miss.length;
      el.querySelector('[data-go]').disabled = !items.length || done;
      done = false;
    }
    srcBox.addEventListener('change', (ev) => {
      const t = ev.target.closest('[data-map]');
      if (!t) return;
      const [si, key] = t.dataset.map.split(':');
      const det = sources[Number(si)].det;
      if (t.value === '') delete det.map[key]; else det.map[key] = Number(t.value);
      if (key === 'age' && t.value !== '') delete det.map.birth;
      if (key === 'birth' && t.value !== '') delete det.map.age;
      paint();
    });
    const addRows = (label, rows) => sources.push({ label, rows, det: MemberFile.detect(rows) });
    el.querySelector('[data-file]').addEventListener('change', async (ev) => {
      const files = [...ev.target.files];
      ev.target.value = '';
      if (!files.length) return;
      Busy.show('讀檔中⋯');
      const errs = [];
      for (const f of files) {
        try { (await MemberFile.readFile(f)).forEach((x) => addRows(x.label, x.rows)); } catch (e) { errs.push(e.message || String(e)); }
      }
      Busy.hide();
      paint();
      if (errs.length) out.insertAdjacentHTML('afterbegin', `<p class="form-error">${errs.map(esc).join('<br>')}</p>`);
    });
    el.querySelector('[data-read-text]').addEventListener('click', () => {
      const text = el.querySelector('[data-text]').value.trim();
      if (!text) return;
      // Claude 整理的 JSON：直接用
      if (/^\s*\{/.test(text)) {
        try {
          const j = JSON.parse(text);
          if (!j || !Array.isArray(j.items) || !j.items.length) throw new Error('找不到 items');
          const rows = [['姓名', '佛堂', '年齡', '出生年', '身分', '清口', '國外']].concat(j.items.map((x) => [x.name, x.temple || '', x.age == null ? '' : x.age, x.birthYear || '', x.identity || '', x.vegetarian ? '是' : '', x.overseas || '']));
          addRows('貼上的文字', rows);
        } catch (e) {
          out.innerHTML = `<p class="form-error">看不懂這段文字：${esc(e.message || '')}。請確認整段都有貼上。</p>`;
          return;
        }
      } else addRows('貼上的表格', MemberFile.textToRows(text));
      el.querySelector('[data-text]').value = '';
      paint();
    });
    el.querySelector('[data-go]').addEventListener('click', async () => {
      if (!items.length) return;
      Busy.show('匯入中⋯');
      try {
        const res = await Api.admin('adminImportMembers', { items, addMissing: el.querySelector('[data-add]').checked });
        Busy.hide();
        out.innerHTML = `<div class="notice notice-success" role="status"><p><strong>✅ 匯入完成</strong>：更新 ${res.updated.length} 位${res.added.length ? `、新增 ${res.added.length} 位` : ''}</p>
          ${res.missing.length ? `<p>找不到（沒改）：${esc(res.missing.join('、'))}</p>` : ''}
          ${res.ambiguous.length ? `<p>同名好幾位、分不出來（沒改）：${esc(res.ambiguous.join('、'))}</p>` : ''}</div>`;
        el.querySelector('[data-go]').disabled = true;
        done = true;
        AdminPage.clearMemo();
        el.querySelector('[data-close]').addEventListener('click', () => reload(), { once: true });
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        out.innerHTML = `<p class="form-error">${errorHtml(err)}</p>`;
      }
    });
  }

  /** 合併成同一人：選另一位、選主要名字（真名），另一位的名字變成別名，報名紀錄一起改名 */
  function mergeMembers(m, guard, reload) {
    const others = memberList.filter((x) => x.row !== m.row);
    const md = Modal.open(`
      <h2 class="modal-title">👥 「${esc(m.name)}」和誰是同一人？</h2>
      <p class="modal-note">例如一個是小名、一個是真名。合併後只留一位，另一個名字變成別名，以前的報名紀錄也會改成同一個名字。</p>
      <label class="form-row"><span>打名字找另一位</span><input class="input" data-q placeholder="打名字或別名"></label>
      <div class="suggestions" data-list></div>
      <div data-pick hidden>
        <p><strong>主要名字要用哪一個？</strong>（請選<strong>真名</strong>）</p>
        <div class="merge-choice" data-choice></div>
        <button type="button" class="btn btn-primary btn-block" data-go>合併</button>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-block" data-close>返回</button></div>`);
    const el = md.el;
    let other = null;
    el.querySelector('[data-close]').addEventListener('click', () => md.close());
    const near = others.filter((x) => Fmt.sameName(x.name, m.name)).slice(0, 6);
    const drawList = (list) => {
      el.querySelector('[data-list]').innerHTML = list.map((x) => `<button type="button" class="suggestion" data-row="${x.row}">${esc(x.name)}${x.temple ? `<small>${esc(x.temple)}</small>` : ''}${x.identity ? `<small>${esc(x.identity)}</small>` : ''}</button>`).join('');
    };
    drawList(near);
    el.querySelector('[data-q]').addEventListener('input', (ev) => {
      const q = ev.target.value.replace(/[\s　]+/g, '');
      drawList(q ? others.filter((x) => x.name.indexOf(q) !== -1 || (x.aliases || []).some((a) => a.indexOf(q) !== -1)).slice(0, 10) : near);
    });
    el.querySelector('[data-list]').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-row]');
      if (!b) return;
      other = others.find((x) => x.row === Number(b.dataset.row));
      const desc = (x) => [x.identity, x.temple, x.age !== '' && x.age !== undefined ? x.age + ' 歲' : ''].filter(Boolean).join('・');
      el.querySelector('[data-choice]').innerHTML = [m, other].map((x, i) => `<label class="check merge-opt"><input type="radio" name="keep" value="${x.row}"${i === 0 ? ' checked' : ''}> <span><strong>${esc(x.name)}</strong>${desc(x) ? `<small>${esc(desc(x))}</small>` : ''}</span></label>`).join('');
      el.querySelector('[data-pick]').hidden = false;
    });
    el.querySelector('[data-go]').addEventListener('click', async () => {
      if (!other) return;
      const keepRow = Number(el.querySelector('[name=keep]:checked').value);
      const keep = keepRow === m.row ? m : other;
      const drop = keep === m ? other : m;
      md.close();
      if (!(await Confirm.open({ title: '確定合併成同一人嗎？', rows: [['主要名字', keep.name], ['變成別名', drop.name]], note: '「' + drop.name + '」以前的報名紀錄會改成「' + keep.name + '」，名單上只留「' + keep.name + '」。', confirmText: '確定合併' }))) return;
      Busy.show('合併中⋯');
      try {
        const res = await Api.admin('adminMergeMembers', { keep: { row: keep.row, original: keep.name }, drop: { row: drop.row, original: drop.name } });
        Busy.hide();
        notice(AdminPage.notice('success', '已合併成同一人', `「${drop.name}」變成「${keep.name}」的別名${res.changed ? `，報名紀錄改了 ${res.changed} 筆` : ''}`));
        afterWrite(reload);
      } catch (err) {
        Busy.hide();
        if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      }
    });
  }

  /** 合併佛堂：同一個佛堂有兩種寫法，把其中一個全部改成另一個（成員、報名紀錄一起改） */
  function mergeTemple(list, guard, reload) {
    const count = (t) => list.filter((m) => m.temple === t).length;
    const opts = (sel) => templeOptions.map((t) => `<option value="${esc(t)}"${t === sel ? ' selected' : ''}>${esc(t)}（${count(t)} 位）</option>`).join('');
    const md = Modal.open(`
      <h2 class="modal-title">🏠 合併佛堂</h2>
      <p class="modal-note">同一個佛堂有兩種寫法時用。上面那個佛堂的成員和報名紀錄，會全部改成下面那個。</p>
      <label class="form-row"><span>要改掉的寫法</span><select class="input" data-from><option value="">（請選）</option>${opts('')}</select></label>
      <label class="form-row"><span>改成（留下這個）</span><select class="input" data-to><option value="">（請選）</option>${opts('')}</select></label>
      <div class="form-error" data-error hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-block btn-primary" data-go>合併</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    const el = md.el;
    el.querySelector('[data-close]').addEventListener('click', () => md.close());
    el.querySelector('[data-go]').addEventListener('click', async () => {
      const from = el.querySelector('[data-from]').value;
      const to = el.querySelector('[data-to]').value;
      const err = el.querySelector('[data-error]');
      if (!from || !to || from === to) { err.textContent = !from || !to ? '請選兩個佛堂' : '兩個佛堂一樣，不用合併'; err.hidden = false; return; }
      md.close();
      if (!(await Confirm.open({ title: '確定合併佛堂嗎？', rows: [['改掉', from], ['改成', to]], note: `「${from}」的 ${count(from)} 位成員和他們的報名紀錄，都會改成「${to}」。`, confirmText: '確定合併' }))) return;
      Busy.show('合併中⋯');
      try {
        const res = await Api.admin('adminMergeTemple', { from, to });
        Busy.hide();
        notice(AdminPage.notice('success', '佛堂已合併', `「${from}」改成「${to}」：成員 ${res.members} 位、報名紀錄 ${res.signups} 筆${res.goals ? `。道務目標還有「${from}」，請到道務目標頁刪掉或改名` : ''}`));
        afterWrite(reload);
      } catch (e) {
        Busy.hide();
        if (!guard(e)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(e)}</p></div>`); reload(); }
      }
    });
  }

  /** 可以編輯成員、分組的帳號：總管理者、道務、教育 */
  function canEditPeople() {
    return ['總管理者', '道務', '教育'].indexOf(Api.adminWho().role) !== -1;
  }

  // ---------- 成員 ----------

  const memberState = { q: '', filter: 'active', identity: 'all', missing: '' };
  // 還沒填的資料（2026/11/22）：後台人員整理成員用
  const MISSING = [['temple', '沒填佛堂', (m) => !m.temple], ['age', '沒填年齡', (m) => m.age === '' || m.age === undefined || m.age === null], ['identity', '沒填身分', (m) => !m.identity]];
  const missingOf = (m) => MISSING.filter(([, , f]) => f(m));
  const IDENTITY_ORDER = [['點傳師', '點傳師'], ['壇辦', '壇辦'], ['道親', '道親'], ['未求道', '未求道'], ['', '未填身分']];
  const SHORT = {}; // 篩選按鈕的短名稱（2026/11/22 起「未填身分」寫完整，才不會以為是沒填佛堂、年齡）

  function members(body, guard) {
    const reload = () => members(body, guard);
    AdminPage.swr('members', () => Api.admin('adminMembers', {}, true), (data, stale) => renderMembers(body, guard, data, stale, reload), body);
  }

  let templeOptions = []; // 佛堂選項（各佛堂道務目標的佛堂）
  let memberList = []; // 合併成同一人時選另一位用

  function renderMembers(body, guard, data, stale, reload) {
    templeOptions = data.temples || [];
    memberList = data.members;
    const counts = { active: data.members.filter((m) => m.active).length };
    counts.inactive = data.members.length - counts.active;
    const pendingList = data.members.filter((m) => m.pending);
    const isSuper = canEditPeople(); // 總管理者、道務、教育帳號可以編輯成員
    if (memberState.filter === 'pending' && !pendingList.length) memberState.filter = 'active';
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${flash}
      ${pendingList.length ? `<div class="notice pending-banner" role="status"><p>🆕 <strong>有 ${pendingList.length} 位新成員待確認</strong>（報名時自動加入的新名字）</p>${memberState.filter === 'pending' ? '<p class="muted">確認每一位：沒問題按「保留」；要改身分、佛堂、分組按「修改」（存檔就算保留）；其實是名單上的某人（寫法不同）按「合併到⋯」；打錯或不需要的按「刪除」。</p>' : '<button type="button" class="btn btn-primary" data-show-pending>查看待確認的人</button>'}</div>` : ''}
      ${canEditPeople() ? '<div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增成員</button><button type="button" class="btn" data-from-signups>從出勤紀錄加入成員</button><button type="button" class="btn" data-import-members>📋 匯入成員資料</button><button type="button" class="btn" data-same-name>👥 同名的舊紀錄</button><button type="button" class="btn" data-merge-temple>🏠 合併佛堂</button></div>' : ''}
      <div class="list-filter">
        <select class="input" data-filter aria-label="狀態">
          ${pendingList.length ? `<option value="pending"${memberState.filter === 'pending' ? ' selected' : ''}>🆕 待確認（${pendingList.length}）</option>` : ''}
          <option value="active"${memberState.filter === 'active' ? ' selected' : ''}>啟用中（${counts.active}）</option>
          <option value="inactive"${memberState.filter === 'inactive' ? ' selected' : ''}>已停用（${counts.inactive}）</option>
          <option value="all"${memberState.filter === 'all' ? ' selected' : ''}>全部（${data.members.length}）</option>
        </select>
        <select class="input" data-missing aria-label="還沒填的資料">
          <option value="">資料：全部</option>
          ${MISSING.map(([k, label, f]) => `<option value="${k}"${memberState.missing === k ? ' selected' : ''}>${label}（${data.members.filter((m) => m.active && f(m)).length}）</option>`).join('')}
          <option value="any"${memberState.missing === 'any' ? ' selected' : ''}>有任何一項沒填（${data.members.filter((m) => m.active && missingOf(m).length).length}）</option>
        </select>
        <input class="input" type="search" data-q placeholder="搜尋姓名、${esc(window.SITE.temple)}或組別" value="${esc(memberState.q)}">
      </div>
      <div class="seg identity-filter" data-identity-filter></div>
      <div data-rows></div>
      <p class="hint">停用的成員不會出現在報名的名字提示裡；過去的報名紀錄不受影響。改名也不會改到過去的報名紀錄。</p>`;
    flash = '';
    const rows = body.querySelector('[data-rows]');
    const fam = Family.generations(data.members);
    const famTags = (m) => { const f = fam.get(m); const st = Family.schoolStage(m.birthYear, data.today); return (f && f.label ? `<span class="tag tag-gen">${esc(f.label)}</span>` : '') + (st ? `<span class="tag tag-stage">${esc(st.label)}</span>` : ''); };
    const card = (m) => `
          <li><button type="button" class="person-card${m.active ? '' : ' is-inactive'}" data-row="${m.row}">
            <span class="person-card-name">${esc(m.name)}${m.aliases && m.aliases.length ? `<small class="person-alias">（${esc(m.aliases.join('、'))}）</small>` : ''}${m.temple ? `<span class="tag tag-temple">${esc(m.temple)}</span>` : ''}${m.overseas ? `<span class="tag tag-temple">🌏 ${esc(m.overseas)}</span>` : ''}
              ${m.identity ? `<span class="tag">${esc(m.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
              ${m.active ? '' : '<span class="tag">已停用</span>'}${m.pending ? '<span class="tag tag-warn">待確認</span>' : ''}${m.identity === '道親' && m.vegetarian ? '<span class="tag">🥬 清口</span>' : ''}${m.age !== '' && m.age !== undefined ? `<span class="tag">${m.age} 歲</span>` : ''}${m.birthday ? `<span class="tag">🎂 ${Number(m.birthday.slice(0, 2))}/${Number(m.birthday.slice(3))}</span>` : ''}${famTags(m)}${memberState.missing ? missingOf(m).filter(([k]) => k !== 'identity').map(([, label]) => `<span class="tag tag-warn">${label.replace('沒填', '未填')}</span>`).join('') : ''}</span>
            <span class="person-card-meta">${esc(GROUP_TYPES.filter((t) => m.groups[t]).map((t) => `${t.replace('組', '')}：${m.groups[t]}`).join('・') || '未分組')}${m.note ? '・' + esc(m.note) : ''}</span>
          </button></li>`;
    function draw() {
      const q = memberState.q.trim();
      if (memberState.filter === 'pending') { drawPending(q); return; }
      const base = data.members.filter((m) => {
        if (memberState.filter === 'active' && !m.active) return false;
        if (memberState.filter === 'inactive' && m.active) return false;
        if (memberState.missing === 'any' ? !missingOf(m).length : (memberState.missing && !MISSING.find(([k]) => k === memberState.missing)[2](m))) return false;
        return !q || m.name.indexOf(q) !== -1 || (m.aliases || []).some((a) => a.indexOf(q) !== -1) || (m.temple || '').indexOf(q) !== -1 || GROUP_TYPES.some((t) => (m.groups[t] || '').indexOf(q) !== -1);
      });
      base.sort((a, b) => Fmt.byStroke(a.name, b.name)); // 姓的筆劃少到多
      // 身分分類：按鈕附人數；選「全部」時分段列出
      const of = (id) => base.filter((m) => (m.identity || '') === id);
      const seg = body.querySelector('[data-identity-filter]');
      seg.innerHTML = [['all', '全部', base.length]].concat(IDENTITY_ORDER.map(([id, label]) => [id || 'none', label, of(id).length]))
        .map(([v, label, n]) => `<label class="seg-item"><input type="radio" name="idf" value="${v}"${memberState.identity === v ? ' checked' : ''}><span>${SHORT[label] || label} ${n}</span></label>`).join('');
      seg.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => { memberState.identity = r.value; draw(); }));
      if (memberState.identity === 'all') {
        const sections = IDENTITY_ORDER.map(([id, label]) => [label, of(id)]).filter(([, list]) => list.length);
        rows.innerHTML = base.length ? sections.map(([label, list]) => `
          <section class="admin-day">
            <h2 class="admin-day-title">${esc(label)}<span class="h2-sub">${list.length} 人</span></h2>
            <ul class="people-list">${list.map(card).join('')}</ul>
          </section>`).join('') : '<p class="panel-empty">沒有符合的成員</p>';
        return;
      }
      const items = of(memberState.identity === 'none' ? '' : memberState.identity);
      rows.innerHTML = items.length ? `
        <p class="muted">共 ${items.length} 人</p>
        <ul class="people-list">${items.map(card).join('')}</ul>` : '<p class="panel-empty">沒有符合的成員</p>';
    }
    // 待確認：每人「保留」「合併到⋯」「刪除」，上面有「全部保留」
    function drawPending(q) {
      body.querySelector('[data-identity-filter]').innerHTML = '';
      const list = pendingList.filter((m) => !q || m.name.indexOf(q) !== -1).sort((a, b) => Fmt.byStroke(a.name, b.name));
      const sure = data.members.filter((m) => !m.pending);
      rows.innerHTML = list.length ? `
        ${isSuper ? '<div class="admin-actions"><button type="button" class="btn" data-confirm-all>✅ 全部保留（' + list.length + ' 位）</button></div>' : ''}
        <ul class="pending-list">${list.map((m) => {
          const near = sure.filter((x) => Fmt.sameName(x.name, m.name)).slice(0, 3);
          return `<li class="pending-item">
            <div><strong>${esc(m.name)}</strong> ${m.identity ? `<span class="tag">${esc(m.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
              <span class="muted">${esc(m.note || '')}</span>
              ${near.length ? `<p class="pending-near">名單上相近的名字：${near.map((x) => esc(x.name)).join('、')}</p>` : ''}</div>
            ${isSuper ? `<div class="pending-actions">
              <button type="button" class="btn btn-small btn-primary" data-keep="${m.row}">✅ 保留</button>
              <button type="button" class="btn btn-small" data-edit-pending="${m.row}">✏️ 修改</button>
              <button type="button" class="btn btn-small" data-merge="${m.row}">🔀 合併到⋯</button>
              <button type="button" class="btn btn-small btn-quiet-danger" data-drop="${m.row}">🗑 刪除</button>
            </div>` : ''}
          </li>`;
        }).join('')}</ul>` : '<p class="panel-empty">沒有符合的人</p>';
      const find = (row) => data.members.find((m) => m.row === Number(row));
      const all = rows.querySelector('[data-confirm-all]');
      if (all) all.addEventListener('click', () => run('adminConfirmMembers', { rows: list.map((m) => ({ row: m.row, original: m.name })) }, `已保留 ${list.length} 位`));
      // 保留＝一按就確認；修改＝打開編輯視窗（身分、佛堂、分組⋯），存檔也算確認
      rows.querySelectorAll('[data-keep]').forEach((b) => b.addEventListener('click', () => { const m = find(b.dataset.keep); run('adminConfirmMembers', { rows: [{ row: m.row, original: m.name }] }, '已保留「' + m.name + '」'); }));
      rows.querySelectorAll('[data-edit-pending]').forEach((b) => b.addEventListener('click', () => editMember(find(b.dataset.editPending), data.groups, guard, reload)));
      rows.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', async () => {
        const m = find(b.dataset.drop);
        if (!(await Confirm.open({ title: '確定刪除「' + m.name + '」嗎？', rows: [['姓名', m.name]], note: '只從成員名單移除，出勤紀錄保留。', confirmText: '刪除', danger: true }))) return;
        run('adminDeleteMember', { row: m.row, original: m.name }, '已刪除「' + m.name + '」');
      }));
      rows.querySelectorAll('[data-merge]').forEach((b) => b.addEventListener('click', () => mergePending(find(b.dataset.merge), sure)));
    }
    async function run(action, payload, okText) {
      Busy.show('處理中⋯');
      try {
        await Api.admin(action, payload);
        Busy.hide();
        notice(AdminPage.notice('success', okText, ''));
        afterWrite(reload);
      } catch (err) {
        Busy.hide();
        if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      }
    }
    function mergePending(m, sure) {
      const near = sure.filter((x) => Fmt.sameName(x.name, m.name)).slice(0, 6);
      const md = Modal.open(`
        <h2 class="modal-title">「${esc(m.name)}」合併到⋯</h2>
        <p class="modal-note">選成員名單上的正確寫法。${esc(m.name)} 的報名紀錄會改成那個名字，然後從名單刪掉「${esc(m.name)}」。</p>
        ${near.length ? `<p>相近的名字：</p><div class="suggestions">${near.map((x) => `<button type="button" class="suggestion" data-to="${esc(x.name)}">${esc(x.name)}${x.identity ? '（' + esc(x.identity) + '）' : ''}</button>`).join('')}</div>` : ''}
        <label class="form-row"><span>或打名字找</span><input class="input" data-q-to placeholder="打名單上的名字"></label>
        <div class="suggestions" data-to-list></div>
        <div class="modal-actions"><button type="button" class="btn btn-block" data-close>返回</button></div>`);
      md.el.querySelector('[data-close]').addEventListener('click', () => md.close());
      const pick = async (to) => {
        md.close();
        if (!(await Confirm.open({ title: '確定合併嗎？', rows: [['新名字', m.name], ['合併到', to]], confirmText: '確定合併' }))) return;
        run('adminMergePendingMember', { row: m.row, original: m.name, to }, `已把「${m.name}」合併到「${to}」`);
      };
      md.el.addEventListener('click', (ev) => { const t = ev.target.closest('[data-to]'); if (t) pick(t.dataset.to); });
      md.el.querySelector('[data-q-to]').addEventListener('input', (ev) => {
        const v = ev.target.value.replace(/[\s　]+/g, '');
        md.el.querySelector('[data-to-list]').innerHTML = v ? sure.filter((x) => x.name.indexOf(v) !== -1).slice(0, 10).map((x) => `<button type="button" class="suggestion" data-to="${esc(x.name)}">${esc(x.name)}</button>`).join('') : '';
      });
    }
    draw();
    const sp = body.querySelector('[data-show-pending]');
    if (sp) sp.addEventListener('click', () => { memberState.filter = 'pending'; renderMembers(body, guard, data, false, reload); });
    body.querySelector('[data-filter]').addEventListener('change', (ev) => { memberState.filter = ev.target.value; renderMembers(body, guard, data, false, reload); });
    body.querySelector('[data-missing]').addEventListener('change', (ev) => { memberState.missing = ev.target.value; draw(); });
    body.querySelector('[data-q]').addEventListener('input', (ev) => { memberState.q = ev.target.value; draw(); });
    if (canEditPeople()) {
      body.querySelector('[data-add]').addEventListener('click', () => editMember(null, data.groups, guard, reload));
      body.querySelector('[data-from-signups]').addEventListener('click', () => fromSignups(guard, reload));
      body.querySelector('[data-import-members]').addEventListener('click', () => importMembers(guard, reload));
      body.querySelector('[data-same-name]').addEventListener('click', () => sameNameSignups(guard));
      body.querySelector('[data-merge-temple]').addEventListener('click', () => mergeTemple(data.members, guard, reload));
    }
    rows.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-row]');
      if (!canEditPeople()) return; // 總管理者、道務、教育帳號能改成員
      if (b) editMember(data.members.find((m) => m.row === Number(b.dataset.row)), data.groups, guard, reload);
    });
  }

  function editMember(m, groups, guard, reload) {
    const v = m || { name: '', identity: '', groups: {}, note: '', active: true };
    const seg = (name, options, value) => `<div class="seg">${options.map(([val, label]) =>
      `<label class="seg-item"><input type="radio" name="${name}" value="${val}"${val === value ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>`;
    const canDelete = m && !m.active; // 已停用的才能刪除
    const { m: modal } = formModal(`
      <h2 class="modal-title">${m ? '編輯成員' : '新增成員'}</h2>
      <label class="form-row"><span>姓名（請用真名）</span><input class="input" name="name" value="${esc(v.name)}" required></label>
      <label class="form-row"><span>別名（小名、其他寫法，用「、」分開；報名打別名會記成這位）</span><input class="input" name="aliases" value="${esc((v.aliases || []).join('、'))}" placeholder="例：小明、阿明"></label>
      <label class="form-row"><span>${esc(window.SITE.temple)}（同名同姓時用來分；不知道可以空著）</span><select class="input" name="temple"><option value="">（不知道／空白）</option>${templeOptions.concat(v.temple && templeOptions.indexOf(v.temple) === -1 ? [v.temple] : []).map((t) => `<option${t === v.temple ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      ${(window.SITE.overseas || []).length ? `<div class="form-row"><span>國外（在國外的人選；台灣的選「台灣」）</span>${seg('overseas', [['', '台灣']].concat(window.SITE.overseas.map((o) => [o, o])), v.overseas || '')}</div>` : ''}
      <div class="form-row"><span>身分</span>${seg('identity', [['道親', '道親'], ['壇辦', '壇辦'], ['未求道', '未求道'], ['點傳師', '點傳師'], ['', '未填']], v.identity || '')}</div>
      ${GROUP_TYPES.map((t) => `
        <label class="form-row"><span>${t}</span>
          <select class="input" name="g-${t}">
            <option value="">（無）</option>
            ${groups.filter((g) => g.type === t).map((g) => `<option${g.name === v.groups[t] ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select></label>`).join('')}
      <div class="form-grid-2">
        <label class="form-row"><span>年齡（選填，今年幾歲；之後每年自動加一歲）</span><input class="input" name="age" inputmode="numeric" maxlength="3" value="${esc(v.age === undefined ? '' : v.age)}" placeholder="例：45"></label>
        <label class="form-row"><span>生日（選填，月/日）</span><input class="input" name="birthday" inputmode="numeric" maxlength="5" value="${esc(v.birthday ? Number(v.birthday.slice(0, 2)) + '/' + Number(v.birthday.slice(3)) : '')}" placeholder="例：3/7"></label>
      </div>
      <label class="check" data-veg-row${(v.identity || '') === '道親' ? '' : ' hidden'}><input type="checkbox" name="vegetarian"${v.vegetarian ? ' checked' : ''}> 🥬 已清口</label>
      <fieldset class="form-block family-block">
        <legend>👨‍👩‍👧 家人（道二代、道三代）</legend>
        <label class="form-row"><span>父母（成員名單上的爸爸、媽媽，用「、」分開）</span><input class="input" name="parents" value="${esc((v.parents || []).join('、'))}" placeholder="打一兩個字會出現名單"></label>
        <p class="family-auto" data-family-auto></p>
        <label class="form-row"><span>學校（選填）</span><input class="input" name="school" maxlength="50" value="${esc(v.school || '')}" placeholder="例：某某國小"></label>
        <label class="form-row"><span>興趣、其他（選填）</span><input class="input" name="interest" maxlength="200" value="${esc(v.interest || '')}" placeholder="例：畫畫、打鼓、喜歡幫忙"></label>
      </fieldset>
      <label class="form-row"><span>備註</span><input class="input" name="note" value="${esc(v.note)}"></label>
      <label class="check"><input type="checkbox" name="active"${v.active ? ' checked' : ''}> 啟用中（取消勾選＝停用）</label>`,
    async (f) => {
      const g = {};
      GROUP_TYPES.forEach((t) => { g[t] = f.elements['g-' + t].value; });
      await Api.admin('adminSaveMember', {
        row: m ? m.row : undefined, original: m ? m.name : undefined,
        member: { name: f.elements.name.value, identity: f.querySelector('input[name=identity]:checked').value, groups: g, note: f.elements.note.value, active: f.elements.active.checked,
          age: f.elements.age.value.trim(), birthday: f.elements.birthday.value.trim(), temple: f.elements.temple.value, parents: f.elements.parents.value, school: f.elements.school.value, interest: f.elements.interest.value, aliases: f.elements.aliases.value, overseas: f.querySelector('input[name=overseas]:checked') ? f.querySelector('input[name=overseas]:checked').value : undefined, vegetarian: f.querySelector('input[name=identity]:checked').value === '道親' && f.elements.vegetarian.checked }
      });
      notice(AdminPage.notice('success', m ? '已存檔' : '已新增成員', f.elements.name.value.trim()));
      afterWrite(reload);
    }, guard, (m ? '<button type="button" class="btn btn-block" data-merge-member>👥 這個人和另一位是同一人</button>' : '') + (canDelete ? '<button type="button" class="btn btn-block btn-quiet-danger" data-delete-member>刪除這位成員</button>'
      : (m ? '<p class="hint">要刪除成員，請先取消勾選「啟用中」存檔（停用），再回來刪除。</p>' : '')));

    modal.el.querySelectorAll('input[name=identity]').forEach((r) => r.addEventListener('change', () => { modal.el.querySelector('[data-veg-row]').hidden = r.value !== '道親' || !r.checked; }));
    // 家人：父母連動成員名單；學齡、第幾代、子女自動算
    const ef = modal.el.querySelector('form');
    MemberSuggest.attach(ef.elements.parents, { multi: true });
    const autoFamily = () => familyAutoText(m, ef.elements.age.value.trim(), ef.elements.parents.value, ef.querySelector('input[name=identity]:checked'));
    const paintAuto = () => { modal.el.querySelector('[data-family-auto]').innerHTML = autoFamily(); };
    ['age', 'parents'].forEach((n) => ef.elements[n].addEventListener('input', paintAuto));
    ef.elements.parents.addEventListener('change', paintAuto);
    paintAuto();
    // 選了佛堂、勤務了愿組還空著：照同佛堂的人帶入（2026/11/22，後端存檔時也會帶）
    const tgSel = ef.elements['g-勤務了愿組'];
    if (tgSel) ef.elements.temple.addEventListener('change', () => {
      const g = templeGroupOf(ef.elements.temple.value, m);
      const note = modal.el.querySelector('[data-tg-note]') || (() => { const p = document.createElement('p'); p.className = 'hint'; p.setAttribute('data-tg-note', ''); tgSel.closest('.form-row').after(p); return p; })();
      if (g && !tgSel.value && [...tgSel.options].some((o) => o.value === g)) { tgSel.value = g; note.textContent = `已依佛堂帶入「${g}」（同佛堂的人都是這一組），不對可以改。`; }
      else note.textContent = '';
    });
    const mg = modal.el.querySelector('[data-merge-member]');
    if (mg) mg.addEventListener('click', () => { modal.close(); mergeMembers(m, guard, reload); });
    const del = modal.el.querySelector('[data-delete-member]');
    if (del) del.addEventListener('click', async () => {
      modal.close();
      const ok = await Confirm.open({
        title: '確定要刪除這位成員嗎？',
        rows: [['姓名', m.name], ['身分', m.identity || '未填']],
        note: '只會從成員名單移除，過去的出勤紀錄與統計不受影響。',
        confirmText: '確定刪除', cancelText: '不要刪除', danger: true
      });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try {
        await Api.admin('adminDeleteMember', { row: m.row, original: m.name });
        Busy.hide();
        notice(AdminPage.notice('success', '已刪除成員', m.name));
        afterWrite(reload);
      } catch (err) {
        Busy.hide();
        if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      }
    });
  }

  /**
   * 從出勤紀錄加入成員：列出報名紀錄裡有、成員名單還沒有的人，勾選後一次加入。
   *   1. 疑似同一人（出勤紀錄裡的不同寫法，例如「小明」「王小明」）：選統一成哪個寫法或各自保留
   *   2. 和現有成員名字相近的：選併入那位成員、加為新成員，或先不加
   *   3. 新成員清單：依上面的選擇即時更新，勾選後加入
   * 送出時先把報名紀錄裡的舊寫法改成統一的名字（統計才不會算成兩個人），再加入成員。
   */
  /** 同名的舊報名紀錄：佛堂系統上線前沒記佛堂，指給正確的那位 */
  async function sameNameSignups(guard) {
    Busy.show('讀取中⋯');
    let data;
    try { data = await Api.admin('adminSameNameSignups'); Busy.hide(); } catch (err) { Busy.hide(); if (guard(err)) return; alert(err.message || '讀取失敗'); return; }
    const items = data.items || [];
    const total = items.reduce((n, g) => n + g.signups.length, 0);
    const opts = (temples) => '<option value="">（先不改）</option>' + temples.map((t) => `<option>${esc(t)}</option>`).join('');
    const md = Modal.open(`
      <h2 class="modal-title">👥 同名的舊紀錄</h2>
      <p class="modal-note">${total ? `成員名單上有同名不同佛堂的人，這 ${total} 筆報名沒有記佛堂，次數會算在一起。每筆選是哪個佛堂的那位（不確定的先不改）。` : '目前沒有需要整理的同名舊紀錄 🙏'}</p>
      <div class="same-name-list">${items.map((g, gi) => `
        <div class="same-name-group"><h3>${esc(g.name)}<small class="muted">（${g.signups.length} 筆；${g.temples.map(esc).join('、')}）</small></h3>
          <label class="same-name-row"><span>這個名字全部選：</span><select class="input" data-all="${gi}">${opts(g.temples)}</select></label>
          ${g.signups.map((s) => `<label class="same-name-row"><span>${esc(Fmt.rocDate(s.date))}　${esc(s.duty)}</span><select class="input" data-sid="${esc(s.id)}" data-g="${gi}">${opts(g.temples)}</select></label>`).join('')}
        </div>`).join('')}</div>
      <div class="modal-actions">
        ${total ? '<button type="button" class="btn btn-primary btn-block" data-save>儲存</button>' : ''}
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    md.el.querySelector('[data-close]').addEventListener('click', () => md.close());
    md.el.querySelectorAll('[data-all]').forEach((sel) => sel.addEventListener('change', () => {
      md.el.querySelectorAll(`[data-g="${sel.dataset.all}"]`).forEach((x) => { x.value = sel.value; });
    }));
    const sv = md.el.querySelector('[data-save]');
    if (sv) sv.addEventListener('click', async () => {
      const list = [...md.el.querySelectorAll('[data-sid]')].filter((x) => x.value).map((x) => ({ id: x.dataset.sid, temple: x.value }));
      if (!list.length) { md.close(); return; }
      Busy.show('儲存中⋯');
      try {
        const res = await Api.admin('adminAssignSignupTemple', { items: list });
        Busy.hide();
        AdminPage.clearMemo();
        md.close();
        alert(`已更新 ${res.updated} 筆 ✓`);
      } catch (err) { Busy.hide(); if (guard(err)) return; alert(err.message || '儲存失敗'); }
    });
  }

  async function fromSignups(guard, reload) {
    Busy.show('讀取出勤紀錄中⋯');
    let list;
    try {
      list = (await Api.admin('adminMemberCandidates', {}, true)).candidates;
      Busy.hide();
    } catch (err) {
      Busy.hide();
      if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      return;
    }
    if (!list.length) {
      const m0 = Modal.open('<h2 class="modal-title">出勤紀錄裡的人都已經在成員名單了</h2><div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>');
      m0.el.querySelector('[data-close]').addEventListener('click', () => m0.close());
      return;
    }

    const byName = new Map(list.map((c) => [c.name, c]));
    // 1. 出勤紀錄裡的疑似同一人（只看和現有成員不像的人）
    const free = list.filter((c) => !c.similar.length);
    const groups = HistoryParse.similarGroups(free.flatMap((c) => Array(c.count).fill(c.name)));
    const groupChoice = groups.map((g) => g.suggest); // 統一成的寫法；'' 各自保留
    // 2. 和現有成員相近的：'' 先不加、'new' 加為新成員、其他＝併入的成員姓名
    const near = list.filter((c) => c.similar.length);
    const nearChoice = near.map(() => '');
    const unchecked = new Set(); // 新成員清單中取消勾選的

    /** 依目前的選擇算出要加入的新成員 */
    function newMembers() {
      const merged = new Map(); // 被併掉的寫法 → 統一的寫法
      groups.forEach((g, gi) => {
        const to = groupChoice[gi];
        if (to) g.names.forEach((n) => { if (n.name !== to) merged.set(n.name, to); });
      });
      const out = new Map();
      free.forEach((c) => {
        const name = merged.get(c.name) || c.name;
        const v = out.get(name) || { name, count: 0, identity: '' };
        v.count += c.count;
        v.identity = v.identity || (byName.get(name) || c).identity || c.identity;
        out.set(name, v);
      });
      near.forEach((c, i) => { if (nearChoice[i] === 'new') out.set(c.name, { name: c.name, temple: c.temple || '', count: c.count, identity: c.identity }); });
      return [...out.values()].sort((a, b) => Fmt.byStroke(a.name, b.name));
    }

    const m = Modal.open(`
      <h2 class="modal-title">從出勤紀錄加入成員</h2>
      <p class="modal-note">有 ${list.length} 個名字出現在出勤紀錄、但還不是成員。身分照紀錄裡最常出現的。</p>
      ${groups.length ? `
        <h3 class="modal-sub">疑似同一人（${groups.length} 組）</h3>
        <p class="modal-note">同一個人有不同寫法時，選要統一成哪個；出勤紀錄裡的舊寫法也會一起改掉。</p>
        <div class="bulk-list">${groups.map((g, gi) => `<div class="merge-group">
          ${g.names.map((n) => `<label class="check"><input type="radio" name="sg${gi}" value="${esc(n.name)}"${groupChoice[gi] === n.name ? ' checked' : ''}> 統一成「${esc(n.name)}」（${n.count} 次）</label>`).join('')}
          <label class="check"><input type="radio" name="sg${gi}" value=""${!groupChoice[gi] ? ' checked' : ''}> 各自保留</label>
        </div>`).join('')}</div>` : ''}
      ${near.length ? `
        <h3 class="modal-sub">可能已經是成員（${near.length} 位）</h3>
        <div class="bulk-list">${near.map((c, i) => `<div class="merge-group">
          <strong>${esc(c.name)}</strong> <span class="muted">出勤 ${c.count} 次</span>
          ${c.similar.map((s) => `<label class="check"><input type="radio" name="nr${i}" value="${esc(s)}"> 就是成員「${esc(s)}」（出勤紀錄改成這個名字）</label>`).join('')}
          <label class="check"><input type="radio" name="nr${i}" value="new"> 不同人，加為新成員</label>
          <label class="check"><input type="radio" name="nr${i}" value="" checked> 先不處理</label>
        </div>`).join('')}</div>` : ''}
      <h3 class="modal-sub" data-new-title>要加入的新成員</h3>
      <div class="bulk-list" data-new></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-block btn-primary" data-go>加入</button>
        <button type="button" class="btn btn-block btn-quiet-danger" data-clear>清掉沒勾的名字⋯</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    const el = m.el;

    function drawNew() {
      const items = newMembers();
      el.querySelector('[data-new-title]').textContent = `要加入的新成員（${items.length} 位）`;
      el.querySelector('[data-new]').innerHTML = items.length ? items.map((c) => `<label class="check cand"><input type="checkbox" data-new-name="${esc(c.name)}"${unchecked.has(c.name) ? '' : ' checked'}>
        <span><strong>${esc(c.name)}</strong> <span class="muted">${esc(c.identity || '未填身分')}・出勤 ${c.count} 次</span></span></label>`).join('') : '<p class="muted">沒有要加入的人</p>';
      el.querySelectorAll('[data-new-name]').forEach((b) => b.addEventListener('change', () => {
        if (b.checked) unchecked.delete(b.dataset.newName); else unchecked.add(b.dataset.newName);
        updateButton();
      }));
      updateButton();
    }

    function merges() {
      const out = [];
      groups.forEach((g, gi) => {
        const to = groupChoice[gi];
        const from = to ? g.names.map((n) => n.name).filter((n) => n !== to) : [];
        if (from.length) out.push({ from, to });
      });
      near.forEach((c, i) => { if (nearChoice[i] && nearChoice[i] !== 'new') out.push({ from: [c.name], to: nearChoice[i] }); });
      return out;
    }

    function chosenMembers() {
      return newMembers().filter((c) => !unchecked.has(c.name)).map((c) => ({ name: c.name, identity: c.identity, temple: c.temple || '' }));
    }

    function updateButton() {
      const n = chosenMembers().length;
      const k = merges().length;
      el.querySelector('[data-go]').textContent = [n ? `加入 ${n} 位` : '', k ? `合併 ${k} 組寫法` : ''].filter(Boolean).join('、') || '沒有要處理的';
    }

    groups.forEach((g, gi) => el.querySelectorAll(`input[name="sg${gi}"]`).forEach((r) => r.addEventListener('change', () => { groupChoice[gi] = r.value; drawNew(); })));
    near.forEach((c, i) => el.querySelectorAll(`input[name="nr${i}"]`).forEach((r) => r.addEventListener('change', () => { nearChoice[i] = r.value; drawNew(); })));
    el.querySelector('[data-close]').addEventListener('click', () => m.close());
    el.querySelector('[data-clear]').addEventListener('click', () => {
      // 沒勾、也沒有要合併的名字
      const keep = new Set(chosenMembers().map((c) => c.name));
      merges().forEach((g) => g.from.forEach((n) => keep.add(n)));
      const rest = list.map((c) => c.name).filter((n) => !keep.has(n));
      if (!rest.length) return;
      m.close();
      clearNames(rest, guard, reload);
    });
    drawNew();

    el.querySelector('[data-go]').addEventListener('click', async () => {
      const members = chosenMembers();
      const mg = merges();
      if (!members.length && !mg.length) return;
      el.setAttribute('data-locked', '');
      try {
        let changed = 0;
        if (mg.length) {
          Busy.show('合併同一人的寫法中⋯');
          changed = (await Api.admin('adminMergeNames', { merges: mg })).changed;
        }
        // 同一場重複的（例如兩種寫法記在同一場）伺服器已自動只留一筆
        let added = 0;
        if (members.length) {
          Busy.show(`加入 ${members.length} 位成員中⋯`);
          added = (await Api.admin('adminAddMembers', { members })).added;
        }
        Busy.hide();
        m.close();
        notice(AdminPage.notice('success', [added ? `已加入 ${added} 位成員` : '', mg.length ? `已合併 ${mg.length} 組寫法（改了 ${changed} 筆出勤紀錄）` : ''].filter(Boolean).join('，'), added ? '可以點名字補上分組、備註。' : ''));
        afterWrite(reload);
      } catch (err) {
        Busy.hide();
        el.removeAttribute('data-locked');
        m.close();
        if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      }
    });
  }

  /** 清掉出勤紀錄裡的怪名字：只是不再列出，或連出勤紀錄一起取消 */
  function clearNames(names, guard, reload) {
    const m = Modal.open(`
      <h2 class="modal-title">清掉這 ${names.length} 個名字</h2>
      <div class="bulk-list"><p>${names.map(esc).join('、')}</p></div>
      <div class="checks checks-col">
        <label class="check"><input type="radio" name="how" value="hide" checked> 只是不要再列出（出勤紀錄保留，統計照算）</label>
        <label class="check"><input type="radio" name="how" value="cancel"> 連出勤紀錄一起取消（統計不再算這些名字）</label>
      </div>
      <p class="modal-note">取消的出勤紀錄不會刪除，會標成「已取消」，需要時可在試算表「報名」分頁改回「有效」。</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-block btn-danger" data-ok>確定清掉</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-ok]').addEventListener('click', async () => {
      const cancelSignups = m.el.querySelector('input[name=how]:checked').value === 'cancel';
      m.el.setAttribute('data-locked', '');
      Busy.show('清除中⋯');
      try {
        const res = await Api.admin('adminClearCandidates', { names, cancelSignups });
        Busy.hide();
        m.close();
        notice(AdminPage.notice('success', `已清掉 ${res.ignored} 個名字`, cancelSignups ? `取消了 ${res.cancelled} 筆出勤紀錄` : '出勤紀錄保留，之後不會再列出'));
        afterWrite(reload);
      } catch (err) {
        Busy.hide();
        m.close();
        if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      }
    });
  }

  // ---------- 分組 ----------

  function groups(body, guard) {
    const reload = () => groups(body, guard);
    AdminPage.swr('groups', () => Api.admin('adminGroups', {}, true), (data, stale) => renderGroups(body, guard, data, stale, reload), body);
  }

  function renderGroups(body, guard, data, stale, reload) {
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${flash}
      ${canEditPeople() ? '<div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增分組</button><button type="button" class="btn" data-assign>📋 依名單設定組別</button></div>' : ''}
      ${GROUP_TYPES.map((t) => {
        const items = data.groups.filter((g) => g.type === t);
        return `
          <section class="admin-day">
            <h2 class="admin-day-title">${esc(t)}<span class="h2-sub">${items.length} 組・近一年共負責 ${items.reduce((n, g) => n + (g.year || []).length, 0)} 筆</span></h2>
            <ul class="people-list">${items.map((g) => `
              <li><button type="button" class="person-card" data-row="${g.row}">
                <span class="person-card-name">${esc(g.name)}<span class="tag">近一年負責 ${(g.year || []).length} 筆</span>${g.upcoming ? `<span class="tag">之後還有 ${g.upcoming} 筆</span>` : ''}</span>
                <span class="person-card-meta">${esc([Fmt.leaderWord(t) + '：' + (g.leader || '未填'), g.assistant ? '佐理：' + g.assistant : '', g.phone || '未填電話', `組員 ${g.members.length} 人`].filter(Boolean).join('・'))}</span>
              </button></li>`).join('') || '<li class="muted">還沒有分組</li>'}</ul>
          </section>`;
      }).join('')}
      <p class="hint">組長電話只在管理後台顯示。改組名時，勤務的負責組與成員的組別會一併更新。</p>`;
    flash = '';
    const addG = body.querySelector('[data-add]');
    if (addG) addG.addEventListener('click', () => editGroup(null, guard, reload));
    const asg = body.querySelector('[data-assign]');
    if (asg) asg.addEventListener('click', () => assignGroups(data.groups, guard, reload));
    body.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => {
      if (!canEditPeople()) return; // 總管理者、道務、教育帳號能改分組
      editGroup(data.groups.find((g) => g.row === Number(b.dataset.row)), guard, reload);
    }));
  }

  /**
   * 📋 依名單設定組別（2026/11/22）：貼上「第1組：某某佛堂、某某」一行一組，先預覽誰會換到哪一組，按「確定設定」才改。
   * 寫了「佛堂」的＝那個佛堂的人全部設成這一組；其他當成姓名（名字比佛堂優先）。
   */
  function assignGroups(groupList, guard, reload) {
    const md = Modal.open(`
      <h2 class="modal-title">📋 依名單設定組別</h2>
      <p class="modal-note">把行事表冊上的分組貼進來，一行一組，例如：<br>第1組：某某佛堂、某某佛堂<br>第一組：王小明、測試甲、測試乙<br>寫「佛堂」的，那個佛堂的人全部設成這一組；其他當成名字。先按「檢查」看誰會換組，確定再設定。</p>
      <label class="form-row"><span>分組類型</span><select class="input" data-type>${GROUP_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
      <p class="hint" data-have></p>
      <textarea class="input day-text" rows="8" data-text placeholder="第1組：某某佛堂、某某佛堂&#10;第2組：王小明、測試甲"></textarea>
      <button type="button" class="btn btn-small" data-from-groups>用各組的「組員」欄</button>
      <label class="check"><input type="checkbox" data-clear> 名單上沒有的人，這一類的組別清掉（新年度重排時用）</label>
      <div data-out></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-block" data-check>檢查</button>
        <button type="button" class="btn btn-primary btn-block" data-go disabled>確定設定</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    const el = md.el;
    const out = el.querySelector('[data-out]');
    const go = el.querySelector('[data-go]');
    let changed = false;
    let body = null;
    el.querySelector('[data-close]').addEventListener('click', () => { md.close(); if (changed) reload(); });
    const type = () => el.querySelector('[data-type]').value;
    const showHave = () => { el.querySelector('[data-have]').textContent = '後台現在的組：' + (groupList.filter((g) => g.type === type()).map((g) => g.name).join('、') || '還沒有，請先新增分組'); };
    showHave();
    const reset = () => { body = null; go.disabled = true; };
    el.querySelector('[data-type]').addEventListener('change', () => { showHave(); reset(); out.innerHTML = ''; });
    el.querySelector('[data-text]').addEventListener('input', reset);
    el.querySelector('[data-clear]').addEventListener('change', reset);
    el.querySelector('[data-from-groups]').addEventListener('click', () => {
      el.querySelector('[data-text]').value = groupList.filter((g) => g.type === type()).map((g) => `${g.name}：${[g.leader].concat(g.assistant ? g.assistant.split(/[、，,\s]+/) : [], g.members).filter(Boolean).join('、')}`).join('\n');
      reset();
    });
    // 一行一組：「組名：名單」；組名後面也可以只用空白隔開
    const parse = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.+?組(?:[（(][^）)]*[）)])?)\s*[:：]?\s*(.*)$/);
      if (!m) return null;
      // 「佐理：」「組員：」這種標題拿掉（只拿後面有冒號的，或單獨一格的；名字裡剛好有這幾個字不會被切開）
      const LABEL = /^(召集人|副組長|組長|佐理|組員)$/;
      const tokens = m[2].replace(/(召集人|副組長|組長|佐理|組員)\s*[:：]/g, '、').split(/[、，,;；\s]+/).map((x) => x.replace(/[()（）]/g, '').trim()).filter((x) => x && !LABEL.test(x));
      return { group: m[1].trim(), names: tokens.filter((x) => !/佛堂$/.test(x)), temples: tokens.filter((x) => /佛堂$/.test(x)) };
    });
    const run = async (apply) => {
      const items = parse(el.querySelector('[data-text]').value);
      if (!items.length || items.some((x) => !x)) { out.innerHTML = '<p class="form-error">看不懂：每一行要是「組名：名單」，例如「第1組：某某佛堂、王小明」。</p>'; return; }
      body = { type: type(), items, clearOthers: el.querySelector('[data-clear]').checked };
      Busy.show(apply ? '設定中⋯' : '檢查中⋯');
      try {
        const r = await Api.admin('adminAssignGroups', Object.assign({ apply }, body));
        Busy.hide();
        const warn = [
          r.unknownTemples.length ? `<p class="form-error">對不到成員佛堂的：${esc(r.unknownTemples.join('、'))}（成員的佛堂可能還沒填，或寫法不一樣）</p>` : '',
          r.unknownNames.length ? `<p class="form-error">名單上找不到的名字：${esc(r.unknownNames.join('、'))}</p>` : '',
          r.ambiguous.length ? `<p class="form-error">同名好幾位、分不出來（沒改）：${esc(r.ambiguous.join('、'))}</p>` : ''
        ].join('');
        if (apply) {
          changed = true;
          out.innerHTML = `<div class="notice notice-success" role="status"><p><strong>✅ 已設定 ${r.changes.length} 位</strong>的${esc(body.type)}${r.same ? `（另外 ${r.same} 位本來就是這一組）` : ''}</p></div>${warn}`;
          go.disabled = true;
          AdminPage.clearMemo();
          return;
        }
        out.innerHTML = `<p>會換組的 <strong>${r.changes.length} 位</strong>${r.same ? `，本來就是這一組的 ${r.same} 位` : ''}。</p>${warn}
          ${r.changes.length ? `<div class="import-preview"><table><thead><tr><th>姓名</th><th>原本</th><th>改成</th></tr></thead><tbody>${r.changes.map((c) => `<tr><td>${esc(c.name)}${c.temple ? `<small>${esc(c.temple)}</small>` : ''}</td><td>${esc(c.from || '（無）')}</td><td><strong>${esc(c.to || '（清掉）')}</strong>${c.by === 'temple' ? '<small>依佛堂</small>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
        go.disabled = !r.changes.length;
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        out.innerHTML = `<p class="form-error">${errorHtml(err)}</p>`;
      }
    };
    el.querySelector('[data-check]').addEventListener('click', () => run(false));
    go.addEventListener('click', () => { if (body) run(true); });
  }

  function editGroup(g, guard, reload) {
    const v = g || { type: '', name: '', leader: '', assistant: '', members: [], phone: '', duties: 0 };
    const deletable = g && !g.duties;
    const { m } = formModal(`
      <h2 class="modal-title">${g ? '編輯分組' : '新增分組'}</h2>
      ${g ? `<p class="modal-note">分組類型：${esc(g.type)}・近一年負責 ${(g.year || []).length} 筆${g.upcoming ? `・之後還有 ${g.upcoming} 筆` : ''}</p>${(g.year || []).length ? `<details class="group-year"><summary>看近一年負責的勤務</summary><ul>${g.year.map((x) => `<li>${esc(Fmt.shortDate(x.date))}　${esc(x.name)}</li>`).join('')}</ul></details>` : ''}` : `
        <label class="form-row"><span>分組類型</span>
          <select class="input" name="type" required>
            <option value="">（請選）</option>
            ${GROUP_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}
          </select></label>`}
      <label class="form-row"><span>組名</span><input class="input" name="name" value="${esc(v.name)}" placeholder="例：第1組" required></label>
      <label class="form-row"><span>組長或召集人</span><input class="input" name="leader" value="${esc(v.leader)}"></label>
      <label class="form-row"><span>佐理</span><input class="input" name="assistant" value="${esc(v.assistant)}" placeholder="多人用「、」分隔"></label>
      <label class="form-row"><span>組員</span><textarea class="input textarea" name="members" rows="4" placeholder="用「、」或換行分隔">${esc(v.members.join('、'))}</textarea></label>
      <label class="form-row"><span>組長電話</span><input class="input" name="phone" value="${esc(v.phone)}" inputmode="tel"></label>`,
    async (f) => {
      const res = await Api.admin('adminSaveGroup', {
        row: g ? g.row : undefined, original: g ? g.name : undefined,
        group: { type: g ? g.type : f.elements.type.value, name: f.elements.name.value, leader: f.elements.leader.value, assistant: f.elements.assistant.value, members: f.elements.members.value, phone: f.elements.phone.value }
      });
      const r = res.renamed || {};
      notice(AdminPage.notice('success', g ? '已存檔' : '已新增分組',
        r.duties || r.members ? `已一併更新 ${r.duties} 筆勤務的負責組、${r.members} 位成員的組別` : f.elements.name.value.trim()));
      afterWrite(reload);
    }, guard, g ? `<button type="button" class="btn btn-block btn-quiet-danger" data-delete${deletable ? '' : ' disabled'}>刪除這一組</button>
      ${deletable ? '' : '<p class="hint">還有勤務由這一組負責，不能刪除。</p>'}` : '');

    // 組長、佐理、組員：連動成員名單（2026/11/22）
    const gf = m.el.querySelector('form');
    if (gf) {
      MemberSuggest.attach(gf.elements.leader);
      MemberSuggest.attach(gf.elements.assistant, { multi: true });
      MemberSuggest.attach(gf.elements.members, { multi: true });
    }
    const del = m.el.querySelector('[data-delete]');
    if (del && deletable) del.addEventListener('click', async () => {
      m.close();
      const ok = await Confirm.open({
        title: '確定要刪除這一組嗎？',
        rows: [['分組類型', g.type], ['組名', g.name]],
        note: '成員名單上屬於這一組的人，組別會一併清空。',
        confirmText: '確定刪除', cancelText: '不要刪除', danger: true
      });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try {
        const res = await Api.admin('adminDeleteGroup', { row: g.row, original: g.name });
        Busy.hide();
        notice(AdminPage.notice('success', '已刪除分組', `${g.type} ${g.name}${res.clearedMembers ? `（${res.clearedMembers} 位成員的組別已清空）` : ''}`));
        afterWrite(reload);
      } catch (err) {
        Busy.hide();
        if (!guard(err)) { notice(`<div class="notice notice-error" role="alert"><p>${errorHtml(err)}</p></div>`); reload(); }
      }
    });
  }

  /** 這個佛堂的人大多是勤務了愿組哪一組（2/3 以上同一組才算；同後端 templeGroupMap_） */
  function templeGroupOf(temple, self) {
    if (!temple) return '';
    const c = {};
    memberList.forEach((x) => { if (x !== self && (!self || x.row !== self.row) && x.temple === temple && x.groups && x.groups['勤務了愿組']) c[x.groups['勤務了愿組']] = (c[x.groups['勤務了愿組']] || 0) + 1; });
    const total = Object.values(c).reduce((a, b) => a + b, 0);
    const best = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
    return best && c[best] * 3 >= total * 2 ? best : '';
  }

  /** 編輯成員的「家人」區：依現在填的年齡、父母，算學齡、第幾代，列出子女 */
  function familyAutoText(m, ageText, parentsText, idInput) {
    const today = new Date().toISOString().slice(0, 10);
    const by = /^\d{1,3}$/.test(ageText) ? Number(today.slice(0, 4)) - Number(ageText) : (m && m.birthYear) || '';
    const me = Object.assign({}, m || { name: '' }, { age: /^\d{1,3}$/.test(ageText) ? Number(ageText) : '', parents: String(parentsText || '').split(/[、，,\s]+/).filter(Boolean), identity: idInput ? idInput.value : (m && m.identity) });
    const list = memberList.filter((x) => !m || x.row !== m.row).concat([me]);
    const f = Family.generations(list).get(me);
    const st = Family.schoolStage(by, today);
    const known = new Set(memberList.flatMap((x) => [x.name].concat(x.aliases || [])));
    const unknown = me.parents.filter((p) => !known.has(p));
    const bits = [];
    if (st) bits.push(`📚 ${esc(st.label)}`);
    if (f && f.label) bits.push(`🌱 ${esc(f.label)}`);
    if (f && f.children.length) bits.push(`子女：${esc(f.children.map((c) => c.name).join('、'))}`);
    return (bits.length ? bits.join('・') + '<small>（自動算的：學齡看年齡，第幾代看父母有沒有求道）</small>' : '<small>學齡、道二代會依年齡和父母自動算。</small>')
      + (unknown.length ? `<small class="form-error">不在成員名單上：${esc(unknown.join('、'))}（請先新增成員，才算得出第幾代）</small>` : '');
  }

  // ---------- 👨‍👩‍👧 道二代、道三代（2026/11/22）：教育組分類、統計 ----------

  const youthState = { gen: 'kids', stage: '', q: '' };

  function youth(body, guard) {
    const reload = () => youth(body, guard);
    AdminPage.swr('members', () => Api.admin('adminMembers', {}, true), (data, stale) => renderYouth(body, guard, data, stale, reload), body);
  }

  function renderYouth(body, guard, data, stale, reload) {
    memberList = data.members;
    const today = data.today || new Date().toISOString().slice(0, 10);
    const all = data.members.filter((m) => m.active && !m.pending);
    const fam = Family.generations(data.members);
    const rows = all.map((m) => ({ m, f: fam.get(m), st: Family.schoolStage(m.birthYear, today) }));
    const kids = rows.filter((r) => r.f.shownGen >= 2 || r.st);
    const count = (fn) => rows.filter(fn).length;
    const gens = [2, 3, 4].map((g) => [g, count((r) => (g === 4 ? r.f.shownGen >= 4 : r.f.shownGen === g))]).filter(([g, n]) => n || g < 4);
    const stages = Family.STAGES.map((s) => [s, count((r) => r.st && r.st.stage === s)]);
    const canEdit = canEditPeople();
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${flash}
      <p class="hint">成員資料填了<strong>父母</strong>（成員名單上的爸爸、媽媽）就會自動算第幾代：父母有求道＝道二代，父母是道二代＝道三代，<strong>只算 45 歲以下</strong>（沒填年齡的照算）。<strong>學齡</strong>看年齡自動算（9 月開始新學年；只有出生年，9 月以後生日的可能差一個年級）。</p>
      <div class="youth-sum">
        ${gens.map(([g, n]) => `<button type="button" class="youth-stat${youthState.gen === String(g) ? ' is-active' : ''}" data-gen="${g}"><strong>${n}</strong><span>${g === 4 ? '道四代以上' : g === 2 ? '道二代' : '道三代'}</span></button>`).join('')}
        ${stages.filter(([, n]) => n).map(([s, n]) => `<button type="button" class="youth-stat${youthState.stage === s ? ' is-active' : ''}" data-stage="${s}"><strong>${n}</strong><span>${s}</span></button>`).join('')}
      </div>
      <div class="list-filter">
        <select class="input" data-yf-gen aria-label="世代">
          <option value="kids"${youthState.gen === 'kids' ? ' selected' : ''}>道二代以上，或學齡中（${kids.length}）</option>
          <option value="2"${youthState.gen === '2' ? ' selected' : ''}>道二代</option>
          <option value="3"${youthState.gen === '3' ? ' selected' : ''}>道三代</option>
          <option value="4"${youthState.gen === '4' ? ' selected' : ''}>道四代以上</option>
          <option value="noparent"${youthState.gen === 'noparent' ? ' selected' : ''}>學齡中、還沒填父母</option>
          <option value="all"${youthState.gen === 'all' ? ' selected' : ''}>全部成員</option>
        </select>
        <select class="input" data-yf-stage aria-label="學齡"><option value="">全部學齡</option>${Family.STAGES.map((s) => `<option${youthState.stage === s ? ' selected' : ''}>${s}</option>`).join('')}<option value="adult"${youthState.stage === 'adult' ? ' selected' : ''}>成年／沒填年齡</option></select>
        <input class="input" type="search" data-yf-q placeholder="搜尋姓名、父母、${esc(window.SITE.temple)}、學校、興趣" value="${esc(youthState.q)}">
      </div>
      <div class="admin-actions"><button type="button" class="btn" data-yf-xlsx>⬇ 匯出 Excel</button></div>
      <div data-yrows></div>`;
    flash = '';
    const pick = () => {
      const q = youthState.q.trim();
      const order = { '學齡前': 0, '幼兒園': 1, '國小': 2, '國中': 3, '高中': 4, '大學': 5 };
      return rows.filter((r) => {
        const g = youthState.gen;
        if (g === 'kids' && !(r.f.shownGen >= 2 || r.st)) return false;
        if (g === '2' && r.f.shownGen !== 2) return false;
        if (g === '3' && r.f.shownGen !== 3) return false;
        if (g === '4' && r.f.shownGen < 4) return false;
        if (g === 'noparent' && !(r.st && !r.f.parents.length)) return false;
        if (youthState.stage === 'adult' ? !!r.st : (youthState.stage && !(r.st && r.st.stage === youthState.stage))) return false;
        const hay = [r.m.name, r.m.temple, r.m.school, r.m.interest].concat(r.f.parents.map((p) => p.name), r.m.aliases || []).join(' ');
        return !q || hay.indexOf(q) !== -1;
      }).sort((a, b) => (a.st ? order[a.st.stage] * 10 + a.st.grade : 99) - (b.st ? order[b.st.stage] * 10 + b.st.grade : 99) || b.f.shownGen - a.f.shownGen || Fmt.byStroke(a.m.name, b.m.name));
    };
    const box = body.querySelector('[data-yrows]');
    function draw() {
      const list = pick();
      box.innerHTML = list.length ? `<p class="muted">${list.length} 位</p><ul class="people-list">${list.map((r) => `
        <li><button type="button" class="person-card" data-yrow="${r.m.row}">
          <span class="person-card-name">${esc(r.m.name)}${r.m.temple ? `<span class="tag tag-temple">${esc(r.m.temple)}</span>` : ''}${r.f.label ? `<span class="tag tag-gen">${esc(r.f.label)}</span>` : ''}${r.st ? `<span class="tag tag-stage">${esc(r.st.label)}</span>` : ''}${r.m.age !== '' && r.m.age !== undefined ? `<span class="tag">${r.m.age} 歲</span>` : ''}${r.m.identity ? `<span class="tag">${esc(r.m.identity)}</span>` : ''}</span>
          <span class="person-card-meta">${esc([r.f.parents.length ? '父母：' + r.f.parents.map((p) => p.name).join('、') : (r.st ? '還沒填父母' : ''), r.f.children.length ? '子女：' + r.f.children.map((c) => c.name).join('、') : '', r.m.school ? '🏫 ' + r.m.school : '', r.m.interest ? '⭐ ' + r.m.interest : ''].filter(Boolean).join('・') || '（還沒填家人資料）')}</span>
        </button></li>`).join('')}</ul>` : '<p class="panel-empty">沒有符合的成員。到「成員」點一位，在「👨‍👩‍👧 家人」填父母、年齡就會出現在這裡。</p>';
    }
    draw();
    body.querySelector('[data-yf-gen]').addEventListener('change', (ev) => { youthState.gen = ev.target.value; renderYouth(body, guard, data, stale, reload); });
    body.querySelector('[data-yf-stage]').addEventListener('change', (ev) => { youthState.stage = ev.target.value; renderYouth(body, guard, data, stale, reload); });
    body.querySelector('[data-yf-q]').addEventListener('input', (ev) => { youthState.q = ev.target.value; draw(); });
    body.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => { youthState.gen = youthState.gen === b.dataset.gen ? 'kids' : b.dataset.gen; renderYouth(body, guard, data, stale, reload); }));
    body.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => { youthState.stage = youthState.stage === b.dataset.stage ? '' : b.dataset.stage; renderYouth(body, guard, data, stale, reload); }));
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-yrow]');
      if (!b) return;
      const r = rows.find((x) => String(x.m.row) === b.dataset.yrow);
      if (r && canEdit) editFamily(r, guard, reload);
    });
    body.querySelector('[data-yf-xlsx]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('無法載入 Excel 工具，請檢查網路')); document.head.appendChild(s); });
        const aoa = [['姓名', window.SITE.temple, '第幾代', '學齡', '年齡', '身分', '父母', '子女', '學校', '興趣、其他']].concat(pick().map((r) => [r.m.name, r.m.temple || '', r.f.label || '', r.st ? r.st.label : '', r.m.age === '' ? '' : r.m.age, r.m.identity || '', r.f.parents.map((p) => p.name).join('、'), r.f.children.map((c) => c.name).join('、'), r.m.school || '', r.m.interest || '']));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [8, 8, 8, 10, 5, 6, 16, 16, 14, 24].map((w) => ({ wch: w * 2 }));
        XLSX.utils.book_append_sheet(wb, ws, '道二代道三代');
        XLSX.writeFile(wb, `道二代道三代_${today}.xlsx`);
      } catch (e) { alert(e.message || '匯出失敗'); }
      btn.disabled = false;
    });
  }

  /** 道二代頁點一位：只改父母、年齡、學校、興趣（adminSetFamily） */
  function editFamily(r, guard, reload) {
    const m = r.m;
    const { m: modal } = formModal(`
      <h2 class="modal-title">👨‍👩‍👧 ${esc(m.name)}</h2>
      <p class="modal-note">${esc([m.temple, m.identity].filter(Boolean).join('・'))}</p>
      <label class="form-row"><span>父母（成員名單上的爸爸、媽媽，用「、」分開）</span><input class="input" name="parents" value="${esc((m.parents || []).join('、'))}" placeholder="打一兩個字會出現名單"></label>
      <label class="form-row"><span>年齡（今年幾歲；之後每年自動加一歲）</span><input class="input" name="age" inputmode="numeric" maxlength="3" value="${esc(m.age === undefined ? '' : m.age)}"></label>
      <p class="family-auto" data-family-auto></p>
      <label class="form-row"><span>學校（選填）</span><input class="input" name="school" maxlength="50" value="${esc(m.school || '')}" placeholder="例：某某國小"></label>
      <label class="form-row"><span>興趣、其他（選填）</span><input class="input" name="interest" maxlength="200" value="${esc(m.interest || '')}" placeholder="例：畫畫、打鼓、喜歡幫忙"></label>`,
    async (f) => {
      await Api.admin('adminSetFamily', { row: m.row, original: m.name, parents: f.elements.parents.value, age: f.elements.age.value.trim(), school: f.elements.school.value, interest: f.elements.interest.value });
      notice(AdminPage.notice('success', '已存檔', m.name));
      afterWrite(reload);
    }, guard, '');
    const f = modal.el.querySelector('form');
    MemberSuggest.attach(f.elements.parents, { multi: true });
    const paint = () => { modal.el.querySelector('[data-family-auto]').innerHTML = familyAutoText(m, f.elements.age.value.trim(), f.elements.parents.value, null); };
    ['age', 'parents'].forEach((n) => f.elements[n].addEventListener('input', paint));
    f.elements.parents.addEventListener('change', paint);
    paint();
  }

  window.PeoplePage = { members, groups, youth };
})();
