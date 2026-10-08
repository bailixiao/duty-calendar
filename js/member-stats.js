// 道務統計裡的「🥬 道親清口」與「🎂 年齡統計」（成員名單的清口、出生年欄，見 apps-script/People.gs）。
// 總管理者、道務帳號可以改清口、填年齡；其他帳號只能看。只算啟用中、非待確認的成員。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const st = { q: '', guard: null, canEdit: false, members: [], temples: [], vegAll: {}, activity: new Map(), vegBox: null, ageBox: null };
  const VEG_FIRST = 20; // 每區先列幾位，其餘按「全部列出」

  async function mount(vegBox, ageBox, opts) {
    st.vegBox = vegBox;
    st.ageBox = ageBox;
    st.canEdit = !!opts.canEdit;
    st.guard = opts.guard;
    st.activity = opts.activity || new Map();
    vegBox.innerHTML = '<h3 class="admin-sub">🥬 道親清口</h3><p class="muted">讀取中⋯</p>';
    ageBox.innerHTML = '<h3 class="admin-sub">🎂 年齡統計</h3><p class="muted">讀取中⋯</p>';
    try {
      const data = await Api.admin('adminMembers', {}, true);
      st.members = data.members;
      st.temples = data.temples || [];
      draw();
    } catch (err) {
      if (st.guard && st.guard(err)) return;
      vegBox.innerHTML = '<h3 class="admin-sub">🥬 道親清口</h3><p class="form-error">讀不到成員名單</p>';
      ageBox.innerHTML = '';
    }
  }

  const active = () => st.members.filter((m) => m.active && !m.pending);

  function draw() {
    if (!st.vegBox.isConnected) return;
    drawVeg();
    drawAges();
  }

  // ---------- 清口 ----------

  function drawVeg() {
    const dao = active().filter((m) => m.identity === '道親').sort((a, b) => Fmt.byStroke(a.name, b.name));
    const yes = dao.filter((m) => m.vegetarian);
    const no = dao.filter((m) => !m.vegetarian);
    const q = st.q.replace(/[\s　]+/g, '');
    const show = (list) => (q ? list.filter((m) => m.name.indexOf(q) !== -1) : list);
    const pct = dao.length ? Math.round((yes.length / dao.length) * 100) : 0;
    // 依佛堂分組（順序同佛堂清單，沒填的放最後）；搜尋時全部列出，沒搜尋時每區先列 VEG_FIRST 位
    const order = (t) => { const i = st.temples.indexOf(t); return t ? (i === -1 ? 900 : i) : 999; };
    // 近一年出席次數（同名不同佛堂的，統計裡是「名字（佛堂）」）
    const act = (m) => st.activity.get(m.name + '（' + (m.temple || '') + '）') || st.activity.get(m.name) || { count: 0, 勤務: 0, 道務: 0, 教育: 0 };
    const byAct = (a, b) => act(b).count - act(a).count || Fmt.byStroke(a.name, b.name);
    const block = (key, list, isYes, empty) => {
      const shown = show(list);
      if (!shown.length) return `<p class="muted veg-empty">${q ? '找不到' : empty}</p>`;
      // 沒全部列出時：先挑出席最多的前 VEG_FIRST 位，再依佛堂分組；同一佛堂裡出席多的在前面
      const pick = q || st.vegAll[key] ? shown : shown.slice().sort(byAct).slice(0, VEG_FIRST);
      const groups = new Map();
      pick.slice().sort((a, b) => order(a.temple || '') - order(b.temple || '') || (a.temple || '').localeCompare(b.temple || '') || byAct(a, b))
        .forEach((m) => { const t = m.temple || ''; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(m); });
      const total = (t) => shown.filter((m) => (m.temple || '') === t).length;
      const html = [...groups].map(([t, ms]) => `<div class="veg-group"><h5>${esc(t || '未填佛堂')}<span>（${ms.length < total(t) ? `列出 ${ms.length}／` : ''}${total(t)}）</span></h5><ul class="veg-list">${ms.map((m) => item(m, isYes)).join('')}</ul></div>`).join('');
      const more = !q && shown.length > VEG_FIRST
        ? `<button type="button" class="btn btn-small veg-more no-print" data-veg-all="${key}">${st.vegAll[key] ? '收起來' : `全部列出（${shown.length} 位）`}</button>` : '';
      return html + more;
    };
    const item = (m, isYes) => {
      const a = act(m);
      const tip = `近一年出席 ${a.count} 次（勤務 ${a.勤務}、道務 ${a.道務}、教育 ${a.教育}）`;
      const label = `${esc(m.name)}${a.count ? `<small class="veg-n">${a.count}</small>` : ''}`;
      return st.canEdit
        ? `<li><button type="button" class="veg-chip${isYes ? ' is-yes' : ''}" data-veg="${m.row}" data-v="${isYes ? '0' : '1'}" title="${tip}；點一下${isYes ? '改成還沒清口' : '改成已清口'}">${label}</button></li>`
        : `<li><span class="veg-chip${isYes ? ' is-yes' : ''}" title="${tip}">${label}</span></li>`;
    };
    st.vegBox.innerHTML = `
      <h3 class="admin-sub">🥬 道親清口<span class="h2-sub">成員名單上的道親</span></h3>
      <div class="veg-summary"><strong>已清口 ${yes.length} 位</strong>／道親 ${dao.length} 位（${pct}%）
        <span class="veg-bar"><span style="width:${pct}%"></span></span></div>
      ${dao.length > 8 ? `<input class="input veg-q" type="search" data-veg-q placeholder="🔍 找名字" value="${esc(st.q)}">` : ''}
      <div class="veg-cols">
        <div><h4>✅ 已清口（${yes.length}）</h4>${block('yes', yes, true, '還沒有')}</div>
        <div><h4>⬜ 還沒清口（${no.length}）</h4>${block('no', no, false, '都清口了 🙏')}</div>
      </div>
      <div class="admin-actions no-print"><button type="button" class="btn" data-veg-copy>複製清口名單</button></div>
      <p class="hint">名字右邊的小字是近一年出席次數（勤務＋道務＋教育），同一佛堂裡常來的排前面，方便找穩定的道親成全清口。${st.canEdit ? '點名字就能在「已清口／還沒清口」之間切換，會記在成員名單。' : ''}道親的身分在「成員」頁設定；名單上沒有的人（例如待確認）不會列在這裡。</p>`;
    const qi = st.vegBox.querySelector('[data-veg-q]');
    if (qi) qi.addEventListener('input', () => { st.q = qi.value; drawVeg(); const n = st.vegBox.querySelector('[data-veg-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    st.vegBox.querySelectorAll('[data-veg-all]').forEach((b) => b.addEventListener('click', () => { st.vegAll[b.dataset.vegAll] = !st.vegAll[b.dataset.vegAll]; drawVeg(); }));
    st.vegBox.querySelectorAll('[data-veg]').forEach((b) => b.addEventListener('click', () => {
      const m = st.members.find((x) => x.row === Number(b.dataset.veg));
      save([{ row: m.row, original: m.name, vegetarian: b.dataset.v === '1' }]);
    }));
    st.vegBox.querySelector('[data-veg-copy]').addEventListener('click', async (ev) => {
      const text = [`🥬 道親清口：已清口 ${yes.length} 位／道親 ${dao.length} 位（${pct}%）`, '', `✅ 已清口：${yes.map((m) => m.name).join('、') || '（無）'}`, '', `⬜ 還沒清口：${no.map((m) => m.name).join('、') || '（無）'}`].join('\n');
      ev.target.textContent = (await Share.copyText(text)) ? '已複製 ✓' : '複製失敗';
      setTimeout(() => { ev.target.textContent = '複製清口名單'; }, 2500);
    });
  }

  // ---------- 年齡 ----------

  function drawAges() {
    const list = active();
    const rows = StatsCalc.ageStats(list);
    const missing = list.filter((m) => m.age === '' || m.age === null || m.age === undefined);
    const maxBand = Math.max(1, ...rows.filter((r) => r.group !== '全部').flatMap((r) => r.bands.map((b) => b.count)));
    const num = (v) => (v === null ? '—' : v);
    st.ageBox.innerHTML = `
      <h3 class="admin-sub">🎂 年齡統計<span class="h2-sub">成員名單（啟用中）</span></h3>
      <div class="edu-table-wrap"><table class="edu-table age-table">
        <thead><tr><th>身分</th><th>人數</th><th>有填年齡</th><th>平均</th><th>中位數</th><th>最小</th><th>最大</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.group === '全部' ? 'is-current' : ''}"><th scope="row">${esc(r.group)}</th><td>${r.total}</td><td>${r.withAge}</td><td>${num(r.avg)}</td><td>${num(r.median)}</td><td>${num(r.min)}</td><td>${num(r.max)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">平均＝所有人年齡加起來除以人數；中位數＝年齡由小排到大，正中間那位（比較不會被少數特別年長或年輕的人影響）。</p>
      <h4 class="age-band-title">年齡層分布</h4>
      <div class="age-bands">${rows.filter((r) => r.group !== '全部' && r.withAge).map((r) => `
        <div class="age-band-group"><strong>${esc(r.group)}</strong>
          ${r.bands.map((b) => `<div class="age-band-row"><span class="age-band-label">${esc(b.label)}</span><span class="age-band-bar"><span style="width:${Math.round((b.count / maxBand) * 100)}%"></span></span><span class="age-band-n">${b.count}</span></div>`).join('')}
        </div>`).join('') || '<p class="muted">還沒有人填年齡</p>'}</div>
      ${missing.length ? `<p class="notice">還有 <strong>${missing.length} 位</strong>沒有填年齡，統計會比較不準。${st.canEdit ? '<button type="button" class="btn btn-small" data-age-fill>一次填年齡</button>' : ''}</p>` : ''}`;
    const fill = st.ageBox.querySelector('[data-age-fill]');
    if (fill) fill.addEventListener('click', () => fillAges(missing));
  }

  function fillAges(missing) {
    const list = missing.slice().sort((a, b) => Fmt.byStroke(a.name, b.name));
    const m = Modal.open(`
      <h2 class="modal-title">🎂 填年齡</h2>
      <p class="modal-note">知道的填就好，不知道的留空白。填的是「今年幾歲」，之後每年會自動加一歲。</p>
      <div class="age-fill-list">${list.map((x) => `<label class="age-fill-row"><span>${esc(x.name)}<small>${esc(x.identity || '未填身分')}</small></span><input class="input" inputmode="numeric" maxlength="3" data-age-row="${x.row}" placeholder="歲"></label>`).join('')}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-age-save>儲存</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-age-save]').addEventListener('click', () => {
      const items = [...m.el.querySelectorAll('[data-age-row]')].filter((i) => i.value.trim()).map((i) => {
        const mem = st.members.find((x) => x.row === Number(i.dataset.ageRow));
        return { row: mem.row, original: mem.name, age: i.value.trim() };
      });
      if (!items.length) { m.close(); return; }
      m.close();
      save(items);
    });
  }

  async function save(items) {
    Busy.show('儲存中⋯');
    try {
      const res = await Api.admin('adminSetMemberExtra', { items });
      Busy.hide();
      st.members = res.members;
      st.temples = res.temples || st.temples;
      AdminPage.clearMemo();
      draw();
    } catch (err) {
      Busy.hide();
      if (st.guard && st.guard(err)) return;
      alert((err.message || '儲存失敗') + (err.details ? '\n' + err.details.map((d) => d.message).join('\n') : ''));
    }
  }

  window.MemberStats = { mount };
})();
