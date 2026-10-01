// 進入點與頁面切換（#hash 路由）。
//   #/                       行事曆
//   #/duty/<勤務ID>?date=…   勤務詳情與報名（第 4 段完成）
(function () {
  'use strict';

  const views = {};

  /** 全畫面「處理中」遮罩：處理期間畫面上什麼都不能按 */
  window.Busy = {
    show(text, sub) {
      const el = document.getElementById('busy');
      el.querySelector('.busy-text').textContent = text;
      el.querySelector('.busy-sub').textContent = sub || '';
      el.hidden = false;
      document.querySelector('.app-main').inert = true;
    },
    hide() {
      document.getElementById('busy').hidden = true;
      document.querySelector('.app-main').inert = false;
    }
  };
  let calendarScrollY = 0;
  let current = 'calendar';

  function route() {
    const m = location.hash.match(/^#\/duty\/([^?]+)(?:\?date=(\d{4}-\d{2}-\d{2}))?/);
    if (m) {
      show('duty');
      const id = decodeURIComponent(m[1]);
      if (window.DutyPage) {
        window.DutyPage.show(id, m[2] || '');
      } else {
        views.duty.innerHTML = `
          <a class="back-link" href="#/">‹ 回行事曆</a>
          <p class="panel-empty">勤務詳情與報名將在下一段完成。</p>`;
      }
    } else {
      show('calendar');
    }
  }

  function show(name) {
    if (current === 'calendar' && name !== 'calendar') calendarScrollY = window.scrollY;
    Object.keys(views).forEach((k) => { views[k].hidden = k !== name; });
    if (name === 'calendar' && current !== 'calendar') {
      CalendarPage.onShow();
      window.scrollTo(0, calendarScrollY);
    } else if (name !== 'calendar') {
      window.scrollTo(0, 0);
    }
    current = name;
  }

  // 捲動位置由本程式自行管理（回到行事曆時還原、年檢視捲到目前月份）
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  document.addEventListener('DOMContentLoaded', () => {
    views.calendar = document.getElementById('view-calendar');
    views.duty = document.getElementById('view-duty');
    CalendarPage.init();
    window.addEventListener('hashchange', route);
    route();
  });
})();
