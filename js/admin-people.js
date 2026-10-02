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

  // ---------- 成員 ----------

  const memberState = { q: '', filter: 'active' };

  function members(body, guard) {
    const reload = () => members(body, guard);
    AdminPage.swr('members', () => Api.admin('adminMembers', {}, true), (data, stale) => renderMembers(body, guard, data, stale, reload), body);
  }

  function renderMembers(body, guard, data, stale, reload) {
    const counts = { active: data.members.filter((m) => m.active).length };
    counts.inactive = data.members.length - counts.active;
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${flash}
      <div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增成員</button><button type="button" class="btn" data-from-signups>從出勤紀錄加入成員</button></div>
      <div class="list-filter">
        <select class="input" data-filter aria-label="狀態">
          <option value="active"${memberState.filter === 'active' ? ' selected' : ''}>啟用中（${counts.active}）</option>
          <option value="inactive"${memberState.filter === 'inactive' ? ' selected' : ''}>已停用（${counts.inactive}）</option>
          <option value="all"${memberState.filter === 'all' ? ' selected' : ''}>全部（${data.members.length}）</option>
        </select>
        <input class="input" type="search" data-q placeholder="搜尋姓名或組別" value="${esc(memberState.q)}">
      </div>
      <div data-rows></div>
      <p class="hint">停用的成員不會出現在報名的名字提示裡；過去的報名紀錄不受影響。改名也不會改到過去的報名紀錄。</p>`;
    flash = '';
    const rows = body.querySelector('[data-rows]');
    function draw() {
      const q = memberState.q.trim();
      const items = data.members.filter((m) => {
        if (memberState.filter === 'active' && !m.active) return false;
        if (memberState.filter === 'inactive' && m.active) return false;
        return !q || m.name.indexOf(q) !== -1 || GROUP_TYPES.some((t) => (m.groups[t] || '').indexOf(q) !== -1);
      });
      items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      rows.innerHTML = items.length ? `
        <p class="muted">共 ${items.length} 人</p>
        <ul class="people-list">${items.map((m) => `
          <li><button type="button" class="person-card${m.active ? '' : ' is-inactive'}" data-row="${m.row}">
            <span class="person-card-name">${esc(m.name)}
              ${m.identity ? `<span class="tag">${esc(m.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
              ${m.active ? '' : '<span class="tag">已停用</span>'}</span>
            <span class="person-card-meta">${esc(GROUP_TYPES.filter((t) => m.groups[t]).map((t) => `${t.replace('組', '')}：${m.groups[t]}`).join('・') || '未分組')}${m.note ? '・' + esc(m.note) : ''}</span>
          </button></li>`).join('')}</ul>` : '<p class="panel-empty">沒有符合的成員</p>';
    }
    draw();
    body.querySelector('[data-filter]').addEventListener('change', (ev) => { memberState.filter = ev.target.value; draw(); });
    body.querySelector('[data-q]').addEventListener('input', (ev) => { memberState.q = ev.target.value; draw(); });
    body.querySelector('[data-add]').addEventListener('click', () => editMember(null, data.groups, guard, reload));
    body.querySelector('[data-from-signups]').addEventListener('click', () => fromSignups(guard, reload));
    rows.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-row]');
      if (b) editMember(data.members.find((m) => m.row === Number(b.dataset.row)), data.groups, guard, reload);
    });
  }

  function editMember(m, groups, guard, reload) {
    const v = m || { name: '', identity: '', groups: {}, note: '', active: true };
    const seg = (name, options, value) => `<div class="seg">${options.map(([val, label]) =>
      `<label class="seg-item"><input type="radio" name="${name}" value="${val}"${val === value ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>`;
    formModal(`
      <h2 class="modal-title">${m ? '編輯成員' : '新增成員'}</h2>
      <label class="form-row"><span>姓名</span><input class="input" name="name" value="${esc(v.name)}" required></label>
      <div class="form-row"><span>身分</span>${seg('identity', [['道親', '道親'], ['壇辦', '壇辦'], ['', '未填']], v.identity || '')}</div>
      ${GROUP_TYPES.map((t) => `
        <label class="form-row"><span>${t}</span>
          <select class="input" name="g-${t}">
            <option value="">（無）</option>
            ${groups.filter((g) => g.type === t).map((g) => `<option${g.name === v.groups[t] ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}
          </select></label>`).join('')}
      <label class="form-row"><span>備註</span><input class="input" name="note" value="${esc(v.note)}"></label>
      <label class="check"><input type="checkbox" name="active"${v.active ? ' checked' : ''}> 啟用中（取消勾選＝停用）</label>`,
    async (f) => {
      const g = {};
      GROUP_TYPES.forEach((t) => { g[t] = f.elements['g-' + t].value; });
      await Api.admin('adminSaveMember', {
        row: m ? m.row : undefined, original: m ? m.name : undefined,
        member: { name: f.elements.name.value, identity: f.querySelector('input[name=identity]:checked').value, groups: g, note: f.elements.note.value, active: f.elements.active.checked }
      });
      notice(AdminPage.notice('success', m ? '已存檔' : '已新增成員', f.elements.name.value.trim()));
      afterWrite(reload);
    }, guard);
  }

  /**
   * 從出勤紀錄加入成員：列出報名紀錄裡有、成員名單還沒有的人，勾選後一次加入。
   *   1. 疑似同一人（出勤紀錄裡的不同寫法，例如「小明」「王小明」）：選統一成哪個寫法或各自保留
   *   2. 和現有成員名字相近的：選併入那位成員、加為新成員，或先不加
   *   3. 新成員清單：依上面的選擇即時更新，勾選後加入
   * 送出時先把報名紀錄裡的舊寫法改成統一的名字（統計才不會算成兩個人），再加入成員。
   */
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
      near.forEach((c, i) => { if (nearChoice[i] === 'new') out.set(c.name, { name: c.name, count: c.count, identity: c.identity }); });
      return [...out.values()].sort((a, b) => b.count - a.count);
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
      return newMembers().filter((c) => !unchecked.has(c.name)).map((c) => ({ name: c.name, identity: c.identity }));
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
      <div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增分組</button></div>
      ${GROUP_TYPES.map((t) => {
        const items = data.groups.filter((g) => g.type === t);
        return `
          <section class="admin-day">
            <h2 class="admin-day-title">${esc(t)}<span class="h2-sub">${items.length} 組</span></h2>
            <ul class="people-list">${items.map((g) => `
              <li><button type="button" class="person-card" data-row="${g.row}">
                <span class="person-card-name">${esc(g.name)}${g.duties ? `<span class="tag">負責 ${g.duties} 筆勤務</span>` : ''}</span>
                <span class="person-card-meta">${esc(['組長：' + (g.leader || '未填'), g.assistant ? '佐理：' + g.assistant : '', g.phone || '未填電話', `組員 ${g.members.length} 人`].filter(Boolean).join('・'))}</span>
              </button></li>`).join('') || '<li class="muted">還沒有分組</li>'}</ul>
          </section>`;
      }).join('')}
      <p class="hint">組長電話只在管理後台顯示。改組名時，勤務的負責組與成員的組別會一併更新。</p>`;
    flash = '';
    body.querySelector('[data-add]').addEventListener('click', () => editGroup(null, guard, reload));
    body.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => {
      editGroup(data.groups.find((g) => g.row === Number(b.dataset.row)), guard, reload);
    }));
  }

  function editGroup(g, guard, reload) {
    const v = g || { type: '', name: '', leader: '', assistant: '', members: [], phone: '', duties: 0 };
    const deletable = g && !g.duties;
    const { m } = formModal(`
      <h2 class="modal-title">${g ? '編輯分組' : '新增分組'}</h2>
      ${g ? `<p class="modal-note">分組類型：${esc(g.type)}${g.duties ? `・負責 ${g.duties} 筆勤務` : ''}</p>` : `
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

  window.PeoplePage = { members, groups };
})();
