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
      <div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增成員</button></div>
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
