// 管理後台：📑 年度總結（#/admin/report）。一整年的出勤、最常來的家人、新朋友、好久不見的老朋友、道務目標、清口與年齡、場地使用。
// 資料都是後台本來就有的（統計、道務目標、成員、場地統計）；勤務／道務／教育帳號只看得到自己類別。可以複製文字、匯出 Excel。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const CATS = ['勤務', '道務', '教育'];
  let year = null;

  /** 一整年的數字（純計算，Node 測試也用） */
  function model(events, y, extra) {
    const inYear = events.filter((e) => e.date.slice(0, 4) === String(y));
    const people = (e) => e.tan.concat(e.dao, e.unknown);
    const byCat = CATS.map((c) => {
      const ev = inYear.filter((e) => (e.category || '勤務') === c);
      return { cat: c, events: ev.length, attend: ev.reduce((n, e) => n + people(e).length, 0), unique: new Set(ev.flatMap(people)).size };
    }).filter((x) => x.events);
    const count = new Map();
    inYear.forEach((e) => people(e).forEach((n) => count.set(n, (count.get(n) || 0) + 1)));
    const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).slice(0, 10);
    const months = Array.from({ length: 12 }, (_, i) => inYear.filter((e) => Number(e.date.slice(5, 7)) === i + 1).reduce((n, e) => n + people(e).length, 0));
    // 新朋友：第一次出席是在這一年的人
    const first = new Map();
    events.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => people(e).forEach((n) => { if (!first.has(n)) first.set(n, e.date); }));
    const newcomers = [...first.entries()].filter(([, d]) => d.slice(0, 4) === String(y)).map(([n, d]) => ({ name: n, date: d, times: count.get(n) || 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return Object.assign({ year: y, byCat, total: inYear.reduce((n, e) => n + people(e).length, 0), top, months, newcomers }, extra || {});
  }

  /** 最近 days 天第一次來的人：[{ name, date, duty, again }]（again＝之後有沒有再來） */
  function recentNewcomers(events, today, days) {
    const from = StatsCalc.addDays(today, -(days || 30));
    const people = (e) => e.tan.concat(e.dao, e.unknown);
    const seen = new Map();
    events.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((e) => people(e).forEach((n) => {
      const v = seen.get(n);
      if (!v) seen.set(n, { name: n, date: e.date, duty: e.name, times: 1 });
      else v.times += 1;
    }));
    return [...seen.values()].filter((v) => v.date >= from && v.date <= today).map((v) => Object.assign(v, { again: v.times > 1 }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /**
   * 好久不見的老朋友：3 個月前往回一年內來了 minTimes 次以上，最近 90 天都沒來的人。
   * 回傳 [{ name, times, last, lastDuty }]，以前來越多次的排前面。
   */
  function longAbsent(events, today, minTimes) {
    const recentFrom = StatsCalc.addDays(today, -90);
    const pastFrom = StatsCalc.addDays(today, -455);
    const people = (e) => e.tan.concat(e.dao, e.unknown);
    const before = new Map();
    const last = new Map();
    const recent = new Set();
    events.forEach((e) => {
      if (e.date > today) return;
      people(e).forEach((n) => {
        const l = last.get(n);
        if (!l || e.date > l.date) last.set(n, { date: e.date, duty: e.name });
        if (e.date >= recentFrom) recent.add(n);
        else if (e.date >= pastFrom) before.set(n, (before.get(n) || 0) + 1);
      });
    });
    return [...before.entries()].filter(([n, t]) => t >= (minTimes || 5) && !recent.has(n))
      .map(([n, t]) => ({ name: n, times: t, last: last.get(n).date, lastDuty: last.get(n).duty }))
      .sort((a, b) => b.times - a.times || (a.last < b.last ? 1 : -1));
  }

  function show(body, guard) {
    body.innerHTML = '<p class="panel-empty">整理年度總結中⋯</p>';
    load(body, guard);
  }

  async function load(body, guard) {
    let stats;
    try { stats = await Api.admin('adminStats', {}, true); } catch (err) { if (guard(err)) return; body.innerHTML = `<p class="form-error">${esc(err.message || '讀不到統計')}</p>`; return; }
    if (!year) year = Number(stats.today.slice(0, 4));
    const y = year;
    const quiet = (p) => p.catch(() => null); // 沒權限或讀不到的區塊就不顯示
    const [goals, members, venue] = await Promise.all([
      quiet(Api.admin('adminGoals', { year: y })),
      quiet(Api.admin('adminMembers', {}, true)),
      quiet(Api.admin('adminVenueStats', { year: y }))
    ]);
    if (y !== year) return;
    const extra = {};
    if (goals && goals.rows && goals.rows.length) {
      const tot = GoalsPage.totals(goals.rows, goals.items);
      extra.goals = goals.items.filter((k) => tot[k].target !== null).map((k) => ({ item: k, target: tot[k].target, current: tot[k].current, rate: tot[k].rate }));
    }
    if (members && members.members) {
      const act = members.members.filter((m) => m.active && !m.pending);
      const dao = act.filter((m) => m.identity === '道親');
      const ages = StatsCalc.ageStats(act.filter((m) => !m.overseas));
      const all = ages.find((r) => r.group === '全部') || {};
      extra.people = { members: act.length, dao: dao.length, veg: dao.filter((m) => m.vegetarian).length, avg: all.avg, median: all.median };
    }
    if (venue && venue.items) extra.venue = { times: venue.items.length, hours: venue.items.reduce((n, x) => n + x.hours.length, 0) };
    extra.recent = recentNewcomers(stats.events || [], stats.today, 30);
    extra.absent = longAbsent(stats.events || [], stats.today, 5);
    render(body, guard, model(stats.events || [], y, extra), stats.today);
  }

  function text(m) {
    const L = window.SITE.categoryLabels || {};
    const lines = [`📑 ${window.SITE.org} ${m.year - 1911} 年度總結`, '', `全年出席 ${m.total} 人次`];
    m.byCat.forEach((c) => lines.push(`・${L[c.cat] || c.cat}：${c.events} 場、${c.attend} 人次、${c.unique} 位`));
    if (m.top.length) lines.push('', '最常來的家人：', ...m.top.map(([n, v], i) => `${i + 1}. ${n} ${v} 次`));
    lines.push('', `新朋友：${m.newcomers.length} 位第一次來`);
    if (m.goals) lines.push('', '道務目標：', ...m.goals.map((g) => `・${g.item}：${g.current}／${g.target}（${g.rate === null ? '—' : Math.round(g.rate * 100) + '%'}）`));
    if (m.people) lines.push('', `成員 ${m.people.members} 位；道親清口 ${m.people.veg}／${m.people.dao} 位；平均年齡 ${m.people.avg ?? '—'} 歲`);
    if (m.venue) lines.push('', `${window.SITE.venue}借出 ${m.venue.times} 次、共 ${m.venue.hours} 小時`);
    lines.push('', '感恩大家這一年的發心 🙏');
    return lines.join('\n');
  }

  function render(body, guard, m, today) {
    const L = window.SITE.categoryLabels || {};
    const maxM = Math.max(1, ...m.months);
    const thisYear = Number(today.slice(0, 4));
    body.innerHTML = `
      <div class="mcal-head report-head">
        <button type="button" class="btn btn-small" data-y="-1" aria-label="前一年">‹</button>
        <h2 class="report-title">${m.year - 1911} 年度總結<small>${m.year}</small></h2>
        <button type="button" class="btn btn-small" data-y="1"${m.year >= thisYear ? ' disabled' : ''} aria-label="下一年">›</button>
      </div>
      ${m.recent ? `<section class="stats-section report-recent">
        <h3 class="admin-sub">🆕 最近 30 天的新朋友<span class="h2-sub">第一次來的，記得關心一下</span></h3>
        ${m.recent.length ? `<ul class="vs-list">${m.recent.map((x) => `<li><span>${esc(x.name)}<small class="muted">　${esc(Fmt.shortDate(x.date))} ${esc(x.duty)}</small></span><strong>${x.again ? '✓ 有再來' : '還沒再來'}</strong></li>`).join('')}</ul>` : '<p class="muted">最近 30 天沒有新朋友。</p>'}
      </section>` : ''}
      ${m.absent ? `<section class="stats-section report-absent">
        <h3 class="admin-sub">💛 好久不見的老朋友<span class="h2-sub">記得關心一下</span></h3>
        ${m.absent.length ? `<ul class="vs-list">${m.absent.slice(0, 30).map((x) => `<li><span>${esc(x.name)}<small class="muted">　上次 ${esc(Fmt.shortDate(x.last))} ${esc(x.lastDuty)}</small></span><strong>之前來了 ${x.times} 次</strong></li>`).join('')}</ul>${m.absent.length > 30 ? `<p class="hint">還有 ${m.absent.length - 30} 位</p>` : ''}<p class="hint">以前常來（3 個月前往回一年內來 5 次以上）、最近 3 個月都沒來的人。可以請組長或引保師打個電話問候一下 🙏</p>` : '<p class="muted">沒有，大家都有常常來 😊</p>'}
      </section>` : ''}
      <div class="stat-cards">
        <div class="stat-card"><span class="stat-label">全年出席</span><span class="stat-num">${m.total}</span><span class="stat-hint">人次（今天以前）</span></div>
        <div class="stat-card"><span class="stat-label">新朋友</span><span class="stat-num">${m.newcomers.length}</span><span class="stat-hint">今年第一次來</span></div>
        ${m.people ? `<div class="stat-card"><span class="stat-label">道親清口</span><span class="stat-num">${m.people.veg}／${m.people.dao}</span><span class="stat-hint">成員 ${m.people.members} 位・平均 ${m.people.avg ?? '—'} 歲</span></div>` : ''}
        ${m.venue ? `<div class="stat-card"><span class="stat-label">${esc(window.SITE.venue)}借出</span><span class="stat-num">${m.venue.hours}</span><span class="stat-hint">小時・${m.venue.times} 次</span></div>` : ''}
      </div>
      <section class="stats-section">
        <h3 class="admin-sub">各類別</h3>
        ${m.byCat.length ? `<div class="edu-table-wrap"><table class="edu-table"><thead><tr><th>類別</th><th>場次</th><th>人次</th><th>不重複人數</th></tr></thead>
          <tbody>${m.byCat.map((c) => `<tr><th scope="row">${esc(L[c.cat] || c.cat)}</th><td>${c.events}</td><td>${c.attend}</td><td>${c.unique}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">這一年沒有出席紀錄</p>'}
      </section>
      <section class="stats-section">
        <h3 class="admin-sub">每個月的出席人次</h3>
        <ul class="vs-bars report-months">${m.months.map((n, i) => `<li><span>${i + 1} 月</span><span class="vs-bar"><span style="width:${Math.round((n / maxM) * 100)}%"></span></span><strong>${n}</strong></li>`).join('')}</ul>
      </section>
      <section class="stats-section">
        <h3 class="admin-sub">最常來的家人</h3>
        ${m.top.length ? `<ol class="rank-list">${m.top.map(([n, v]) => `<li><span>${esc(n)}</span><strong>${v} 次</strong></li>`).join('')}</ol>` : '<p class="muted">沒有</p>'}
      </section>
      <section class="stats-section">
        <h3 class="admin-sub">🆕 新朋友<span class="h2-sub">今年第一次來的</span></h3>
        ${m.newcomers.length ? `<ul class="vs-list">${m.newcomers.slice(0, 30).map((x) => `<li><span>${esc(x.name)}<small class="muted">　第一次 ${esc(Fmt.shortDate(x.date))}</small></span><strong>${x.times > 1 ? `今年來了 ${x.times} 次` : '只來過 1 次'}</strong></li>`).join('')}</ul>${m.newcomers.length > 30 ? `<p class="hint">還有 ${m.newcomers.length - 30} 位</p>` : ''}` : '<p class="muted">沒有</p>'}
      </section>
      ${m.goals ? `<section class="stats-section">
        <h3 class="admin-sub">各佛堂道務目標（全區合計）</h3>
        <ul class="goal-bars">${m.goals.map((g) => `<li class="goal-bar${g.current >= g.target ? ' is-done' : ''}"><span class="goal-bar-name">${esc(g.item)}</span><span class="goal-bar-track"><span class="goal-bar-fill" style="width:${g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0}%"></span></span><span class="goal-bar-num"><strong>${g.current}</strong>／${g.target}（${g.rate === null ? '—' : Math.round(g.rate * 100) + '%'}）</span></li>`).join('')}</ul>
      </section>` : ''}
      <div class="admin-actions no-print">
        <button type="button" class="btn btn-primary" data-copy>複製年度總結（貼 LINE）</button>
        <button type="button" class="btn" data-xlsx>⬇ 匯出 Excel</button>
      </div>
      <p class="hint">人次只算今天以前的出席（不含陪同）。勤務、道務、教育帳號只看得到自己類別。</p>`;
    body.querySelectorAll('[data-y]').forEach((b) => b.addEventListener('click', () => { year += Number(b.dataset.y); show(body, guard); }));
    body.querySelector('[data-copy]').addEventListener('click', async (ev) => {
      ev.target.textContent = (await Share.copyText(text(m))) ? '已複製 ✓' : '複製失敗';
      setTimeout(() => { ev.target.textContent = '複製年度總結（貼 LINE）'; }, 2500);
    });
    body.querySelector('[data-xlsx]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try { await StatsExport.yearReport(m); } catch (err) { alert(err.message || '匯出失敗'); }
      ev.target.disabled = false;
    });
  }

  const api = { show, model, text, recentNewcomers, longAbsent };
  if (typeof module !== 'undefined') module.exports = api;
  else window.ReportPage = api;
})();
