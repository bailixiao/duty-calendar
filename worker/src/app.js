// Worker 的請求處理：和 Apps Script 版相同的 API（GET 讀取、POST 寫入，text/plain 的 JSON），
// 另外有兩個只給 Google 端用的動作：import（第一次把試算表資料搬過來）、syncExport（每 10 分鐘拿資料寫回試算表）。
import { createRuntime } from './runtime.js';
import { createGs } from './gs.generated.js';
import * as A from './async-actions.js';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

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
      store.setProp('LAST_SYNC_AT', gs.nowString_()); // 同步停太久會通知總管理者（PushMore.gs checkSyncHealth_）
      const sheets = {};
      // 帳號（含密碼雜湊）不同步到 Google 試算表
      Object.values(gs.SHEETS).forEach((def) => { if (def.headers.length && def !== gs.SHEETS.ACCOUNTS) sheets[def.name] = store.sheets[def.name] || []; });
      return { sheets, at: gs.nowString_() };
    }
  };
  const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const FILE_MAX = 5 * 1024 * 1024;
  /** 上傳 DM（照片、PDF）：要登入且不是唯讀；回傳檔案代號，存勤務時放進 dm 欄位 */
  special.adminUploadFile = (body) => {
    const who = gs.requireAdmin_(body);
    if (who.role === '唯讀') throw new gs.ApiError_('FORBIDDEN', '這個帳號沒有權限做這件事');
    const mime = String(body.mime || '');
    if (FILE_TYPES.indexOf(mime) === -1) throw new gs.ApiError_('BAD_REQUEST', '只能上傳照片（jpg、png）或 PDF');
    const bytes = Uint8Array.from(Buffer.from(String(body.data || ''), 'base64'));
    if (!bytes.length) throw new gs.ApiError_('BAD_REQUEST', '檔案是空的');
    if (bytes.length > FILE_MAX) throw new gs.ApiError_('BAD_REQUEST', '檔案太大（最大 5MB），請先壓縮');
    const id = 'F-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    store.putFile(id, mime, String(body.name || '').slice(0, 80), bytes);
    return { id };
  };

  /** 修繕回報的照片：公開上傳，只收照片、最大 2MB，受防止亂報名限制；回傳檔案代號（照片只在後台顯示） */
  special.repairUpload = (body) => {
    gs.rateLimit_(Object.assign({}, body, { action: 'repairUpload' }));
    const mime = String(body.mime || '');
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) === -1) throw new gs.ApiError_('BAD_REQUEST', '只能上傳照片');
    const bytes = Uint8Array.from(Buffer.from(String(body.data || ''), 'base64'));
    if (!bytes.length) throw new gs.ApiError_('BAD_REQUEST', '照片是空的');
    if (bytes.length > 2 * 1024 * 1024) throw new gs.ApiError_('BAD_REQUEST', '照片太大（最大 2MB）');
    const id = 'F-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    store.putFile(id, mime, 'repair', bytes);
    return { id };
  };

  const asyncActions = {
    adminDraftFromImages: (body) => A.adminDraftFromImages(gs, body),
    pushTest: (body) => A.pushTest(gs, body)
  };

  async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.searchParams.get('action') === 'file') {
      // DM 檔案：代號不會重複使用，可以長期快取
      const f = store.getFile(String(url.searchParams.get('id') || ''));
      if (!f) return new Response('找不到檔案', { status: 404, headers: CORS });
      return new Response(f.bytes, { headers: Object.assign({ 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline' }, CORS) });
    }
    if (request.method === 'GET') {
      return json(gs.doGet({ parameter: Object.fromEntries(url.searchParams) }).text);
    }
    if (request.method !== 'POST') return json({ ok: false, error: { code: 'BAD_REQUEST', message: '不支援的請求' } });
    const text = await request.text();
    let body = null;
    try { body = JSON.parse(text || '{}'); } catch (e) { /* 交給 doPost 回錯誤 */ }
    const action = body && body.action;
    if (action === 'repairUpload' && body) { // 帶上網路位址的雜湊（防止亂報名計數）
      const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
      if (ip) body._client = createHash('sha256').update('dc|' + ip).digest('hex').slice(0, 16);
    }
    if (special[action]) return json(await A.respondAsync(gs, () => special[action](body)));
    if (asyncActions[action]) return json(await A.respondAsync(gs, () => asyncActions[action](body)));
    // 防止亂報名：公開的寫入動作帶上「網路位址的雜湊」給 .gs 計數（RateLimit.gs）；位址本身不存
    let contents = text;
    if (body && typeof body === 'object' && String(action || '').indexOf('admin') !== 0) {
      const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
      if (ip) contents = JSON.stringify(Object.assign({}, body, { _client: createHash('sha256').update('dc|' + ip).digest('hex').slice(0, 16) }));
    }
    const out = gs.doPost({ postData: { contents } }).text;
    await flushPush();
    return json(out);
  }

  /** 這次請求排進去的推播（借場地通知、後台現在推播）一起送出；還沒正式切換不送 */
  async function flushPush() {
    const eps = gs.takePendingPush_();
    if (!eps.length || store.getProp('LIVE') !== '1') return;
    try {
      gs.markPushResults_(await A.sendPushTo(gs, eps));
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
    }
  }

  /** 每天兩次的推播（正式切換後才送，避免和 Google 端重複） */
  async function cron(when) {
    if (store.getProp('LIVE') !== '1') return { skipped: 'not-live' };
    if (when === 'plans') { // 每 5 分鐘：排定時間到了的後台推播
      const res = gs.runDuePushPlans_();
      await flushPush();
      return res;
    }
    return A.sendPushAll(gs, when);
  }

  return { gs, handle, cron };
}
