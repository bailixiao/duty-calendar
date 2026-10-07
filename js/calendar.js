// 行事曆首頁：年／月檢視用 FullCalendar，週檢視自製（七天直向列出，含沒有勤務的日子）。
// 「近期」檢視：今天起一個月有勤務的日子依序列出，最上面提醒哪幾天缺人（與管理後台的近期勤務同樣內容）。
// 格子顯示國曆、農曆與勤務色點；點日期在下方列出當天勤務卡片。格子上不顯示名字。
(function () {
  'use strict';

  const FC_VIEWS = { year: 'multiMonthYear', month: 'dayGridMonth' };
  const STORAGE_KEY = 'duty-calendar:view';
  const DOTS_MAX = { year: 3, month: 4 };
  const VENUE_ORDER = { 早上: '08:00', 下午: '13:00', 晚上: '18:00' }; // 場地借用排在當天的順序
  const RECENT_DAYS = 31; // 近期＝今天起一個月
  // 類別篩選（勤務／道務／教育）：有道務或教育的項目時才顯示篩選列；記住上次的選擇
  const CAT_KEY = 'duty-calendar:cat';
  let catFilter = (() => { try { return localStorage.getItem(CAT_KEY) || '全部'; } catch (e) { return '全部'; } })();
  const KIND_ORDER = { short: 0, full: 1, ok: 2, notice: 3, venue: 4 };

  const el = {};
  const state = {
    view: 'month',
    anchor: Fmt.toDateStr(new Date()),
    selected: null,
    today: Fmt.toDateStr(new Date()),
    range: null, // { from, to } 目前畫面上的資料區間
    loading: true, // 載入中不顯示舊區間的資料，避免誤判「沒有勤務」
    pendingScroll: null, // 年檢視載入完成後要捲到的月份
    showPast: false // 年檢視是否顯示今年已過的月份（每次開啟預設收起）
  };
  const EVENTS_STORAGE_PREFIX = 'duty-calendar:events:';
  const windows = new Map(); // 年份 → { data, fresh, promise }
  const dayMap = new Map(); // 'yyyy-MM-dd' → [{ duty, day, state }]
  // 我的勤務：這支手機記過的名字（手機提醒的「我是誰」優先，其次查我的報名查過的）
  const mine = { name: '', keys: new Set(), dates: new Set(), items: [], token: 0 };
  const cells = new Map(); // 'yyyy-MM-dd' → Set<HTMLElement>
  let calendar = null;
  let loadToken = 0;
  // 第一次畫出資料（手機裡上次的、或剛從伺服器拿到的）或載入失敗時完成；開場動畫等它（見 app.js）
  let readyResolve = null;
  const ready = new Promise((r) => { readyResolve = r; });

  function init() {
    el.fc = document.getElementById('fc');
    el.week = document.getElementById('week');
    el.title = document.getElementById('cal-title');
    el.status = document.getElementById('cal-status');
    el.panel = document.getElementById('day-panel');
    el.tabs = Array.from(document.querySelectorAll('[data-view]'));
    el.pastToggle = document.getElementById('past-toggle');
    el.nav = ['cal-prev', 'cal-next', 'cal-today'].map((id) => document.getElementById(id));

    state.view = loadSavedView();

    calendar = new FullCalendar.Calendar(el.fc, {
      locale: 'zh-tw',
      firstDay: 0,
      headerToolbar: false,
      height: 'auto',
      fixedWeekCount: false,
      initialView: FC_VIEWS[state.view] || FC_VIEWS.month,
      initialDate: state.anchor,
      multiMonthMinWidth: 260,
      multiMonthMaxColumns: 3,
      dayHeaderContent: (arg) => Fmt.weekday(Fmt.toDateStr(arg.date)),
      dayCellContent: cellContent,
      dayCellDidMount: onCellMount,
      dayCellWillUnmount: onCellUnmount,
      dateClick: (info) => onDateClick(info.dateStr),
      datesSet: onDatesSet
    });
    calendar.render();

    el.tabs.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.getElementById('cal-prev').addEventListener('click', () => move(-1));
    document.getElementById('cal-next').addEventListener('click', () => move(1));
    document.getElementById('cal-today').addEventListener('click', goToday);
    el.pastToggle.addEventListener('click', () => {
      state.showPast = !state.showPast;
      applyPastMonths();
    });

    applyView();
  }

  // ---------- 檢視切換與導覽 ----------

  function switchView(view) {
    if (view === state.view) return;
    // 月檢視選了某天後切換，以那天為準（例如切到週檢視就顯示那一週）
    if (state.view === 'month' && state.selected) state.anchor = state.selected;
    state.view = view;
    saveView(view);
    applyView();
  }

  function applyView() {
    el.tabs.forEach((btn) => {
      const on = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const isList = isListView();
    el.fc.hidden = isList;
    if (isList) el.pastToggle.hidden = true;
    el.week.hidden = !isList;
    el.panel.hidden = state.view !== 'month';
    // 近期檢視固定是今天起一個月，不需要翻頁
    el.nav.forEach((b) => { b.hidden = state.view === 'recent'; });

    if (state.view === 'recent') {
      loadRecent();
    } else if (isList) {
      loadWeek();
    } else {
      calendar.changeView(FC_VIEWS[state.view], state.anchor);
      calendar.updateSize();
      loadFcRange(); // datesSet 不一定會觸發（區間沒變時），這裡確保資料跟上
      if (state.view === 'year') state.pendingScroll = state.anchor;
    }
  }

  // ---------- 年檢視：今年已過的月份預設收起 ----------

  function pastMonthCount() {
    if (state.view !== 'year' || state.anchor.slice(0, 4) !== state.today.slice(0, 4)) return 0;
    return Number(state.today.slice(5, 7)) - 1;
  }

  function markPastMonth(month) {
    if (!month || !month.dataset.date) return;
    // 用月份自己的年份判斷（翻頁時格子會比 state.anchor 先更新）
    const key = month.dataset.date;
    const hide = !state.showPast && key.slice(0, 4) === state.today.slice(0, 4) && key < state.today.slice(0, 7);
    month.classList.toggle('is-past-month', hide);
  }

  function applyPastMonths() {
    el.fc.querySelectorAll('.fc-multimonth-month').forEach(markPastMonth);
    updatePastToggle();
  }

  function updatePastToggle() {
    const n = pastMonthCount();
    el.pastToggle.hidden = n === 0;
    if (n === 0) return;
    const range = n === 1 ? '1 月' : `1–${n} 月`;
    el.pastToggle.textContent = state.showPast ? '隱藏已過的月份' : `顯示已過的月份（${range}）`;
    el.pastToggle.setAttribute('aria-expanded', state.showPast ? 'true' : 'false');
  }

  /** 年檢視在手機上是 12 個月直向排列，切換過來時捲到目前月份（資料載入、高度穩定後才捲） */
  function scrollToPendingMonth() {
    const dateStr = state.pendingScroll;
    state.pendingScroll = null;
    if (!dateStr || state.view !== 'year') return;
    const month = el.fc.querySelector(`.fc-multimonth-month[data-date="${dateStr.slice(0, 7)}"]`);
    if (!month) return;
    const top = month.getBoundingClientRect().top + window.scrollY - 8;
    if (top > window.innerHeight / 2) window.scrollTo({ top });
  }

  function move(step) {
    if (state.view === 'recent') return;
    if (state.view === 'week') {
      state.anchor = Fmt.addDays(state.anchor, step * 7);
      loadWeek();
    } else if (step < 0) {
      calendar.prev();
    } else {
      calendar.next();
    }
  }

  function goToday() {
    state.anchor = state.today;
    state.selected = state.today;
    if (state.view === 'recent') {
      loadRecent();
    } else if (state.view === 'week') {
      loadWeek();
    } else {
      calendar.gotoDate(state.today);
      markSelected();
      renderPanel();
    }
  }

  /** 週、近期是自製的直向列表，不用 FullCalendar */
  function isListView() {
    return state.view === 'week' || state.view === 'recent';
  }

  function onDatesSet() {
    if (isListView()) return;
    loadFcRange();
  }

  function loadFcRange() {
    const view = calendar.view;
    state.anchor = Fmt.toDateStr(calendar.getDate());
    const from = Fmt.toDateStr(view.activeStart);
    const to = Fmt.addDays(Fmt.toDateStr(view.activeEnd), -1);

    if (state.view === 'month') {
      const monthStart = Fmt.toDateStr(view.currentStart);
      const monthEnd = Fmt.addDays(Fmt.toDateStr(view.currentEnd), -1);
      const inMonth = (d) => d && d >= monthStart && d <= monthEnd;
      if (!inMonth(state.selected)) state.selected = inMonth(state.today) ? state.today : monthStart;
    }
    setTitle();
    updatePastToggle();
    load(from, to);
  }

  function weekStart(dateStr) {
    return Fmt.addDays(dateStr, -Fmt.parseDate(dateStr).getDay());
  }

  function loadWeek() {
    const from = weekStart(state.anchor);
    setTitle();
    load(from, Fmt.addDays(from, 6));
  }

  function loadRecent() {
    setTitle();
    load(state.today, Fmt.addDays(state.today, RECENT_DAYS - 1));
  }

  function setTitle() {
    const a = state.anchor;
    let text;
    if (state.view === 'year') {
      text = `${Fmt.rocYear(a)} 年`;
    } else if (state.view === 'month') {
      text = `${Fmt.rocYear(a)} 年 ${Number(a.slice(5, 7))} 月`;
    } else if (state.view === 'recent') {
      text = '近一個月的行程';
    } else {
      const from = weekStart(a);
      const to = Fmt.addDays(from, 6);
      const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
      text = `${Fmt.rocYear(from)} 年 ${md(from)} – ${md(to)}`;
    }
    el.title.textContent = text;
  }

  // ---------- 資料 ----------

  // Apps Script 每次呼叫本身就要 2–3 秒，查一週跟查一年差不多快，
  // 所以一次載入一整年（前後各多 7 天，涵蓋月檢視與跨年的週），之後切換檢視、翻頁都不用再等。
  // 上次的資料存在 localStorage，再次開啟時先顯示，同時在背景更新（報名時伺服器會再檢查名額，不會因此超收）。

  function windowRange(year) {
    return { from: Fmt.addDays(`${year}-01-01`, -7), to: Fmt.addDays(`${year}-12-31`, 7) };
  }

  /** 涵蓋 from～to 的資料年份 */
  function windowYearFor(from, to) {
    const y = Number(from.slice(0, 4));
    return to <= windowRange(y).to ? y : y + 1;
  }

  function ensureWindow(year) {
    let entry = windows.get(year);
    if (!entry) {
      entry = { data: readStoredEvents(year), fresh: false, promise: null };
      windows.set(year, entry);
    }
    if (!entry.fresh && !entry.promise) {
      const r = windowRange(year);
      // 今年的資料順便打包近 30 天勤務的詳情（點進勤務就能立刻顯示，見 duty-cache.js）
      const fetcher = year === Number(state.today.slice(0, 4))
        ? Api.getBundle(r.from, r.to).then((data) => {
          if (window.DutyCache) DutyCache.setMany(data.details);
          delete data.details;
          return data;
        }, (err) => {
          // 伺服器還是舊版（沒有 getBundle）：改用一般的行事曆讀取
          if (err.code === 'BAD_REQUEST') return Api.getEvents(r.from, r.to);
          throw err;
        })
        : Api.getEvents(r.from, r.to);
      entry.promise = fetcher.then((data) => {
        entry.data = data;
        entry.fresh = true;
        if (data.today) state.today = data.today;
        entry.promise = null;
        storeEvents(year, data);
        return data;
      }, (err) => {
        entry.promise = null;
        throw err;
      });
    }
    return entry;
  }

  async function load(from, to) {
    const token = ++loadToken;
    state.range = { from, to };
    const year = windowYearFor(from, to);
    const entry = ensureWindow(year);

    if (entry.data) {
      render(entry.data, from, to);
      if (entry.fresh) hideStatus();
      else showStatus('refreshing');
    } else {
      state.loading = true;
      showStatus('loading');
      paintAllCells();
      renderList();
    }

    if (!entry.fresh) {
      try {
        const data = await entry.promise;
        if (token !== loadToken) return;
        render(data, from, to);
        hideStatus();
      } catch (err) {
        if (token !== loadToken) return;
        readyResolve();
        if (entry.data) showStatus('error', '無法更新，目前顯示的是上次的資料');
        else showStatus('error', err.message || '無法載入行事曆資料');
      }
    }
    prefetchNeighbor(state.anchor);
  }

  function render(data, from, to) {
    readyResolve();
    Fmt.setContact(data.contact);
    indexEvents(data, from, to);
    state.loading = false;
    paintAllCells();
    renderList();
    scrollToPendingMonth();
    if (!mine.loaded) loadMine();
  }

  // ---------- 我的勤務（首頁「下一個勤務」、行事曆上的 ✓） ----------

  function savedMyName() {
    try { return (localStorage.getItem('duty-calendar:push-name') || localStorage.getItem('duty-calendar:mine-name') || '').trim(); } catch (e) { return ''; }
  }

  async function loadMine() {
    mine.loaded = true;
    const name = savedMyName();
    const t = ++mine.token;
    mine.name = name;
    if (!name) { mine.keys.clear(); mine.dates.clear(); mine.items = []; renderMyNext(); return; }
    try {
      const res = await Api.mySignups(name);
      if (t !== mine.token) return;
      mine.items = res.items || [];
      mine.keys = new Set(mine.items.map((it) => it.dutyId + '|' + it.date));
      mine.dates = new Set(mine.items.map((it) => it.date));
      paintAllCells();
      renderList();
      renderMyNext();
    } catch (e) { /* 讀不到就先不顯示 */ }
  }

  function renderMyNext() {
    const box = document.getElementById('my-next');
    if (!box) return;
    if (!mine.name) { box.hidden = true; return; }
    const next = mine.items[0];
    const more = mine.items.length - 1;
    box.hidden = false;
    box.innerHTML = next
      ? `<a class="my-next-main" href="#/mine"><span class="my-next-who">👤 ${Fmt.esc(mine.name)} 的下一個勤務</span>
          <strong>${Fmt.esc(Fmt.shortDate(next.date))}${next.startTime && next.start === next.end ? ' ' + Fmt.esc(next.startTime) : ''}　${Fmt.esc(next.dutyName)}${next.positionName ? '・' + Fmt.esc(next.positionName) : ''}</strong>
          ${more > 0 ? `<span class="my-next-more">之後還有 ${more} 個 ›</span>` : '<span class="my-next-more">看我的報名 ›</span>'}</a>
         <a class="my-next-switch" href="#/mine">不是我／換名字</a>`
      : `<p class="my-next-main"><span class="my-next-who">👤 ${Fmt.esc(mine.name)}</span>目前沒有報名的勤務，看看哪裡缺人 🙋</p><a class="my-next-switch" href="#/mine">不是我／換名字</a>`;
  }

  /** 看的日期接近年底或年初時，先在背景載入相鄰年份 */
  function prefetchNeighbor(dateStr) {
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(5, 7));
    const next = month >= 10 ? year + 1 : month <= 2 ? year - 1 : null;
    if (next === null || (windows.get(next) && windows.get(next).fresh)) return;
    const entry = ensureWindow(next);
    if (entry.promise) entry.promise.catch(() => { /* 背景預先載入失敗無妨，用到時會再試 */ });
  }

  function readStoredEvents(year) {
    try {
      const raw = localStorage.getItem(EVENTS_STORAGE_PREFIX + year);
      const data = raw ? JSON.parse(raw) : null;
      return data && Array.isArray(data.duties) ? data : null;
    } catch (e) {
      return null;
    }
  }

  function storeEvents(year, data) {
    try {
      localStorage.setItem(EVENTS_STORAGE_PREFIX + year, JSON.stringify(data));
    } catch (e) { /* 無痕模式或空間不足，忽略 */ }
  }

  function indexEvents(data, from, to) {
    dayMap.clear();
    updateCatFilter(data);
    data.duties.forEach((duty) => {
      if (catFilter === '場地' || (catFilter !== '全部' && (duty.category || '勤務') !== catFilter)) return; // 「借場地」只看場地借用
      const start = duty.start > from ? duty.start : from;
      const end = duty.end < to ? duty.end : to;
      Fmt.datesBetween(start, end).forEach((date) => {
        const day = duty.days[date];
        const item = { duty, day, state: Fmt.dayState(duty, day) };
        if (!dayMap.has(date)) dayMap.set(date, []);
        dayMap.get(date).push(item);
      });
    });
    // 區中心場地已借出（姓名、用途）：「全部」與「借場地」時顯示
    if (catFilter === '全部' || catFilter === '場地') (data.venue || []).forEach((v) => {
      if (v.date < from || v.date > to) return;
      if (!dayMap.has(v.date)) dayMap.set(v.date, []);
      dayMap.get(v.date).push({ venue: v, duty: { name: '', startTime: VENUE_ORDER[v.slot] || '' }, state: { kind: 'venue', label: '已借出' } });
    });
    // 合併顯示：同一天有「名稱含 merge 文字」的項目（例：拜香輪值），把這筆接在它後面，變成一張卡片
    dayMap.forEach((items, date) => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        const key = it.duty.merge;
        if (!key) continue;
        const host = items.find((h) => h !== it && !h.duty.merge && h.duty.name.indexOf(key) !== -1);
        if (!host) continue;
        (host.follow = host.follow || []).unshift(it);
        items.splice(i, 1);
      }
      items.forEach((h) => { if (h.follow && !h.hostState) { h.hostState = h.state; h.state = h.follow[0].state; } }); // 卡片的狀態看要報名的那一筆
      void date;
    });
    dayMap.forEach((items) => items.sort((a, b) =>
      KIND_ORDER[a.state.kind] - KIND_ORDER[b.state.kind] ||
      (a.duty.startTime || '').localeCompare(b.duty.startTime || '') ||
      a.duty.name.localeCompare(b.duty.name, 'zh-Hant')));
  }

  function updateCatFilter(data) {
    const box = document.getElementById('cat-filter');
    if (!box) return;
    const hasOther = data.duties.some((d) => d.category && d.category !== '勤務') || (data.venue || []).length > 0;
    box.hidden = !hasOther;
    if (!hasOther) catFilter = '全部';
    box.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('is-active', b.dataset.cat === catFilter));
    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-cat]');
        if (!b) return;
        catFilter = b.dataset.cat;
        try { localStorage.setItem(CAT_KEY, catFilter); } catch (e) { /* 無痕模式：不記住 */ }
        if (state.range) load(state.range.from, state.range.to);
      });
    }
  }

  /** 重新向伺服器讀取目前畫面（報名後呼叫） */
  function refresh() {
    windows.forEach((entry) => { entry.fresh = false; });
    if (state.range) load(state.range.from, state.range.to);
    loadMine();
  }

  // ---------- 格子 ----------

  function cellContent(arg) {
    const date = Fmt.toDateStr(arg.date);
    let html = `<span class="cell-num">${arg.date.getDate()}</span>`;
    if (arg.view.type === FC_VIEWS.month) {
      const lunar = LunarUtil.cellLabel(date);
      html += `<span class="cell-lunar${lunar.highlight ? ' is-hl' : ''}">${lunar.text}</span>`;
    }
    return { html };
  }

  function onCellMount(arg) {
    if (arg.view.type === FC_VIEWS.year) markPastMonth(arg.el.closest('.fc-multimonth-month'));
    if (arg.isOther && arg.view.type === FC_VIEWS.year) return;
    const date = Fmt.toDateStr(arg.date);
    if (!cells.has(date)) cells.set(date, new Set());
    cells.get(date).add(arg.el);
    paintCell(arg.el, date);
  }

  function onCellUnmount(arg) {
    const set = cells.get(Fmt.toDateStr(arg.date));
    if (set) set.delete(arg.el);
  }

  function paintAllCells() {
    cells.forEach((set, date) => set.forEach((cell) => paintCell(cell, date)));
  }

  function paintCell(cell, date) {
    cell.classList.toggle('is-selected', state.view === 'month' && date === state.selected);
    cell.classList.toggle('is-past', date < state.today);
    const frame = cell.querySelector('.fc-daygrid-day-frame');
    if (!frame) return;
    const old = frame.querySelector('.cell-dots');
    if (old) old.remove();
    const oldMine = frame.querySelector('.cell-mine');
    if (oldMine) oldMine.remove();

    const items = state.loading ? [] : dayMap.get(date) || [];
    if (!items.length) {
      cell.removeAttribute('aria-label');
      return;
    }
    const max = DOTS_MAX[state.view] || 4;
    if (mine.dates.has(date)) {
      const mk = document.createElement('span');
      mk.className = 'cell-mine';
      mk.setAttribute('aria-hidden', 'true');
      mk.textContent = '✓';
      frame.appendChild(mk);
    }
    const dots = document.createElement('div');
    dots.className = 'cell-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = items.slice(0, max).map((it) => `<i class="dot dot-${it.state.kind}"></i>`).join('') +
      (items.length > max ? `<span class="cell-more">+${items.length - max}</span>` : '');
    frame.appendChild(dots);

    const short = items.filter((it) => it.state.kind === 'short').length;
    cell.setAttribute('aria-label', `${Fmt.shortDate(date)} ${items.length} 項${short ? `，${short} 項缺人` : ''}`);
  }

  function markSelected() {
    cells.forEach((set, date) => set.forEach((cell) =>
      cell.classList.toggle('is-selected', state.view === 'month' && date === state.selected)));
  }

  function onDateClick(date) {
    if (state.view === 'year') {
      state.selected = date;
      state.anchor = date;
      switchView('month');
      return;
    }
    state.selected = date;
    markSelected();
    renderPanel();
    el.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- 當天勤務卡片 ----------

  /** 類別小標籤：勤務（赭紅）、道務（紫）、教育（藍綠）；舊資料沒有類別的算勤務 */
  function catTag(duty) {
    const c = duty.category || '勤務';
    return `<span class="cat-tag cat-${Fmt.esc(c)}">${Fmt.esc(Fmt.catLabel(c))}</span>`;
  }

  function cardHtml(item, date, compact) {
    if (item.venue) return `
      <div class="duty-card kind-venue${compact ? ' is-compact' : ''}" role="note">
        <span class="card-main">
          <span class="card-title"><span class="cat-tag cat-venue">場地</span>🏠 ${Fmt.esc(window.SITE.venue)} ${Fmt.esc(item.venue.slot)}</span>
          <span class="card-meta">${Fmt.esc(item.venue.purpose)}（${Fmt.esc(item.venue.name)}）</span>
        </span>
        <span class="badge badge-venue">已借出</span>
      </div>`;
    if (item.follow) return mergedCardHtml(item, date, compact);
    const { duty, state: st } = item;
    const meta = [duty.location, Fmt.cardTime(duty, date)].filter(Boolean);
    const group = Fmt.groupText(duty);
    const href = `#/duty/${encodeURIComponent(duty.id)}?date=${date}`; // 職司表的勤務也先到報名頁，頁面上有「打開大張職司表」
    return `
      <a class="duty-card kind-${st.kind}${compact ? ' is-compact' : ''}" href="${href}">
        <span class="card-main">
          <span class="card-title">${catTag(duty)}${Fmt.esc(duty.name)}${mine.keys.has(duty.id + '|' + date) ? '<span class="card-mine">✓ 我有報名</span>' : ''}</span>
          ${meta.length ? `<span class="card-meta">${meta.map(Fmt.esc).join('・')}</span>` : ''}
          ${group && !compact ? `<span class="card-meta">${Fmt.esc(group)}</span>` : ''}
        </span>
        <span class="badge badge-${st.kind}">${Fmt.esc(st.label)}</span>
      </a>`;
  }

  /** 合併的卡片：先（拜香輪值，時間、輪值組）→ 接著（初一十五班）；點進去到要報名的那一筆 */
  function mergedCardHtml(item, date, compact) {
    const host = item.duty;
    const first = item.follow[0].duty;
    const st = item.state;
    const cat = catTag;
    const hostMeta = [Fmt.cardTime(host, date), host.location, item.hostState && item.hostState.kind === 'notice' ? item.hostState.label : Fmt.groupText(host)].filter(Boolean);
    return `
      <a class="duty-card kind-${st.kind} is-merged${compact ? ' is-compact' : ''}" href="#/duty/${encodeURIComponent(first.id)}?date=${date}">
        <span class="card-main">
          <span class="card-title">${cat(host)}🙏 ${Fmt.esc(host.name)}</span>
          ${hostMeta.length ? `<span class="card-meta">${hostMeta.map(Fmt.esc).join('・')}</span>` : ''}
          ${item.follow.map((f) => `<span class="card-follow">接著　${cat(f.duty)}${Fmt.esc(f.duty.name)}${mine.keys.has(f.duty.id + '|' + date) ? '<span class="card-mine">✓ 我有報名</span>' : ''}${f.duty.startTime ? `<small>${Fmt.esc(f.duty.startTime)}</small>` : ''}</span>`).join('')}
        </span>
        <span class="badge badge-${st.kind}">${Fmt.esc(st.label)}</span>
      </a>`;
  }

  function renderPanel() {
    if (state.view !== 'month' || !state.selected) return;
    const date = state.selected;
    const lunar = LunarUtil.lunarOf(date);
    const head = `
      <h2 class="panel-date">
        ${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日（${Fmt.weekday(date)}）
        <span class="panel-lunar">農曆${lunar.full}</span>
      </h2>`;
    let body;
    if (state.loading) {
      body = '<p class="panel-empty">載入中⋯</p>';
    } else {
      const items = dayMap.get(date) || [];
      body = items.length
        ? `<div class="card-list">${items.map((it) => cardHtml(it, date)).join('')}</div>`
        : '<p class="panel-empty">這天沒有行程</p>';
    }
    el.panel.innerHTML = head + body;
  }

  function renderList() {
    if (state.view === 'week') renderWeek();
    else if (state.view === 'recent') renderRecent();
    else renderPanel();
  }

  // ---------- 近期檢視 ----------

  function renderRecent() {
    if (state.loading) {
      el.week.innerHTML = '<p class="panel-empty">載入中⋯</p>';
      return;
    }
    const dates = Fmt.datesBetween(state.range.from, state.range.to).filter((d) => (dayMap.get(d) || []).length);
    const shortDates = dates.filter((d) => dayMap.get(d).some((it) => it.state.kind === 'short'));
    const alert = catFilter === '場地' ? '' : shortDates.length
      ? `<div class="notice notice-error recent-alert" role="status"><p><strong>近一個月有 ${shortDates.length} 天缺人</strong></p><p>${Fmt.shortDateList(shortDates)}</p><p class="muted">點勤務就可以報名幫忙</p>${Share.buttonsHtml()}</div>`
      : `<div class="notice recent-alert" role="status"><p>近一個月的勤務都不缺人</p></div>`;
    if (!dates.length) {
      el.week.innerHTML = `<p class="panel-empty">近一個月沒有行程</p>`;
      return;
    }
    const rows = dates.map((date) => {
      const lunar = LunarUtil.lunarOf(date);
      return `
        <li class="week-day${date === state.today ? ' is-today' : ''}">
          <div class="week-date">
            <span class="week-wd">${date === state.today ? '今天' : '週' + Fmt.weekday(date)}</span>
            <span class="week-md">${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}</span>
            <span class="week-lunar${lunar.isFirst || lunar.isFifteenth ? ' is-hl' : ''}">${lunar.full}</span>
          </div>
          <div class="week-items">${dayMap.get(date).map((it) => cardHtml(it, date, true)).join('')}</div>
        </li>`;
    });
    el.week.innerHTML = alert + `<ol class="week-list">${rows.join('')}</ol>`;
    const all = [];
    dates.forEach((date) => dayMap.get(date).forEach((it) => { if (!it.venue) all.push({ duty: it.duty, date, state: it.state }); }));
    Share.bind(el.week, () => Share.shortageText(all));
  }

  // ---------- 週檢視 ----------

  function renderWeek() {
    const from = weekStart(state.anchor);
    const rows = Fmt.datesBetween(from, Fmt.addDays(from, 6)).map((date) => {
      const lunar = LunarUtil.lunarOf(date);
      const items = dayMap.get(date) || [];
      const classes = ['week-day'];
      if (date === state.today) classes.push('is-today');
      if (date < state.today) classes.push('is-past');
      let content;
      if (state.loading) content = '<p class="week-empty">載入中⋯</p>';
      else if (items.length) content = items.map((it) => cardHtml(it, date, true)).join('');
      else content = '<p class="week-empty">沒有行程</p>';
      return `
        <li class="${classes.join(' ')}">
          <div class="week-date">
            <span class="week-wd">週${Fmt.weekday(date)}</span>
            <span class="week-md">${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}</span>
            <span class="week-lunar${lunar.isFirst || lunar.isFifteenth ? ' is-hl' : ''}">${lunar.full}</span>
          </div>
          <div class="week-items">${content}</div>
        </li>`;
    });
    el.week.innerHTML = `<ol class="week-list">${rows.join('')}</ol>`;
  }

  // ---------- 狀態列 ----------

  function showStatus(kind, message) {
    el.status.hidden = false;
    el.status.className = 'status status-' + kind;
    if (kind === 'loading') {
      el.status.innerHTML = '<span>載入中⋯</span>';
    } else if (kind === 'refreshing') {
      el.status.innerHTML = '<span>更新中⋯（先顯示上次的資料）</span>';
    } else {
      el.status.innerHTML = `<span>${Fmt.esc(message)}</span><button type="button" class="btn btn-small">重試</button>`;
      el.status.querySelector('button').addEventListener('click', refresh);
    }
  }

  function hideStatus() {
    el.status.hidden = true;
  }

  // ---------- 記住使用者選的檢視（只是方便，讀寫失敗不影響） ----------

  function loadSavedView() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'year' || v === 'month' || v === 'week' || v === 'recent' ? v : 'month';
    } catch (e) {
      return 'month';
    }
  }

  function saveView(v) {
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch (e) { /* 無痕模式等情況，忽略 */ }
  }

  /** 從其他頁面回到行事曆時呼叫（隱藏時 FullCalendar 量不到尺寸） */
  function onShow() {
    if (state.view !== 'week') calendar.updateSize();
    if (savedMyName() !== mine.name) loadMine(); // 在查我的報名換了名字
  }

  /**
   * 從已載入的行事曆資料找勤務（詳情頁先用它立刻顯示，名單再向伺服器讀）。
   * 回傳複本，含 today；找不到回傳 null。
   */
  function peekDuty(id) {
    for (const entry of windows.values()) {
      const d = entry.data && entry.data.duties.find((x) => x.id === id);
      if (d) return Object.assign(JSON.parse(JSON.stringify(d)), { today: state.today });
    }
    return null;
  }

  /** 已載入的行事曆資料中，與 from～to 重疊的勤務（days 只留區間內），格式同 getEvents；沒有資料回傳 null */
  function peekRange(from, to) {
    const seen = new Map();
    for (const entry of windows.values()) {
      if (!entry.data) continue;
      entry.data.duties.forEach((d) => {
        if (d.start > to || d.end < from || seen.has(d.id)) return;
        const copy = JSON.parse(JSON.stringify(d));
        Object.keys(copy.days).forEach((x) => { if (x < from || x > to) delete copy.days[x]; });
        seen.set(d.id, copy);
      });
    }
    return seen.size ? { from, to, today: state.today, duties: [...seen.values()] } : null;
  }

  /**
   * 詳情頁讀到某勤務的最新人數時呼叫：更新行事曆已載入的資料並重畫（不用再向伺服器讀整年）。
   * fresh 為 getDuty 的資料（含 days）。
   */
  function patchDuty(fresh) {
    let changed = false;
    windows.forEach((entry) => {
      const d = entry.data && entry.data.duties.find((x) => x.id === fresh.id);
      if (!d) return;
      Object.keys(fresh.days || {}).forEach((date) => {
        if (date in d.days && JSON.stringify(d.days[date]) !== JSON.stringify(fresh.days[date])) {
          d.days[date] = fresh.days[date];
          changed = true;
        }
      });
    });
    if (changed && state.range && !state.loading) {
      const year = windowYearFor(state.range.from, state.range.to);
      const entry = windows.get(year);
      if (entry && entry.data) {
        render(entry.data, state.range.from, state.range.to);
        storeEvents(year, entry.data);
      }
    }
  }

  window.CalendarPage = { init, refresh, onShow, peekDuty, peekRange, patchDuty, ready: () => ready, setView: switchView };
})();
