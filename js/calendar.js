// 行事曆首頁：年／月檢視用 FullCalendar，週檢視自製（七天直向列出，含沒有勤務的日子）。
// 格子顯示國曆、農曆與勤務色點；點日期在下方列出當天勤務卡片。格子上不顯示名字。
(function () {
  'use strict';

  const FC_VIEWS = { year: 'multiMonthYear', month: 'dayGridMonth' };
  const STORAGE_KEY = 'duty-calendar:view';
  const DOTS_MAX = { year: 3, month: 4 };
  const KIND_ORDER = { short: 0, full: 1, ok: 2, notice: 3 };

  const el = {};
  const state = {
    view: 'month',
    anchor: Fmt.toDateStr(new Date()),
    selected: null,
    today: Fmt.toDateStr(new Date()),
    range: null, // { from, to } 目前畫面上的資料區間
    loading: true, // 載入中不顯示舊區間的資料，避免誤判「沒有勤務」
    pendingScroll: null // 年檢視載入完成後要捲到的月份
  };
  const cache = new Map(); // 'from|to' → Promise
  const dayMap = new Map(); // 'yyyy-MM-dd' → [{ duty, day, state }]
  const cells = new Map(); // 'yyyy-MM-dd' → Set<HTMLElement>
  let calendar = null;
  let loadToken = 0;

  function init() {
    el.fc = document.getElementById('fc');
    el.week = document.getElementById('week');
    el.title = document.getElementById('cal-title');
    el.status = document.getElementById('cal-status');
    el.panel = document.getElementById('day-panel');
    el.tabs = Array.from(document.querySelectorAll('[data-view]'));

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
    const isWeek = state.view === 'week';
    el.fc.hidden = isWeek;
    el.week.hidden = !isWeek;
    el.panel.hidden = state.view !== 'month';

    if (isWeek) {
      loadWeek();
    } else {
      calendar.changeView(FC_VIEWS[state.view], state.anchor);
      calendar.updateSize();
      loadFcRange(); // datesSet 不一定會觸發（區間沒變時），這裡確保資料跟上
      if (state.view === 'year') state.pendingScroll = state.anchor;
    }
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
    if (state.view === 'week') {
      loadWeek();
    } else {
      calendar.gotoDate(state.today);
      markSelected();
      renderPanel();
    }
  }

  function onDatesSet() {
    if (state.view === 'week') return;
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

  function setTitle() {
    const a = state.anchor;
    let text;
    if (state.view === 'year') {
      text = `${Fmt.rocYear(a)} 年`;
    } else if (state.view === 'month') {
      text = `${Fmt.rocYear(a)} 年 ${Number(a.slice(5, 7))} 月`;
    } else {
      const from = weekStart(a);
      const to = Fmt.addDays(from, 6);
      const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
      text = `${Fmt.rocYear(from)} 年 ${md(from)} – ${md(to)}`;
    }
    el.title.textContent = text;
  }

  // ---------- 資料 ----------

  function fetchEvents(from, to) {
    const key = from + '|' + to;
    if (!cache.has(key)) {
      const p = Api.getEvents(from, to).catch((err) => {
        cache.delete(key);
        throw err;
      });
      cache.set(key, p);
    }
    return cache.get(key);
  }

  async function load(from, to) {
    const token = ++loadToken;
    state.range = { from, to };
    state.loading = true;
    showStatus('loading');
    paintAllCells();
    if (state.view === 'week') renderWeek();
    else renderPanel();
    try {
      const data = await fetchEvents(from, to);
      if (token !== loadToken) return;
      state.today = data.today || state.today;
      indexEvents(data, from, to);
      state.loading = false;
      hideStatus();
      paintAllCells();
      if (state.view === 'week') renderWeek();
      else renderPanel();
      scrollToPendingMonth();
    } catch (err) {
      if (token !== loadToken) return;
      showStatus('error', err.message || '無法載入勤務資料');
    }
  }

  function indexEvents(data, from, to) {
    dayMap.clear();
    data.duties.forEach((duty) => {
      const start = duty.start > from ? duty.start : from;
      const end = duty.end < to ? duty.end : to;
      Fmt.datesBetween(start, end).forEach((date) => {
        const day = duty.days[date];
        const item = { duty, day, state: Fmt.dayState(duty, day) };
        if (!dayMap.has(date)) dayMap.set(date, []);
        dayMap.get(date).push(item);
      });
    });
    dayMap.forEach((items) => items.sort((a, b) =>
      KIND_ORDER[a.state.kind] - KIND_ORDER[b.state.kind] ||
      (a.duty.startTime || '').localeCompare(b.duty.startTime || '') ||
      a.duty.name.localeCompare(b.duty.name, 'zh-Hant')));
  }

  /** 重新向伺服器讀取目前畫面（報名後呼叫） */
  function refresh() {
    cache.clear();
    if (state.range) load(state.range.from, state.range.to);
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

    const items = state.loading ? [] : dayMap.get(date) || [];
    if (!items.length) {
      cell.removeAttribute('aria-label');
      return;
    }
    const max = DOTS_MAX[state.view] || 4;
    const dots = document.createElement('div');
    dots.className = 'cell-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = items.slice(0, max).map((it) => `<i class="dot dot-${it.state.kind}"></i>`).join('') +
      (items.length > max ? `<span class="cell-more">+${items.length - max}</span>` : '');
    frame.appendChild(dots);

    const short = items.filter((it) => it.state.kind === 'short').length;
    cell.setAttribute('aria-label', `${Fmt.shortDate(date)} ${items.length} 項勤務${short ? `，${short} 項缺人` : ''}`);
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

  function cardHtml(item, date, compact) {
    const { duty, state: st } = item;
    const meta = [duty.location, Fmt.cardTime(duty, date)].filter(Boolean);
    const group = Fmt.groupText(duty);
    const href = `#/duty/${encodeURIComponent(duty.id)}?date=${date}`;
    return `
      <a class="duty-card kind-${st.kind}${compact ? ' is-compact' : ''}" href="${href}">
        <span class="card-main">
          <span class="card-title">${Fmt.esc(duty.name)}</span>
          ${meta.length ? `<span class="card-meta">${meta.map(Fmt.esc).join('・')}</span>` : ''}
          ${group && !compact ? `<span class="card-meta">${Fmt.esc(group)}</span>` : ''}
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
        : '<p class="panel-empty">這天沒有勤務</p>';
    }
    el.panel.innerHTML = head + body;
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
      else content = '<p class="week-empty">沒有勤務</p>';
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
      el.status.innerHTML = '<span>載入勤務中⋯</span>';
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
      return v === 'year' || v === 'month' || v === 'week' ? v : 'month';
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
  }

  window.CalendarPage = { init, refresh, onShow };
})();
