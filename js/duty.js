// 勤務詳情頁：勤務說明、報名名單（依了愿項目列出，名字只在這裡出現）、報名表單；公告型顯示輪值組，沒有報名。
// 第一階段不提供取消、改期（第二階段加入）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  let root = null;
  let token = 0;
  const page = { id: null, data: null, viewDate: null };

  function show(id, date) {
    root = document.getElementById('view-duty');
    token += 1;
    page.id = id;
    page.data = null;
    page.viewDate = date || null;
    root.innerHTML = backLink() + '<p class="panel-empty">載入中⋯</p>';
    load(token);
  }

  async function load(t, flash) {
    try {
      const data = await Api.getDuty(page.id);
      if (t !== token) return;
      page.data = data;
      const dates = Fmt.datesBetween(data.start, data.end);
      if (dates.indexOf(page.viewDate) === -1) {
        page.viewDate = dates.find((d) => d >= data.today) || dates[dates.length - 1];
      }
      render(flash);
    } catch (err) {
      if (t !== token) return;
      root.innerHTML = backLink() + `
        <div class="notice notice-error" role="alert">
          <p>${esc(err.message || '無法載入勤務')}</p>
          <button type="button" class="btn" data-retry>重試</button>
        </div>`;
      root.querySelector('[data-retry]').addEventListener('click', () => {
        root.innerHTML = backLink() + '<p class="panel-empty">載入中⋯</p>';
        load(t, flash);
      });
    }
  }

  function backLink() {
    return '<a class="back-link" href="#/">‹ 回行事曆</a>';
  }

  function dateText(d) {
    return d.start === d.end ? Fmt.rocDate(d.start) : `${Fmt.rocDate(d.start)} – ${Fmt.shortDate(d.end)}`;
  }

  function render(flash) {
    const d = page.data;
    const isNotice = d.mode === '公告型';
    const info = [
      ['日期', dateText(d)],
      ['時段', Fmt.timeRange(d)],
      ['地點', d.location],
      ['服裝', d.attire],
      ['負責組', isNotice ? '' : Fmt.groupText(d).replace(/^負責：/, '')]
    ].filter((row) => row[1]);

    root.innerHTML = `
      ${backLink()}
      <article class="duty-detail">
        <header class="detail-head">
          <p class="detail-kicker">${esc(d.nature || '勤務')}${isNotice ? '・公告（不需報名）' : ''}</p>
          <h1 class="detail-title">${esc(d.name)}</h1>
        </header>
        <div id="duty-flash">${flash || ''}</div>
        <dl class="detail-info">
          ${info.map((row) => `<div><dt>${row[0]}</dt><dd>${esc(row[1])}</dd></div>`).join('')}
        </dl>
        ${isNotice ? groupSection(d) : ''}
        ${d.description ? `
          <section class="detail-section">
            <h2>說明</h2>
            <p class="detail-desc">${esc(d.description).replace(/\n/g, '<br>')}</p>
          </section>` : ''}
        ${isNotice ? '' : '<section id="duty-roster" class="detail-section"></section><section id="duty-signup" class="detail-section"></section>'}
      </article>`;

    if (!isNotice) {
      renderRoster();
      mountSignup();
    }
  }

  // ---------- 公告型：本次輪值組 ----------

  function groupSection(d) {
    const g = d.groupInfo || { name: d.group, leader: '', assistant: '', members: [] };
    const rows = [
      ['輪值組', g.name || d.group],
      ['組長', g.leader],
      ['佐理', g.assistant]
    ].filter((row) => row[1]);
    return `
      <section class="detail-section">
        <h2>本次輪值</h2>
        <dl class="detail-info">
          ${rows.map((row) => `<div><dt>${row[0]}</dt><dd>${esc(row[1])}</dd></div>`).join('')}
          ${g.members.length ? `<div><dt>組員</dt><dd>${g.members.map(esc).join('、')}</dd></div>` : ''}
        </dl>
      </section>`;
  }

  // ---------- 報名名單 ----------

  function positionLabel(p, day) {
    const count = (day && day.counts[p.id]) || 0;
    const of = p.max !== null ? `${count}／${p.max}` : `${count}`;
    if (p.max !== null && count >= p.max) return { kind: 'full', text: `額滿 ${of}` };
    if (p.min !== null && count < p.min) return { kind: 'short', text: `缺 ${p.min - count} 人・已報 ${of}` };
    return { kind: 'ok', text: `已報 ${of} 人` };
  }

  function renderRoster() {
    const d = page.data;
    const el = document.getElementById('duty-roster');
    const dates = Fmt.datesBetween(d.start, d.end);
    const date = page.viewDate;
    const day = d.days[date];

    const tabs = dates.length > 1 ? `
      <div class="date-tabs" role="group" aria-label="選擇要查看的日期">
        ${dates.map((x) => {
          const st = Fmt.dayState(d, d.days[x]);
          return `<button type="button" class="date-tab${x === date ? ' is-active' : ''}${x < d.today ? ' is-past' : ''}" data-date="${x}" aria-pressed="${x === date}">
            <span class="date-tab-day">${Fmt.shortDate(x)}</span>
            <span class="date-tab-state state-${st.kind}">${esc(st.label)}</span>
          </button>`;
        }).join('')}
      </div>` : '';

    const rows = d.positions.map((p) => {
      const label = positionLabel(p, day);
      const people = d.signups.filter((s) => s.date === date && s.positionId === p.id);
      const names = people.length
        ? people.map((s) => `<span class="person">${esc(s.name)}${s.accompany ? '<span class="tag">陪同</span>' : ''}</span>`).join('')
        : '<span class="muted">還沒有人報名</span>';
      return `
        <li class="position">
          <div class="position-head">
            <span class="position-name">${esc(p.name)}${p.slot && p.name.indexOf(p.slot) === -1 ? `<small>${esc(p.slot)}</small>` : ''}</span>
            <span class="badge badge-${label.kind}">${esc(label.text)}</span>
          </div>
          <div class="position-people">${names}</div>
        </li>`;
    }).join('');

    el.innerHTML = `
      <h2>報名名單${dates.length > 1 ? `<span class="h2-sub">${Fmt.shortDate(date)}</span>` : ''}</h2>
      ${tabs}
      <ul class="position-list">${rows}</ul>
      <p class="hint">「陪同」不佔名額。要取消或改期請聯絡管理者。</p>`;

    el.querySelectorAll('[data-date]').forEach((btn) => btn.addEventListener('click', () => {
      page.viewDate = btn.dataset.date;
      renderRoster();
    }));
  }

  // ---------- 報名表單 ----------

  function mountSignup() {
    const d = page.data;
    const el = document.getElementById('duty-signup');
    const open = Fmt.datesBetween(d.start, d.end).some((x) => x >= d.today);
    if (!open) {
      el.innerHTML = '<h2>我要報名</h2><p class="muted">這個勤務已經結束，不能報名。</p>';
      return;
    }
    SignupForm.mount(el, d, page.viewDate, onSignedUp);
  }

  /** 報名成功：用伺服器回傳的新報名與人數直接更新畫面（不用再等一次讀取），行事曆在背景更新 */
  function onSignedUp(result, res) {
    const names = result.entries.map((e) => `${e.name}（${e.identity}${e.accompany ? '・陪同' : ''}）`).join('、');
    const dates = result.dates.map(Fmt.shortDate).join('、');
    const flash = `
      <div class="notice notice-success" role="status">
        <p><strong>報名成功！</strong></p>
        <p>${esc(names)}<br>${esc(dates)}・${esc(result.positionName)}</p>
      </div>`;
    if (window.CalendarPage) CalendarPage.refresh();
    if (!page.data || page.data.id !== result.dutyId) return; // 報名期間已離開這頁（例如按了瀏覽器返回）
    res.created.forEach((c) => page.data.signups.push({
      id: c.id, date: c.date, positionId: result.positionId, name: c.name, accompany: c.accompany
    }));
    Object.assign(page.data.days, res.days);
    render(flash);
    const box = document.getElementById('duty-flash');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  window.DutyPage = { show };
})();
