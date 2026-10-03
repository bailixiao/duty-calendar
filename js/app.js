// 進入點與頁面切換（#hash 路由）。
//   #/                       行事曆
//   #/duty/<勤務ID>?date=…   勤務詳情與報名
//   #/mine                   我的報名（見 mine.js）
//   #/admin…                 管理後台（見 admin.js）
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
    const admin = location.hash.match(/^#\/admin\/?(.*)$/);
    if (admin) {
      show('admin');
      AdminPage.show(admin[1]);
      return;
    }
    if (/^#\/mine\/?$/.test(location.hash)) {
      show('mine');
      MinePage.show();
      return;
    }
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

  // ---------- 開場動畫 ----------
  // 行事曆一畫出資料就放大淡出。手機裡有上次的資料時很快就有東西可看，只播約 0.7 秒；
  // 第一次打開要等伺服器，至少讓 logo 長大完（1.2 秒）；伺服器太慢最多等 3.5 秒，先進行事曆，資料到了再補。
  function hideSplashWhenReady() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    const started = performance.now();
    let gone = false;
    const hide = () => {
      if (gone) return;
      gone = true;
      splash.classList.add('is-leaving');
      setTimeout(() => splash.remove(), 600);
    };
    const later = (ms) => setTimeout(hide, Math.max(0, ms - performance.now()));
    CalendarPage.ready().then(() => {
      const cached = performance.now() - started < 200;
      later(cached ? 700 : 1200);
    });
    later(3500);
  }

  // 網頁檔案存在手機裡（見 sw.js）。本機開發時預設不啟用（改程式後才不會看到舊檔），網址加 ?sw=1 可測試。
  if ('serviceWorker' in navigator) {
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!local || /[?&]sw=1/.test(location.search)) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    }
  }

  // 捲動位置由本程式自行管理（回到行事曆時還原、年檢視捲到目前月份）
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  document.addEventListener('DOMContentLoaded', () => {
    views.calendar = document.getElementById('view-calendar');
    views.duty = document.getElementById('view-duty');
    views.mine = document.getElementById('view-mine');
    views.admin = document.getElementById('view-admin');
    CalendarPage.init();
    hideSplashWhenReady();
    window.addEventListener('hashchange', route);
    route();
  });
})();
