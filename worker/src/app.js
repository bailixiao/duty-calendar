// Worker 的請求處理：和 Apps Script 版相同的 API（GET 讀取、POST 寫入，text/plain 的 JSON），
// 另外有兩個只給 Google 端用的動作：import（第一次把試算表資料搬過來）、syncExport（每 10 分鐘拿資料寫回試算表）。
import { createRuntime } from './runtime.js';
import { createGs } from './gs.generated.js';
import * as A from './async-actions.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (obj) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), {
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS)
});

export function createApp(store, opts) {
  const gs = createGs(createRuntime(store, opts));

  // 每個分頁都要在、標題列要是最新的（後來新增的欄位加在最後）
  Object.values(gs.SHEETS).forEach((def) => {
    const rows = store.sheets[def.name];
    if (!rows) {
      store.sheets[def.name] = def.headers.length ? [def.headers.slice()] : [];
      store.markDirty(def.name);
    } else if (def.headers.length && (rows[0] || []).length < def.headers.length) {
      const cur = rows[0] || [];
      if (cur.every((h, i) => h === def.headers[i])) {
        rows[0] = def.headers.slice();
        store.markDirty(def.name);
      }
    }
  });

  /** import、syncExport 用管理密碼驗證（和管理後台同一組，連錯 10 次鎖 10 分鐘） */
  function checkPassword(password, allowEmpty) {
    const pw = store.getProp('ADMIN_PASSWORD');
    if (!pw && allowEmpty) return;
    const fails = Number(store.cacheGet('admin-fails') || 0);
    if (fails >= 10) throw new gs.ApiError_('LOCKED', '密碼錯誤太多次，請 10 分鐘後再試');
    if (!pw || String(password || '') !== pw) {
      store.cachePut('admin-fails', String(fails + 1), 600);
      throw new gs.ApiError_('UNAUTHORIZED', '密碼不正確');
    }
  }

  const special = {
    /** 第一次搬家（或切換正式前再搬一次最新的）：用 Google 端的資料整個取代 */
    import(body) {
      checkPassword(body.password, true);
      const sheets = body.sheets || {};
      Object.keys(sheets).forEach((name) => {
        if (!Array.isArray(sheets[name])) return;
        store.sheets[name] = sheets[name].map((r) => r.map((v) => (v === undefined || v === null ? '' : String(v))));
        store.markDirty(name);
      });
      Object.entries(body.props || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) store.setProp(k, String(v)); });
      if (body.live !== undefined) store.setProp('LIVE', body.live ? '1' : '');
      store.cacheClear();
      return { sheets: Object.fromEntries(Object.keys(sheets).map((n) => [n, sheets[n].length])), live: store.getProp('LIVE') === '1' };
    },
    /** Google 端每 10 分鐘來拿資料寫回試算表（統計分頁由 Google 端自己算） */
    syncExport(body) {
      checkPassword(body.password, false);
      if (body.statsUpdatedAt) store.setProp('STATS_UPDATED_AT', String(body.statsUpdatedAt));
      const sheets = {};
      Object.values(gs.SHEETS).forEach((def) => { if (def.headers.length) sheets[def.name] = store.sheets[def.name] || []; });
      return { sheets, at: gs.nowString_() };
    }
  };
  const asyncActions = {
    adminDraftFromImages: (body) => A.adminDraftFromImages(gs, body),
    pushTest: (body) => A.pushTest(gs, body)
  };

  async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method === 'GET') {
      return json(gs.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
    }
    if (request.method !== 'POST') return json({ ok: false, error: { code: 'BAD_REQUEST', message: '不支援的請求' } });
    const text = await request.text();
    let body = null;
    try { body = JSON.parse(text || '{}'); } catch (e) { /* 交給 doPost 回錯誤 */ }
    const action = body && body.action;
    if (special[action]) return json(await A.respondAsync(gs, () => special[action](body)));
    if (asyncActions[action]) return json(await A.respondAsync(gs, () => asyncActions[action](body)));
    return json(gs.doPost({ postData: { contents: text } }).text);
  }

  /** 每天兩次的推播（正式切換後才送，避免和 Google 端重複） */
  async function cron(when) {
    if (store.getProp('LIVE') !== '1') return { skipped: 'not-live' };
    return A.sendPushAll(gs, when);
  }

  return { gs, handle, cron };
}
