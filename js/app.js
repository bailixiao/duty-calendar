// 進入點與頁面切換（#hash 路由）。
//   #/                       行事曆
//   #/duty/<勤務ID>?date=…   勤務詳情與報名
//   #/mine                   我的報名（見 mine.js）
//   #/grid/<勤務ID>          職司表大頁面（見 grid-page.js）
//   #/venue?date=…           借區中心場地（見 venue.js）
//   #/help、#/help/<問題ID>、#/help?c=分類   常見問題（見 help.js）
//   #/rollcall/<勤務ID>?date=…   當天點名（見 rollcall.js）
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
    // 通知點進來：打開行事曆的「近期」
    if (location.hash === '#/recent') {
      history.replaceState(null, '', '#/');
      show('calendar');
      CalendarPage.setView('recent');
      return;
    }
    const venue = location.hash.match(/^#\/venue\/?(?:\?date=(\d{4}-\d{2}-\d{2}))?/);
    if (venue) {
      show('venue');
      VenuePage.show(venue[1] || '');
      return;
    }
    const rc = location.hash.match(/^#\/rollcall\/([^?]+)\?date=(\d{4}-\d{2}-\d{2})/);
    if (rc) {
      show('rollcall');
      RollcallPage.show(decodeURIComponent(rc[1]), rc[2]);
      return;
    }
    const help = location.hash.match(/^#\/help(?:\/([^?]+))?\/?(?:\?c=([^&]+))?$/);
    if (help) {
      show('help');
      HelpPage.show(help[1] ? decodeURIComponent(help[1]) : '', help[2] ? decodeURIComponent(help[2]) : '');
      return;
    }
    const grid = location.hash.match(/^#\/grid\/([^?]+)/);
    if (grid) {
      show('grid');
      GridPage.show(decodeURIComponent(grid[1]));
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
    // 勤務頁、我的報名、管理後台：標題列左邊顯示「‹」，點標題回行事曆（取代頁面上方的「‹ 回行事曆」）
    document.body.classList.toggle('is-sub', name !== 'calendar');
    document.body.classList.toggle('on-admin', name === 'admin');
    document.body.classList.toggle('on-grid', name === 'grid'); // 職司表大頁面：版面放寬 // 管理後台裡不顯示右下角的「管理者」連結
  }

  // ---------- 開場動畫 ----------
  // 1. logo 由小變大再放大淡出 → 2. 一個字一個字浮現「教全區行事曆」→ 3. 名稱滑到左上角（變成頁首標題）
  // → 4. 行事曆展開。各段重疊接續、中間不停頓，全程約 3.5 秒；期間在背景讀取資料，沒讀完也照常展開，資料到了再補。
  const SITE_NAME = window.SITE.name;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function hideSplashWhenReady() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    const main = document.querySelector('.app-main');
    const finish = () => {
      splash.remove();
      document.body.classList.remove('splash-on');
      if (window.PushPage) PushPage.showCardIfNeeded(); // 動畫結束後才問要不要開啟提醒
    };
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !splash.animate) {
      await Promise.race([CalendarPage.ready(), wait(1500)]);
      finish();
      return;
    }
    try {
      const bg = splash.querySelector('.splash-bg');
      const logo = splash.querySelector('.splash-logo');
      const title = splash.querySelector('[data-splash-title]');
      const header = document.querySelector('.app-title');
      const chars = [...SITE_NAME];
      title.innerHTML = chars.map((c) => `<span>${c}</span>`).join('');
      // 等字型載入再量寬度（最多 0.3 秒，這段時間畫面只是底色），名稱才會剛好置中、落點剛好對齊頁首
      await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), wait(300)]);
      const scale = Math.min(1.8, (window.innerWidth - 40) / title.offsetWidth);
      const from = `translate(${(window.innerWidth - title.offsetWidth * scale) / 2}px, ${window.innerHeight * 0.42 - title.offsetHeight * scale / 2}px) scale(${scale})`;
      const r = header.getBoundingClientRect();
      const to = `translate(${r.left}px, ${r.top + (r.height - title.offsetHeight) / 2}px) scale(1)`;
      title.style.transform = from;

      // 時間軸（毫秒）：每一段在上一段快結束時就開始，整段連續不停頓
      const T = { logo: 1300, type: 1000, step: 80, charIn: 320, fly: 2050, flyDur: 850, reveal: 2750, revealDur: 750 };
      const smooth = 'cubic-bezier(.65, 0, .35, 1)';

      // 1. logo：由小變大（略微超過再回來）→ 停一下下 → 放大淡出，一個動畫連貫完成
      logo.animate([
        { transform: 'scale(.15)', opacity: 0, offset: 0 },
        { transform: 'scale(1.08)', opacity: 1, offset: 0.45 },
        { transform: 'scale(1)', opacity: 1, offset: 0.62 },
        { transform: 'scale(1.7)', opacity: 0, offset: 1 }
      ], { duration: T.logo, easing: 'ease-in-out', fill: 'forwards' });

      // 2. 一個字一個字浮現（logo 還在淡出時就開始）
      title.querySelectorAll('span').forEach((s, i) => s.animate([
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'none' }
      ], { duration: T.charIn, delay: T.type + i * T.step, easing: 'ease-out', fill: 'both' }));

      // 3. 名稱縮小、滑到左上角，落在頁首標題的位置
      title.animate([{ transform: from }, { transform: to }], { duration: T.flyDur, delay: T.fly, easing: smooth, fill: 'both' });

      // 4. 名稱快到定位時，底色淡出、行事曆從下方輕輕展開
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: T.revealDur, delay: T.reveal, easing: 'ease-out', fill: 'both' });
      const show = main.animate([
        { opacity: 0, transform: 'translateY(28px) scale(.97)' },
        { opacity: 1, transform: 'none' }
      ], { duration: T.revealDur, delay: T.reveal, easing: 'cubic-bezier(.2, .7, .2, 1)', fill: 'both' });
      document.body.classList.remove('splash-on'); // 主畫面的透明度改由上面的動畫控制
      header.style.visibility = 'hidden';
      await show.finished;
      header.style.visibility = '';
      show.cancel();
    } catch (e) { /* 動畫出問題就直接進行事曆 */ }
    finish();
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

  // ---------- 字體大小（頁首 A＋）：標準 → 大 → 特大 → 標準，記在這支手機 ----------
  const TEXT_KEY = 'duty-calendar:text-size';
  const TEXT_STEPS = [['', 'A＋'], ['l', 'A＋＋'], ['xl', 'A 原本']];
  function initTextSize() {
    const btn = document.getElementById('text-size');
    if (!btn) return;
    const root = document.documentElement;
    const now = () => (root.classList.contains('text-xl') ? 'xl' : root.classList.contains('text-l') ? 'l' : '');
    const paint = () => {
      const i = TEXT_STEPS.findIndex((s) => s[0] === now());
      btn.textContent = TEXT_STEPS[i][1];
      btn.setAttribute('aria-label', '字體大小：' + ['標準', '大', '特大'][i] + '，按一下換');
    };
    btn.addEventListener('click', () => {
      const i = TEXT_STEPS.findIndex((s) => s[0] === now());
      const next = TEXT_STEPS[(i + 1) % TEXT_STEPS.length][0];
      root.classList.remove('text-l', 'text-xl');
      if (next) root.classList.add('text-' + next);
      try { localStorage.setItem(TEXT_KEY, next); } catch (e) { /* 無痕模式 */ }
      paint();
      window.dispatchEvent(new Event('resize')); // 讓月曆重新排版
    });
    paint();
  }

  /** 把 index.html 裡的團體名稱、場地、類別名稱換成 js/site.js 的設定；關掉的功能藏起來 */
  function applySite() {
    const S = window.SITE;
    document.title = S.name;
    const t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (t) t.setAttribute('content', S.name);
    document.querySelectorAll('[data-site]').forEach((el) => { if (S[el.dataset.site]) el.textContent = S[el.dataset.site]; });
    // data-site-tpl：整段文字的範本，{venue} 這類換成設定（只換文字，不拆開元素，排版不變）
    document.querySelectorAll('[data-site-tpl]').forEach((el) => { el.textContent = el.dataset.siteTpl.replace(/\{(\w+)\}/g, (m, k) => S[k] || ''); });
    document.querySelectorAll('[data-site-cat]').forEach((el) => { el.textContent = Fmt.catLabel(el.dataset.siteCat); });
    document.querySelectorAll('[data-feature]').forEach((el) => { if (S.features && S.features[el.dataset.feature] === false) el.hidden = true; });
  }

  document.addEventListener('DOMContentLoaded', () => {
    applySite();
    initTextSize();
    views.calendar = document.getElementById('view-calendar');
    views.duty = document.getElementById('view-duty');
    views.mine = document.getElementById('view-mine');
    views.grid = document.getElementById('view-grid');
    views.venue = document.getElementById('view-venue');
    views.admin = document.getElementById('view-admin');
    views.help = document.getElementById('view-help');
    views.rollcall = document.getElementById('view-rollcall');
    CalendarPage.init();
    // 搬家測試：用 ?api=cf 試用 Cloudflare 版時，左下角顯示提示，按一下切回正式版
    if (window.APP_CONFIG.TEST) {
      const b = document.createElement('a');
      b.className = 'test-badge';
      b.href = location.pathname + '?api=' + (window.APP_CONFIG.API_NAME === 'cf' ? 'gas' : 'cf');
      b.textContent = '🧪 ' + (window.APP_CONFIG.API_NAME === 'cf' ? 'Cloudflare' : 'Google') + ' 測試版（按這裡切回）';
      document.body.appendChild(b);
    }
    document.getElementById('push-open').addEventListener('click', () => PushPage.openPanel());
    hideSplashWhenReady();
    window.addEventListener('hashchange', route);
    route();
  });
})();
