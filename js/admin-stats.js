// 管理後台：統計（#/admin/stats）。規格第 10 節。
// 月／季／年切換；大數字＋比上一期、比去年同期；最近幾期趨勢圖；依勤務分類；出勤排行；明細；
// 複製文字報告（貼 LINE）、列印、更新試算表「統計」分頁。計算在 stats-calc.js。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const C = window.StatsCalc;
  const TREND_COUNT = { month: 12, quarter: 8, year: 5 };
  const state = { unit: 'month', period: null, rankKind: 'all', rankAll: false };

  function show(body, guard) {
    AdminPage.swr('stats', () => Api.admin('adminStats', {}, true), (data, stale) => {
      if (!state.period || state.period.unit !== state.unit) state.period = C.periodOf(state.unit, data.today);
      render(body, guard, data, stale);
    }, body);
  }

  function deltaHtml(name, d) {
    if (!name) return '';
    if (d.text === null) return `<span class="stat-delta is-none">${esc(name)}：沒有資料</span>`;
    return `<span class="stat-delta ${d.sign > 0 ? 'is-up' : d.sign < 0 ? 'is-down' : ''}">${esc(name)} ${esc(d.text)}</span>`;
  }

  function render(body, guard, data, stale) {
    const ev = data.events;
    const p = state.period;
    const s = C.summarize(ev, p);
    const prevP = C.shift(p, -1);
    const prev = C.summarize(ev, prevP);
    const lyP = p.unit === 'year' ? null : C.lastYear(p);
    const ly = lyP ? C.summarize(ev, lyP) : null;
    const prevName = C.prevName(p.unit);
    const lyName = C.lastYearName(p.unit);
    const cmpVal = (o, key) => (o && o.hasData ? o[key] : null);
    const nowP = C.periodOf(p.unit, data.today);
    const atLatest = p.year === nowP.year && p.n === nowP.n;

    const trend = C.trend(ev, p, TREND_COUNT[p.unit]);
    const maxTotal = Math.max(1, ...trend.map((t) => t.total));
    const cats = C.byCategory(ev, p);
    const maxCat = Math.max(1, ...cats.map((c) => c.total));
    const rank = C.ranking(ev, p, state.rankKind);
    const missing = C.missingIdentity(ev, p);
    const details = C.eventsIn(ev, p);

    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <div class="stats" data-stats>
        <div class="stats-top no-print">
          <div class="seg stats-units">${[['month', '月'], ['quarter', '季'], ['year', '年']].map(([v, l]) =>
            `<label class="seg-item"><input type="radio" name="unit" value="${v}"${v === p.unit ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
        </div>
        <div class="stats-nav">
          <button type="button" class="btn btn-icon no-print" data-move="-1" aria-label="上一${C.UNIT_NAME[p.unit]}">‹</button>
          <h2 class="stats-title">${esc(C.label(p))}</h2>
          <button type="button" class="btn btn-icon no-print" data-move="1" aria-label="下一${C.UNIT_NAME[p.unit]}"${atLatest ? ' disabled' : ''}>›</button>
        </div>
        ${atLatest ? '' : `<p class="no-print stats-back"><button type="button" class="btn btn-small" data-latest>回到本${C.UNIT_NAME[p.unit]}</button></p>`}

        <div class="stat-cards">
          <div class="stat-card">
            <span class="stat-label">出勤人次</span>
            <span class="stat-num">${s.total}</span>
            ${deltaHtml('比' + prevName, C.delta(s.hasData ? s.total : null, cmpVal(prev, 'total')))}
            ${lyName ? deltaHtml('比' + lyName, C.delta(s.hasData ? s.total : null, cmpVal(ly, 'total'))) : ''}
          </div>
          <div class="stat-card">
            <span class="stat-label">道親佔比</span>
            <span class="stat-num">${C.pct(s.ratio)}</span>
            <span class="stat-sub">道親 ${s.dao}・壇辦 ${s.tan}${s.unknown ? `・未填 ${s.unknown}` : ''}</span>
            ${deltaHtml('比' + prevName, C.delta(s.ratio, cmpVal(prev, 'ratio'), true))}
            ${lyName ? deltaHtml('比' + lyName, C.delta(s.ratio, cmpVal(ly, 'ratio'), true)) : ''}
          </div>
          <div class="stat-card">
            <span class="stat-label">勤務場次</span>
            <span class="stat-num">${s.events}</span>
            ${deltaHtml('比' + prevName, C.delta(s.hasData ? s.events : null, cmpVal(prev, 'events')))}
          </div>
          <div class="stat-card">
            <span class="stat-label">參與人數（不重複）</span>
            <span class="stat-num">${s.people}</span>
            ${deltaHtml('比' + prevName, C.delta(s.hasData ? s.people : null, cmpVal(prev, 'people')))}
          </div>
        </div>
        ${s.shortEvents || s.accompany || s.absent ? `<p class="stats-note">${[s.shortEvents ? `缺人的場次 ${s.shortEvents} 場` : '', s.accompany ? `陪同 ${s.accompany} 人次（不算人數）` : '', s.absent ? `報名但未到 ${s.absent} 人次` : ''].filter(Boolean).join('・')}</p>` : ''}
        ${missing.length ? `<div class="notice notice-error no-print"><p><strong>${missing.length} 位沒有填身分</strong>（道親佔比可能不準）：${missing.map(esc).join('、')}</p><p>請到勤務名單或試算表「報名」分頁補上身分。</p></div>` : ''}

        <section class="stats-section">
          <h3 class="admin-sub">最近 ${trend.length} ${p.unit === 'month' ? '個月' : p.unit === 'quarter' ? '季' : '年'}<span class="h2-sub">深色＝道親、淺色＝壇辦</span></h3>
          <div class="trend">
            ${trend.map((t) => {
              const h = Math.round((t.total / maxTotal) * 100);
              const daoH = t.total ? Math.round((t.dao / t.total) * h) : 0;
              const cur = t.period.year === p.year && t.period.n === p.n;
              return `<button type="button" class="trend-col${cur ? ' is-current' : ''}" data-jump="${t.period.year}-${t.period.n}" aria-label="${esc(C.label(t.period))}：${t.total} 人次">
                <span class="trend-val">${t.total || ''}</span>
                <span class="trend-bar" style="height:${h}%"><span class="trend-dao" style="height:${h ? Math.round((daoH / h) * 100) : 0}%"></span></span>
                <span class="trend-label">${esc(C.label(t.period, true))}</span>
                <span class="trend-pct">${C.pct(t.ratio)}</span>
              </button>`;
            }).join('')}
          </div>
        </section>

        <section class="stats-section">
          <h3 class="admin-sub">比較</h3>
          <table class="stats-table">
            <thead><tr><th></th><th>場次</th><th>人次</th><th>道親</th><th>壇辦</th><th>佔比</th></tr></thead>
            <tbody>
              ${[[C.label(p), s, true], [`${prevName}（${C.label(prevP, 'plain')}）`, prev], lyP ? [`${lyName}（${C.label(lyP, 'plain')}）`, ly] : null].filter(Boolean).map(([l, o, me]) => `
                <tr${me ? ' class="is-me"' : ''}><th>${esc(l)}</th>${o.hasData ? `<td>${o.events}</td><td>${o.total}</td><td>${o.dao}</td><td>${o.tan}</td><td>${C.pct(o.ratio)}</td>` : '<td colspan="5" class="muted">沒有資料</td>'}</tr>`).join('')}
            </tbody>
          </table>
        </section>

        ${cats.length ? `
        <section class="stats-section">
          <h3 class="admin-sub">依勤務分類</h3>
          <ul class="cat-list">${cats.map((c) => `
            <li><span class="cat-name">${esc(c.name)}<span class="muted">（${c.events} 場）</span></span>
              <span class="cat-bar"><span style="width:${Math.round((c.total / maxCat) * 100)}%"></span></span>
              <span class="cat-val">${c.total} 人次</span></li>`).join('')}</ul>
        </section>` : ''}

        ${rank.length ? `
        <section class="stats-section">
          <h3 class="admin-sub">出勤次數排行<span class="h2-sub">感謝名單</span></h3>
          <div class="seg rank-kind no-print">${[['all', '全部'], ['dao', '道親'], ['tan', '壇辦']].map(([v, l]) =>
            `<label class="seg-item"><input type="radio" name="rank" value="${v}"${v === state.rankKind ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <ol class="rank-list">${(state.rankAll ? rank : rank.slice(0, 10)).map((r) => `
            <li><span class="rank-name">${esc(r.name)}${r.identity ? ` <span class="tag">${esc(r.identity)}</span>` : ''}</span><span class="rank-count">${r.count} 次</span></li>`).join('')}</ol>
          ${rank.length > 10 ? `<button type="button" class="btn btn-small no-print" data-rank-all>${state.rankAll ? '只看前 10 名' : `看全部 ${rank.length} 位`}</button>` : ''}
        </section>` : ''}

        <section class="stats-section">
          <h3 class="admin-sub">勤務明細<span class="h2-sub">${details.length} 場</span></h3>
          ${details.length ? `<ul class="detail-list">${details.map((e) => {
            const total = e.tan.length + e.dao.length + e.unknown.length;
            return `<li class="detail-item">
              <div class="detail-head"><span>${esc(Fmt.shortDate(e.date))} ${esc(e.name)}</span><strong>${total} 人</strong></div>
              ${e.tan.length ? `<p>壇辦 ${e.tan.length}：${e.tan.map(esc).join('、')}</p>` : ''}
              ${e.dao.length ? `<p>道親 ${e.dao.length}：${e.dao.map(esc).join('、')}</p>` : ''}
              ${e.unknown.length ? `<p class="warn">未填身分：${e.unknown.map(esc).join('、')}</p>` : ''}
              ${e.accompany.length ? `<p class="muted">陪同：${e.accompany.map(esc).join('、')}</p>` : ''}
            </li>`;
          }).join('')}</ul>` : '<p class="panel-empty">這段期間沒有出勤紀錄</p>'}
        </section>

        <div class="stats-actions no-print">
          <button type="button" class="btn btn-primary" data-copy>複製文字報告（貼 LINE）</button>
          <button type="button" class="btn" data-print>列印</button>
          <button type="button" class="btn" data-sheet>更新試算表「統計」分頁</button>
          <a class="btn" href="#/admin/history">匯入歷史資料（舊 Excel）</a>
        </div>
        <p class="hint no-print" data-sheet-note>${data.sheetUpdatedAt ? `試算表統計最後更新：${esc(data.sheetUpdatedAt)}` : '試算表「統計」分頁還沒產生過'}。只算出席、非陪同的人；人次＝每場每人算一次；只算今天以前。</p>
      </div>`;

    const rerender = () => render(body, guard, data, false);
    body.querySelectorAll('input[name=unit]').forEach((r) => r.addEventListener('change', () => {
      state.unit = r.value;
      state.period = C.periodOf(state.unit, data.today);
      rerender();
    }));
    body.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      state.period = C.shift(state.period, Number(b.dataset.move));
      rerender();
    }));
    const latest = body.querySelector('[data-latest]');
    if (latest) latest.addEventListener('click', () => { state.period = C.periodOf(state.unit, data.today); rerender(); });
    body.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      const [y, n] = b.dataset.jump.split('-').map(Number);
      state.period = { unit: state.unit, year: y, n };
      rerender();
    }));
    body.querySelectorAll('input[name=rank]').forEach((r) => r.addEventListener('change', () => { state.rankKind = r.value; rerender(); }));
    const all = body.querySelector('[data-rank-all]');
    if (all) all.addEventListener('click', () => { state.rankAll = !state.rankAll; rerender(); });
    body.querySelector('[data-print]').addEventListener('click', () => window.print());
    body.querySelector('[data-copy]').addEventListener('click', () => copyReport(C.textReport(ev, p)));
    body.querySelector('[data-sheet]').addEventListener('click', () => updateSheet(body, guard, p.year));
  }

  async function copyReport(text) {
    try {
      await navigator.clipboard.writeText(text);
      showText(text, '已複製，可以直接貼到 LINE');
    } catch (e) {
      showText(text, '無法自動複製，請長按下面的文字全選後複製');
    }
  }

  function showText(text, title) {
    const m = Modal.open(`
      <h2 class="modal-title">${esc(title)}</h2>
      <textarea class="day-text" rows="10" readonly>${esc(text)}</textarea>
      <div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
  }

  async function updateSheet(body, guard, year) {
    Busy.show(`更新 ${year - 1911} 年統計中⋯`, '約需 10–20 秒');
    try {
      const res = await Api.admin('adminUpdateStatsSheet', { year });
      Busy.hide();
      const note = body.querySelector('[data-sheet-note]');
      if (note) note.textContent = `試算表「統計」分頁已更新（${res.updatedAt}）。到試算表選「檔案 → 下載 → Microsoft Excel」就能存成 .xlsx。`;
    } catch (err) {
      Busy.hide();
      if (!guard(err)) showText(err.message || '更新失敗', '更新失敗');
    }
  }

  window.StatsPage = { show };
})();
