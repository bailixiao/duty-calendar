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

  /** 寫入（報名）。不自動重送，避免重複寫入；超過 90 秒視為連線問題（之後由報名表單查證是否已寫入） */
  async function post(body) {
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

  window.Api = {
    ApiError,
    getEvents: (from, to) => get('getEvents', { from, to }),
    getDuty: (id) => get('getDuty', { id }),
    searchMembers: (q, groupType, group) => get('searchMembers', { q, groupType: groupType || '', group: group || '' }),
    signup: (payload) => post(Object.assign({ action: 'signup' }, payload))
  };
})();
