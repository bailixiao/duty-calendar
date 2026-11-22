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
  /** 這個帳號能選的類別（分壇的總務・勤務／道務／教育帳號只能選自己那一類，2026/11/22） */
  const myCats = () => { const r = (Api.adminWho() || {}).role; return CATS.filter(([v]) => r === '總管理者' || r === '唯讀' || r === v); };
  const readOnly = () => (Api.adminWho() || {}).role === '唯讀'; // 唯讀帳號：只看清單、總表、整組總覽、統計
  const catLabel = (c) => (CATS.find((x) => x[0] === c) || [c, c])[1];
  const when = (c) => [Fmt.shortDate(c.start) + (c.end && c.end !== c.start ? '～' + Fmt.shortDate(c.end) : ''), c.startTime ? c.startTime + (c.endTime ? '–' + c.endTime : '') : '', c.location].filter(Boolean).join('・');
  const quotaText = (c, q) => (c.quotaMode === 'none' ? '不限' : q ? q + ' 位' : c.quotaMode === 'self' ? '各區自己報' : '不限');
  const errHtml = (e) => `${esc(e.message || '發生錯誤')}${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
  const loadXlsx = () => (window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('無法載入 Excel 工具，請檢查網路')); document.head.appendChild(s); }));

  // =====================================================================
  // 分壇的後台
  // =====================================================================

  async function show(body, guard, sub) {
    if (readOnly() && /^hq\/(new|edit\/|import|group\/)/.test(sub || '')) { location.replace('#/admin'); return; }
    if (sub === 'hq/import') return importPage(body, guard);
    if (/^hq\/group\//.test(sub || '')) return groupPage(body, guard, decodeURIComponent(sub.slice(9)));
    if (/^hq\/overview\//.test(sub || '')) return overview(body, guard, decodeURIComponent(sub.slice(12)));
    if (sub === 'hqstats') return stats(body, guard);
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
      ${readOnly() ? '<p class="role-note">👀 唯讀帳號：看得到各區的狀況、報名人數和統計，不能開或修改分派。</p>' : '<div class="admin-actions"><a class="btn btn-primary" href="#/admin/hq/new">＋ 開新的分派</a><a class="btn" href="#/admin/hq/import">📄 從檔案匯入行事曆</a></div>'}
      ${data.campaigns.some((c) => c.status === 'draft') ? `<p class="hint">📝 草稿：各區還看不到。同一個名稱的併成一組，點進去一起檢查一次，按「送出給各區」。</p>` : ''}
      ${data.campaigns.length ? `<div class="card-list">${draftGroups(data.campaigns).map((g) => `<a class="duty-card hq-card is-draft" href="#/admin/hq/group/${encodeURIComponent(g.key)}">
          <span class="card-main"><span class="card-title"><span class="hq-st st-seen">📝 草稿</span> ${esc(g.items[0].title)}${g.items.length > 1 ? `<small>（${g.items.length} 個日期）</small>` : ''}</span>
          <span class="card-meta">${esc(catLabel(g.items[0].category))}・${esc(datesText(g.items))}</span>
          <span class="card-meta">${g.items.length > 1 ? '一起檢查一次就好・' : ''}預計送給 ${new Set([].concat(...g.items.map((c) => c.regions))).size} 區</span></span></a>`).join('')}${sentGroups(data.campaigns).filter((g) => g.items.length > 1).map((g) => {
        const rs = [...new Set([].concat(...g.items.map((c) => c.regions)))];
        const today = new Date().toISOString().slice(0, 10);
        const next = g.items.filter((c) => c.end >= today).length;
        return `<a class="duty-card hq-card" href="#/admin/hq/overview/${encodeURIComponent(g.key)}">
          <span class="card-main"><span class="card-title">${esc(g.items[0].title)}<small>（${g.items.length} 個日期）</small></span>
          <span class="card-meta">${esc(catLabel(g.items[0].category))}・${esc(datesText(g.items))}</span>
          <span class="card-meta">送給 ${rs.length} 區・${next ? `還有 ${next} 個日期沒到` : '都過了'}・<strong>點開看整組總覽 ›</strong></span></span></a>`;
      }).join('')}${sentGroups(data.campaigns).filter((g) => g.items.length === 1).map((g) => g.items[0]).sort((a, b) => b.start.localeCompare(a.start)).map((c) => {
        const ok = c.regions.filter((r) => c.delivery && c.delivery[r] === 'ok').length;
        return `<a class="duty-card hq-card${c.status === 'draft' ? ' is-draft' : ''}" href="#/admin/hq/${encodeURIComponent(c.id)}">
          <span class="card-main"><span class="card-title">${c.status === 'draft' ? '<span class="hq-st st-seen">📝 草稿</span> ' : ''}${esc(c.title)}</span>
          <span class="card-meta">${esc(catLabel(c.category))}・${esc(when(c))}</span>
          <span class="card-meta">${c.status === 'draft' ? `預計送給 ${c.regions.length} 區` : `送給 ${c.regions.length} 區（${esc(c.regions.map(name).join('、'))}）・送到 ${ok} 區`}</span></span></a>`;
      }).join('')}</div>` : '<p class="panel-empty">還沒有分派。按「＋ 開新的分派」開始。</p>'}`;
  }

  /** 草稿依名稱＋類別分組（同名的一起檢查、一起送出），組內照日期排、組照最早日期排 */
  const groupKey = (c) => c.title.replace(/\s/g, '') + '|' + c.category;
  function draftGroups(campaigns) {
    const m = new Map();
    campaigns.filter((c) => c.status === 'draft').forEach((c) => { const k = groupKey(c); if (!m.has(k)) m.set(k, { key: k, items: [] }); m.get(k).items.push(c); });
    const gs = [...m.values()];
    gs.forEach((g) => g.items.sort((a, b) => a.start.localeCompare(b.start)));
    return gs.sort((a, b) => a.items[0].start.localeCompare(b.items[0].start));
  }
  /** 已送出的依名稱＋類別分組（好幾個日期的一張卡，點開看整組總覽）；組照最近的日期排（新的在前） */
  function sentGroups(campaigns) {
    const m = new Map();
    campaigns.filter((c) => c.status !== 'draft').forEach((c) => { const k = groupKey(c); if (!m.has(k)) m.set(k, { key: k, items: [] }); m.get(k).items.push(c); });
    const gs = [...m.values()];
    gs.forEach((g) => g.items.sort((a, b) => a.start.localeCompare(b.start)));
    return gs.sort((a, b) => b.items[b.items.length - 1].start.localeCompare(a.items[a.items.length - 1].start));
  }

  /**
   * 整組總覽（2026/11/22）：同一個活動好幾個日期 × 各區。每格：狀態或報名人數（有名額的寫「2／3」，不夠的紅字）。
   * 點日期看那一天的總表；點格子看名字。上面有每一區還沒處理幾天、全部報名人數；可以一次提醒、匯出 Excel。
   */
  async function overview(body, guard, key) {
    body.innerHTML = '<p class="panel-empty">問各區的狀況中⋯</p>';
    let list0, d;
    try {
      list0 = await Api.admin('hqList', {});
      const g = sentGroups(list0.campaigns).find((x) => x.key === key);
      if (!g) { body.innerHTML = '<p class="panel-empty">找不到這一組分派，可能已經刪掉了。<a href="#/admin">回分派清單</a></p>'; return; }
      d = await Api.admin('hqGroupSummary', { ids: g.items.map((c) => c.id) });
    } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p><p><a href="#/admin">回分派清單</a></p>`; return; }
    const cs = d.campaigns;
    const c0 = cs[0];
    const today = new Date().toISOString().slice(0, 10);
    const cell = (c, r) => d.cells[c.id] && d.cells[c.id][r.code];
    const quotaOf = (c, r, x) => { const q = (x && x.quota) || (c.quotaMode === 'assigned' && c.quotas ? c.quotas[r.code] : ''); return x && (x.status === 'declined' || x.status === 'not-open') ? 0 : Number(q) || 0; };
    const todoBy = {};
    d.regions.forEach((r) => { todoBy[r.code] = cs.filter((c) => { const x = cell(c, r); return x && (x.status === 'new' || x.status === 'seen') && c.end >= today; }).length; });
    let totalN = 0, totalQ = 0;
    cs.forEach((c) => d.regions.forEach((r) => { const x = cell(c, r); if (x) { totalN += x.count || 0; totalQ += quotaOf(c, r, x); } }));
    const cellHtml = (c, r) => {
      const x = cell(c, r);
      if (!x) return '<td class="ov-none">·</td>';
      const q = quotaOf(c, r, x);
      if (x.status === 'published') return `<td class="ov-ok${q && x.count < q ? ' ov-short' : ''}"><button type="button" class="link-btn" data-cell="${esc(c.id)}|${r.code}">${q ? `${x.count}／${q}` : `✓ ${x.count}`}</button></td>`;
      const [l, cls] = STATUS[x.status] || [x.status, ''];
      return `<td><span class="hq-st ${cls}" title="${esc(x.declineReason || '')}">${esc(x.status === 'seen' ? '看過' : l)}</span></td>`;
    };
    const pending = d.regions.filter((r) => todoBy[r.code]);
    body.innerHTML = `
      <p><a href="#/admin">‹ 分派清單</a></p>
      <h2>${esc(c0.title)}<small>（${cs.length} 個日期）</small></h2>
      <p class="muted">${esc(catLabel(c0.category))}・${esc(c0.location || '')}${c0.startTime ? '・' + esc(c0.startTime) + (c0.endTime ? '–' + esc(c0.endTime) : '') : ''}</p>
      <div class="hq-total"><strong>${totalN}</strong> 位已報名${totalQ ? `／名額 ${totalQ} 位${totalN < totalQ ? `，還差 <strong>${totalQ - totalN}</strong> 位` : ''}` : ''}</div>
      ${pending.length ? `<div class="hq-alert"><div class="hq-alert-head"><span class="hq-alert-icon" aria-hidden="true">!</span><div><strong>${pending.length} 區還有日期沒處理</strong><small>${pending.map((r) => esc(r.name) + ' ' + todoBy[r.code] + ' 天').join('、')}</small></div></div></div>` : '<p class="notice notice-success">✅ 各區都處理好了。</p>'}
      <div class="admin-actions">
        <button type="button" class="btn" data-remind>📋 提醒還沒處理的區</button>
        <button type="button" class="btn" data-xlsx>⬇ 匯出 Excel</button>
      </div>
      <p class="hint">每格：✓ 幾位＝已放到行事曆、幾位報名（有名額的寫「報名／名額」，不夠的紅字）；點數字看名字。點日期看那一天的總表、修改或刪除。</p>
      <div class="hq-table-wrap ov-wrap"><table class="hq-table ov-table">
        <thead><tr><th class="ov-date">日期</th>${d.regions.map((r) => `<th>${esc(r.name.replace(/區$/, ''))}${todoBy[r.code] ? `<span class="tab-alert">! ${todoBy[r.code]}</span>` : ''}</th>`).join('')}<th>合計</th></tr></thead>
        <tbody>${cs.map((c) => { const n = d.regions.reduce((s, r) => s + ((cell(c, r) || {}).count || 0), 0); const q = d.regions.reduce((s, r) => s + quotaOf(c, r, cell(c, r)), 0); return `
          <tr class="${c.end < today ? 'ov-past' : ''}"><th class="ov-date"><a href="#/admin/hq/${encodeURIComponent(c.id)}">${esc(Fmt.shortDate(c.start))}</a></th>${d.regions.map((r) => cellHtml(c, r)).join('')}<td class="ov-sum${q && n < q ? ' ov-short' : ''}">${q ? `${n}／${q}` : n}</td></tr>`; }).join('')}</tbody>
      </table></div>`;
    body.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', () => {
      const [id, code] = b.dataset.cell.split('|');
      const c = cs.find((x) => x.id === id);
      const r = d.regions.find((x) => x.code === code);
      const x = cell(c, r);
      const pm = Modal.open(`<h2 class="modal-title">${esc(r.name)}・${esc(Fmt.shortDate(c.start))}：${x.count} 位</h2>
        ${x.people && x.people.length ? `<div class="hq-table-wrap"><table class="hq-table"><thead><tr><th>姓名</th><th>身分</th><th>佛堂</th><th>項目</th></tr></thead>
        <tbody>${x.people.map((p) => `<tr><td>${esc(p.name)}${p.accompany ? '<small>陪同</small>' : ''}</td><td>${esc(p.identity)}</td><td>${esc(p.temple)}</td><td>${esc(p.position)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="panel-empty">還沒有人報名。</p>'}
        <div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
      pm.el.querySelector('[data-close]').addEventListener('click', () => pm.close());
    }));
    body.querySelector('[data-remind]').addEventListener('click', () => {
      const text = `🙏【宏教分壇分派】${c0.title}（${cs.length} 個日期）\n\n${pending.length ? pending.map((r) => `${r.name}：還有 ${todoBy[r.code]} 天沒處理`).join('\n') + `\n\n請${catLabel(c0.category)}組長到後台「📥 分壇分派」，可以按「📅 一次放到本區行事曆」（或寫原因不參加）。` : '各區都處理好了，感恩 🙏'}`;
      const m = Modal.open(`<h2 class="modal-title">📋 提醒還沒處理的區</h2><p class="modal-note">${pending.length ? `${pending.length} 區還沒處理完。複製下面的文字傳給他們的組長：` : '各區都處理好了。'}</p>
        <textarea class="day-text" rows="8" readonly>${esc(text)}</textarea>
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
        const txt = (c, r) => { const x = cell(c, r); if (!x) return ''; const q = quotaOf(c, r, x); return x.status === 'published' ? (q ? `${x.count}/${q}` : x.count) : (STATUS[x.status] || [x.status])[0]; };
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['日期'].concat(d.regions.map((r) => r.name), ['合計'])].concat(cs.map((c) => [c.start].concat(d.regions.map((r) => txt(c, r)), [d.regions.reduce((s, r) => s + ((cell(c, r) || {}).count || 0), 0)])))), '總覽');
        const people = [];
        cs.forEach((c) => d.regions.forEach((r) => ((cell(c, r) || {}).people || []).forEach((p) => people.push([c.start, r.name, p.name, p.identity, p.temple, p.position, p.accompany ? '是' : '']))));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['日期', '區', '姓名', '身分', '佛堂', '了愿項目', '陪同']].concat(people)), '名單');
        XLSX.writeFile(wb, `${c0.title}_整組總覽_${today}.xlsx`);
      } catch (e) { alert(e.message || '匯出失敗'); }
      btn.disabled = false;
    });
  }

  /**
   * 📊 分壇統計（2026/11/22）：選期間（今年、去年、這個月、自訂）和類別，看各區的配合度與人數：
   * 收到幾次（區 × 日期）、放到行事曆、不參加、還沒處理、報名人次、名額；也依活動加總。可以匯出 Excel。
   */
  async function stats(body, guard) {
    const y = new Date().getFullYear();
    const ym = new Date().toISOString().slice(0, 7);
    const st = { period: 'year', from: y + '-01-01', to: y + '-12-31', cat: '' };
    const periods = { year: ['今年', y + '-01-01', y + '-12-31'], last: ['去年', (y - 1) + '-01-01', (y - 1) + '-12-31'], month: ['這個月', ym + '-01', ym + '-31'], custom: ['自訂', '', ''] };
    const cats = myCats();
    let d = null;
    const load = async () => {
      body.querySelector('[data-out]').innerHTML = '<p class="panel-empty">問各區的狀況中⋯</p>';
      try { d = await Api.admin('hqStats', { from: st.from, to: st.to }); } catch (e) { if (guard(e, body)) return; body.querySelector('[data-out]').innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
      paint();
    };
    body.innerHTML = `
      <h2>📊 分壇統計</h2>
      <p class="hint">看各區有沒有配合分派、報名多少人。只算已經送出的分派（草稿不算），用活動日期算期間；同一個活動好幾個日期，每個日期各算一次。</p>
      <div class="form-row"><span>期間</span><div class="seg">${Object.keys(periods).map((k) => `<label class="seg-item"><input type="radio" name="period" value="${k}"${st.period === k ? ' checked' : ''}><span>${periods[k][0]}</span></label>`).join('')}</div></div>
      <div class="form-grid-2" data-custom hidden>
        <label class="form-row"><span>從</span><input class="input" type="date" name="from" value="${st.from}"></label>
        <label class="form-row"><span>到</span><input class="input" type="date" name="to" value="${st.to}"></label>
      </div>
      ${cats.length > 1 ? `<div class="form-row"><span>類別</span><div class="seg"><label class="seg-item"><input type="radio" name="cat" value="" checked><span>全部</span></label>${cats.map(([v, l]) => `<label class="seg-item"><input type="radio" name="cat" value="${v}"><span>${l}</span></label>`).join('')}</div></div>` : `<p class="muted">類別：${esc(cats[0][1])}</p>`}
      <div data-out></div>`;
    body.querySelectorAll('input[name=period]').forEach((x) => x.addEventListener('change', () => {
      st.period = x.value;
      body.querySelector('[data-custom]').hidden = x.value !== 'custom';
      if (x.value !== 'custom') { st.from = periods[x.value][1]; st.to = periods[x.value][2]; load(); }
    }));
    ['from', 'to'].forEach((k) => body.querySelector(`input[name=${k}]`).addEventListener('change', (ev) => { st[k] = ev.target.value; if (st.from && st.to) load(); }));
    body.querySelectorAll('input[name=cat]').forEach((x) => x.addEventListener('change', () => { st.cat = x.value; paint(); }));

    function compute() {
      const today = new Date().toISOString().slice(0, 10);
      const cs = d.campaigns.filter((c) => !st.cat || c.category === st.cat);
      const reg = {};
      d.regions.forEach((r) => { reg[r.code] = { r, got: 0, pub: 0, dec: 0, todo: 0, late: 0, n: 0, q: 0, off: 0 }; });
      const acts = new Map();
      cs.forEach((c) => {
        const k = groupKey(c);
        if (!acts.has(k)) acts.set(k, { title: c.title, category: c.category, dates: 0, regions: new Set(), pub: 0, n: 0, q: 0 });
        const a = acts.get(k);
        a.dates++;
        c.regions.forEach((code) => {
          const g = reg[code]; const x = (d.cells[c.id] || {})[code];
          if (!g || !x) return;
          a.regions.add(code);
          if (x.status === 'not-open' || x.status === 'none' || x.status === 'error') { g.off++; return; }
          g.got++;
          const q = x.status === 'declined' ? 0 : Number(x.quota || (c.quotaMode === 'assigned' && c.quotas ? c.quotas[code] : '')) || 0;
          if (x.status === 'published') { g.pub++; a.pub++; }
          else if (x.status === 'declined') g.dec++;
          else if (x.status === 'new' || x.status === 'seen') { if (c.end < today) g.late++; else g.todo++; }
          g.n += x.count || 0; a.n += x.count || 0; g.q += q; a.q += q;
        });
      });
      const rows = Object.values(reg).filter((g) => g.got || g.off);
      return { cs, rows, acts: [...acts.values()].sort((p, q) => q.dates - p.dates || p.title.localeCompare(q.title)) };
    }
    const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
    function paint() {
      const out = body.querySelector('[data-out]');
      if (!d) return;
      const { cs, rows, acts } = compute();
      if (!cs.length) { out.innerHTML = '<p class="panel-empty">這段期間沒有送出的分派。</p>'; return; }
      const sum = (k) => rows.reduce((s, g) => s + g[k], 0);
      out.innerHTML = `
        <div class="hq-tiles">
          <div class="hq-tile"><b>${acts.length}</b><span>個活動</span><small>${cs.length} 個日期</small></div>
          <div class="hq-tile"><b>${pct(sum('pub'), sum('got'))}</b><span>放到行事曆</span><small>${sum('pub')}／${sum('got')} 次</small></div>
          <div class="hq-tile"><b>${sum('n')}</b><span>報名人次</span><small>${sum('q') ? `名額 ${sum('q')}・${pct(sum('n'), sum('q'))}` : '　'}</small></div>
          <div class="hq-tile${sum('late') + sum('todo') ? ' is-warn' : ''}"><b>${sum('late') + sum('todo')}</b><span>還沒處理</span><small>${sum('late') ? `其中 ${sum('late')} 次已經過了` : '　'}</small></div>
        </div>
        <div class="admin-actions"><button type="button" class="btn" data-xlsx>⬇ 匯出 Excel</button></div>
        <h3>各區</h3>
        <p class="hint">收到＝分派到這一區的次數（區 × 日期）；放上去的比例越高越配合。「過了沒處理」＝活動日期過了還沒放也沒回不參加。</p>
        <div class="hq-table-wrap"><table class="hq-table hq-stat-table">
          <thead><tr><th>區</th><th>收到</th><th>放到行事曆</th><th>不參加</th><th>還沒處理</th><th>過了沒處理</th><th>報名人次</th><th>名額</th></tr></thead>
          <tbody>${rows.sort((a, b) => b.pub / (b.got || 1) - a.pub / (a.got || 1) || b.n - a.n).map((g) => `<tr>
            <th>${esc(g.r.name)}${g.off && !g.got ? '<small>還沒開通</small>' : ''}</th><td>${g.got}</td>
            <td><b>${g.pub}</b><small>${pct(g.pub, g.got)}</small></td><td>${g.dec || '—'}</td>
            <td>${g.todo ? `<span class="hq-st st-new">${g.todo}</span>` : '—'}</td><td>${g.late ? `<span class="hq-st st-no">${g.late}</span>` : '—'}</td>
            <td><b>${g.n}</b></td><td>${g.q ? `${g.q}<small>${pct(g.n, g.q)}</small>` : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th>合計</th><td>${sum('got')}</td><td><b>${sum('pub')}</b><small>${pct(sum('pub'), sum('got'))}</small></td><td>${sum('dec')}</td><td>${sum('todo')}</td><td>${sum('late')}</td><td><b>${sum('n')}</b></td><td>${sum('q') || '—'}</td></tr></tfoot>
        </table></div>
        <h3>各活動</h3>
        <div class="hq-table-wrap"><table class="hq-table hq-stat-table">
          <thead><tr><th>活動</th><th>類別</th><th>日期數</th><th>送給幾區</th><th>報名人次</th><th>名額</th></tr></thead>
          <tbody>${acts.map((a) => `<tr><th>${esc(a.title)}</th><td>${esc(catLabel(a.category))}</td><td>${a.dates}</td><td>${a.regions.size}</td><td><b>${a.n}</b></td><td>${a.q ? `${a.q}<small>${pct(a.n, a.q)}</small>` : '—'}</td></tr>`).join('')}</tbody>
        </table></div>`;
      out.querySelector('[data-xlsx]').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
          await loadXlsx();
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['區', '收到', '放到行事曆', '比例', '不參加', '還沒處理', '過了沒處理', '報名人次', '名額']].concat(rows.map((g) => [g.r.name, g.got, g.pub, pct(g.pub, g.got), g.dec, g.todo, g.late, g.n, g.q || '']))), '各區');
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['活動', '類別', '日期數', '送給幾區', '報名人次', '名額']].concat(acts.map((a) => [a.title, catLabel(a.category), a.dates, a.regions.size, a.n, a.q || '']))), '各活動');
          XLSX.writeFile(wb, `分壇統計_${st.from}_${st.to}${st.cat ? '_' + catLabel(st.cat) : ''}.xlsx`);
        } catch (e) { alert(e.message || '匯出失敗'); }
        btn.disabled = false;
      });
    }
    load();
  }

  /** 「11/22、11/24、11/29⋯共 12 天」 */
  function datesText(items) {
    const ds = items.map((c) => Fmt.shortDate(c.start) + (c.end && c.end !== c.start ? '～' + Fmt.shortDate(c.end) : ''));
    return ds.length > 4 ? ds.slice(0, 3).join('、') + `⋯共 ${ds.length} 個日期` : ds.join('、');
  }
  const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  /** 同名草稿一起檢查：共同的資料填一次，每個日期可改時間、送給哪幾區，一次送出 */
  async function groupPage(body, guard, key) {
    let data;
    try { data = await Api.admin('hqList', {}); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
    const g = draftGroups(data.campaigns).find((x) => x.key === key);
    if (!g) { body.innerHTML = '<p class="panel-empty">找不到這一組草稿，可能已經送出或刪掉了。<a href="#/admin">回分派清單</a></p>'; return; }
    const f0 = g.items[0];
    const c = { title: f0.title, category: f0.category, nature: f0.nature, location: f0.location, attire: f0.attire || '', description: f0.description, positions: f0.positions && f0.positions.length ? f0.positions : [{ name: '參加' }], quotaMode: f0.quotaMode || 'none', quotas: Object.assign({}, f0.quotas), deadlineDays: '' };
    const rows = g.items.map((x) => ({ id: x.id, pick: true, start: x.start, end: x.end, startTime: x.startTime, endTime: x.endTime, regions: x.regions.slice(), description: x.description, source: x.source }));
    const sameDesc = rows.every((r) => r.description === f0.description);
    const regionNames = (codes) => (codes.length === data.targets.length ? '全部 ' + codes.length + ' 區' : codes.length ? data.targets.filter((t) => codes.indexOf(t.code) !== -1).map((t) => t.name.replace(/區$/, '')).join('、') : '還沒選');
    const draw = () => {
      const allRegions = data.targets.filter((t) => rows.some((r) => r.pick && r.regions.indexOf(t.code) !== -1));
      const n = rows.filter((r) => r.pick).length;
      body.innerHTML = `
        <p><a href="#/admin">‹ 分派清單</a></p>
        <h2><span class="hq-st st-seen">📝 草稿</span> ${esc(c.title)}${rows.length > 1 ? `<small>（${rows.length} 個日期）</small>` : ''}</h2>
        <p class="notice">📝 各區還看不到。${rows.length > 1 ? '同一個名稱的草稿在這裡<strong>一起檢查一次</strong>：上面共同的資料填一次，下面每個日期確認時間和送給哪幾區，' : '補好說明、了愿項目、名額，確認日期時間，'}再按「送出給各區」。</p>
        <form class="admin-form hq-form" novalidate>
          <label class="form-row"><span>名稱</span><input class="input" name="title" maxlength="40" value="${esc(c.title)}" required></label>
          <div class="form-row"><span>類別（送給各區哪一組的組長）</span><div class="seg">${myCats().map(([v, l]) => `<label class="seg-item"><input type="radio" name="category" value="${v}"${c.category === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
          <label class="form-row"><span>性質</span><select class="input" name="nature">${NATURES[c.category].map((x) => `<option${x === c.nature ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="form-row"><span>地點</span><input class="input" name="location" maxlength="40" value="${esc(c.location)}"></label>
          <label class="form-row"><span>服裝（可空白）</span><input class="input" name="attire" maxlength="40" value="${esc(c.attire)}"></label>
          <label class="form-row"><span>說明${sameDesc ? '' : '（每個日期 AI 讀到的不一樣，填了這裡就全部用這段；空白＝各自用原本的）'}</span><textarea class="input textarea" name="description" rows="4" maxlength="2000">${esc(sameDesc ? c.description : '')}</textarea></label>
          <label class="form-row"><span>了愿項目（好幾項用「、」分開；只有一項＝大家都報這個）</span><input class="input" name="positions" value="${esc(c.positions.map((p) => p.name).join('、'))}"></label>
          <label class="form-row"><span>報名截止：活動前幾天（可空白）</span><input class="input" name="deadlineDays" inputmode="numeric" maxlength="2" value="${esc(c.deadlineDays)}" placeholder="例：3"></label>
          <fieldset class="form-block">
            <legend>名額（每個日期都一樣）</legend>
            <div class="seg">${[['none', '不限'], ['assigned', '分壇分配'], ['self', '各區自己報']].map(([v, l]) => `<label class="seg-item"><input type="radio" name="quotaMode" value="${v}"${c.quotaMode === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
            ${c.quotaMode === 'assigned' ? `<p class="hint">每區每次幾位（空白＝那一區不限）。</p>
              <div class="hq-quotas">${allRegions.map((t) => `<label class="form-row" data-quota-row="${t.code}"><span>${esc(t.name)}</span><input class="input" name="q-${t.code}" inputmode="numeric" maxlength="4" value="${esc(c.quotas[t.code] || '')}"></label>`).join('')}</div>` : ''}
            ${c.quotaMode === 'self' ? '<p class="hint">各區組長放到行事曆時自己填要幾位。</p>' : ''}
          </fieldset>
          <fieldset class="form-block">
            <legend>日期（${n}／${rows.length} 個要送出）</legend>
            <div class="hq-import-dates hq-group-dates">${rows.map((r, i) => `
              <div class="hq-import-row${r.pick ? '' : ' is-off'}" data-i="${i}">
                <label class="check"><input type="checkbox" data-k="pick"${r.pick ? ' checked' : ''} aria-label="送出這一天"></label>
                <div class="hq-import-fields">
                  <div class="hq-import-line hq-import-when">
                    <input class="input" type="date" data-k="start" value="${esc(r.start)}" aria-label="日期">
                    <input class="input" type="date" data-k="end" value="${esc(r.end !== r.start ? r.end : '')}" aria-label="結束日（一天就空白）">
                    <input class="input" data-k="startTime" value="${esc(r.startTime)}" placeholder="開始時間" aria-label="開始時間">
                    <input class="input" data-k="endTime" value="${esc(r.endTime)}" placeholder="結束時間" aria-label="結束時間">
                  </div>
                  <details class="hq-import-to"${r.regions.length ? '' : ' open'}>
                    <summary>📨 送給：<strong${r.regions.length ? '' : ' class="form-error"'}>${esc(regionNames(r.regions))}</strong> <small>✏️ 改</small></summary>
                    <div class="hq-regions">${data.targets.map((t) => `<label class="check"><input type="checkbox" data-row-region="${t.code}"${r.regions.indexOf(t.code) !== -1 ? ' checked' : ''}> ${esc(t.name)}${t.open ? '' : '<small class="muted">（還沒開通）</small>'}</label>`).join('')}</div>
                  </details>
                  ${!sameDesc && r.description ? `<small class="muted">${esc(r.description.slice(0, 80))}</small>` : ''}
                </div>
              </div>`).join('')}</div>
            ${rows.length > 1 ? `<details class="hq-import-to"><summary>📨 全部日期改成送給⋯ <small>✏️</small></summary>
              <div class="hq-regions">${data.targets.map((t) => `<label class="check"><input type="checkbox" data-all-region="${t.code}"> ${esc(t.name)}</label>`).join('')}</div>
              <button type="button" class="btn" data-all-apply>套用到勾選的日期</button></details>` : ''}
          </fieldset>
          <div class="form-error" data-error hidden></div>
          <div class="form-actions"><button type="submit" class="btn btn-primary btn-block"${n ? '' : ' disabled'}>送出給各區（${n} 個日期）</button>
            <button type="button" class="btn btn-block" data-save-draft>📝 先存草稿（不送出）</button>
            <button type="button" class="btn btn-quiet-danger btn-block" data-del>🗑 刪除這${rows.length > 1 ? '一組' : '個'}草稿</button></div>
        </form>`;
      const f = body.querySelector('form');
      const sync = () => {
        ['title', 'nature', 'location', 'attire', 'description', 'deadlineDays'].forEach((k) => { c[k] = f.elements[k].value; });
        c.positions = f.elements.positions.value.split(/[\n、,，]+/).map((x) => x.trim()).filter(Boolean).map((name) => ({ name }));
        f.querySelectorAll('[data-quota-row]').forEach((row) => { c.quotas[row.dataset.quotaRow] = row.querySelector('input').value.trim(); });
      };
      const redraw = () => { sync(); const y = scrollY; draw(); scrollTo(0, y); };
      f.querySelectorAll('input[name=category]').forEach((x) => x.addEventListener('change', () => { sync(); c.category = x.value; c.nature = ''; draw(); }));
      f.querySelectorAll('input[name=quotaMode]').forEach((x) => x.addEventListener('change', () => { sync(); c.quotaMode = x.value; draw(); }));
      f.querySelectorAll('[data-i]').forEach((el) => {
        const r = rows[Number(el.dataset.i)];
        el.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
          const k = inp.dataset.k;
          if (k === 'pick') { r.pick = inp.checked; redraw(); return; }
          r[k] = inp.value;
          if ((k === 'startTime' || k === 'endTime') && inp.value) { const t = Fmt.parseTime(inp.value); if (t) { r[k] = t; inp.value = t; } }
        }));
        el.querySelectorAll('[data-row-region]').forEach((inp) => inp.addEventListener('change', () => {
          r.regions = [...el.querySelectorAll('[data-row-region]:checked')].map((y) => y.dataset.rowRegion);
          const s = el.querySelector('summary strong'); s.textContent = regionNames(r.regions); s.className = r.regions.length ? '' : 'form-error';
        }));
      });
      const ap = f.querySelector('[data-all-apply]');
      if (ap) ap.addEventListener('click', () => {
        const codes = [...f.querySelectorAll('[data-all-region]:checked')].map((y) => y.dataset.allRegion);
        if (!codes.length) { alert('請先勾要送給哪幾區'); return; }
        rows.forEach((r) => { if (r.pick) r.regions = codes.slice(); });
        redraw();
      });
      const save = async (draft) => {
        sync();
        const box = body.querySelector('[data-error]');
        box.hidden = true;
        const todo = draft ? rows : rows.filter((r) => r.pick);
        const bad = todo.filter((r) => !r.start || (!draft && !r.regions.length));
        if (bad.length) { box.textContent = bad.some((r) => !r.start) ? '有日期沒填' : '有 ' + bad.length + ' 個日期還沒選送給哪幾區：' + bad.map((r) => Fmt.shortDate(r.start)).join('、'); box.hidden = false; return; }
        const days = Number(c.deadlineDays);
        const t = (v) => { const x = Fmt.parseTime(v); return x === null ? v : x; };
        // 一次送出（hqSaveMany：每一區只叫一次），不用一筆一筆等
        const items = todo.map((r) => ({ id: r.id, title: c.title, category: c.category, nature: c.nature, location: c.location, attire: c.attire, description: c.description.trim() || r.description, positions: c.positions, quotaMode: c.quotaMode, quotas: c.quotas,
          start: r.start, end: r.end || r.start, startTime: t(r.startTime), endTime: t(r.endTime), regions: r.regions, deadline: days > 0 ? addDays(r.start, -days) : '' }));
        Busy.show(`${draft ? '存草稿' : '送出'}中⋯（${todo.length} 個日期）`);
        try {
          const res = await Api.admin('hqSaveMany', { items, draft });
          Busy.hide();
          const bad = draft ? 0 : res.campaigns.filter((x) => Object.values(x.delivery || {}).some((v) => /^error/.test(v))).length;
          location.hash = '#/admin';
          setTimeout(() => { const b = document.querySelector('[data-body]'); if (b) b.insertAdjacentHTML('afterbegin', `<div class="notice notice-success" role="status"><p>✅ ${draft ? '已存草稿' : '已送出給各區'}：${esc(c.title)} ${res.saved} 個日期。${bad ? `<br>⚠️ 有 ${bad} 個日期某幾區沒送到，點進去看，按「✏️ 修改」再存一次會重送。` : ''}</p></div>`); }, 800);
        } catch (e) {
          Busy.hide();
          if (guard(e)) return;
          box.innerHTML = errHtml(e);
          box.hidden = false;
        }
      };
      f.addEventListener('submit', (ev) => { ev.preventDefault(); save(false); });
      body.querySelector('[data-save-draft]').addEventListener('click', () => save(true));
      body.querySelector('[data-del]').addEventListener('click', async () => {
        if (!(await Confirm.open({ title: `確定要刪除${rows.length > 1 ? '這一組' : '這個'}草稿嗎？`, rows: [['名稱', c.title], ['日期', datesText(rows)]], confirmText: '確定刪除', cancelText: '不要刪除', danger: true }))) return;
        Busy.show('刪除中⋯');
        try {
          await Api.admin('hqDeleteDrafts', { ids: rows.map((r) => r.id) });
          Busy.hide(); location.hash = '#/admin';
        } catch (e) { Busy.hide(); if (!guard(e)) alert(e.message); }
      });
    };
    draw();
  }

  async function form(body, guard, id) {
    let data;
    try { data = await Api.admin('hqList', {}); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
    const old = id ? data.campaigns.find((c) => c.id === id) : null;
    if (id && !old) { body.innerHTML = '<p class="panel-empty">找不到這個分派，可能已經刪掉了。<a href="#/admin">回分派清單</a></p>'; return; }
    const c = old || { title: '', category: myCats()[0][0], nature: '', start: '', end: '', startTime: '', endTime: '', location: '', attire: '', description: '', positions: [{ name: '參加' }], deadline: '', quotaMode: 'none', quotas: {}, regions: data.targets.filter((t) => t.open).map((t) => t.code) };
    const st = { category: c.category, quotaMode: c.quotaMode };
    let asDraft = false;
    const draw = () => {
      body.innerHTML = `
        <p><a href="${old ? '#/admin/hq/' + encodeURIComponent(old.id) : '#/admin'}">‹ 返回</a></p>
        <h2>${old ? '✏️ 修改分派' : '＋ 開新的分派'}</h2>
        ${old && old.status !== 'draft' ? '<p class="notice">存檔後會重新送給各區：已經放到行事曆的區，內容會跟著改；組長後台會看到「分壇有更新」。</p>' : ''}
        ${old && old.status === 'draft' ? '<p class="notice">📝 這是草稿，各區還看不到。補好說明、了愿項目、名額，確認日期時間沒錯，再按「送出給各區」。</p>' : ''}
        <form class="admin-form hq-form" novalidate>
          <label class="form-row"><span>名稱</span><input class="input" name="title" maxlength="40" value="${esc(c.title)}" placeholder="例：總壇運動會觀禮" required></label>
          <div class="form-row"><span>類別（送給各區哪一組的組長）</span><div class="seg">${myCats().map(([v, l]) => `<label class="seg-item"><input type="radio" name="category" value="${v}"${st.category === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
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
          <div class="form-actions"><button type="submit" class="btn btn-primary btn-block">${old && old.status !== 'draft' ? '存檔並重新送出' : '送出給各區'}</button>
            ${!old || old.status === 'draft' ? '<button type="button" class="btn btn-block" data-save-draft>📝 先存成草稿（不送出）</button>' : ''}</div>
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
      const dr = body.querySelector('[data-save-draft]');
      if (dr) dr.addEventListener('click', () => { asDraft = true; f.requestSubmit(); });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const draft = asDraft;
        asDraft = false;
        sync();
        const t = (v) => { const x = Fmt.parseTime(v); return x === null ? v : x; };
        const campaign = Object.assign({}, c, { id: old ? old.id : undefined, category: st.category, quotaMode: st.quotaMode, startTime: t(c.startTime), endTime: t(c.endTime), end: c.end || c.start });
        const box = body.querySelector('[data-error]');
        box.hidden = true;
        Busy.show('送出中⋯');
        try {
          const r = await Api.admin('hqSave', { campaign, draft });
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
    if (c.status === 'draft') { location.replace('#/admin/hq/group/' + encodeURIComponent(groupKey(c))); return; }
    // 還沒開通、還沒收到的區：名額照分壇分配的寫
    rows.forEach((r) => { if (!r.quota && c.quotaMode === 'assigned' && c.quotas && c.quotas[r.code]) r.quota = c.quotas[r.code]; });
    const qOf = (r) => (r.quota && r.status !== 'not-open' && r.status !== 'declined' ? Number(r.quota) : 0);
    const totalQ = rows.reduce((n, r) => n + qOf(r), 0);
    const totalN = rows.reduce((n, r) => n + (r.count || 0), 0);
    const statusHtml = (r) => { const [l, cls] = STATUS[r.status] || [r.status, '']; return `<span class="hq-st ${cls}">${l}</span>${r.status === 'declined' && r.declineReason ? `<small>${esc(r.declineReason)}</small>` : ''}${r.syncError ? `<small class="form-error">更新失敗：${esc(r.syncError)}</small>` : ''}`; };
    body.innerHTML = `
      <p><a href="#/admin">‹ 分派清單</a>　<a href="#/admin/hq/overview/${encodeURIComponent(groupKey(c))}">📊 同名的整組總覽</a></p>
      <h2>${esc(c.title)}</h2>
      <p class="muted">${esc(catLabel(c.category))}・${esc(when(c))}${c.deadline ? '・報名截止 ' + esc(Fmt.shortDate(c.deadline)) : ''}・名額：${esc({ none: '不限', assigned: '分壇分配', self: '各區自己報' }[c.quotaMode])}</p>
      <div class="admin-actions">
        ${readOnly() ? '' : `<a class="btn" href="#/admin/hq/edit/${encodeURIComponent(c.id)}">✏️ 修改</a>`}
        <button type="button" class="btn" data-xlsx>⬇ 匯出 Excel</button>
        <button type="button" class="btn" data-remind>📋 提醒還沒處理的區</button>
        ${readOnly() ? '' : '<button type="button" class="btn btn-quiet-danger" data-del>🗑 刪除分派</button>'}
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
    if (body.querySelector('[data-del]')) body.querySelector('[data-del]').addEventListener('click', async () => {
      const ok = await Confirm.open({ title: '確定要刪除這個分派嗎？', rows: [['名稱', c.title], ['日期', when(c)]], note: '各區的收件匣會標「分壇已收回」。已經放到行事曆、有人報名的，那一區的活動會留著，由組長自己決定。', confirmText: '確定刪除', cancelText: '不要刪除', danger: true });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try { await Api.admin('hqDelete', { id: c.id }); Busy.hide(); location.hash = '#/admin'; } catch (e) { Busy.hide(); if (!guard(e)) alert(e.message); }
    });
  }


  // ---------- 📄 從檔案匯入行事曆（2026/11/22）：AI 讀檔 → 勾選、修改 → 存成草稿 ----------

  const LUNAR_MONTH = { 正: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 冬: 11, 十二: 12, 臘: 12, 腊: 12 };
  const LUNAR_DAY = (s) => { const m = String(s).match(/^(初|十|廿|二十|三十)?([一二三四五六七八九十])?$/); if (!m) return 0; const n = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }; const head = m[1] || ''; const tail = m[2] ? n[m[2]] : 0; if (head === '初') return tail; if (head === '十') return 10 + tail; if (head === '廿' || head === '二十') return 20 + tail; if (head === '三十') return 30; return tail; };
  /** 農曆「九月十五」「閏六月初一」→ 國曆（lunar-javascript）；換不出來回傳 '' */
  function lunarToSolar(text, year) {
    const m = String(text || '').replace(/\s/g, '').match(/^(閏)?(正|十一|十二|冬|臘|腊|一|二|三|四|五|六|七|八|九|十)月(.+)$/);
    if (!m || !window.Lunar) return '';
    const mo = LUNAR_MONTH[m[2]] * (m[1] ? -1 : 1);
    const d = LUNAR_DAY(m[3]);
    if (!d) return '';
    try { return window.Lunar.fromYmd(Number(year) || new Date().getFullYear(), mo, d).getSolar().toYmd(); } catch (e) { return ''; }
  }
  /** 「6-8, 10」→ 要讀的頁碼集合（空白＝全部） */
  function pageSet(text, max) {
    const t = String(text || '').trim();
    if (!t) return null;
    const out = new Set();
    t.split(/[,，、\s]+/).forEach((p) => { const m = p.match(/^(\d+)(?:[-～~到](\d+))?$/); if (!m) return; const a = Number(m[1]), b = Number(m[2] || m[1]); for (let i = Math.max(1, a); i <= Math.min(max, b); i++) out.add(i); });
    return out.size ? out : null;
  }
  /** 圖片縮小成 JPEG（最寬 1600），回傳 base64 */
  async function shrink(src) {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('圖片讀不到')); i.src = src; });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }
  const fileUrl = (f) => URL.createObjectURL(f);

  /** 把檔案拆成一批一批要給 AI 讀的：{ label, images: [{mime,data}], text } */
  async function chunksOf(file, pages, onPage) {
    const name = file.name || '檔案';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const out = [];
    if (/^image\//.test(file.type) || ['jpg', 'jpeg', 'png', 'webp', 'heic'].indexOf(ext) !== -1) {
      const u = fileUrl(file);
      try { out.push({ label: name, images: [{ mime: 'image/jpeg', data: await shrink(u) }] }); } finally { URL.revokeObjectURL(u); }
      return out;
    }
    if (ext === 'pdf') {
      await MemberFile.loadPdfJs();
      const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const want = pageSet(pages, pdf.numPages);
      let imgs = [], imgFrom = 0, imgTo = 0, texts = [], textFrom = 0, textTo = 0;
      const flushImgs = () => { const to = imgTo; if (imgs.length) out.push({ label: `${name} 第 ${imgFrom}${to > imgFrom ? '～' + to : ''} 頁`, images: imgs }); imgs = []; };
      const flushText = () => { const to = textTo; if (texts.length) out.push({ label: `${name} 第 ${textFrom}${to > textFrom ? '～' + to : ''} 頁`, text: texts.join('\n\n') }); texts = []; };
      for (let p = 1; p <= pdf.numPages; p++) {
        if (want && !want.has(p)) continue;
        if (onPage) onPage(p, pdf.numPages);
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();
        // NFKC：PDF 的部首字（⽉⽇⼤）換回一般的字；中文字之間的空白拿掉
        const txt = tc.items.map((it) => it.str).join(' ').normalize('NFKC').replace(/\s+/g, ' ').replace(/([㐀-鿿])\s+(?=[㐀-鿿])/g, '$1').trim();
        if (txt.length > 80) { // 有文字的頁：直接給文字（快、準）
          if (!texts.length) textFrom = p;
          texts.push('【第 ' + p + ' 頁】' + txt);
          textTo = p;
          if (texts.join('').length > 12000) flushText();
        } else { // 掃描的頁：畫成圖片
          const vp = page.getViewport({ scale: Math.min(2, 1600 / page.getViewport({ scale: 1 }).width) });
          const c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          if (!imgs.length) imgFrom = p;
          imgs.push({ mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.75).split(',')[1] });
          imgTo = p;
          if (imgs.length >= 4) flushImgs();
        }
      }
      flushImgs(); flushText();
      return out;
    }
    if (['docx', 'xlsx', 'xls', 'xlsm', 'csv', 'ods'].indexOf(ext) !== -1) {
      const srcs = await MemberFile.readFile(file);
      const text = srcs.map((s) => '【' + s.label + '】\n' + s.rows.map((r) => r.map((x) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x == null ? '' : x))).filter(Boolean).join('\t')).filter(Boolean).join('\n')).join('\n\n');
      for (let i = 0; i < text.length; i += 12000) out.push({ label: name + (text.length > 12000 ? ` 第 ${i / 12000 + 1} 段` : ''), text: text.slice(i, i + 12000) });
      return out;
    }
    if (ext === 'doc') throw new Error(`「${name}」是舊版 Word（.doc），請用 Word 打開後「另存新檔」成 .docx 再選`);
    throw new Error(`「${name}」不是 PDF、Word、Excel 或照片`);
  }

  async function importPage(body, guard) {
    let data;
    try { data = await Api.admin('hqList', {}); } catch (e) { if (guard(e, body)) return; body.innerHTML = `<p class="form-error">${errHtml(e)}</p>`; return; }
    const today = new Date().toISOString().slice(0, 10);
    let rows = []; // 讀到的活動 { pick, title, category, start, end, startTime, endTime, location, description, uncertain, source }
    const st = { regions: data.targets.filter((t) => t.open).map((t) => t.code) };
    body.innerHTML = `
      <p><a href="#/admin">‹ 分派清單</a></p>
      <h2>📄 從檔案匯入行事曆</h2>
      <p class="notice">選分壇的行事曆檔案（PDF、Word、Excel 或照片，掃描的也可以），AI 會整理成一筆一筆的活動。<strong>匯入的先存成草稿，各區還看不到</strong>，補好資料再一筆一筆送出。</p>
      <label class="btn btn-block">📂 選檔案（可以好幾個）<input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.ods,image/*" multiple hidden data-files></label>
      <p class="muted" data-picked></p>
      <div class="form-grid-2">
        <label class="form-row"><span>PDF 只讀第幾頁（可空白＝全部，例：6-8, 13）</span><input class="input" data-pages placeholder="例：6-8"></label>
        <label class="form-row"><span>給 AI 的補充說明（可空白）</span><input class="input" data-hint placeholder="例：只要 115 年的；日期是民國年"></label>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-read disabled>先選檔案，才能開始讀</button>
      <p class="hint">檔案會交給 Google 的 AI 讀（和「從照片新增」一樣）。AI 可能看錯，日期、時間請一定要看過。人名、電話不會整理進來。</p>
      <div data-progress></div>
      <div data-rows></div>`;
    /** AI 寫的區名（「仁孝」「教志區」「全部」）→ 區代號；「仁孝」這種兩個字的，一個字一區 */
    function regionsOf(names) {
      const out = new Set();
      (Array.isArray(names) ? names : []).forEach((s) => {
        s = String(s || '').replace(/\s/g, '');
        if (!s) return;
        if (/全部|各區/.test(s)) { data.targets.forEach((t) => out.add(t.code)); return; }
        const full = data.targets.find((t) => s === t.name || s + '區' === t.name || '教' + s + '區' === t.name || '教' + s === t.name);
        if (full) { out.add(full.code); return; }
        s.replace(/[教區]/g, '').split('').forEach((ch) => { const t = data.targets.find((y) => y.name === '教' + ch + '區'); if (t) out.add(t.code); });
      });
      return data.targets.map((t) => t.code).filter((c) => out.has(c));
    }
    const regionNames = (codes) => (codes.length === data.targets.length ? '全部 ' + codes.length + ' 區' : codes.length ? data.targets.filter((t) => codes.indexOf(t.code) !== -1).map((t) => t.name.replace(/區$/, '')).join('、') : '還沒選');
    let files = [];
    const fin = body.querySelector('[data-files]');
    fin.addEventListener('change', () => {
      files = [...fin.files];
      body.querySelector('[data-picked]').textContent = files.length ? '已選：' + files.map((f) => f.name).join('、') : '';
      const rb = body.querySelector('[data-read]'); rb.disabled = !files.length; rb.textContent = files.length ? '🔍 開始讀' : '先選檔案，才能開始讀';
    });
    const prog = body.querySelector('[data-progress]');
    body.querySelector('[data-read]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const errs = [];
      let chunks = [];
      prog.innerHTML = '<p class="muted">準備檔案中⋯</p>';
      for (const f of files) {
        try { chunks = chunks.concat((await chunksOf(f, body.querySelector('[data-pages]').value, (p, n) => { prog.innerHTML = `<p class="muted">準備檔案中⋯（${esc(f.name)} 第 ${p}／${n} 頁）</p>`; })).map((c) => Object.assign(c, { file: f.name }))); } catch (e) { errs.push(e.message || String(e)); }
      }
      const found = [];
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const t0 = Date.now(); const paint = () => { prog.innerHTML = `<p class="muted">AI 讀檔中⋯（${i + 1}／${chunks.length}：${esc(c.label)}）已經 ${Math.round((Date.now() - t0) / 1000)} 秒，每一批大約 10～60 秒</p><progress max="${chunks.length}" value="${i}"></progress>`; }; paint(); const tick = setInterval(paint, 1000);
        try {
          const r = await Api.admin('hqImportAi', { images: c.images || [], text: c.text || '', hint: body.querySelector('[data-hint]').value, part: c.label });
          r.items.forEach((x) => found.push(Object.assign({}, x, { source: c.label })));
        } catch (e) {
          if (e.code === 'UNAUTHORIZED') { guard(e); return; }
          errs.push(`${c.label}：${e.code === 'NETWORK' ? '等太久沒有回應（這一批可能太多頁，可以用「只讀第幾頁」分開讀）' : e.message}`);
          if (e.code === 'AI_LIMIT' || e.code === 'CONFIG') break;
        } finally { clearInterval(tick); }
      }
      btn.disabled = false;
      // 整理：農曆換國曆、同名同天只留一筆、過去的不勾
      const seen = new Set();
      rows = found.map((x) => {
        let start = /^\d{4}-\d{2}-\d{2}$/.test(x.start || '') ? x.start : '';
        if (!start && x.lunarDate) start = lunarToSolar(x.lunarDate, x.lunarYear);
        const end = /^\d{4}-\d{2}-\d{2}$/.test(x.end || '') && x.end >= start ? x.end : start;
        const tt = (v) => { const t = Fmt.parseTime(String(v || '')); return t || ''; };
        const named = regionsOf(x.regions);
        return { regions: named.length ? named : st.regions.slice(), byAi: named.length > 0, title: String(x.title || '').trim().slice(0, 40), category: myCats().some(([v]) => v === x.category) ? x.category : myCats()[0][0], start, end, startTime: tt(x.startTime), endTime: tt(x.endTime), location: String(x.location || '').slice(0, 40), description: String(x.description || '').slice(0, 2000), lunar: x.lunarDate || '', uncertain: Array.isArray(x.uncertain) ? x.uncertain.join('；') : '', source: x.source };
      }).filter((x) => { const k = x.title + '|' + x.start; if (!x.title || seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
      rows.forEach((x) => { x.pick = !!x.start && x.start >= today; });
      prog.innerHTML = (errs.length ? `<p class="form-error">${errs.map(esc).join('<br>')}</p>` : '') + `<p>讀到 <strong>${rows.length}</strong> 筆活動${rows.length ? '，看一下、改一下，不要的取消勾選。已經過去的日期先不勾。' : '。'}</p>`;
      drawRows();
    });

    function drawRows() {
      const box = body.querySelector('[data-rows]');
      if (!rows.length) { box.innerHTML = ''; return; }
      const n = rows.filter((x) => x.pick).length;
      const redraw = () => { const y = scrollY; drawRows(); scrollTo(0, y); };
      // 同一個活動名稱（同類別）整理成一組，下面一個日期一行
      const gm = new Map();
      rows.forEach((x, i) => { const k = x.title.replace(/\s/g, '') + '|' + x.category; if (!gm.has(k)) gm.set(k, { items: [] }); gm.get(k).items.push(i); });
      const groups = [...gm.values()];
      groups.forEach((g) => g.items.sort((p, q) => (rows[p].start || '9999').localeCompare(rows[q].start || '9999')));
      groups.sort((p, q) => (rows[p.items[0]].start || '9999').localeCompare(rows[q.items[0]].start || '9999'));
      box.innerHTML = `
        <fieldset class="form-block">
          <legend>預設送給哪幾區</legend>
          <p class="hint">下面同一個名稱的活動整理成一組，每個日期一行。表上沒寫哪一區的都用這裡的設定；表上有寫「輪值區別」的，會自動勾那幾區。每個日期的「送給」可以單獨改，也可以用「這一組全部改成送給⋯」一次改。</p>
          <div class="hq-regions">${data.targets.map((t) => `<label class="check"><input type="checkbox" data-region="${t.code}"${st.regions.indexOf(t.code) !== -1 ? ' checked' : ''}> ${esc(t.name)}${t.open ? '' : '<small class="muted">（還沒開通）</small>'}</label>`).join('')}</div>
        </fieldset>
        <div class="hq-import-list">${groups.map((g, gi) => {
          const on = g.items.filter((x) => rows[x].pick).length;
          const f0 = rows[g.items[0]];
          const srcs = [...new Set(g.items.map((x) => rows[x].source))];
          return `
          <section class="hq-import-group${on ? '' : ' is-off'}" data-g="${gi}">
            <div class="hq-import-head">
              <label class="check" title="整組勾選"><input type="checkbox" data-gk="pick"${on === g.items.length ? ' checked' : ''}${on && on < g.items.length ? ' data-partial' : ''} aria-label="整組勾選"></label>
              <div class="hq-import-fields">
                <input class="input hq-import-title" data-gk="title" value="${esc(f0.title)}" aria-label="活動名稱">
                <div class="hq-import-line">
                  <select class="input" data-gk="category" aria-label="類別">${myCats().map(([v, l]) => `<option value="${v}"${f0.category === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
                  <input class="input" data-gk="location" value="${esc(f0.location)}" placeholder="地點" aria-label="地點">
                </div>
                <small class="muted">${g.items.length} 個日期，勾了 ${on} 個・來源：${esc(srcs.join('、'))}</small>
              </div>
            </div>
            <div class="hq-import-dates">${g.items.map((i) => { const x = rows[i]; return `
              <div class="hq-import-row${x.pick ? '' : ' is-off'}${x.start && x.start < today ? ' is-past' : ''}" data-i="${i}">
                <label class="check"><input type="checkbox" data-k="pick"${x.pick ? ' checked' : ''} aria-label="這一天"></label>
                <div class="hq-import-fields">
                  <div class="hq-import-line hq-import-when">
                    <input class="input" type="date" data-k="start" value="${esc(x.start)}" aria-label="日期">
                    <input class="input" type="date" data-k="end" value="${esc(x.end && x.end !== x.start ? x.end : '')}" aria-label="結束日（一天就空白）">
                    <input class="input" data-k="startTime" value="${esc(x.startTime)}" placeholder="開始時間" aria-label="開始時間">
                    <input class="input" data-k="endTime" value="${esc(x.endTime)}" placeholder="結束時間" aria-label="結束時間">
                  </div>
                  <details class="hq-import-to"${x.regions.length ? '' : ' open'}>
                    <summary>📨 送給：<strong${x.regions.length ? '' : ' class="form-error"'}>${esc(regionNames(x.regions))}</strong>${x.byAi && !x.custom ? '<small class="muted">（表上寫的）</small>' : ''} <small>✏️ 改</small></summary>
                    <div class="hq-regions">${data.targets.map((t) => `<label class="check"><input type="checkbox" data-row-region="${t.code}"${x.regions.indexOf(t.code) !== -1 ? ' checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>
                  </details>
                  ${x.lunar || (x.start && x.start < today) || x.description ? `<small class="muted">${x.lunar ? '農曆' + esc(x.lunar) + (x.start ? '（已換成國曆）' : '（換不出國曆，請自己填日期）') + '・' : ''}${x.start && x.start < today ? '已經過了・' : ''}${esc(x.description.slice(0, 60))}</small>` : ''}
                  ${x.uncertain ? `<small class="form-error">AI 不確定：${esc(x.uncertain)}</small>` : ''}
                </div>
              </div>`; }).join('')}</div>
            ${g.items.length > 1 ? `<details class="hq-import-to hq-import-all">
              <summary>📨 這一組全部改成送給⋯ <small>✏️</small></summary>
              <div class="hq-regions">${data.targets.map((t) => `<label class="check"><input type="checkbox" data-g-region="${t.code}"> ${esc(t.name)}</label>`).join('')}</div>
              <button type="button" class="btn" data-g-apply>套用到這一組勾選的日期</button>
            </details>` : ''}
          </section>`; }).join('')}</div>
        <div class="form-error" data-error hidden></div>
        <button type="button" class="btn btn-primary btn-block" data-save${n ? '' : ' disabled'}>📝 存成草稿（${n} 筆）</button>`;
      box.querySelectorAll('[data-partial]').forEach((el) => { el.indeterminate = true; });
      box.querySelectorAll('[data-g]').forEach((sec) => {
        const g = groups[Number(sec.dataset.g)];
        sec.querySelectorAll('[data-gk]').forEach((el) => el.addEventListener('change', () => {
          const k = el.dataset.gk;
          if (k === 'pick') { g.items.forEach((i) => { rows[i].pick = el.checked; }); redraw(); return; }
          g.items.forEach((i) => { rows[i][k] = k === 'title' ? el.value.trim() : el.value; });
        }));
        const ap = sec.querySelector('[data-g-apply]');
        if (ap) ap.addEventListener('click', () => {
          const codes = [...sec.querySelectorAll('[data-g-region]:checked')].map((y) => y.dataset.gRegion);
          if (!codes.length) { alert('請先勾要送給哪幾區'); return; }
          g.items.forEach((i) => { if (rows[i].pick) { rows[i].regions = codes.slice(); rows[i].custom = true; } });
          redraw();
        });
      });
      box.querySelectorAll('[data-i]').forEach((row) => {
        const x = rows[Number(row.dataset.i)];
        row.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('change', () => {
          const k = el.dataset.k;
          if (k === 'pick') { x.pick = el.checked; redraw(); return; }
          x[k] = el.value;
          if ((k === 'startTime' || k === 'endTime') && el.value) { const t = Fmt.parseTime(el.value); if (t) { x[k] = t; el.value = t; } }
        }));
        row.querySelectorAll('[data-row-region]').forEach((el) => el.addEventListener('change', () => {
          x.regions = [...row.querySelectorAll('[data-row-region]:checked')].map((y) => y.dataset.rowRegion);
          x.custom = true;
          const s = row.querySelector('.hq-import-to summary strong');
          s.textContent = regionNames(x.regions);
          s.className = x.regions.length ? '' : 'form-error';
          const m = row.querySelector('.hq-import-to summary .muted'); if (m) m.remove();
        }));
      });
      box.querySelectorAll('[data-region]').forEach((el) => el.addEventListener('change', () => {
        st.regions = [...box.querySelectorAll('[data-region]:checked')].map((y) => y.dataset.region);
        rows.forEach((x) => { if (!x.byAi && !x.custom) x.regions = st.regions.slice(); });
        redraw();
      }));
      box.querySelector('[data-save]').addEventListener('click', async () => {
        const err = box.querySelector('[data-error]');
        err.hidden = true;
        const items = rows.filter((x) => x.pick).map((x) => ({ title: x.title, category: x.category, start: x.start, end: x.end || x.start, startTime: x.startTime, endTime: x.endTime, location: x.location, description: x.description, positions: [], quotaMode: 'none', regions: x.regions, source: x.source }));
        const noDate = items.filter((x) => !x.start);
        if (noDate.length) { err.textContent = '有 ' + noDate.length + ' 筆沒有日期，請填日期或取消勾選：' + noDate.map((x) => x.title).join('、'); err.hidden = false; return; }
        const noRegion = items.filter((x) => !x.regions.length);
        if (noRegion.length) { err.textContent = '有 ' + noRegion.length + ' 筆還沒選送給哪幾區：' + noRegion.map((x) => x.title).join('、'); err.hidden = false; return; }
        Busy.show('存成草稿中⋯');
        try {
          const r = await Api.admin('hqSaveDrafts', { items });
          Busy.hide();
          location.hash = '#/admin';
          setTimeout(() => { const b = document.querySelector('[data-body]'); if (b) b.insertAdjacentHTML('afterbegin', `<div class="notice notice-success" role="status"><p>✅ 已存成 ${r.saved} 筆草稿。同名的活動已經併成一組，點每一組補說明、了愿項目、名額，一起檢查一次就可以「送出給各區」。</p></div>`); }, 800);
        } catch (e) {
          Busy.hide();
          if (guard(e)) return;
          err.innerHTML = errHtml(e);
          err.hidden = false;
        }
      });
    }
  }

  window.HqAdminPage = { show };

  // =====================================================================
  // 各區：📥 分壇分派
  // =====================================================================

  let inboxMemo = null;
  const pendingOf = (x) => x.status === 'new' || x.status === 'seen' || x.updated;

  /** 後台首頁最上面：有待處理的才顯示 */
  /** 收件匣依名稱＋類別分組（同名的好幾個日期一組），組照最早日期排 */
  function inboxGroups(items) {
    const m = new Map();
    items.forEach((x) => { const k = x.c.title.replace(/\s/g, '') + '|' + x.c.category; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    const gs = [...m.values()];
    gs.forEach((g) => g.sort((a, b) => a.c.start.localeCompare(b.c.start)));
    return gs.sort((a, b) => ((b.some(pendingOf)) - (a.some(pendingOf))) || a[0].c.start.localeCompare(b[0].c.start));
  }
  const shortDates = (xs, max) => { const ds = xs.map((x) => Fmt.shortDate(x.c.start).replace(/（.）/, '')); return ds.length > max ? ds.slice(0, max).join('、') + `⋯等 ${ds.length} 天` : ds.join('、'); };

  /** 後台首頁最上面：有待處理的才顯示 */
  async function mount(box, guard) {
    if (!box) return;
    const paint = (d) => {
      if (!box.isConnected || !d) return;
      const todo = d.items.filter(pendingOf);
      if (!d.items.length) { box.innerHTML = ''; return; }
      const gs = inboxGroups(todo);
      box.innerHTML = todo.length ? `<div class="hq-alert" role="status">
          <div class="hq-alert-head"><span class="hq-alert-icon" aria-hidden="true">!</span>
            <div><strong>${esc(d.hqName)}分派：${todo.length} 件待處理</strong><small>看過按「放到本區行事曆」家人才報得了名</small></div></div>
          <ul class="hq-alert-list">${gs.slice(0, 4).map((g) => { const upd = g.some((x) => x.updated && x.status === 'published'); return `<li>
            <span class="hq-alert-title">${upd ? '🔄 ' : ''}${esc(g[0].c.title)}<small>${esc(catLabel(g[0].c.category))}</small></span>
            <span class="hq-alert-dates">${g.length > 1 ? `<b>${g.length} 個日期</b>：` : ''}${esc(shortDates(g, 4))}${upd ? '（分壇有更新）' : ''}</span></li>`; }).join('')}
            ${gs.length > 4 ? `<li class="muted">還有 ${gs.length - 4} 個活動⋯</li>` : ''}</ul>
          <a class="btn btn-primary hq-alert-btn" href="#/admin/hqinbox">📥 去處理分派 ›</a></div>`
        : '';
    };
    paint(inboxMemo);
    try { inboxMemo = await Api.admin('adminHqInbox', {}, true); paint(inboxMemo); } catch (e) { /* 讀不到就不顯示 */ }
  }

  /** 後台上方的「📥 分壇分派」分頁：有分派才出現，有待處理的加紅色驚嘆號和件數 */
  async function tab(el) {
    if (!el) return;
    const paint = (d) => {
      if (!el.isConnected || !d) return;
      if (!d.items.length) { el.hidden = true; return; }
      const n = d.items.filter(pendingOf).length;
      el.hidden = false;
      el.innerHTML = `📥 分壇分派${n ? `<span class="tab-alert" aria-label="${n} 件待處理">! ${n}</span>` : ''}`;
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
        <h2>📥 ${esc(d.hqName)}分派</h2>
        <p class="hint">分壇送來的活動，看過按「📅 放到本區行事曆」才會出現在本區的行事曆，家人才能報名；不參加請按「本區不參加」寫原因（分壇看得到）。內容由分壇統一改。</p>
        ${d.items.length ? `<div class="hq-inbox-groups">${(groupsNow = inboxGroups(d.items)).map((g, gi) => { const todo = g.filter(pendingOf).length; const fresh = g.filter((x) => x.status === 'new' || x.status === 'seen').length; return `
          <section class="hq-inbox-group${todo ? ' has-todo' : ''}">
            <div class="hq-inbox-ghead">
              ${todo ? `<span class="hq-alert-icon" aria-hidden="true">!</span>` : '<span class="hq-ok-icon" aria-hidden="true">✓</span>'}
              <div><strong>${esc(g[0].c.title)}</strong><small>${esc(catLabel(g[0].c.category))}${g.length > 1 ? `・${g.length} 個日期` : ''}${todo ? `・<b class="hq-todo-n">${todo} 件待處理</b>` : '・都處理好了'}</small></div>
            </div>
            <div class="hq-inbox-rows">${g.map((x) => { const [l, cls] = STATUS[x.status] || [x.status, '']; return `
              <button type="button" class="hq-inbox-row${pendingOf(x) ? ' is-todo' : ''}" data-open="${d.items.indexOf(x)}">
                <span class="hq-inbox-when">${esc(when(x.c))}</span>
                <span class="hq-inbox-st"><span class="hq-st ${cls}">${l}</span>${x.status === 'published' ? `<small>${x.count} 位報名</small>` : ''}${x.updated ? '<span class="hq-st st-new">分壇有更新</span>' : ''}</span>
                <span class="hq-inbox-go" aria-hidden="true">›</span>
              </button>`; }).join('')}</div>
            ${fresh > 1 ? `<button type="button" class="btn btn-primary btn-block hq-group-pub" data-group-pub="${gi}">📅 這 ${fresh} 個日期一次放到本區行事曆</button>` : ''}
          </section>`; }).join('')}</div>` : '<p class="panel-empty">目前沒有分壇分派。</p>'}`;
      body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(d.items[Number(b.dataset.open)])));
      body.querySelectorAll('[data-group-pub]').forEach((b) => b.addEventListener('click', () => openGroup(groupsNow[Number(b.dataset.groupPub)])));
    };
    let groupsNow = [];
    /** 同一個活動好幾個日期：補充說明、負責組、名額填一次，整組放到本區行事曆 */
    async function openGroup(g) {
      const xs = g.filter((x) => x.status === 'new' || x.status === 'seen');
      if (!xs.length) return;
      const groups = await groupsP;
      const types = [...new Set(groups.map((y) => y.type))];
      const c = xs[0].c;
      const self = xs.some((x) => x.c.quotaMode === 'self');
      const m = Modal.open(`
        <h2 class="modal-title">📅 ${esc(c.title)}：一次放 ${xs.length} 個日期</h2>
        <p class="modal-note">${esc(catLabel(c.category))}・${esc(shortDates(xs, 8))}</p>
        <dl class="modal-rows">
          ${c.attire ? `<div><dt>服裝</dt><dd>${esc(c.attire)}</dd></div>` : ''}
          <div><dt>了愿項目</dt><dd>${esc((c.positions || []).map((p) => p.name).join('、') || '參加')}</dd></div>
          <div><dt>名額</dt><dd>${esc(self ? '各區自己報（下面填）' : quotaText(c, xs[0].quota))}</dd></div>
        </dl>
        ${c.description ? `<p class="hq-desc">${esc(c.description).replace(/\n/g, '<br>')}</p>` : ''}
        <form class="admin-form" novalidate>
          ${self ? '<label class="form-row"><span>本區每次要幾位</span><input class="input" name="quota" inputmode="numeric" maxlength="4"></label>' : ''}
          <label class="form-row"><span>本區補充說明（每個日期都一樣；可空白）</span><textarea class="input textarea" name="note" rows="3" maxlength="500"></textarea></label>
          ${types.length ? `<div class="form-grid-2"><label class="form-row"><span>負責組（可空白）</span><select class="input" name="groupType"><option value="">（不指定）</option>${types.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
            <label class="form-row"><span>&nbsp;</span><select class="input" name="group" disabled><option value="">（不指定）</option></select></label></div>` : ''}
          <p class="hint">要分開設定的日期（例如不同負責組），先點那一天單獨處理，剩下的再一次放。</p>
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-primary btn-block">📅 ${xs.length} 個日期一次放到本區行事曆</button>
            <button type="button" class="btn btn-block" data-close>返回</button>
          </div></form>`);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      const f = m.el.querySelector('form');
      const gSel = f.elements.group;
      if (gSel) f.elements.groupType.addEventListener('change', () => { const t = f.elements.groupType.value; gSel.innerHTML = `<option value="">（不指定）</option>${groups.filter((y) => y.type === t).map((y) => `<option>${esc(y.name)}</option>`).join('')}`; gSel.disabled = !t; });
      const box = f.querySelector('[data-error]');
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        box.hidden = true;
        try {
          const r = await act('adminHqPublishMany', { ids: xs.map((x) => x.id), note: f.elements.note.value, quota: f.elements.quota ? f.elements.quota.value : undefined, groupType: f.elements.groupType ? f.elements.groupType.value : '', group: gSel ? gSel.value : '' }, `放到行事曆中⋯（${xs.length} 個日期）`);
          if (!r) return;
          m.close();
          draw();
          body.insertAdjacentHTML('afterbegin', `<div class="notice notice-success" role="status"><p>✅ 已放到本區行事曆：${esc(c.title)} ${r.done} 個日期${r.errors && r.errors.length ? `<br>⚠️ 這幾天沒放上去：${r.errors.map((e) => esc(e.message)).join('；')}` : ''}</p></div>`);
          if (window.CalendarPage) CalendarPage.refresh();
          AdminPage.clearMemo();
        } catch (e) { box.innerHTML = errHtml(e); box.hidden = false; }
      });
    }
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

  window.HqInbox = { mount, page, tab };
})();
