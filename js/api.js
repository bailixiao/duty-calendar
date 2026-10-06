// 呼叫 Apps Script API。
// 讀取用 GET；寫入用 POST，內容是 JSON 但標頭設 text/plain，避免 CORS 預檢（Apps Script 不支援）。
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details || [];
    }
  }

  async function parse(res) {
    if (!res.ok) throw new ApiError('NETWORK', '連線失敗，請稍後再試');
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new ApiError('NETWORK', '伺服器回應格式錯誤，請稍後再試');
    }
    if (!json.ok) throw new ApiError(json.error.code, json.error.message, json.error.details);
    return json.data;
  }

  async function getOnce(url, timeoutMs, ctrl) {
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal });
      return await parse(res);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK', '無法連線，請檢查網路後再試');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 讀取。Apps Script 偶爾單一請求會卡住十幾秒，但同時再問一次通常 2–3 秒就回來。
   * 所以第一個請求超過 waits[0] 毫秒還沒回來，就「同時」再送一個（前一個不取消），誰先回來用誰；
   * 之後每隔 waits[i] 再加送一個，最多送 waits.length + 1 個。全部都連線失敗才算失敗。
   * 只有讀取會這樣做；報名（寫入）不重送，避免重複寫入。
   */
  function get(action, params, waitList) {
    const url = window.APP_CONFIG.API_URL + '?' + new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const waits = waitList || [3500, 5000, 10000];
    return new Promise((resolve, reject) => {
      const ctrls = [];
      let done = false;
      let started = 0;
      let failed = 0;
      let timer = null;
      const finish = (fn, value, winner) => {
        done = true;
        clearTimeout(timer);
        ctrls.forEach((c) => { if (c !== winner) c.abort(); });
        fn(value);
      };
      const launch = () => {
        if (done || started > waits.length) return;
        const i = started++;
        const ctrl = new AbortController();
        ctrls.push(ctrl);
        clearTimeout(timer);
        if (i < waits.length) timer = setTimeout(launch, waits[i]);
        getOnce(url, 40000, ctrl).then((data) => {
          if (!done) finish(resolve, data, ctrl);
        }, (err) => {
          if (done) return;
          if (err.code !== 'NETWORK') return finish(reject, err); // 伺服器明確回錯誤（例如找不到勤務）：不用再問
          failed++;
          if (failed < started) return; // 還有其他請求在等
          if (started <= waits.length) launch(); // 全部都失敗了：馬上再送一個
          else finish(reject, err);
        });
      };
      launch();
    });
  }

  /**
   * Apps Script 偶爾會把 POST 的內容弄丟（例如剛部署新版本時），伺服器收到的是沒有內容的請求、
   * 回「未知的 action：（空白）」。這代表確定沒有寫入，可以安全地重送（最多 2 次）。
   */
  function lostBody(err) {
    return err.code === 'BAD_REQUEST' && /未知的 action：（空白）/.test(err.message);
  }

  async function post(body) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await postOnce(body);
      } catch (err) {
        if (!lostBody(err) || attempt >= 2) throw err;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }

  /** 寫入（報名）。連線失敗不自動重送，避免重複寫入；超過 90 秒視為連線問題（之後由報名表單查證是否已寫入） */
  async function postOnce(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      return await parse(res);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK', '無法連線，請檢查網路後再試');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 寫入時伺服器回 BUSY（同時使用的人太多、排隊逾時）代表確定沒有寫入，可以安全地自動重送。
   * 隨機等 1–3 秒（避免大家同時再擠進來）後重送，最多重送 3 次；每次重送前呼叫 onBusy()。
   */
  async function retryBusy(fn, onBusy) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err.code !== 'BUSY' || attempt >= 3) throw err;
        if (onBusy) onBusy();
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
      }
    }
  }

  // ---------- 管理後台 ----------
  // 通行碼存在這個瀏覽器（6 小時後過期）；讀寫失敗不影響使用，只是要重新登入。
  const TOKEN_KEY = 'duty-calendar:admin';

  function loadSaved() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      return t && t.expires > Date.now() ? t : null;
    } catch (e) {
      return null;
    }
  }

  function loadToken() {
    const t = loadSaved();
    return t ? t.token : null;
  }

  function saveToken(token, expiresInSec, who) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(Object.assign({ token, expires: Date.now() + expiresInSec * 1000 - 60000 }, who || {})));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 無痕模式等，忽略 */ }
  }

  let adminToken = loadToken();
  // 登入的帳號與角色（總管理者／勤務／道務／教育／唯讀）：畫面依此顯示能用的功能，真正的權限由伺服器檢查
  let adminWho = (() => { const t = loadSaved(); return t && t.role ? { account: t.account, role: t.role } : { account: '總管理者', role: '總管理者' }; })();

  /**
   * 管理 API（一律 POST，通行碼放在內容）。read=true 的讀取在連線失敗時重送一次。
   * 通行碼無效時清除並丟出 UNAUTHORIZED，由畫面導回登入。
   */
  async function admin(action, payload, read) {
    const body = Object.assign({ action, token: adminToken }, payload || {});
    try {
      return read
        ? await post(body).catch((err) => { if (err.code === 'NETWORK') return post(body); throw err; })
        : await retryBusy(() => post(body));
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') { adminToken = null; saveToken(null); }
      throw err;
    }
  }

  async function adminLogin(password, account) {
    const data = await post({ action: 'adminLogin', password, account: account || '' });
    adminToken = data.token;
    adminWho = { account: data.account || '總管理者', role: data.role || '總管理者' };
    saveToken(data.token, data.expiresInSec, adminWho);
  }

  function adminLogout() {
    const token = adminToken;
    adminToken = null;
    saveToken(null);
    if (token) post({ action: 'adminLogout', token }).catch(() => {});
  }

  window.Api = {
    ApiError,
    retryBusy,
    admin,
    adminLogin,
    adminLogout,
    isAdmin: () => !!adminToken,
    adminWho: () => adminWho,
    getEvents: (from, to) => get('getEvents', { from, to }),
    // 先叫醒伺服器（點名字欄時呼叫），之後的名字搜尋比較不會遇到冷啟動
    warmUp: () => get('ping', {}, []).catch(() => {}),
    getDuty: (id) => get('getDuty', { id }),
    // 區中心場地借用
    getFaq: () => get('getFaq', {}),
    getRepairs: () => get('getRepairs', {}),
    reportRepair: (p) => post(Object.assign({ action: 'reportRepair' }, p)),
    repairWatch: (endpoint, id) => post({ action: 'repairWatch', endpoint, id }),
    repairUpload: (p) => post(Object.assign({ action: 'repairUpload' }, p)),
    getVenue: (from, to) => get('getVenue', { from, to }),
    requestVenue: (payload) => post(Object.assign({ action: 'requestVenue' }, payload)),
    myVenue: (name) => post({ action: 'myVenue', name }),
    cancelVenue: (payload) => post(Object.assign({ action: 'cancelVenue' }, payload)),
    venueWatch: (endpoint, id) => post({ action: 'venueWatch', endpoint, id }),
    pushSetName: (endpoint, name) => post({ action: 'pushSetName', endpoint, name }),
    rollcallGet: (p) => post(Object.assign({ action: 'rollcallGet' }, p)),
    rollcallSet: (p) => post(Object.assign({ action: 'rollcallSet' }, p)),
    loginAccounts: () => get('loginAccounts', {}),
    // DM 檔案（照片、PDF）的網址
    fileUrl: (id) => window.APP_CONFIG.API_URL + (window.APP_CONFIG.API_URL.indexOf('?') === -1 ? '?' : '&') + 'action=file&id=' + encodeURIComponent(id),
    // 開網站時一次打包：行事曆＋近 30 天勤務詳情（資料較多，第一次等久一點）
    getBundle: (from, to) => get('getBundle', { from, to }, [4500, 6000, 10000]),
    // 名字提示要快：平常 2 秒內回來，3 秒沒回來就同時再問一次
    searchMembers: (q, groupType, group) => get('searchMembers', { q, groupType: groupType || '', group: group || '' }, [3000, 4000, 8000]),
    getSiblings: (dutyId) => get('getSiblings', { id: dutyId }),
    signup: (payload) => post(Object.assign({ action: 'signup' }, payload)),
    cancel: (signupId) => post({ action: 'cancel', signupId }),
    reschedule: (payload) => post(Object.assign({ action: 'reschedule' }, payload)),
    // 手機提醒（推播）：只送瀏覽器產生的推播網址，沒有名字
    pushKey: () => get('pushKey', {}),
    pushSubscribe: (endpoint) => post({ action: 'pushSubscribe', endpoint }),
    pushUnsubscribe: (endpoint) => post({ action: 'pushUnsubscribe', endpoint }),
    pushTest: (endpoint) => post({ action: 'pushTest', endpoint }),
    // 我的報名：名字放在 POST 內容（不放網址）；只是讀取，連線失敗可以安全地重送一次
    mySignups: (name) => post({ action: 'mySignups', name }).catch((err) => { if (err.code === 'NETWORK') return post({ action: 'mySignups', name }); throw err; })
  };
})();
