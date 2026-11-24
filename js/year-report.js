// 📄 一鍵年度報表（2026/11/24）：後台「統計」按「📄 年度報表」，把一年的出勤整理成一頁（可以列印、存成 PDF、複製文字），開會時用。
//   總覽（場次、出勤人次、參與人數、道親佔比，和去年比）、各類別、每個月、人次最多的活動、感謝名單。
//   build() 是純函式（Node 測試用 module.exports），open() 畫畫面（瀏覽器用 window.YearReport）。
//   今年還沒過完：去年也只算到同一天，比較才公平。
(function (root) {
  'use strict';

  const CATS = ['勤務', '道務', '教育'];
  const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');

  /**
   * events：統計的出勤（adminStats 的 events，全部類別）；year：西元年；today：今天。
   * 回傳 { year, roc, until（今年還沒過完時＝today，不然 ''）, total, last, cats, months, top, thanks }
   */
  function build(events, year, today, C) {
    const p = { unit: 'year', year, n: 0 };
    const partial = today.slice(0, 4) === String(year) ? today : '';
    const lastUntil = partial ? `${year - 1}${today.slice(4)}` : undefined;
    const total = C.summarize(events, p);
    const last = C.summarize(events, C.lastYear(p), lastUntil);
    const inCat = (c) => events.filter((e) => (e.category || '勤務') === c);
    const cats = CATS.map((c) => Object.assign({ name: c, last: C.summarize(inCat(c), C.lastYear(p), lastUntil) }, C.summarize(inCat(c), p))).filter((c) => c.events || c.last.events);
    const months = Array.from({ length: 12 }, (_, i) => Object.assign({ n: i + 1, future: !!partial && `${year}-${String(i + 1).padStart(2, '0')}` > today.slice(0, 7) },
      C.summarize(events, { unit: 'month', year, n: i + 1 })));
    const top = C.byCategory(events, p).slice(0, 10);
    const thanks = C.ranking(events, p, 'all').slice(0, 15);
    return { year, roc: year - 1911, until: partial, total, last, cats, months, top, thanks };
  }

  /** 和去年比：+12%、-5%、（去年沒有）'' */
  function diff(now, before) {
    if (!before) return '';
    const d = Math.round(((now - before) / before) * 100);
    return d === 0 ? '和去年一樣' : (d > 0 ? '比去年多 ' : '比去年少 ') + Math.abs(d) + '%';
  }

  /** 複製用的文字 */
  function text(r, name) {
    const t = r.total, l = r.last;
    return [
      `📄【${name} ${r.roc} 年度報表】${r.until ? `（統計到 ${Number(r.until.slice(5, 7))}/${Number(r.until.slice(8, 10))}）` : ''}`,
      `・場次 ${t.events} 場${l.events ? `（去年 ${l.events}）` : ''}`,
      `・出勤 ${t.total} 人次${l.total ? `（去年 ${l.total}，${diff(t.total, l.total)}）` : ''}`,
      `・參與 ${t.people} 位家人${l.people ? `（去年 ${l.people}）` : ''}`,
      `・道親佔比 ${pct(t.ratio)}${l.total ? `（去年 ${pct(l.ratio)}）` : ''}`,
      r.cats.length > 1 ? '\n各類別：\n' + r.cats.map((c) => `・${c.name}：${c.events} 場、${c.total} 人次、道親 ${pct(c.ratio)}`).join('\n') : '',
      r.top.length ? '\n人次最多的活動：\n' + r.top.map((x, i) => `${i + 1}. ${x.name}：${x.events} 場、${x.total} 人次`).join('\n') : '',
      r.thanks.length ? '\n🙏 感謝名單：' + r.thanks.map((x) => `${x.name}（${x.count}）`).join('、') : ''
    ].filter(Boolean).join('\n');
  }

  // =====================================================================
  // 畫面
  // =====================================================================
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function html(r, name) {
    const t = r.total, l = r.last;
    const tile = (label, v, lv, unit) => `<div class="yr-tile"><span class="yr-tile-label">${label}</span><b>${esc(v)}</b><small>${unit || ''}</small>${lv !== '' && lv !== undefined ? `<span class="yr-tile-vs">去年 ${esc(lv)}</span>` : ''}</div>`;
    const maxM = Math.max(1, ...r.months.map((m) => m.total));
    return `
      <div class="yr-head">
        <h2>${esc(name)} ${r.roc} 年度報表</h2>
        <p class="muted">${r.until ? `統計到 ${Number(r.until.slice(5, 7))} 月 ${Number(r.until.slice(8, 10))} 日（今年還沒過完，去年也只算到同一天）` : `${r.roc} 年 1～12 月`}・只算出席、非陪同；人次＝每場每人算一次</p>
      </div>
      <div class="yr-tiles">
        ${tile('場次', t.events, l.events || '', '場')}
        ${tile('出勤人次', t.total, l.total || '', '人次')}
        ${tile('參與的家人', t.people, l.people || '', '位')}
        ${tile('道親佔比', pct(t.ratio), l.total ? pct(l.ratio) : '', '')}
      </div>
      ${l.total ? `<p class="yr-sum">出勤人次${esc(diff(t.total, l.total))}${t.people && l.people ? `，參與的家人${esc(diff(t.people, l.people))}` : ''}。</p>` : ''}

      ${r.cats.length ? `<h3 class="yr-h">各類別</h3>
      <table class="yr-table"><thead><tr><th>類別</th><th>場次</th><th>人次</th><th>人數</th><th>道親佔比</th><th>去年人次</th></tr></thead>
        <tbody>${r.cats.map((c) => `<tr><th>${esc(c.name)}</th><td>${c.events}</td><td>${c.total}</td><td>${c.people}</td><td>${pct(c.ratio)}</td><td>${c.last.total || '—'}</td></tr>`).join('')}</tbody></table>` : ''}

      <h3 class="yr-h">每個月</h3>
      <table class="yr-table yr-months"><thead><tr><th>月</th><th>場次</th><th>人次</th><th class="yr-bar-th"></th><th>道親佔比</th></tr></thead>
        <tbody>${r.months.map((m) => m.future ? `<tr class="is-future"><th>${m.n} 月</th><td colspan="4">—</td></tr>` : `<tr><th>${m.n} 月</th><td>${m.events}</td><td>${m.total}</td><td class="yr-bar"><span style="width:${Math.round((m.total / maxM) * 100)}%"></span></td><td>${pct(m.ratio)}</td></tr>`).join('')}</tbody></table>

      ${r.top.length ? `<h3 class="yr-h">人次最多的活動</h3>
      <table class="yr-table"><thead><tr><th>#</th><th>活動</th><th>場次</th><th>人次</th><th>道親佔比</th></tr></thead>
        <tbody>${r.top.map((x, i) => `<tr><td>${i + 1}</td><th>${esc(x.name)}</th><td>${x.events}</td><td>${x.total}</td><td>${pct(x.total ? x.dao / x.total : null)}</td></tr>`).join('')}</tbody></table>` : ''}

      ${r.thanks.length ? `<h3 class="yr-h">🙏 感謝名單<small>出勤最多的 ${r.thanks.length} 位</small></h3>
      <ol class="yr-thanks">${r.thanks.map((x) => `<li>${esc(x.name)}<small>${x.count} 次</small></li>`).join('')}</ol>` : ''}`;
  }

  /** 打開報表（蓋在畫面上；列印時只印報表）。groups＝統計的活動歸類（改過名字的算成同一個） */
  function open(events, year, today, name, groups) {
    const C = root.StatsCalc;
    if (groups && Object.keys(groups).length) events = events.map((e) => (groups[e.series] ? Object.assign({}, e, { series: groups[e.series] }) : e));
    const pick = (y) => {
      const r = build(events, y, today, C);
      const years = [...new Set(events.map((e) => Number(e.date.slice(0, 4))))].concat([Number(today.slice(0, 4))]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a);
      el.innerHTML = `
        <div class="yr-bar-top no-print">
          <select class="input" data-yr-year aria-label="年度">${years.map((v) => `<option value="${v}"${v === y ? ' selected' : ''}>${v - 1911} 年</option>`).join('')}</select>
          <button type="button" class="btn btn-primary" data-yr-print>🖨 列印／存成 PDF</button>
          <button type="button" class="btn" data-yr-copy>📋 複製文字</button>
          <button type="button" class="btn" data-yr-close>關閉</button>
        </div>
        <article class="yr-page">${r.total.events || r.last.events ? html(r, name) : `<p class="panel-empty">${y - 1911} 年沒有出勤紀錄</p>`}</article>`;
      el.querySelector('[data-yr-year]').addEventListener('change', (ev) => pick(Number(ev.target.value)));
      el.querySelector('[data-yr-print]').addEventListener('click', () => window.print());
      el.querySelector('[data-yr-close]').addEventListener('click', close);
      const cp = el.querySelector('[data-yr-copy]');
      cp.addEventListener('click', async () => { cp.textContent = (await Share.copyText(text(r, name))) ? '已複製 ✓' : '複製失敗，請再按一次'; });
      el.scrollTop = 0;
    };
    const el = document.createElement('div');
    el.className = 'yr-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '年度報表');
    document.body.appendChild(el);
    document.body.classList.add('yr-open');
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    function close() { el.remove(); document.body.classList.remove('yr-open'); document.removeEventListener('keydown', onKey); }
    document.addEventListener('keydown', onKey);
    pick(year);
  }

  const api = { build, text, diff, open };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YearReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
