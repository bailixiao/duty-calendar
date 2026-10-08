// 勤務詳情頁：勤務說明、報名名單（依了愿項目列出，名字只在這裡出現）、報名表單；公告型顯示輪值組，沒有報名。
// 名單上每人有「改期」「取消」（勤務當天含之後不能自己改，請聯絡管理者）。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const LAST_NAME_KEY = 'duty-calendar:last-name'; // 上次報名用的名字（從報名連結進來時帶入）
  let root = null;
  let token = 0;
  const page = { id: null, data: null, viewDate: null, revalidate: false };

  function show(id, date) {
    root = document.getElementById('view-duty');
    token += 1;
    page.id = id;
    page.data = null;
    page.goDone = null;
    page.viewDate = date || null;
    page.revalidate = false;
    // 快取裡有完整詳情（開網站時打包拿回的、或看過的）：連名單一起立刻顯示，舊的話在背景更新
    const cached = window.DutyCache && DutyCache.get(id);
    if (cached) {
      page.data = cached;
      pickViewDate();
      render();
      if (DutyCache.isFresh(id)) return;
      page.revalidate = true;
      load(token);
      return;
    }
    // 行事曆已有這個勤務的資料就先立刻顯示（名單除外），報名表單也可以先填；名單到了再補上
    const preview = window.CalendarPage && CalendarPage.peekDuty(id);
    if (preview) {
      preview.signups = null;
      page.data = preview;
      pickViewDate();
      render();
    } else {
      root.innerHTML = backLink() + '<p class="panel-empty">載入中⋯</p>';
    }
    load(token);
  }

  function pickViewDate() {
    const d = page.data;
    const dates = Fmt.datesBetween(d.start, d.end);
    if (dates.indexOf(page.viewDate) === -1) {
      page.viewDate = dates.find((x) => x >= d.today) || dates[dates.length - 1];
    }
  }

  async function load(t, flash) {
    try {
      const data = await DutyCache.fetch(page.id);
      if (t !== token) return;
      Fmt.setContact(data.contact);
      if (window.CalendarPage) CalendarPage.patchDuty(data); // 行事曆的人數一起更新
      if (page.data && (page.data.signups === null || page.revalidate) && !flash) {
        // 先前用行事曆資料或快取顯示：只補上說明、輪值組與名單，不重畫報名表單（避免清掉正在填的名字）
        page.revalidate = false;
        Object.assign(page.data, data);
        renderExtra();
        renderRoster();
        return;
      }
      page.data = data;
      pickViewDate();
      render(flash);
    } catch (err) {
      if (t !== token) return;
      if (page.revalidate) { page.revalidate = false; return; } // 背景更新失敗：繼續顯示快取的資料
      if (page.data && page.data.signups === null) {
        const el = document.getElementById('duty-roster');
        if (el) {
          el.innerHTML = `<h2>報名名單</h2><div class="notice notice-error" role="alert"><p>${esc(err.message || '無法載入名單')}</p><button type="button" class="btn" data-retry>重試</button></div>`;
          el.querySelector('[data-retry]').addEventListener('click', () => { renderRoster(); load(t); });
        }
        return;
      }
      root.innerHTML = backLink() + `
        <div class="notice notice-error" role="alert">
          <p>${esc(err.message || '無法載入，請稍後再試')}</p>
          <button type="button" class="btn" data-retry>重試</button>
        </div>`;
      root.querySelector('[data-retry]').addEventListener('click', () => {
        root.innerHTML = backLink() + '<p class="panel-empty">載入中⋯</p>';
        load(t, flash);
      });
    }
  }

  function backLink() {
    return ''; // 回行事曆：標題列左上的「‹」與頁面最下方的大按鈕
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
      ['師資', d.teachers],
      ['講師', d.lecturers],
      ['帶班', d.leaders],
      ['服裝', d.attire],
      ['報名截止', d.deadline ? Fmt.rocDate(d.deadline) : ''],
      ['負責組', isNotice ? '' : (Fmt.groupText(d) ? d.group : '')],
      ['<span class="nw">組長／</span><span class="nw">召集人</span>', isNotice || !Fmt.groupText(d) ? '' : d.groupLeader]
    ].filter((row) => row[1]);

    root.innerHTML = `
      ${backLink()}
      <article class="duty-detail">
        <header class="detail-head">
          <p class="detail-kicker"><span class="cat-tag cat-${esc(d.category || '勤務')}">${esc(Fmt.catLabel(d.category))}</span>${esc(d.nature || '勤務')}${isNotice ? '・公告（不需報名）' : ''}</p>
          <h1 class="detail-title">${esc(d.name)}</h1>
        </header>
        <div id="duty-flash">${flash || ''}</div>
        <dl class="detail-info">
          ${info.map((row) => `<div><dt>${row[0]}</dt><dd>${esc(row[1])}</dd></div>`).join('')}
        </dl>
        <div id="duty-extra"></div>
        ${isNotice ? '' : '<section id="duty-roster" class="detail-section"></section><section id="duty-signup" class="detail-section"></section>'}
      </article>
      <a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>`;

    renderExtra();
    if (!isNotice) {
      renderRoster();
      mountSignup();
      // 從職司表頁按「點我報名」過來：直接捲到報名表單
      if (sessionStorage.getItem('duty-calendar:to-signup') === d.id) {
        sessionStorage.removeItem('duty-calendar:to-signup');
        const box = document.getElementById('duty-signup');
        if (box) setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    }
  }

  /** 公告型的輪值組與說明（行事曆資料沒有這些，等詳情讀到再補） */
  function renderExtra() {
    const d = page.data;
    const el = document.getElementById('duty-extra');
    if (!el) return;
    const images = imagesFor(d.name);
    // DM：管理者上傳的照片、PDF（存在 Cloudflare）
    const dm = Array.isArray(d.dm) ? d.dm : [];
    const dmImages = dm.filter((x) => /^image\//.test(x.mime)).map((x) => ({ src: Api.fileUrl(x.id), caption: '' }));
    const dmPdfs = dm.filter((x) => x.mime === 'application/pdf');
    el.innerHTML = `
      ${d.layout === '職司表' ? stagesSection(d) : ''}
      ${d.mergeHost ? mergeHostSection(d) : ''}
      ${d.mode === '公告型' && (d.group || d.groupInfo) ? groupSection(d) : ''}
      ${dm.length ? `
        <section class="detail-section">
          <h2>DM${dmImages.length ? '<span class="h2-sub">點圖片可以放大</span>' : ''}</h2>
          ${dmImages.length ? `<div class="dm-images">${dmImages.map((img, i) => `
            <button type="button" class="dm-image" data-dm-img="${i}"><img src="${esc(img.src)}" alt="DM" loading="lazy"></button>`).join('')}</div>` : ''}
          ${dmPdfs.map((x) => `<a class="btn btn-block dm-pdf-link" href="${esc(Api.fileUrl(x.id))}" target="_blank" rel="noopener">📄 打開 PDF${x.name ? `：${esc(x.name.replace(/\.pdf$/i, ''))}` : ''}</a>`).join('')}
        </section>` : ''}
      ${d.description ? `
        <section class="detail-section">
          <h2>說明</h2>
          ${d.layout === '職司表' ? `<div class="rich-desc">${GridPage.richDesc(d.description)}</div>` : `<p class="detail-desc">${esc(d.description).replace(/\n/g, '<br>')}</p>`}
        </section>` : ''}
      ${images.length ? `
        <section class="detail-section">
          <h2>重點圖片<span class="h2-sub">點圖片可以放大</span></h2>
          <div class="duty-images">${images.map((img, i) => `
            <button type="button" class="duty-image" data-img="${i}">
              <img src="${esc(img.src)}" alt="${esc(img.caption)}" loading="lazy">
              <span>${esc(img.caption)}</span>
            </button>`).join('')}</div>
        </section>` : ''}`;
    el.querySelectorAll('[data-img]').forEach((b) => b.addEventListener('click', () => openImage(images[Number(b.dataset.img)])));
    el.querySelectorAll('[data-dm-img]').forEach((b) => b.addEventListener('click', () => openImage(dmImages[Number(b.dataset.dmImg)])));
  }

  /** 這個勤務的重點圖片（設定在 duty-images.js） */
  function imagesFor(name) {
    return (window.DUTY_IMAGES || []).filter((x) => name && name.indexOf(x.match) !== -1).flatMap((x) => x.images);
  }

  /** 放大看圖片：整張寬度顯示，可上下捲動 */
  function openImage(img) {
    const m = Modal.open(`
      <h2 class="modal-title">${esc(img.caption)}</h2>
      <img class="image-full" src="${esc(img.src)}" alt="${esc(img.caption)}">
      <div class="modal-actions">
        <a class="btn btn-block image-open" href="${esc(img.src)}" target="_blank" rel="noopener">開新頁看原圖（可以用手指放大）</a>
        <button type="button" class="btn btn-block" data-close>關閉</button>
      </div>`);
    m.el.classList.add('modal-wide');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
  }

  // ---------- 合併顯示：先拜香，接著上課 ----------

  function mergeHostSection(d) {
    const h = d.mergeHost;
    const rows = [
      ['時間', Fmt.timeRange({ start: d.start, end: d.start, startTime: h.startTime, endTime: h.endTime })],
      ['地點', h.location],
      ['輪值', h.group ? h.group + (h.groupLeader ? `（${h.groupLeader}）` : '') : ''],
      ['服裝', h.attire]
    ].filter((r) => r[1]);
    return `
      <section class="detail-section merge-host">
        <h2>🙏 先：${esc(h.name)}</h2>
        ${rows.length ? `<dl class="detail-info">${rows.map((r) => `<div><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('')}</dl>` : ''}
        <p class="merge-next">📖 接著：<strong>${esc(d.name)}</strong>${d.startTime ? '' : '（拜香完接著開始）'}</p>
        <a class="link-btn" href="#/duty/${encodeURIComponent(h.id)}?date=${d.start}">看${esc(h.name)}的詳情 ›</a>
      </section>`;
  }

  // ---------- 職司表：階段時間軸 ----------

  function stagesSection(d) {
    const stages = RosterGrid.parseStages(RosterGrid.stagesText(d), d.start, d.today);
    if (!stages.length) return '';
    return `
      <section class="detail-section">
        <ol class="stages">${stages.map((s) => `
          <li class="stage stage-${s.state}">
            <span class="stage-when"><span class="stage-n">${s.n}</span>${esc(s.when)}${s.state === 'now' ? '<span class="stage-now">進行中</span>' : ''}</span>
            <span class="stage-text">${esc(s.text)}</span>
          </li>`).join('')}</ol>
      </section>`;
  }

  // ---------- 職司表：一欄一天、一列一個了愿項目 ----------

  function gridSection(d) {
    if (!d.signups) return '<p class="muted">載入職司表中⋯</p>';
    return `
      <a class="btn btn-primary btn-block grid-open" href="#/grid/${encodeURIComponent(d.id)}">📋 打開大張職司表</a>
      ${GridPage.tableHtml(d)}
      <p class="hint">表格可以左右滑動。<span class="nw"><span class="grid-star">★</span> 是組長；</span><span class="nw">點「註」可以看註記。</span></p>`;
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
    const min = Fmt.effectiveMin(p);
    if (count < min) return { kind: 'short', text: `缺 ${min - count} 人・已報 ${of}` };
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

    const canChange = date > d.today; // 勤務當天（含）之後不能自己取消、改期
    const rows = d.positions.map((p) => {
      const label = positionLabel(p, day);
      const people = d.signups ? d.signups.filter((s) => s.date === date && s.positionId === p.id) : [];
      const names = !d.signups ? '<span class="muted">載入名單中⋯</span>' : people.length
        ? `<ul class="people">${people.map((s) => `
            <li class="person-row">
              <span class="person">${s.leader ? '<span class="grid-star" title="組長">★</span>' : ''}${esc(s.name)}${s.leader && d.leaderTitle ? `<span class="tag tag-leader">${esc(d.leaderTitle)}</span>` : ''}${s.temple && (d.signups || []).some((o) => o !== s && o.name === s.name) ? `<span class="tag">${esc(s.temple)}</span>` : ''}${s.accompany ? '<span class="tag">陪同</span>' : ''}</span>
            </li>`).join('')}</ul>`
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

    const leaderNow = d.leaderTitle && d.signups ? d.signups.filter((s) => s.date === date && s.leader).map((s) => s.name) : [];
    const leaderLine = d.leaderTitle && d.signups ? `<p class="leader-line">★ ${esc(d.leaderTitle)}：${leaderNow.length ? `<strong>${esc([...new Set(leaderNow)].join('、'))}</strong>` : `<span class="muted">還沒有${date > d.today ? '，報名時可以勾選' : ''}</span>`}</p>` : '';
    const daily = `
      ${tabs}
      ${leaderLine}
      <ul class="position-list">${rows}</ul>
      <p class="hint">「陪同」不佔名額。${canChange ? '要取消或改期，請到「查我的報名」輸入自己的名字。' : `當天（含）之後不能自己取消或改期，${Fmt.askAdmin()}。`}</p>
      ${canChange && (d.signups || []).length ? '<a class="btn btn-block roster-mine-link" href="#/mine">🔍 查我的報名（取消／改期）</a>' : ''}`;
    el.innerHTML = d.layout === '職司表' ? `
      <h2>職司表</h2>
      ${gridSection(d)}
      <details class="grid-daily"${page.dailyOpen ? ' open' : ''}>
        <summary>每天的名單</summary>
        ${daily}
      </details>` : `
      <h2>報名名單${dates.length > 1 ? `<span class="h2-sub">${Fmt.shortDate(date)}</span>` : ''}</h2>
      ${daily}`;
    const det = el.querySelector('.grid-daily');
    if (det) det.addEventListener('toggle', () => { page.dailyOpen = det.open; });

    el.querySelectorAll('[data-date]').forEach((btn) => btn.addEventListener('click', () => {
      page.viewDate = btn.dataset.date;
      renderRoster();
    }));
    if (d.layout === '職司表') GridPage.bindNotes(el, d);
  }

  // ---------- 報名表單 ----------

  function mountSignup() {
    const d = page.data;
    const el = document.getElementById('duty-signup');
    const open = Fmt.datesBetween(d.start, d.end).some((x) => x > d.today); // 當天（含）之後不能報名
    // 過了報名截止日：不能再報名，只看名單（管理者仍可補登）
    if (open && d.deadline && d.today && d.today > d.deadline) {
      el.innerHTML = `<h2>我要報名</h2><p class="notice notice-error">報名已在 ${Fmt.esc(Fmt.rocDate(d.deadline))} 截止。如需報名或更改，${Fmt.esc(Fmt.askAdmin())}。</p>`;
      return;
    }
    if (!open) {
      const isToday = Fmt.datesBetween(d.start, d.end).indexOf(d.today) !== -1;
      el.innerHTML = `<h2>我要報名</h2><p class="muted">${isToday
        ? `當天不能報名。如需報名、取消或改期，${Fmt.askAdmin()}。`
        : '已經結束，不能報名。'}</p>`;
      return;
    }
    SignupForm.mount(el, d, page.viewDate, onSignedUp);
    goSignup(el);
  }

  /** 從通知、LINE 的報名連結（&go=signup）進來：捲到報名表，名字帶入這支手機上次報名用的（只填入，按「加入」才算） */
  function goSignup(el) {
    if (location.hash.indexOf('go=signup') === -1 || page.goDone === page.data.id) return;
    page.goDone = page.data.id;
    let last = '';
    try { last = localStorage.getItem(LAST_NAME_KEY) || ''; } catch (e) { /* 無痕模式 */ }
    const input = el.querySelector('[data-name-input]');
    if (input && last && !input.value) {
      input.value = last;
      const hint = document.createElement('p');
      hint.className = 'hint go-hint';
      hint.textContent = `已帶入上次的名字「${last}」，是您的話按「加入」；不是的話改掉就好 😊`;
      const row = input.closest('.name-row') || input.parentElement;
      row.insertAdjacentElement('afterend', hint);
    }
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }

  /** 報名成功：用伺服器回傳的新報名與人數直接更新畫面（不用再等一次讀取），行事曆在背景更新 */
  /** 報名成功後的「加到手機行事曆」：每個日期一個按鈕（最多 7 個） */
  function calButtons(result) {
    const d = page.data;
    if (!d || d.id !== result.dutyId) return '';
    const many = result.dates.length > 1;
    return `<div class="addcal-row">${result.dates.slice(0, 7).map((date) => AddCal.button({
      name: d.name, location: d.location, start: d.start, end: d.end, startTime: d.startTime, endTime: d.endTime, dutyId: d.id, date
    }, many ? `加到行事曆：${Fmt.shortDate(date)}` : '加到手機行事曆')).join('')}</div>`;
  }

  function onSignedUp(result, res) {
    try { if (result.entries[0]) localStorage.setItem(LAST_NAME_KEY, result.entries[0].name); } catch (e) { /* 無痕模式 */ }
    const who = (e) => `${e.name}（${e.identity}${e.accompany ? '・陪同' : ''}）`;
    const dates = result.dates.map(Fmt.shortDate).join('、');
    // 大家報同樣的項目：一行名字＋項目；各報各的：逐人列出
    const body = result.positionName
      ? `<p>${esc(result.entries.map(who).join('、'))}<br>${esc(dates)}・${esc(result.positionName)}</p>`
      : `<p>${esc(dates)}</p>${result.entries.map((e) => `<p>${esc(who(e))}：${esc(e.positionLabel)}</p>`).join('')}`;
    const flash = `
      <div class="notice notice-success notice-big" role="status">
        <p><strong>✅ 報名成功！</strong></p>
        ${body}
        ${calButtons(result)}
      </div>`;
    if (window.CalendarPage) CalendarPage.refresh();
    if (!page.data || page.data.id !== result.dutyId) return; // 報名期間已離開這頁（例如按了瀏覽器返回）
    if (!page.data.signups) { load(token, flash); return; } // 名單還沒載入：直接重新讀取
    res.created.forEach((c) => page.data.signups.push({
      id: c.id, date: c.date, positionId: c.positionId || result.positionId, name: c.name, accompany: c.accompany, leader: !!c.leader, temple: c.temple || ''
    }));
    Object.assign(page.data.days, res.days);
    DutyCache.set(page.data.id, page.data);
    render(flash);
    const box = document.getElementById('duty-flash');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  window.DutyPage = { show };
})();
