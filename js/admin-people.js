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

  /** 匯入成員資料：貼上整理好的 JSON（佛堂、年齡、身分），依名字更新 */
  function importMembers(guard, reload) {
    const md = Modal.open(`
      <h2 class="modal-title">📋 匯入成員資料</h2>
      <p class="modal-note">貼上整理好的資料（Claude 整理的文字），會依名字（或別名）幫成員補上佛堂、年齡、身分、清口、國外；只更新有給的欄位，不會清掉原本的資料。</p>
      <textarea class="input day-text" rows="7" data-text placeholder='{"type":"成員資料","items":[...]}'></textarea>
      <label class="check"><input type="checkbox" data-add> 名單上找不到的，直接新增成員</label>
      <div data-out></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-block" data-check>檢查</button>
        <button type="button" class="btn btn-primary btn-block" data-go disabled>確定匯入</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    const el = md.el;
    let items = null;
    el.querySelector('[data-close]').addEventListener('click', () => md.close());
    el.querySelector('[data-text]').addEventListener('input', () => { items = null; el.querySelector('[data-go]').disabled = true; });
    el.querySelector('[data-check]').addEventListener('click', () => {
      const out = el.querySelector('[data-out]');
      try {
        const j = JSON.parse(el.querySelector('[data-text]').value);
        if (!j || !Array.isArray(j.items) || !j.items.length) throw new Error('找不到 items');
        items = j.items;
      } catch (e) {
        out.innerHTML = `<p class="form-error">看不懂這段文字：${esc(e.message || '')}。請確認整段都有貼上。</p>`;
        return;
      }
      const known = new Set(memberList.flatMap((m) => [m.name].concat(m.aliases || [])));
      const miss = items.filter((x) => !known.has(String(x.name || '').trim()));
      out.innerHTML = `<p>共 ${items.length} 位：名單上找得到 ${items.length - miss.length} 位${miss.length ? `，<strong>找不到 ${miss.length} 位</strong>（${esc(miss.map((x) => x.name).join('、'))}）` : ''}。</p>`;
      el.querySelector('[data-go]').disabled = false;
    });
    el.querySelector('[data-go]').addEventListener('click', async () => {
      if (!items) return;
      Busy.show('匯入中⋯');
      try {
        const res = await Api.admin('adminImportMembers', { items, addMissing: el.querySelector('[data-add]').checked });
        Busy.hide();
        el.querySelector('[data-out]').innerHTML = `<div class="notice notice-success" role="status"><p><strong>✅ 匯入完成</strong>：更新 ${res.updated.length} 位${res.added.length ? `、新增 ${res.added.length} 位` : ''}</p>
          ${res.missing.length ? `<p>找不到（沒改）：${esc(res.missing.join('、'))}</p>` : ''}
          ${res.ambiguous.length ? `<p>同名好幾位、分不出來（沒改）：${esc(res.ambiguous.join('、'))}</p>` : ''}</div>`;
        el.querySelector('[data-go]').disabled = true;
        AdminPage.clearMemo();
        el.querySelector('[data-close]').addEventListener('click', () => reload(), { once: true });
      } catch (err) {
        Busy.hide();
        if (guard(err)) return;
        el.querySelector('[data-out]').innerHTML = `<p class="form-error">${errorHtml(err)}</p>`;
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

  /** 可以編輯成員、分組的帳號：總管理者、道務、教育 */
  function canEditPeople() {
    return ['總管理者', '道務', '教育'].indexOf(Api.adminWho().role) !== -1;
  }

  // ---------- 成員 ----------

  const memberState = { q: '', filter: 'active', identity: 'all' };
  const IDENTITY_ORDER = [['點傳師', '點傳師'], ['壇辦', '壇辦'], ['道親', '道親'], ['未求道', '未求道'], ['', '未填身分']];
  const SHORT = { '未填身分': '未填' }; // 篩選按鈕用短一點的字，手機上才排得下一列

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
      ${pendingList.length ? `<div class="notice pending-banner" role="status"><p>🆕 <strong>有 ${pendingList.length} 位新成員待確認</strong>（報名時自動加入的新名字）</p>${memberState.filter === 'pending' ? '<p class="muted">確認每一位：沒問題按「保留」；其實是名單上的某人（寫法不同）按「合併到⋯」；打錯或不需要的按「刪除」。</p>' : '<button type="button" class="btn btn-primary" data-show-pending>查看待確認的人</button>'}</div>` : ''}
      ${canEditPeople() ? '<div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增成員</button><button type="button" class="btn" data-from-signups>從出勤紀錄加入成員</button><button type="button" class="btn" data-import-members>📋 匯入成員資料</button><button type="button" class="btn" data-same-name>👥 同名的舊紀錄</button></div>' : ''}
      <div class="list-filter">
        <select class="input" data-filter aria-label="狀態">
          ${pendingList.length ? `<option value="pending"${memberState.filter === 'pending' ? ' selected' : ''}>🆕 待確認（${pendingList.length}）</option>` : ''}
          <option value="active"${memberState.filter === 'active' ? ' selected' : ''}>啟用中（${counts.active}）</option>
          <option value="inactive"${memberState.filter === 'inactive' ? ' selected' : ''}>已停用（${counts.inactive}）</option>
          <option value="all"${memberState.filter === 'all' ? ' selected' : ''}>全部（${data.members.length}）</option>
        </select>
        <input class="input" type="search" data-q placeholder="搜尋姓名、${esc(window.SITE.temple)}或組別" value="${esc(memberState.q)}">
      </div>
      <div class="seg identity-filter" data-identity-filter></div>
      <div data-rows></div>
      <p class="hint">停用的成員不會出現在報名的名字提示裡；過去的報名紀錄不受影響。改名也不會改到過去的報名紀錄。</p>`;
    flash = '';
    const rows = body.querySelector('[data-rows]');
    const card = (m) => `
          <li><button type="button" class="person-card${m.active ? '' : ' is-inactive'}" data-row="${m.row}">
            <span class="person-card-name">${esc(m.name)}${m.aliases && m.aliases.length ? `<small class="person-alias">（${esc(m.aliases.join('、'))}）</small>` : ''}${m.temple ? `<span class="tag tag-temple">${esc(m.temple)}</span>` : ''}${m.overseas ? `<span class="tag tag-temple">🌏 ${esc(m.overseas)}</span>` : ''}
              ${m.identity ? `<span class="tag">${esc(m.identity)}</span>` : '<span class="tag tag-warn">未填身分</span>'}
              ${m.active ? '' : '<span class="tag">已停用</span>'}${m.pending ? '<span class="tag tag-warn">待確認</span>' : ''}${m.identity === '道親' && m.vegetarian ? '<span class="tag">🥬 清口</span>' : ''}${m.age !== '' && m.age !== undefined ? `<span class="tag">${m.age} 歲</span>` : ''}</span>
            <span class="person-card-meta">${esc(GROUP_TYPES.filter((t) => m.groups[t]).map((t) => `${t.replace('組', '')}：${m.groups[t]}`).join('・') || '未分組')}${m.note ? '・' + esc(m.note) : ''}</span>
          </button></li>`;
    function draw() {
      const q = memberState.q.trim();
      if (memberState.filter === 'pending') { drawPending(q); return; }
      const base = data.members.filter((m) => {
        if (memberState.filter === 'active' && !m.active) return false;
        if (memberState.filter === 'inactive' && m.active) return false;
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
              <button type="button" class="btn btn-small" data-merge="${m.row}">🔀 合併到⋯</button>
              <button type="button" class="btn btn-small btn-quiet-danger" data-drop="${m.row}">🗑 刪除</button>
            </div>` : ''}
          </li>`;
        }).join('')}</ul>` : '<p class="panel-empty">沒有符合的人</p>';
      const find = (row) => data.members.find((m) => m.row === Number(row));
      const all = rows.querySelector('[data-confirm-all]');
      if (all) all.addEventListener('click', () => run('adminConfirmMembers', { rows: list.map((m) => ({ row: m.row, original: m.name })) }, `已保留 ${list.length} 位`));
      rows.querySelectorAll('[data-keep]').forEach((b) => b.addEventListener('click', () => editMember(find(b.dataset.keep), data.groups, guard, reload)));
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
    body.querySelector('[data-q]').addEventListener('input', (ev) => { memberState.q = ev.target.value; draw(); });
    if (canEditPeople()) {
      body.querySelector('[data-add]').addEventListener('click', () => editMember(null, data.groups, guard, reload));
      body.querySelector('[data-from-signups]').addEventListener('click', () => fromSignups(guard, reload));
      body.querySelector('[data-import-members]').addEventListener('click', () => importMembers(guard, reload));
      body.querySelector('[data-same-name]').addEventListener('click', () => sameNameSignups(guard));
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
      <label class="form-row"><span>年齡（選填，今年幾歲；之後每年自動加一歲）</span><input class="input" name="age" inputmode="numeric" maxlength="3" value="${esc(v.age === undefined ? '' : v.age)}" placeholder="例：45"></label>
      <label class="check" data-veg-row${(v.identity || '') === '道親' ? '' : ' hidden'}><input type="checkbox" name="vegetarian"${v.vegetarian ? ' checked' : ''}> 🥬 已清口</label>
      <label class="form-row"><span>備註</span><input class="input" name="note" value="${esc(v.note)}"></label>
      <label class="check"><input type="checkbox" name="active"${v.active ? ' checked' : ''}> 啟用中（取消勾選＝停用）</label>`,
    async (f) => {
      const g = {};
      GROUP_TYPES.forEach((t) => { g[t] = f.elements['g-' + t].value; });
      await Api.admin('adminSaveMember', {
        row: m ? m.row : undefined, original: m ? m.name : undefined,
        member: { name: f.elements.name.value, identity: f.querySelector('input[name=identity]:checked').value, groups: g, note: f.elements.note.value, active: f.elements.active.checked,
          age: f.elements.age.value.trim(), temple: f.elements.temple.value, aliases: f.elements.aliases.value, overseas: f.querySelector('input[name=overseas]:checked') ? f.querySelector('input[name=overseas]:checked').value : undefined, vegetarian: f.querySelector('input[name=identity]:checked').value === '道親' && f.elements.vegetarian.checked }
      });
      notice(AdminPage.notice('success', m ? '已存檔' : '已新增成員', f.elements.name.value.trim()));
      afterWrite(reload);
    }, guard, (m ? '<button type="button" class="btn btn-block" data-merge-member>👥 這個人和另一位是同一人</button>' : '') + (canDelete ? '<button type="button" class="btn btn-block btn-quiet-danger" data-delete-member>刪除這位成員</button>'
      : (m ? '<p class="hint">要刪除成員，請先取消勾選「啟用中」存檔（停用），再回來刪除。</p>' : '')));

    modal.el.querySelectorAll('input[name=identity]').forEach((r) => r.addEventListener('change', () => { modal.el.querySelector('[data-veg-row]').hidden = r.value !== '道親' || !r.checked; }));
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
      ${canEditPeople() ? '<div class="admin-actions"><button type="button" class="btn btn-primary" data-add>＋ 新增分組</button></div>' : ''}
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
    const addG = body.querySelector('[data-add]');
    if (addG) addG.addEventListener('click', () => editGroup(null, guard, reload));
    body.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => {
      if (!canEditPeople()) return; // 總管理者、道務、教育帳號能改分組
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
