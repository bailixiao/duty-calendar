// 職司表大頁面（#/grid/<勤務ID>）：12人小組這類多天輪值的獨立頁面，可以單獨分享網址。
// 上方大標題與階段、滿版職司表（一欄一天、一列一個了愿項目）、職司說明、浮動的「點我報名」。
// 報名資料和勤務頁是同一份，每 30 秒自動更新。表格的 HTML 也給勤務頁共用（GridPage.tableHtml）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const REFRESH_MS = 30000;
  let root = null;
  let token = 0;
  let timer = null;
  let data = null;
  let updatedAt = null;

  /** 職司表的表格（勤務頁與大頁面共用） */
  function tableHtml(d) {
    const g = RosterGrid.build(d);
    const head = g.dates.map((x) => `<th scope="col" class="${x.today ? 'is-today' : ''}">${Fmt.shortDate(x.date).replace('（', '<br>(').replace('）', ')')}${x.today ? '<small>今天</small>' : ''}</th>`).join('');
    const totals = g.dates.map((x) => `<td class="${x.today ? 'is-today' : ''}">${x.total} 人</td>`).join('');
    const body = g.groups.map((grp, gi) => Array.from({ length: grp.rows }, (_, r) => `
      <tr class="${r === 0 ? 'grid-first' : ''} grid-g${gi % 2}">
        ${r === 0 ? `<th scope="rowgroup" rowspan="${grp.rows}" class="grid-pos"><span>${esc(grp.position.name)}</span></th>` : ''}
        <td class="grid-n">${r + 1}</td>
        ${g.dates.map((x) => {
          const s = grp.cells[x.date][r];
          if (!s) return `<td class="grid-empty${x.today ? ' is-today' : ''}">—</td>`;
          return `<td class="${x.today ? 'is-today' : ''}"><span class="grid-name${s.leader ? ' is-leader' : ''}">${s.leader ? '<span class="grid-star" title="組長">★</span>' : ''}${esc(s.name)}${s.accompany ? '<small>陪同</small>' : ''}${s.note ? `<button type="button" class="grid-note" data-note="${esc(s.id)}" aria-label="${esc(s.name)}的註記">註</button>` : ''}</span></td>`;
        }).join('')}
      </tr>`).join('')).join('');
    return `
      <div class="grid-wrap">
        <table class="roster-grid">
          <thead><tr><th scope="col" colspan="2" class="grid-corner">日期</th>${head}</tr>
            <tr class="grid-total"><th scope="row" colspan="2" class="grid-corner">人數</th>${totals}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  /** 點「註」看註記 */
  function bindNotes(el, d) {
    el.querySelectorAll('[data-note]').forEach((btn) => btn.addEventListener('click', () => {
      const s = (d.signups || []).find((x) => x.id === btn.dataset.note);
      if (!s) return;
      const m = Modal.open(`
        <h2 class="modal-title">${esc(s.name)}</h2>
        <p class="modal-note">${esc(Fmt.shortDate(s.date))}</p>
        <p class="note-full">${esc(s.note)}</p>
        <div class="modal-actions"><button type="button" class="btn btn-block" data-close>關閉</button></div>`);
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    }));
  }

  function show(id) {
    root = document.getElementById('view-grid');
    token += 1;
    const t = token;
    data = window.DutyCache && DutyCache.get(id);
    if (data) render();
    else root.innerHTML = '<p class="panel-empty">載入職司表中⋯</p>';
    load(id, t);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.getElementById('view-grid') || root.hidden) { clearInterval(timer); return; }
      if (document.visibilityState === 'visible') load(id, t);
    }, REFRESH_MS);
  }

  async function load(id, t) {
    try {
      const fresh = await DutyCache.fetch(id);
      if (t !== token) return;
      data = fresh;
      updatedAt = new Date();
      render();
    } catch (err) {
      if (t !== token || data) return;
      root.innerHTML = `<p class="panel-empty">${esc(err.message || '讀取失敗，請稍後再試')}</p>`;
    }
  }

  function dateRange(d) {
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}(${Fmt.weekday(s)})`;
    return d.start === d.end ? md(d.start) : `${md(d.start)}～${md(d.end)}`;
  }

  function render() {
    const d = data;
    if (d.layout !== '職司表') { // 不是職司表的勤務：直接去勤務頁
      location.replace(`#/duty/${encodeURIComponent(d.id)}`);
      return;
    }
    const stages = d.stages ? RosterGrid.parseStages(d.stages, d.start, d.today) : [];
    const keep = root.querySelector('.grid-wrap');
    const scrollX = keep ? keep.scrollLeft : null;
    root.innerHTML = `
      <header class="gp-hero">
        <p class="gp-when">${esc(dateRange(d))}</p>
        <h1 class="gp-title">${esc(d.name)}</h1>
        ${d.location ? `<p class="gp-place">📍 ${esc(d.location)}${Fmt.timeRange(d) ? `　🕑 ${esc(Fmt.timeRange(d))}` : ''}</p>` : ''}
        ${stages.length ? `<ol class="gp-stages">${stages.map((s) => `
          <li class="gp-stage gp-stage-${s.state}">
            <span class="gp-stage-when"><span class="gp-stage-n">${s.n}</span>${esc(s.when)}</span>
            <span class="gp-stage-text">${esc(s.text)}</span>
          </li>`).join('')}</ol>` : ''}
      </header>
      <p class="gp-updated">${updatedAt ? `最近更新：${updatedAt.toLocaleTimeString('zh-TW', { hour12: false })}` : '更新中⋯'}<span class="gp-legend"><span class="grid-star">★</span> 組長　<span class="grid-note gp-legend-note">註</span> 點了看註記</span></p>
      <section class="gp-section">
        <h2 class="gp-h2">職司表</h2>
        ${d.signups ? tableHtml(d) : '<p class="muted">載入職司表中⋯</p>'}
        <p class="hint">表格可以左右滑動。報名、取消或改期後，這裡會自動更新。</p>
      </section>
      ${d.description ? `
      <section class="gp-section">
        <h2 class="gp-h2">職司說明</h2>
        <p class="gp-desc">${esc(d.description).replace(/\n/g, '<br>')}</p>
        ${d.attire ? `<p class="gp-desc"><strong>服裝：</strong>${esc(d.attire)}</p>` : ''}
      </section>` : ''}
      <p class="gp-foot">每 30 秒自動更新　<a href="#/">回行事曆</a></p>
      <a class="gp-signup" href="#/duty/${encodeURIComponent(d.id)}" data-signup>點我報名</a>`;
    const wrap = root.querySelector('.grid-wrap');
    if (wrap && scrollX !== null) wrap.scrollLeft = scrollX; // 自動更新時保留左右滑的位置
    else if (wrap) { // 第一次打開：滑到今天那欄
      const today = wrap.querySelector('th.is-today');
      if (today) wrap.scrollLeft = Math.max(0, today.offsetLeft - 120);
    }
    bindNotes(root, d);
    root.querySelector('[data-signup]').addEventListener('click', () => {
      // 到勤務頁後直接捲到報名表單
      sessionStorage.setItem('duty-calendar:to-signup', d.id);
    });
  }

  window.GridPage = { show, tableHtml, bindNotes };
})();
