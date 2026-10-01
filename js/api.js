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

  async function get(action, params) {
    const qs = new URLSearchParams(Object.assign({ action }, params || {}));
    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL + '?' + qs.toString());
    } catch (e) {
      throw new ApiError('NETWORK', '無法連線，請檢查網路後再試');
    }
    return parse(res);
  }

  async function post(body) {
    let res;
    try {
      res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new ApiError('NETWORK', '無法連線，請檢查網路後再試');
    }
    return parse(res);
  }

  window.Api = {
    ApiError,
    getEvents: (from, to) => get('getEvents', { from, to }),
    getDuty: (id) => get('getDuty', { id }),
    searchMembers: (q, groupType, group) => get('searchMembers', { q, groupType: groupType || '', group: group || '' }),
    signup: (payload) => post(Object.assign({ action: 'signup' }, payload))
  };
})();
