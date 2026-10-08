// 道務統計裡的「🥬 道親清口」與「🎂 年齡統計」（成員名單的清口、出生年欄，見 apps-script/People.gs）。
// 總管理者、道務帳號可以改清口、填年齡；其他帳號只能看。只算啟用中、非待確認的成員。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const st = { q: '', guard: null, canEdit: false, members: [], temples: [], vegAll: {}, vegShowYes: false, activity: new Map(), vegBox: null, ageBox: null };
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
    const where = (m) => m.overseas || m.temple || ''; // 國外的人分在國外那一區
    // 近一年出席次數（同名不同佛堂的，統計裡是「名字（佛堂）」）
    const act = (m) => actOf(m);
    const byAct = (a, b) => act(b).count - act(a).count || Fmt.byStroke(a.name, b.name);
    const block = (key, list, isYes, empty) => {
      const shown = show(list);
      if (!shown.length) return `<p class="muted veg-empty">${q ? '找不到' : empty}</p>`;
      // 沒全部列出時：先挑出席最多的前 VEG_FIRST 位，再依佛堂分組；同一佛堂裡出席多的在前面
      const pick = q || st.vegAll[key] ? shown : shown.slice().sort(byAct).slice(0, VEG_FIRST);
      const groups = new Map();
      pick.slice().sort((a, b) => order(where(a)) - order(where(b)) || where(a).localeCompare(where(b)) || byAct(a, b))
        .forEach((m) => { const t = where(m); if (!groups.has(t)) groups.set(t, []); groups.get(t).push(m); });
      const total = (t) => shown.filter((m) => where(m) === t).length;
      const html = [...groups].map(([t, ms]) => `<div class="veg-group"><h5>${esc(t || '未填佛堂')}<span>（${ms.length < total(t) ? `列出 ${ms.length}／` : ''}${total(t)}）</span></h5><ul class="veg-list">${ms.map((m) => item(m, isYes)).join('')}</ul></div>`).join('');
      const more = !q && shown.length > VEG_FIRST
        ? `<button type="button" class="btn btn-small veg-more no-print" data-veg-all="${key}">${st.vegAll[key] ? '收起來' : `全部列出（${shown.length} 位）`}</button>` : '';
      return html + more;
    };
    const item = (m, isYes) => {
      const a = act(m);
      const tip = `近一年出席 ${a.count} 次（勤務 ${a.勤務}、道務 ${a.道務}、教育 ${a.教育}）`;
      const label = `${m.careNote ? '<span class="veg-note" title="有成全紀錄">📝</span>' : ''}${esc(m.name)}${a.count ? `<small class="veg-n">${a.count}</small>` : ''}`;
      return `<li><button type="button" class="veg-chip${isYes ? ' is-yes' : ''}" data-veg="${m.row}" title="${tip}">${label}</button></li>`;
    };
    // 可成全清口：還沒清口、近一年出席 MIN 次以上；其餘的是「還沒清口」
    const MIN = (window.SITE && SITE.vegCandidateMin) || 15;
    const cand = no.filter((m) => act(m).count >= MIN);
    const rest = no.filter((m) => act(m).count < MIN);
    st.vegBox.innerHTML = `
      <h3 class="admin-sub">🥬 道親清口<span class="h2-sub">成員名單上的道親</span></h3>
      <div class="veg-summary"><button type="button" class="veg-yes-btn" data-veg-yes aria-expanded="${st.vegShowYes}">已清口 ${yes.length} 位 ${st.vegShowYes ? '▴' : '▾'}</button>／道親 ${dao.length} 位（${pct}%）
        <span class="veg-bar"><span style="width:${pct}%"></span></span></div>
      ${dao.length > 8 ? `<input class="input veg-q" type="search" data-veg-q placeholder="🔍 找名字" value="${esc(st.q)}">` : ''}
      <div class="veg-cols">
        ${st.vegShowYes || q ? `<div class="veg-yes-box"><h4>✅ 已清口（${yes.length}）<span class="h2-sub">點名字看資料</span></h4>${block('yes', yes, true, '還沒有人清口')}</div>` : ''}
        <div><h4>🙏 可成全清口（${cand.length}）<span class="h2-sub">近一年出席 ${MIN} 次以上</span></h4>${block('cand', cand, false, `還沒有出席 ${MIN} 次以上、還沒清口的道親`)}</div>
        <div><h4>⬜ 還沒清口（${rest.length}）</h4>${block('no', rest, false, no.length ? '都在上面了' : '都清口了 🙏')}</div>
      </div>
      <div class="admin-actions no-print"><button type="button" class="btn" data-veg-copy>複製清口名單</button></div>
      ${noIdentityHtml()}
      <p class="hint">名字右邊的小字是近一年出席次數（勤務＋道務＋教育），同一佛堂裡常來的排前面，方便找穩定的道親成全清口。點名字可以看這位參加了哪些勤務、課程、法會${st.canEdit ? '，最下面按「已成全清口」才會改，會記在成員名單' : ''}。按上面的「已清口 N 位」可以看已清口的名單。道親的身分在「成員」頁設定；名單上沒有的人（例如待確認）不會列在這裡。</p>`;
    const qi = st.vegBox.querySelector('[data-veg-q]');
    if (qi) qi.addEventListener('input', () => { st.q = qi.value; drawVeg(); const n = st.vegBox.querySelector('[data-veg-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    const fi = st.vegBox.querySelector('[data-fill-identity]');
    if (fi) fi.addEventListener('click', fillIdentity);
    st.vegBox.querySelector('[data-veg-yes]').addEventListener('click', () => { st.vegShowYes = !st.vegShowYes; drawVeg(); });
    st.vegBox.querySelectorAll('[data-veg-all]').forEach((b) => b.addEventListener('click', () => { st.vegAll[b.dataset.vegAll] = !st.vegAll[b.dataset.vegAll]; drawVeg(); }));
    st.vegBox.querySelectorAll('[data-veg]').forEach((b) => b.addEventListener('click', () => vegDetail(st.members.find((x) => x.row === Number(b.dataset.veg)))));
    st.vegBox.querySelector('[data-veg-copy]').addEventListener('click', async (ev) => {
      const text = [`🥬 道親清口：已清口 ${yes.length} 位／道親 ${dao.length} 位（${pct}%）`, '', `✅ 已清口：${yes.map((m) => m.name).join('、') || '（無）'}`, '', `🙏 可成全清口（近一年出席 ${MIN} 次以上）：${cand.sort(byAct).map((m) => m.name).join('、') || '（無）'}`, '', `⬜ 還沒清口：${rest.map((m) => m.name).join('、') || '（無）'}`].join('\n');
      ev.target.textContent = (await Share.copyText(text)) ? '已複製 ✓' : '複製失敗';
      setTimeout(() => { ev.target.textContent = '複製清口名單'; }, 2500);
    });
  }

  /** 近一年出席次數（同名不同佛堂的，統計裡是「名字（佛堂）」） */
  function actOf(m) {
    return st.activity.get(m.name + '（' + (m.temple || '') + '）') || st.activity.get(m.name) || { count: 0, 勤務: 0, 道務: 0, 教育: 0, last: '', items: {} };
  }

  /** 點名字：看這位的資料與出席情形，最下面才是「已成全清口」 */
  function vegDetail(m) {
    if (!m) return;
    const a = actOf(m);
    const CAT_NAME = { 勤務: '總務・勤務', 道務: '道務', 教育: '教育' };
    const items = Object.entries(a.items || {}).sort((x, y) => y[1].count - x[1].count);
    const md = Modal.open(`
      <h2 class="modal-title">${esc(m.name)}${m.vegetarian ? '<span class="veg-tag">已清口</span>' : ''}</h2>
      <p class="modal-note">${[m.temple ? '佛堂：' + esc(m.temple) : '還沒填佛堂', m.overseas ? '國外：' + esc(m.overseas) : '', esc(m.identity || '未填身分'), m.age !== '' && m.age !== undefined && m.age !== null ? m.age + ' 歲' : ''].filter(Boolean).join('・')}</p>
      <div class="veg-detail">
        <p class="veg-detail-sum">近一年出席 <strong>${a.count}</strong> 次${a.last ? `<span class="muted">（最近一次 ${esc(Fmt.rocDate(a.last))}）</span>` : ''}</p>
        <ul class="veg-detail-cats">${['勤務', '道務', '教育'].map((k) => `<li><span>${CAT_NAME[k]}</span><strong>${a[k]}</strong></li>`).join('')}</ul>
        <h3 class="veg-detail-h">📝 成全紀錄</h3>
        ${st.canEdit ? `<textarea class="input textarea veg-care" rows="3" maxlength="300" data-care placeholder="例：10/8 已和她談過，由某某負責成全">${esc(m.careNote || '')}</textarea><button type="button" class="btn btn-small" data-care-save>存紀錄</button>` : `<p>${m.careNote ? esc(m.careNote) : '<span class="muted">還沒有紀錄</span>'}</p>`}
        ${items.length ? `<h3 class="veg-detail-h">參加過的項目</h3><ul class="veg-detail-items">${items.map(([, v]) => `<li><span>${esc(v.name)}<small>${esc(CAT_NAME[v.category] || v.category)}</small></span><strong>${v.count} 次</strong></li>`).join('')}</ul>` : '<p class="muted">近一年沒有出席紀錄</p>'}
      </div>
      <div class="modal-actions">
        ${st.canEdit ? (m.vegetarian
          ? '<button type="button" class="btn btn-block" data-set="0">改回還沒清口</button>'
          : '<button type="button" class="btn btn-primary btn-block" data-set="1">🙏 已成全清口</button>') : ''}
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    md.el.querySelector('[data-close]').addEventListener('click', () => md.close());
    const cs = md.el.querySelector('[data-care-save]');
    if (cs) cs.addEventListener('click', () => {
      md.close();
      save([{ row: m.row, original: m.name, careNote: md.el.querySelector('[data-care]').value }]);
    });
    const set = md.el.querySelector('[data-set]');
    if (set) set.addEventListener('click', () => {
      md.close();
      save([{ row: m.row, original: m.name, vegetarian: set.dataset.set === '1' }]);
    });
  }

  /** 沒填身分的成員（不會列在清口名單）＋「一次補身分」 */
  function noIdentityHtml() {
    const n = active().filter((m) => !m.identity).length;
    if (!n) return '';
    return `<p class="notice">還有 <strong>${n} 位</strong>成員沒填身分（不會列在清口名單）。${st.canEdit ? '<button type="button" class="btn btn-small" data-fill-identity>一次補身分</button>' : ''}</p>`;
  }

  function fillIdentity() {
    const list = active().filter((m) => !m.identity).sort((a, b) => Fmt.byStroke(a.name, b.name));
    const IDS = ['道親', '壇辦', '未求道', '點傳師'];
    const m = Modal.open(`
      <h2 class="modal-title">👤 補身分</h2>
      <p class="modal-note">每位選一個身分，不知道的不用選。</p>
      <div class="id-fill-list">${list.map((x) => `
        <div class="id-fill-row"><span>${esc(x.name)}<small>${esc(x.overseas || x.temple || '未填佛堂')}</small></span>
          <div class="id-fill-opts">${IDS.map((id) => `<label class="id-opt"><input type="radio" name="id-${x.row}" value="${id}" data-id-row="${x.row}"><span>${id}</span></label>`).join('')}</div>
        </div>`).join('')}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary btn-block" data-id-save>儲存</button>
        <button type="button" class="btn btn-block" data-close>返回</button>
      </div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    m.el.querySelector('[data-id-save]').addEventListener('click', () => {
      const items = [...m.el.querySelectorAll('[data-id-row]:checked')].map((i) => {
        const mem = st.members.find((x) => x.row === Number(i.dataset.idRow));
        return { row: mem.row, original: mem.name, identity: i.value };
      });
      m.close();
      if (items.length) save(items);
    });
  }

  // ---------- 年齡 ----------

  // 圓餅圖：年齡層的顏色（由年輕到年長）
  const AGE_COLORS = ['#8fc1a9', '#6fa3c7', '#e0b450', '#e89a6a', '#c9705a', '#9b7bb8'];

  // 圓餅圖每一塊上的短標籤（和 StatsCalc 的年齡層同順序）
  const AGE_SHORT = ['14↓', '15–29', '30–44', '45–54', '55–64', '65↑'];

  /** 一個身分的年齡層圓餅圖（SVG，每一塊寫年齡層與百分比；太小的寫在圓外）＋圖例（百分比＝占有填年齡的人） */
  function pieHtml(r) {
    const R = 100;
    const pct = (n) => Math.round((n / r.withAge) * 100);
    const pt = (a, rad) => [Math.sin(a) * rad, -Math.cos(a) * rad].map((v) => v.toFixed(2)).join(' ');
    let at = 0;
    const parts = r.bands.map((b, i) => {
      const share = b.count / r.withAge;
      const a0 = at * 2 * Math.PI;
      at += share;
      const a1 = at * 2 * Math.PI;
      if (!b.count) return { path: '', label: '' };
      const path = share >= 0.9999
        ? `<circle r="${R}" fill="${AGE_COLORS[i]}"/>`
        : `<path d="M0 0 L${pt(a0, R)} A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1, R)} Z" fill="${AGE_COLORS[i]}"/>`;
      const mid = share >= 0.9999 ? 0 : (a0 + a1) / 2;
      const inside = share >= 0.08;
      const [x, y] = pt(mid, share >= 0.9999 ? 0 : inside ? R * 0.62 : R * 1.17).split(' ');
      const label = inside
        ? `<text x="${x}" y="${y}" class="age-pie-in"><tspan x="${x}" dy="-0.2em">${AGE_SHORT[i]}</tspan><tspan x="${x}" dy="1.15em" class="age-pie-pct">${pct(b.count)}%</tspan></text>`
        : `<text x="${x}" y="${y}" class="age-pie-out" dy="0.35em">${AGE_SHORT[i]} ${pct(b.count)}%</text>`;
      return { path, label };
    });
    return `
      <div class="age-pie-card${r.group === '全部' ? ' is-all' : ''}">
        <strong class="age-pie-title">${esc(r.group)}<small>有填年齡 ${r.withAge} 位</small></strong>
        <div class="age-pie-body">
          <svg class="age-pie" viewBox="-140 -128 280 256" role="img" aria-label="${esc(r.group)}年齡層：${r.bands.map((b) => `${b.label} ${pct(b.count)}%`).join('、')}">
            <g stroke="#fffdf7" stroke-width="2">${parts.map((p) => p.path).join('')}</g>${parts.map((p) => p.label).join('')}
          </svg>
          <ul class="age-pie-legend">${r.bands.map((b, i) => `<li${b.count ? '' : ' class="is-zero"'}><i style="background:${AGE_COLORS[i]}"></i><span>${esc(b.label)}</span><strong>${pct(b.count)}%</strong><small>${b.count} 位</small></li>`).join('')}</ul>
        </div>
      </div>`;
  }

  function drawAges() {
    const list = active().filter((m) => !m.overseas); // 年齡統計看台灣：國外的不算
    const rows = StatsCalc.ageStats(list);
    const missing = list.filter((m) => m.age === '' || m.age === null || m.age === undefined);
    const num = (v) => (v === null ? '—' : v);
    st.ageBox.innerHTML = `
      <h3 class="admin-sub">🎂 年齡統計<span class="h2-sub">成員名單（啟用中，不含國外）</span></h3>
      <div class="edu-table-wrap"><table class="edu-table age-table">
        <thead><tr><th>身分</th><th>人數</th><th>有填年齡</th><th>平均</th><th>中位數</th><th>最小</th><th>最大</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.group === '全部' ? 'is-current' : ''}"><th scope="row">${esc(r.group)}</th><td>${r.total}</td><td>${r.withAge}</td><td>${num(r.avg)}</td><td>${num(r.median)}</td><td>${num(r.min)}</td><td>${num(r.max)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">平均＝所有人年齡加起來除以人數；中位數＝年齡由小排到大，正中間那位（比較不會被少數特別年長或年輕的人影響）。</p>
      <h4 class="age-band-title">年齡層分布</h4>
      <div class="age-pies">${rows.filter((r) => r.withAge).map(pieHtml).join('') || '<p class="muted">還沒有人填年齡</p>'}</div>
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
