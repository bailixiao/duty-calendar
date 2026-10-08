// 管理後台：統計（#/admin/stats）。規格第 10 節。
// 月／季／年切換；大數字＋比上一期、比去年同期；最近幾期趨勢圖；依勤務分類；出勤排行；明細；
// 複製文字報告（貼 LINE）、列印、更新試算表「統計」分頁。計算在 stats-calc.js。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const C = window.StatsCalc;
  const TREND_COUNT = { month: 12, quarter: 8, year: 5 };
  const state = { unit: 'month', period: null, rankKind: 'all', rankAll: false, category: '勤務', eduCourse: {}, eduRankAll: false, eduGridAll: false, eduItemsOpen: false, eduPick: {}, careDays: 60 };

  function show(body, guard) {
    AdminPage.swr('stats', () => Api.admin('adminStats', {}, true), (data, stale) => {
      if (!state.period || state.period.unit !== state.unit) state.period = C.periodOf(state.unit, data.today);
      render(body, guard, data, stale);
      if (!stale) autoUpdateSheet(body, data);
    }, body);
  }

  // 試算表「統計」分頁超過 6 小時沒更新（或從沒產生過）：打開統計頁時在背景更新今年的，不用等
  const SHEET_STALE_MS = 6 * 3600 * 1000;
  let autoUpdating = false;
  function autoUpdateSheet(body, data) {
    const last = data.sheetUpdatedAt ? new Date(data.sheetUpdatedAt.replace(' ', 'T') + '+08:00').getTime() : 0;
    if (autoUpdating || Date.now() - last < SHEET_STALE_MS) return;
    autoUpdating = true;
    const note = () => body.querySelector('[data-sheet-note]');
    if (note()) note().textContent = '正在背景更新試算表「統計」分頁⋯（不用等，可以繼續看）';
    Api.admin('adminUpdateStatsSheet', { year: Number(data.today.slice(0, 4)) })
      .then((res) => {
        data.sheetUpdatedAt = res.updatedAt;
        if (note()) note().textContent = `試算表「統計」分頁已自動更新（${res.updatedAt}）。`;
      })
      .catch(() => { if (note()) note().textContent = '試算表「統計」分頁自動更新失敗，可以按上面的按鈕再試一次。'; })
      .finally(() => { autoUpdating = false; });
  }

  /** 一行比較：左邊「比上月」、右邊 ▲ 12（綠）／▼ 3（紅）／＝ 持平／—（沒有資料） */
  function deltaHtml(name, d) {
    if (!name) return '';
    let cls = '';
    let val = '—';
    if (d.text === '持平') val = '＝ 持平';
    else if (d.text !== null) {
      cls = d.sign > 0 ? 'is-up' : 'is-down';
      val = (d.sign > 0 ? '▲ ' : '▼ ') + d.text.replace(/^[+−]/, '');
    } else cls = 'is-none';
    return `<div class="cmp-row"><span class="cmp-label">${esc(name)}</span><span class="cmp-val ${cls}">${esc(val)}</span></div>`;
  }

  /** 卡片下方的比較區（上一期、去年同期各一行） */
  function cmpList(rows) {
    return `<div class="cmp-list">${rows.join('')}</div>`;
  }

  function render(body, guard, data, stale) {
    // 類別：勤務／道務／教育帳號只拿得到自己類別的資料；總管理者、唯讀可以切換
    const canPick = ['總管理者', '唯讀'].indexOf(Api.adminWho().role) !== -1;
    // 教育：改成以課程為單位的統計
    // 教育、道務：改成以課程（道務含法會、會議）為單位的統計
    const eduCat = canPick ? state.category : Api.adminWho().role;
    if (eduCat === '教育' || eduCat === '道務') return renderEdu(body, guard, data, stale, canPick, eduCat);
    const ev = canPick && state.category !== '全部' ? data.events.filter((e) => (e.category || '勤務') === state.category) : data.events;
    const p = state.period;
    // 本期還沒過完時，比較期間只算到相同天數（見 StatsCalc.compare）
    const { now: s, prev, prevP, ly, lyP, partial } = C.compare(ev, p, data.today);
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
          ${canPick ? `<div class="seg stats-cats">${['勤務', '道務', '教育'].map((c) => `<label class="seg-item"><input type="radio" name="scat" value="${c}"${c === state.category ? ' checked' : ''}><span>${Fmt.catLabel(c)}</span></label>`).join('')}</div>` : `<p class="stats-cat-fixed">「${esc(Api.adminWho().role)}」類的統計</p>`}
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
            <span class="stat-hint">每場每人算 1 次<br>（來 3 場＝3 人次）</span>
            ${cmpList([deltaHtml('比' + prevName, C.delta(s.total, cmpVal(prev, 'total'))), lyName ? deltaHtml('比' + lyName, C.delta(s.total, cmpVal(ly, 'total'))) : ''])}
          </div>
          <div class="stat-card">
            <span class="stat-label">道親佔比</span>
            <span class="stat-num">${C.pct(s.ratio)}</span>
            <span class="stat-sub">道親 ${s.dao}・壇辦 ${s.tan}${s.unknown ? `・未填 ${s.unknown}` : ''}</span>
            ${cmpList([deltaHtml('比' + prevName, C.delta(s.ratio, cmpVal(prev, 'ratio'), true)), lyName ? deltaHtml('比' + lyName, C.delta(s.ratio, cmpVal(ly, 'ratio'), true)) : ''])}
          </div>
          <div class="stat-card">
            <span class="stat-label">${AdminPage.term()}場次</span>
            <span class="stat-num">${s.events}</span>
            ${cmpList([deltaHtml('比' + prevName, C.delta(s.events, cmpVal(prev, 'events'))), lyName ? deltaHtml('比' + lyName, C.delta(s.events, cmpVal(ly, 'events'))) : ''])}
          </div>
          <div class="stat-card">
            <span class="stat-label">參與人數（不重複）</span>
            <span class="stat-num">${s.people}</span>
            <span class="stat-hint">同一人只算 1 位</span>
            ${cmpList([deltaHtml('比' + prevName, C.delta(s.people, cmpVal(prev, 'people'))), lyName ? deltaHtml('比' + lyName, C.delta(s.people, cmpVal(ly, 'people'))) : ''])}
          </div>
        </div>
        ${partial ? `<p class="stats-note">本${C.UNIT_NAME[p.unit]}還沒結束：算到今天 ${Number(data.today.slice(5, 7))}/${Number(data.today.slice(8, 10))}，比較的期間也只算到相同日期。</p>` : ""}
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

        ${careHtml(ev, data.today)}

        <section class="stats-section">
          <h3 class="admin-sub">勤務明細<span class="h2-sub">${details.length} 場</span></h3>
          ${details.length ? `<ul class="detail-list">${details.map((e) => {
            const total = e.tan.length + e.dao.length + e.unknown.length;
            return `<li class="detail-item">
              <div class="stat-detail-head"><span>${esc(Fmt.shortDate(e.date))} ${esc(e.name)}</span><strong>${total} 人</strong></div>
              ${e.tan.length ? `<p>壇辦 ${e.tan.length}：${e.tan.map(esc).join('、')}</p>` : ''}
              ${e.dao.length ? `<p>道親 ${e.dao.length}：${e.dao.map(esc).join('、')}</p>` : ''}
              ${e.unknown.length ? `<p class="warn">未填身分：${e.unknown.map(esc).join('、')}</p>` : ''}
              ${e.accompany.length ? `<p class="muted">陪同：${e.accompany.map(esc).join('、')}</p>` : ''}
            </li>`;
          }).join('')}</ul>` : '<p class="panel-empty">這段期間沒有出勤紀錄</p>'}
        </section>

        <div class="stats-actions no-print">
          <button type="button" class="btn btn-primary" data-copy>複製文字報告（貼 LINE）</button>
          <button type="button" class="btn" data-xlsx>⬇ 匯出 Excel</button>
          <button type="button" class="btn" data-print>列印</button>
          <button type="button" class="btn" data-sheet>更新試算表「統計」分頁</button>
          <a class="btn" href="#/admin/history">匯入歷史資料（舊 Excel）</a>
        </div>
        <p class="hint no-print" data-sheet-note>${data.sheetUpdatedAt ? `試算表統計最後更新：${esc(data.sheetUpdatedAt)}` : '試算表「統計」分頁還沒產生過'}。只算出席、非陪同的人；人次＝每場每人算一次；只算今天以前。</p>
      </div>`;

    const rerender = () => render(body, guard, data, false);
    bindNav(body, data, rerender);
    body.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      const [y, n] = b.dataset.jump.split('-').map(Number);
      state.period = { unit: state.unit, year: y, n };
      rerender();
    }));
    body.querySelectorAll('input[name=rank]').forEach((r) => r.addEventListener('change', () => { state.rankKind = r.value; rerender(); }));
    const all = body.querySelector('[data-rank-all]');
    if (all) all.addEventListener('click', () => { state.rankAll = !state.rankAll; rerender(); });
    bindCare(body, ev, data.today, rerender);
    body.querySelector('[data-print]').addEventListener('click', () => window.print());
    body.querySelector('[data-copy]').addEventListener('click', () => copyReport(C.textReport(ev, p)));
    body.querySelector('[data-xlsx]').addEventListener('click', () => exportXlsx(body, () => StatsExport.general(ev, p, Fmt.catLabel(canPick ? state.category : Api.adminWho().role))));
    body.querySelector('[data-sheet]').addEventListener('click', () => updateSheet(body, guard, p.year));
  }

  // 教育統計的「各班師資」只看這幾個班（課程名稱含這幾個字）
  const EDU_TEACHER_CLASSES = window.SITE.eduTeacherClasses; // 在 js/site.js

  // 教育、道務統計的用詞
  const EDU_LABELS = {
    教育: { item: '課程', unit: '堂', person: '學生', staff: '師資', staffTitle: '各課程負責師資', pick: '選課程',
      empty: '這段期間沒有課程（教育類、性質「課程」）', noStaff: '還沒有填師資。新增或編輯教育的課程時，在「師資」欄填上負責的師資。' },
    道務: { item: '項目', unit: '場', person: '參與者', staff: '負責人員', staffTitle: '負責人員（講師・帶班・助理帶班）', pick: '選項目',
      empty: '這段期間沒有道務的課程、法會或會議', noStaff: '還沒有填講師、帶班、助理帶班。在道務的編輯畫面填寫，或用「安排整年的人員」一次排好。' }
  };

  const GRID_FIRST = 10; // 出缺勤表先列幾位
  const NATURE_ORDER = ['法會', '課程', '會議']; // 道務的性質

  /** 「項目」卡片展開的清單：依性質分，寫場次；點名稱看出缺勤表 */
  function itemsListHtml(courses, L, cat) {
    if (!courses.length) return `<div class="items-box"><p class="muted">${L.empty}</p></div>`;
    const idx = (c) => courses.indexOf(c);
    const groups = cat === '道務'
      ? NATURE_ORDER.concat([...new Set(courses.map((c) => c.nature).filter((n) => NATURE_ORDER.indexOf(n) === -1))])
        .map((n) => [n || '其他', courses.filter((c) => (c.nature || '') === n || (!n && !c.nature))]).filter(([, cs]) => cs.length)
      : [[L.item, courses]];
    return `<div class="items-box">${groups.map(([n, cs]) => `
      <div class="items-group"><h4>${esc(n)}<span>（${cs.length}）</span></h4>
        <ul>${cs.slice().sort((a, b) => b.sessions.length - a.sessions.length).map((c) => `<li><button type="button" class="link-btn" data-course="${idx(c)}">${esc(c.name)}</button><small>${c.sessions.length} ${L.unit}・${c.students.length} 人</small></li>`).join('')}</ul>
      </div>`).join('')}<p class="hint">點名稱看那個${L.item}的出缺勤表。</p></div>`;
  }

  /** 教育、道務的統計：以課程（道務也含法會、會議）為單位（參與量、出缺勤表、出席排行、負責人員） */
  function renderEdu(body, guard, data, stale, canPick, cat) {
    const L = EDU_LABELS[cat];
    const p = state.period;
    const nowP = C.periodOf(p.unit, data.today);
    const atLatest = p.year === nowP.year && p.n === nowP.n;
    const r = EduStats.summarize(data.eduSessions || [], data.events, (d) => C.contains(p, d), cat);
    const allCourses = r.courses;
    // 選課程：沒勾＝全部；勾了就只算勾的（卡片、參與量、出缺勤、排行、人員都跟著）
    const pickList = state.eduPick[cat] || [];
    const picked = pickList.filter((n) => allCourses.some((c) => c.name === n));
    const courses = picked.length ? allCourses.filter((c) => picked.indexOf(c.name) !== -1) : allCourses;
    const teacherList = EduStats.teachersOf(courses);
    const cur = courses.find((c) => c.name === state.eduCourse[cat]) || courses[0];
    const students = new Set(courses.flatMap((c) => c.students));
    const present = courses.reduce((n, c) => n + c.present, 0);
    const absent = courses.reduce((n, c) => n + c.absent, 0);
    const pctText = (v) => (v === null ? '—' : Math.round(v * 100) + '%');
    const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    // 只有一種角色：只寫角色（場數看右邊「共 N 場」）；兩種以上才寫各幾場
    const roleText = (t) => { const ks = Object.keys(t.byRole); return ks.length === 1 ? ks[0] : ks.map((k) => `${k} ${t.byRole[k]}`).join('・'); };

    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <div class="stats" data-stats>
        <div class="stats-top no-print">
          ${canPick ? `<div class="seg stats-cats">${['勤務', '道務', '教育'].map((c) => `<label class="seg-item"><input type="radio" name="scat" value="${c}"${c === state.category ? ' checked' : ''}><span>${Fmt.catLabel(c)}</span></label>`).join('')}</div>` : `<p class="stats-cat-fixed">「${cat}」類的統計</p>`}
          <div class="seg stats-units">${[['month', '月'], ['quarter', '季'], ['year', '年']].map(([v, l]) =>
            `<label class="seg-item"><input type="radio" name="unit" value="${v}"${v === p.unit ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
        </div>
        <div class="stats-nav">
          <button type="button" class="btn btn-icon no-print" data-move="-1" aria-label="上一${C.UNIT_NAME[p.unit]}">‹</button>
          <h2 class="stats-title">${esc(C.label(p))}</h2>
          <button type="button" class="btn btn-icon no-print" data-move="1" aria-label="下一${C.UNIT_NAME[p.unit]}"${atLatest ? ' disabled' : ''}>›</button>
        </div>
        ${atLatest ? '' : `<p class="no-print stats-back"><button type="button" class="btn btn-small" data-latest>回到本${C.UNIT_NAME[p.unit]}</button></p>`}

        ${allCourses.length > 1 ? `<div class="edu-pick no-print">
          <span class="edu-pick-label">${L.pick}：</span>
          <button type="button" class="edu-pick-btn${picked.length ? '' : ' is-on'}" data-pick-all>全部</button>
          ${allCourses.map((c) => `<button type="button" class="edu-pick-btn${picked.indexOf(c.name) !== -1 ? ' is-on' : ''}" data-pick="${esc(c.name)}">${picked.indexOf(c.name) !== -1 ? '✓ ' : ''}${esc(c.name)}</button>`).join('')}
        </div>${picked.length ? `<p class="stats-note">只看：${picked.map(esc).join('、')}</p>` : ''}` : ''}

        <div class="stat-cards">
          <button type="button" class="stat-card stat-card-btn${state.eduItemsOpen ? ' is-open' : ''}" data-items-toggle aria-expanded="${state.eduItemsOpen}"><span class="stat-label">${L.item} ${state.eduItemsOpen ? '▴' : '▾'}</span><span class="stat-num">${courses.length}</span><span class="stat-hint">${cat === '道務' && courses.length ? NATURE_ORDER.map((n) => `${n} ${courses.filter((c) => c.nature === n).length}`).join('・') : `同名的算同一個${L.item}`}</span></button>
          <div class="stat-card"><span class="stat-label">${cat === '教育' ? '上課堂數' : '場次'}</span><span class="stat-num">${courses.reduce((n, c) => n + c.sessions.length, 0)}</span><span class="stat-hint">只算今天以前</span></div>
          <div class="stat-card"><span class="stat-label">${L.person}（不重複）</span><span class="stat-num">${students.size}</span><span class="stat-hint">同一人只算 1 位，不含陪同</span></div>
          <div class="stat-card"><span class="stat-label">出席率</span><span class="stat-num">${pctText(present + absent ? present / (present + absent) : null)}</span><span class="stat-hint">出席 ${present} 人次・未到 ${absent} 人次</span></div>
        </div>

        ${state.eduItemsOpen ? itemsListHtml(courses, L, cat) : ''}

        <section class="stats-section">
          <h3 class="admin-sub">各${L.item}${L.person}量<span class="h2-sub">點${L.item}看出缺勤表</span></h3>
          ${courses.length ? `<div class="edu-table-wrap"><table class="edu-table">
            <thead><tr><th>${L.item}</th><th>${L.unit}數</th><th>${L.person}</th><th>平均每${L.unit}</th><th>出席率</th><th>${L.staff}</th></tr></thead>
            <tbody>${courses.map((c, i) => `
              <tr class="${c === cur ? 'is-current' : ''}">
                <th scope="row"><button type="button" class="link-btn edu-course" data-course="${i}">${esc(c.name)}</button></th>
                <td>${c.sessions.length}</td><td>${c.students.length} 人</td><td>${c.avg} 人</td><td>${pctText(c.rate)}</td>
                <td class="edu-teachers">${c.teachers.length ? c.teachers.map(esc).join('、') : '<span class="muted">未填</span>'}</td>
              </tr>`).join('')}</tbody>
          </table></div>` : `<p class="panel-empty">${L.empty}</p>`}
        </section>

        ${cur ? `
        <section class="stats-section" data-grid-section>
          <h3 class="admin-sub">出缺勤表：${esc(cur.name)}<span class="h2-sub">✓ 出席・✗ 未到・空白＝沒報名</span></h3>
          ${cur.students.length ? `<div class="edu-table-wrap"><table class="edu-table edu-grid">
            <thead><tr><th class="edu-sticky">姓名</th>${cur.sessions.map((s) => `<th>${md(s.date)}<small>（${esc(Fmt.weekday(s.date))}）</small></th>`).join('')}<th>出席</th></tr></thead>
            <tbody>${(state.eduGridAll ? cur.students : cur.students.slice(0, GRID_FIRST)).map((n) => `
              <tr><th scope="row" class="edu-sticky">${esc(n)}</th>${cur.sessions.map((s) => {
                const v = cur.grid[n][s.key] || '';
                return `<td class="${v === '✓' ? 'is-here' : v === '✗' ? 'is-away' : ''}">${v}</td>`;
              }).join('')}<td class="edu-sum">${cur.perStudent[n]}/${cur.sessions.length}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th class="edu-sticky">每${L.unit}出席</th>${cur.sessions.map((s) => `<td>${cur.perSession[s.key]}</td>`).join('')}<td></td></tr></tfoot>
          </table></div>
          ${cur.students.length > GRID_FIRST ? `<button type="button" class="btn btn-small no-print grid-more" data-grid-all>${state.eduGridAll ? `只看前 ${GRID_FIRST} 位` : `看全部 ${cur.students.length} 位`}</button>` : ''}
          <div class="admin-actions no-print"><button type="button" class="btn" data-copy-grid>複製出缺勤表（貼到試算表或 LINE）</button></div>` : `<p class="muted">這個${L.item}這段期間還沒有人報名</p>`}
          <p class="hint">沒來的人：到後台這${L.unit}的報名名單按「改未到」；沒報名但有來的人：按「補登」。</p>
        </section>` : ''}

        ${cur ? (() => {
          // 每個課程的人不同：只排目前選的（點上面的名稱切換）
          const rank = EduStats.ranking(courses, cur.name);
          return `
        <section class="stats-section">
          <h3 class="admin-sub">${L.person}出席排行：${esc(cur.name)}<span class="h2-sub">出席次數多的在前${courses.length > 1 ? `・點上面的${L.item}換一個` : ''}</span></h3>
          ${rank.length ? `<ol class="rank-list edu-rank">${(state.eduRankAll ? rank : rank.slice(0, 10)).map((x) => `
            <li><span class="rank-name">${esc(x.name)}${x.absent ? ` <span class="tag tag-warn">未到 ${x.absent}</span>` : ''}</span>
              <span class="rank-count">${x.count}／${cur.sessions.length} ${L.unit}</span></li>`).join('')}</ol>
          ${rank.length > 10 ? `<button type="button" class="btn btn-small no-print" data-erank-all>${state.eduRankAll ? '只看前 10 名' : `看全部 ${rank.length} 位`}</button>` : ''}` : `<p class="muted">還沒有${L.person}報名</p>`}
        </section>`;
        })() : ''}

        ${cat === '教育' ? (() => {
          // 教育：只看讀經班、青少年班、高大班、青年班的師資（課程名稱含這幾個字），一班一區
          const groups = EDU_TEACHER_CLASSES.map((k) => {
            const cs = allCourses.filter((c) => c.name.indexOf(k) !== -1);
            return { name: k, sessions: cs.reduce((n, c) => n + c.sessions.length, 0), teachers: EduStats.teachersOf(cs) };
          });
          return `
        <section class="stats-section">
          <h3 class="admin-sub">各班師資<span class="h2-sub">${EDU_TEACHER_CLASSES.join('・')}</span></h3>
          <div class="edu-class-teachers">${groups.map((g) => `
            <div class="edu-class-card">
              <div class="edu-class-head"><strong>${esc(g.name)}</strong><span class="muted">${g.sessions ? `這段期間 ${g.sessions} 堂` : '這段期間沒有課'}</span></div>
              ${g.teachers.length ? `<ul class="edu-class-list">${g.teachers.map((t) => `<li><span>${esc(t.name)}</span><span class="edu-teacher-total">${t.total} 堂</span></li>`).join('')}</ul>`
                : `<p class="muted">${g.sessions ? '還沒有填師資' : '—'}</p>`}
            </div>`).join('')}</div>
          <p class="hint">依上面選的期間（月／季／年）計算；師資在新增或編輯課程時的「師資」欄填寫。</p>
        </section>`;
        })() : ''}
        <section class="stats-section"${cat === '教育' ? ' hidden' : ''}>
          <h3 class="admin-sub">${L.staffTitle}</h3>
          ${teacherList.length ? `<ul class="edu-teacher-list">${teacherList.map((t) => `
            <li><span class="edu-teacher-name">${esc(t.name)}</span><span class="edu-teacher-total">共 ${t.total} ${L.unit}</span>
              ${cat === '道務' ? `<span class="edu-teacher-roles">${esc(roleText(t))}</span>` : ''}
              <span class="edu-teacher-courses">${t.courses.map((c) => `${esc(c.name)} ${c.count} ${L.unit}`).join('、')}</span></li>`).join('')}</ul>`
            : `<p class="muted">${L.noStaff}</p>`}
        </section>
        ${careHtml((data.events || []).filter((e) => (e.category || '勤務') === cat), data.today)}
        <div class="stats-actions no-print"><button type="button" class="btn btn-primary" data-xlsx>⬇ 匯出 Excel（${L.item}總覽＋每個${L.item}的出缺勤表）</button></div>
        ${cat === '道務' ? '<section class="stats-section" data-veg></section><section class="stats-section" data-ages></section><section class="stats-section" data-goals></section>' : ''}
      </div>`;

    bindNav(body, data, () => render(body, guard, data, false));
    body.querySelectorAll('[data-course]').forEach((b) => b.addEventListener('click', () => {
      state.eduCourse[cat] = courses[Number(b.dataset.course)].name;
      render(body, guard, data, false);
      const sec = body.querySelector('[data-grid-section]');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    const it = body.querySelector('[data-items-toggle]');
    if (it) it.addEventListener('click', () => { state.eduItemsOpen = !state.eduItemsOpen; render(body, guard, data, false); });
    const ea = body.querySelector('[data-erank-all]');
    if (ea) ea.addEventListener('click', () => { state.eduRankAll = !state.eduRankAll; render(body, guard, data, false); });
    const ga = body.querySelector('[data-grid-all]');
    if (ga) ga.addEventListener('click', () => {
      state.eduGridAll = !state.eduGridAll;
      render(body, guard, data, false);
      if (!state.eduGridAll) body.querySelector('[data-grid-section]').scrollIntoView({ block: 'start' }); // 收起來後回到表格開頭
    });
    body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.pick;
      const set = new Set(state.eduPick[cat] || []);
      if (set.has(n)) set.delete(n); else set.add(n);
      state.eduPick[cat] = [...set];
      render(body, guard, data, false);
    }));
    const pa = body.querySelector('[data-pick-all]');
    if (pa) pa.addEventListener('click', () => { state.eduPick[cat] = []; render(body, guard, data, false); });
    const cp = body.querySelector('[data-copy-grid]');
    if (cp) cp.addEventListener('click', () => copyReport(EduStats.gridText(cur)));
    body.querySelector('[data-xlsx]').addEventListener('click', () => exportXlsx(body, () => StatsExport.edu(courses, teacherList, L, cat, p)));
    bindCare(body, (data.events || []).filter((e) => (e.category || '勤務') === cat), data.today, () => render(body, guard, data, false));
    // 各佛堂道務目標（年度跟著上面選的期間）
    const veg = body.querySelector('[data-veg]');
    if (veg) MemberStats.mount(veg, body.querySelector('[data-ages]'), { canEdit: ['總管理者', '道務'].indexOf(Api.adminWho().role) !== -1, guard, activity: C.activity(data.events || [], data.today) });
    const goals = body.querySelector('[data-goals]');
    if (goals) GoalsPage.mount(goals, p.year, { canEdit: ['總管理者', '道務'].indexOf(Api.adminWho().role) !== -1, guard });
  }

  // ---------- 關懷名單：以前常來、最近很久沒來的人 ----------

  function careHtml(events, today) {
    const list = C.careList(events, today, state.careDays, 3);
    return `
        <section class="stats-section care-section">
          <h3 class="admin-sub">💛 關懷名單<span class="h2-sub">過去一年來過 3 次以上，最近 ${state.careDays} 天沒有出席</span></h3>
          <div class="seg care-days no-print">${[30, 60, 90].map((d) => `<label class="seg-item"><input type="radio" name="careDays" value="${d}"${d === state.careDays ? ' checked' : ''}><span>${d} 天</span></label>`).join('')}</div>
          ${list.length ? `<ul class="care-list">${list.map((v) => `
            <li><span class="care-name">${esc(v.name)}${v.identity ? ` <span class="tag">${esc(v.identity)}</span>` : ''}</span>
              <span class="care-meta">最後一次：${esc(Fmt.shortDate(v.last))} ${esc(v.lastName)}（${v.daysAgo} 天前）・過去一年 ${v.count} 次</span></li>`).join('')}</ul>
          <div class="admin-actions no-print"><button type="button" class="btn" data-care-copy>複製關懷名單</button></div>` : '<p class="muted">沒有需要關懷的人 😊</p>'}
          <p class="hint">可以打電話或在 LINE 問候一下，邀請他們回來 🙏（只算出席、非陪同的紀錄）</p>
        </section>`;
  }

  function bindCare(body, events, today, rerender) {
    body.querySelectorAll('input[name=careDays]').forEach((r) => r.addEventListener('change', () => { state.careDays = Number(r.value); rerender(); }));
    const cp = body.querySelector('[data-care-copy]');
    if (cp) cp.addEventListener('click', () => {
      const list = C.careList(events, today, state.careDays, 3);
      copyReport(['💛 關懷名單（最近 ' + state.careDays + ' 天沒有出席）', ...list.map((v) => `${v.name}：最後 ${Fmt.shortDate(v.last)} ${v.lastName}（${v.daysAgo} 天前），過去一年 ${v.count} 次`)].join('\n'));
    });
  }

  /** 匯出 Excel：按鈕顯示處理中，失敗時提示 */
  async function exportXlsx(body, run) {
    const btn = body.querySelector('[data-xlsx]');
    const text = btn.textContent;
    btn.disabled = true;
    btn.textContent = '產生中⋯';
    try {
      await run();
      btn.textContent = '已下載 ✓';
    } catch (e) {
      alert(e.message || '匯出失敗，請再試一次');
      btn.textContent = text;
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = text; }, 2500);
  }

  /** 類別、月季年、上一期下一期的按鈕（一般統計與教育統計共用） */
  function bindNav(body, data, rerender) {
    body.querySelectorAll('input[name=scat]').forEach((r) => r.addEventListener('change', () => { state.category = r.value; rerender(); }));
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
