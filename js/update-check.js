// 🔄 有新版本時自動更新（2026/11/24）：網頁一直開著（手機切到別的 App 再切回來、加到主畫面的）不會重新下載，
//   會一直看到舊的畫面。這裡定時（切回這個網頁時、開著每 10 分鐘）看一下網站上的 index.html 版本號（?v=…）：
//   - 和現在的不一樣，而且沒有在填東西（沒有打開的對話框、表單沒有改過）→ 直接重新載入。
//   - 正在填東西 → 上面出現「🔄 有新版本，按這裡更新」，等使用者自己按（不會弄丟填到一半的資料）。
(function () {
  'use strict';

  // 網站版本：<meta name="app-version">（正式網站每個檔案的 ?v= 是內容雜湊，見 tools/build-pages.js）；沒有的話看 app.js 的 ?v=
  const mine = (() => {
    const meta = document.querySelector('meta[name="app-version"]');
    if (meta && meta.content) return meta.content;
    const s = document.querySelector('script[src*="js/app.js?v="]');
    const m = s && /[?&]v=([\w-]+)/.exec(s.getAttribute('src'));
    return m ? m[1] : '';
  })();
  if (!mine || !window.fetch) return;

  const EVERY = 10 * 60 * 1000;
  let lastCheck = Date.now();
  let shown = false;

  /** 有沒有正在填的東西：打開的對話框、年度報表、改過的輸入框 */
  function busy() {
    if (document.querySelector('.modal, .yr-overlay, .celebrate')) return true;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'search') return true;
    return [...document.querySelectorAll('input, textarea')].some((el) => {
      if (/^(hidden|search|button|submit)$/.test(el.type)) return false;
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
      return el.value !== el.defaultValue;
    });
  }

  async function latest() {
    const url = new URL('./', location.href);
    url.searchParams.set('vcheck', String(Date.now())); // sw.js 不處理帶 vcheck 的（不會拿到手機裡存的舊網頁）
    const res = await fetch(url.href, { cache: 'no-store' });
    if (!res.ok) return '';
    const text = await res.text();
    const m = /<meta name="app-version" content="([\w-]+)"/.exec(text) || /js\/app\.js\?v=([\w-]+)/.exec(text);
    return m ? m[1] : '';
  }

  function bar() {
    if (shown) return;
    shown = true;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'update-bar';
    el.textContent = '🔄 網站有新版本，按這裡更新';
    el.addEventListener('click', () => location.reload());
    document.body.appendChild(el);
  }

  async function check(auto) {
    if (navigator.onLine === false) return;
    lastCheck = Date.now();
    let v = '';
    try { v = await latest(); } catch (e) { return; }
    if (!v || v === mine) return;
    if (auto && !busy()) location.reload();
    else bar();
  }

  // 切回這個網頁（手機從別的 App 回來）：可以的話直接更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60 * 1000) check(true);
  });
  // 一直開著看：每 10 分鐘看一次；正在看畫面時不突然跳掉，只出現提示
  setInterval(() => { if (document.visibilityState === 'visible') check(false); }, EVERY);

  window.UpdateCheck = { check, busy, version: mine };
})();
