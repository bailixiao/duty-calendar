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

  async function getOnce(url, timeoutMs) {
    const ctrl = new AbortController();
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
   * 讀取。Apps Script 偶爾會卡住幾十秒或無故失敗，但馬上重送通常 2–3 秒就回應，
   * 所以第一次只等 8 秒，逾時或連線失敗就重送一次（第二次等久一點）。
   * 只有讀取會自動重送；報名（寫入）不重送，避免重複寫入。
   */
  async function get(action, params) {
    const url = window.APP_CONFIG.API_URL + '?' + new URLSearchParams(Object.assign({ action }, params || {})).toString();
    try {
      return await getOnce(url, 8000);
    } catch (err) {
      if (err.code !== 'NETWORK') throw err;
      return getOnce(url, 30000);
    }
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

  function loadToken() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      return t && t.expires > Date.now() ? t.token : null;
    } catch (e) {
      return null;
    }
  }

  function saveToken(token, expiresInSec) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expires: Date.now() + expiresInSec * 1000 - 60000 }));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 無痕模式等，忽略 */ }
  }

  let adminToken = loadToken();

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

  async function adminLogin(password) {
    const data = await post({ action: 'adminLogin', password });
    adminToken = data.token;
    saveToken(data.token, data.expiresInSec);
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
    getEvents: (from, to) => get('getEvents', { from, to }),
    getDuty: (id) => get('getDuty', { id }),
    searchMembers: (q, groupType, group) => get('searchMembers', { q, groupType: groupType || '', group: group || '' }),
    getSiblings: (dutyId) => get('getSiblings', { id: dutyId }),
    signup: (payload) => post(Object.assign({ action: 'signup' }, payload)),
    cancel: (signupId) => post({ action: 'cancel', signupId }),
    reschedule: (payload) => post(Object.assign({ action: 'reschedule' }, payload))
  };
})();
