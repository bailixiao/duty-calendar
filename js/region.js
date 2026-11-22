// 分區（2026/11/19）：同一套網頁給 13 個區用。網址 ?r=<代號> 是哪一區（教全區沒有代號），見 docs/multi-region.md。
// 排在 site.js 之後、其他程式之前：
//   - 手機裡記的東西（duty-calendar: 開頭）其他區改記成 duty-calendar:<代號>:，教全區不變。
//   - 網站名稱、場地等設定（window.SITE）先用手機裡記的這一區設定，再向伺服器拿最新的（getSite）。
//   - API 網址加 region=<代號>（Region.api）；分享出去的網址用這一區的網址（Region.home）。
// 後端 worker/src/regions.js 有一樣的清單（tests/region.test.js 會檢查兩邊一致）。
(function () {
  'use strict';

  const REGIONS = {
    zhen: '教真區', shan: '教善區', mei: '教美區', zhi: '教志區', xiao: '教孝區', ren: '教仁區',
    yong: '教勇區', ding: '教定區', hui: '教慧區', fa: '教發區', ci: '教慈區', she: '教捨區',
    hq: '宏教分壇' // 宏教分壇（2026/11/22）：上級單位，只有「📣 分派」後台，沒有行事曆；分派送給上面 12 區和教全區（worker/src/hq.js）
  };
  const P = 'duty-calendar:';
  const SHARED = [P + 'text-size', P + 'api']; // 各區共用：字體大小（頁首一開始就要用）、API 測試開關

  const m = /[?&]r=([a-z]+)(?:&|$)/.exec(location.search);
  const code = m && Object.prototype.hasOwnProperty.call(REGIONS, m[1]) ? m[1] : '';
  const name = code ? REGIONS[code] : (window.SITE && window.SITE.org) || '';

  // ---------- 手機裡記的東西分區 ----------
  if (code) {
    const mine = P + code + ':';
    const map = (k) => (typeof k === 'string' && k.indexOf(P) === 0 && k.indexOf(mine) !== 0 && SHARED.indexOf(k) === -1 ? mine + k.slice(P.length) : k);
    const S = window.Storage && Storage.prototype;
    if (S) {
      const get = S.getItem;
      const set = S.setItem;
      const del = S.removeItem;
      S.getItem = function (k) { return get.call(this, map(k)); };
      S.setItem = function (k, v) { return set.call(this, map(k), v); };
      S.removeItem = function (k) { return del.call(this, map(k)); };
    }
  }

  /** 網站的根網址（…/duty-calendar/） */
  function root() {
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }

  /** 這一區分享用的網址：教全區 …/duty-calendar/，其他區 …/duty-calendar/she/（轉址頁會轉回 ?r=she） */
  function home() {
    return root() + (code ? code + '/' : '');
  }

  /** API 網址加上區代號（教全區不加） */
  function api(url) {
    if (!code || !url) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'region=' + code;
  }

  // ---------- 這一區的網站設定 ----------
  const SITE_KEY = P + 'site'; // 其他區會自動記成 duty-calendar:<代號>:site
  function regionDefaults() {
    return {
      name: name + '行事曆',
      org: name,
      locations: [],
      overseas: [],
      shortageTitle: '🙏【' + name + '勤務缺人通知】🙏',
      inviteTitle: '🙏【' + name + ' 成全邀請】🙏',
      examples: { dutyName: '例：區中心打掃', pushBody: '例：今晚 19:30 區中心，還缺 3 位，歡迎成全 🙏' }
    };
  }
  function applySite(s) {
    if (!s || !window.SITE) return;
    Object.keys(s).forEach((k) => { window.SITE[k] = s[k]; });
    document.title = window.SITE.name;
    const t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (t) t.setAttribute('content', window.SITE.name);
  }

  let notOpen = false;
  if (code) {
    applySite(regionDefaults());
    try { applySite(JSON.parse(localStorage.getItem(SITE_KEY) || 'null')); } catch (e) { /* 第一次、無痕模式：用預設 */ }
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', 'manifests/' + code + '.webmanifest'); // 加到主畫面：這一區的名稱、打開這一區
  }

  /** 向伺服器拿這一區最新的設定（開機時呼叫）；有變就套用並記在手機裡。這一區還沒開通就回 false */
  async function refreshSite() {
    if (!code || !window.APP_CONFIG) return true;
    try {
      const res = await fetch(api(window.APP_CONFIG.API_URL) + '&action=getSite');
      const json = await res.json();
      if (!json.ok) {
        if (json.error && json.error.code === 'NOT_OPEN') { notOpen = true; return false; }
        return true;
      }
      const s = json.data || {};
      delete s.siteUrl;
      applySite(s);
      try { localStorage.setItem(SITE_KEY, JSON.stringify(s)); } catch (e) { /* 記不住沒關係 */ }
    } catch (e) { /* 沒網路：用手機裡記的 */ }
    return true;
  }

  window.Region = {
    REGIONS,
    code,
    name,
    home,
    api,
    refreshSite,
    isNotOpen: () => notOpen
  };
})();
