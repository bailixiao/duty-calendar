// Worker 的請求處理：和 Apps Script 版相同的 API（GET 讀取、POST 寫入，text/plain 的 JSON），
// 另外有兩個只給 Google 端用的動作：import（第一次把試算表資料搬過來）、syncExport（每 10 分鐘拿資料寫回試算表）。
import { createRuntime } from './runtime.js';
import { createGs } from './gs.generated.js';
import * as A from './async-actions.js';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { REGIONS, regionSiteDefaults, SITE_BASE } from './regions.js';
import { createHq } from './hq.js';

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
      // 總管理者在後台改了密碼（adminChangeMyPassword）：Google 端還拿舊密碼來，認舊密碼，回傳新密碼讓 Google 端換掉；
      // 之後 Google 端用新密碼來，就把舊密碼刪掉
      const prev = store.getProp('PREV_ADMIN_PASSWORD');
      const usedPrev = !!prev && String(body.password || '') === prev;
      if (!usedPrev) {
        checkPassword(body.password, false);
        if (prev) store.deleteProp('PREV_ADMIN_PASSWORD');
      }
      if (body.statsUpdatedAt) store.setProp('STATS_UPDATED_AT', String(body.statsUpdatedAt));
      store.setProp('LAST_SYNC_AT', gs.nowString_()); // 同步停太久會通知總管理者（PushMore.gs checkSyncHealth_）
      const sheets = {};
      // 帳號（含密碼雜湊）不同步到 Google 試算表
      Object.values(gs.SHEETS).forEach((def) => { if (def.headers.length && def !== gs.SHEETS.ACCOUNTS) sheets[def.name] = store.sheets[def.name] || []; });
      return Object.assign({ sheets, at: gs.nowString_() }, usedPrev ? { adminPassword: store.getProp('ADMIN_PASSWORD') } : {});
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

  /** 活動回報的照片：要有正確的回報碼（組長才能傳），只收照片、最大 2MB，受防止亂報名限制；照片只在回報頁與後台顯示 */
  special.reportUpload = (body) => {
    gs.rateLimit_(Object.assign({}, body, { action: 'reportUpload' }));
    gs.reportCheck_(body);
    const mime = String(body.mime || '');
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) === -1) throw new gs.ApiError_('BAD_REQUEST', '只能上傳照片');
    const bytes = Uint8Array.from(Buffer.from(String(body.data || ''), 'base64'));
    if (!bytes.length) throw new gs.ApiError_('BAD_REQUEST', '照片是空的');
    if (bytes.length > 2 * 1024 * 1024) throw new gs.ApiError_('BAD_REQUEST', '照片太大（最大 2MB）');
    const id = 'F-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    store.putFile(id, mime, 'report', bytes);
    return { id };
  };

  // ---------- 📸 活動相簿（2026/11/23，apps-script/Album.gs）：任何人都可以上傳，大圖＋縮圖兩個檔案 ----------
  const ALBUM_LIMIT = 80; // 同一個網路 10 分鐘最多上傳幾張（一次選很多張也夠）
  special.albumUpload = (body) => {
    gs.albumCheck_(body);
    if (body._client) {
      const k = 'al:' + body._client + ':' + Math.floor(Date.now() / 600000);
      const n = Number(store.cacheGet(k) || 0) + 1;
      store.cachePut(k, String(n), 660);
      if (n > ALBUM_LIMIT) throw new gs.ApiError_('BUSY', '照片傳太多了，請 10 分鐘後再試，感恩您 🙏');
    }
    const take = (b64, max, label) => {
      const bytes = Uint8Array.from(Buffer.from(String(b64 || ''), 'base64'));
      if (!bytes.length) throw new gs.ApiError_('BAD_REQUEST', label + '是空的');
      if (bytes.length > max) throw new gs.ApiError_('BAD_REQUEST', label + '太大了，請再試一次');
      return bytes;
    };
    if (String(body.mime || 'image/jpeg') !== 'image/jpeg') throw new gs.ApiError_('BAD_REQUEST', '只能上傳照片');
    const big = take(body.data, 2 * 1024 * 1024, '照片');
    const small = take(body.thumb, 300 * 1024, '縮圖');
    const id = 'F-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const tid = 'F-' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    store.putFile(id, 'image/jpeg', 'album', big);
    store.putFile(tid, 'image/jpeg', 'album-thumb', small);
    try {
      return gs.albumAddPhoto_({ dutyId: body.dutyId, date: body.date, by: body.by, file: id, thumb: tid });
    } catch (e) { store.deleteFile(id); store.deleteFile(tid); throw e; } // 相簿滿了：檔案也不要留
  };
  /** 管理者刪照片、連結：刪那一列，照片檔案也刪掉 */
  special.adminAlbumDelete = (body) => {
    const who = gs.requireAdmin_(body);
    const res = gs.hqAs_(who, () => gs.adminAlbumDelete_(body));
    res.files.forEach((f) => store.deleteFile(f));
    return res.album;
  };

  // ---------- 分區 ②：開通連結、區設定 ----------
  let curRegion = 'main'; // 這次請求是哪一區（handle 開頭設定）
  const SETUP_DAYS = 7;
  const hashToken = (t) => createHash('sha256').update('setup|' + String(t || '')).digest('hex');

  /** 開通連結對不對、有沒有過期 */
  function checkSetupToken(token) {
    const h = store.getProp('SETUP_TOKEN');
    const exp = Number(store.getProp('SETUP_EXPIRES') || 0);
    if (!h || !token || hashToken(token) !== h || Date.now() > exp) {
      throw new gs.ApiError_('BAD_TOKEN', '這個開通連結不對、已經用過或過期了，請向給你連結的人要一個新的');
    }
  }

  /** 開通頁：先確認連結有效，顯示區名 */
  special.regionSetupCheck = (body) => {
    checkSetupToken(body.token);
    return { org: gs.getSite_().org, hasPassword: !!store.getProp('ADMIN_PASSWORD') };
  };

  /** 開通頁：總管理者自己設定密碼（連結只能用一次；設定後原本登入的裝置都要重新登入） */
  special.regionSetup = (body) => {
    checkSetupToken(body.token);
    const pw = String(body.password || '');
    if (!pw.trim()) throw new gs.ApiError_('BAD_REQUEST', '請輸入密碼');
    if (pw.length > 100) throw new gs.ApiError_('BAD_REQUEST', '密碼太長了');
    store.setProp('ADMIN_PASSWORD', pw);
    store.deleteProp('SETUP_TOKEN');
    store.deleteProp('SETUP_EXPIRES');
    store.deleteProp('ADMIN_CURRENT_TOKEN');
    return { org: gs.getSite_().org };
  };

  /** 後台「⚙️ 區設定」：只有總管理者；教全區的設定寫在程式裡，不在這裡改 */
  function requireSiteAdmin(body) {
    const who = gs.requireAdmin_(body);
    if (who.role !== '總管理者') throw new gs.ApiError_('FORBIDDEN', '只有總管理者可以改區設定');
    if (curRegion === 'main') throw new gs.ApiError_('FORBIDDEN', '教全區的設定寫在程式裡，請找 Claude 改');
    return who;
  }
  special.adminSiteGet = (body) => {
    requireSiteAdmin(body);
    return { site: gs.getSite_(), contact: store.getProp('ADMIN_CONTACT') || '' };
  };
  special.adminSiteSave = (body) => {
    requireSiteAdmin(body);
    const s = body.site || {};
    const str = (v, max, label, need) => {
      const t = String(v == null ? '' : v).trim();
      if (need && !t) throw new gs.ApiError_('BAD_REQUEST', '請填「' + label + '」');
      if (t.length > max) throw new gs.ApiError_('BAD_REQUEST', '「' + label + '」太長了（最多 ' + max + ' 個字）');
      return t;
    };
    const list = (v, label) => {
      const arr = (Array.isArray(v) ? v : String(v || '').split(/[\n、,，]+/)).map((x) => String(x).trim()).filter(Boolean);
      const out = arr.filter((x, i) => arr.indexOf(x) === i);
      if (out.length > 40) throw new gs.ApiError_('BAD_REQUEST', '「' + label + '」最多 40 個');
      out.forEach((x) => { if (x.length > 20) throw new gs.ApiError_('BAD_REQUEST', '「' + label + '」的「' + x.slice(0, 10) + '⋯」太長了（最多 20 個字）'); });
      return out;
    };
    const org = str(s.org, 12, '區名', true);
    const cat = s.categoryLabels || {};
    const f = s.features || {};
    const cur = gs.getSite_();
    const site = Object.assign({}, regionSiteDefaults(curRegion), {
      name: org + '行事曆',
      org,
      venue: str(s.venue, 12, '場地名稱', true),
      temple: cur.temple || '佛堂',
      categoryLabels: { 勤務: str(cat['勤務'], 10, '勤務的名字', true), 道務: str(cat['道務'], 10, '道務的名字', true), 教育: str(cat['教育'], 10, '教育的名字', true) },
      locations: list(s.locations, '地點'),
      eduTeacherClasses: list(s.eduTeacherClasses, '教育統計的班'),
      overseas: list(s.overseas, '國外的選項'),
      shortageTitle: str(s.shortageTitle, 40, '缺人通知的標題', true),
      inviteTitle: str(s.inviteTitle, 40, '邀請的標題', true),
      features: { venue: f.venue !== false, repair: f.repair !== false, help: f.help !== false, push: f.push !== false },
      siteUrl: cur.siteUrl,
      aiRegion: org,
      aiRegionShort: org.replace(/區$/, '')
    });
    if (!site.locations.length) throw new gs.ApiError_('BAD_REQUEST', '「地點」至少要有一個');
    store.setProp('SITE_JSON', JSON.stringify(site));
    store.setProp('SITE_SAVED', '1'); // 開始使用清單：區設定存過了
    const contact = str(body.contact, 30, '管理者聯絡人', false);
    if (contact) store.setProp('ADMIN_CONTACT', contact); else store.deleteProp('ADMIN_CONTACT');
    applySite();
    gs.invalidateAllTables_(); // 讀取快取用新的名稱重算（不清整個快取：登入的通行碼也在裡面）
    return { site: gs.getSite_(), contact };
  };

  /**
   * 新區「🚀 開始使用」清單（2026/11/21）：其他區的總管理者在後台首頁看到，每一步做完沒有從資料判斷。
   * 區設定存過、有分組、有成員（啟用中）、有勤務；「把網址傳給家人們」按過複製／傳到 LINE 就算；可以「先不要顯示」。
   */
  special.adminOnboarding = (body) => {
    requireSiteAdmin(body);
    const count = (def, f) => gs.readTable_(def).filter(f || (() => true)).length;
    return {
      siteSaved: store.getProp('SITE_SAVED') === '1',
      groups: count(gs.SHEETS.GROUPS),
      members: count(gs.SHEETS.MEMBERS, (r) => r['啟用中'] !== '否'),
      duties: count(gs.SHEETS.DUTIES),
      shared: store.getProp('ONBOARD_SHARED') === '1',
      hidden: store.getProp('ONBOARD_HIDE') === '1'
    };
  };
  /** body = { key: 'shared' | 'hide', on }：記下「網址傳過了」或「先不要顯示」（on: false 取消） */
  special.adminOnboardingMark = (body) => {
    requireSiteAdmin(body);
    const prop = { shared: 'ONBOARD_SHARED', hide: 'ONBOARD_HIDE' }[body.key];
    if (!prop) throw new gs.ApiError_('BAD_REQUEST', '不認得的項目');
    if (body.on === false) store.deleteProp(prop); else store.setProp(prop, '1');
    return special.adminOnboarding(body);
  };

  /** 教全區：推播金鑰（開通新區時複製過去） */
  function vapidKeys() {
    gs.ensurePushKeys_();
    return { VAPID_PRIVATE: store.getProp('VAPID_PRIVATE'), VAPID_PUBLIC: store.getProp('VAPID_PUBLIC') };
  }

  /** 開通這一區（已開通的再叫一次＝換一個新的開通連結，例如總管理者忘了密碼）；回傳連結用的代碼 */
  function openRegion({ region, vapid, siteBase }) {
    if (!Object.prototype.hasOwnProperty.call(REGIONS, region)) throw new Error('不認得的區：' + region);
    const first = store.getProp('REGION_OPEN') !== '1';
    store.setProp('REGION_OPEN', '1');
    store.setProp('LIVE', '1'); // 沒有 Google 試算表，一開始就是正式
    if (!store.getProp('VAPID_PUBLIC') && vapid && vapid.VAPID_PUBLIC) {
      store.setProp('VAPID_PRIVATE', vapid.VAPID_PRIVATE);
      store.setProp('VAPID_PUBLIC', vapid.VAPID_PUBLIC);
    }
    if (!store.getProp('SITE_JSON')) store.setProp('SITE_JSON', JSON.stringify(regionSiteDefaults(region, siteBase)));
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const expires = Date.now() + SETUP_DAYS * 86400000;
    store.setProp('SETUP_TOKEN', hashToken(token));
    store.setProp('SETUP_EXPIRES', String(expires));
    return { token, first, expires: new Date(expires).toISOString(), hasPassword: !!store.getProp('ADMIN_PASSWORD') };
  }

  /** 教全區記下開通的區（排程用） */
  function addOpenRegion(code) {
    const list = openRegions();
    if (list.indexOf(code) === -1) list.push(code);
    store.setProp('OPEN_REGIONS', JSON.stringify(list));
    return list;
  }

  // ---------- 每週自動備份（worker/src/backup-store.js） ----------
  /** 這一區全部的資料（分頁、指令碼屬性；上傳的照片不含）存成一段文字 */
  function snapshot() {
    store.persist();
    return JSON.stringify({ v: 1, at: new Date().toISOString(), sheets: store.sheets, props: store.listProps() });
  }

  /** 用備份還原（整個取代分頁與指令碼屬性）；只有 Claude 用 tools/region-backup.js 做，做之前會先自動備份現在的資料 */
  function restore(text) {
    const snap = JSON.parse(text);
    if (!snap || snap.v !== 1 || !snap.sheets || !snap.props) throw new Error('備份格式不對');
    Object.keys(store.sheets).forEach((n) => { if (!snap.sheets[n]) { store.sheets[n] = []; store.markDirty(n); } });
    Object.keys(snap.sheets).forEach((n) => { store.sheets[n] = snap.sheets[n]; store.markDirty(n); });
    Object.keys(store.listProps()).forEach((k) => { if (!(k in snap.props)) store.deleteProp(k); });
    Object.entries(snap.props).forEach(([k, v]) => store.setProp(k, String(v)));
    store.cacheClear();
    store.persist();
    return { at: snap.at, sheets: Object.keys(snap.sheets).length };
  }

  // ---------- 用量（免費額度每天 10 萬次請求，台灣早上 8 點＝UTC 0 點重算） ----------
  // 每一區自己數（記在記憶體，每 10 次寫一次，不會每個請求都多寫一筆）；教全區每 5 分鐘加總，到 8 成通知總管理者。
  const USAGE_FLUSH = 10;
  let usageDay = '';
  let usageMem = 0;
  const utcDay = () => new Date().toISOString().slice(0, 10);
  function countRequest() {
    const d = utcDay();
    if (d !== usageDay) { usageDay = d; usageMem = 0; }
    usageMem += 1;
    if (usageMem >= USAGE_FLUSH) flushUsage();
  }
  function flushUsage() {
    if (!usageMem) return;
    const k = 'USAGE:' + usageDay;
    store.setProp(k, String(Number(store.getProp(k) || 0) + usageMem));
    usageMem = 0;
    // 舊的日子不用留
    Object.keys(store.listProps()).forEach((p) => { if (p.indexOf('USAGE:') === 0 && p < 'USAGE:' + usageDay) store.deleteProp(p); });
  }
  /** 這一區今天大約用了幾次 */
  function usageToday() {
    const d = utcDay();
    return Number(store.getProp('USAGE:' + d) || 0) + (usageDay === d ? usageMem : 0);
  }
  const USAGE_LIMIT = 100000;
  /** 教全區：全部的區加起來到 8 成，通知「系統通知」的手機（一天一次） */
  async function usageCheck(total) {
    const d = utcDay();
    if (total < USAGE_LIMIT * 0.8 || store.getProp('USAGE_ALERTED') === d) return { alerted: false, total };
    store.setProp('USAGE_ALERTED', d);
    gs.withSignupLock_(() => gs.pushMessageTo_(gs.pushTargets_('系統通知'), '⚠️ 今天的用量快到上限了',
      '今天大約用了 ' + total + ' 次，免費額度一天 10 萬次，已經用到 8 成。超過的話，今天剩下的時間網站會讀不到資料，台灣早上 8 點恢復。', '#/admin'));
    await flushPush();
    return { alerted: true, total };
  }

  const asyncActions = {
    adminDraftFromImages: (body) => A.adminDraftFromImages(gs, body),
    pushTest: (body) => A.pushTest(gs, body)
  };

  /** 分區（2026/11/19）：教全區（main）一直都能用；其他區要開通（REGION_OPEN＝1）才能用 */
  /** 這一區的網站設定（SITE_JSON）蓋在 SITE 上；網站網址用 SITE_BASE（各區 …/she/） */
  const applySite = () => gs.applySiteOverrides_(SITE_BASE + (curRegion && curRegion !== 'main' ? curRegion + '/' : ''));

  const isOpen = (region) => !region || region === 'main' || store.getProp('REGION_OPEN') === '1';

  // ---------- 宏教分壇分派（2026/11/22，worker/src/hq.js、apps-script/Hq.gs） ----------
  // opts.cross(區, 動作, 資料)：叫另一區的 Durable Object；opts.openRegions()：已經開通的區（問教全區）
  const hq = createHq({
    gs, store,
    cross: (opts && opts.cross) || (async () => { throw new Error('沒有跨區連線'); }),
    openRegions: (opts && opts.openRegions) || (async () => [])
  });
  Object.keys(hq.special).forEach((k) => { special[k] = (body) => hq.special[k](body, curRegion); });
  /** 別的區（分壇）叫過來：region＝這個 Durable Object 是哪一區 */
  async function hqRpc(region, method, payload) {
    curRegion = region || 'main';
    if (!isOpen(curRegion)) return { status: 'not-open' };
    applySite();
    let out;
    try {
      out = hq.rpc(method, payload);
    } catch (e) {
      throw new Error((e && e.message) || String(e));
    }
    await flushPush(); // 公告、提醒、回覆：通知這一區管理者的手機（2026/11/23）
    return out;
  }


  async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    curRegion = request.headers.get('X-Region') || 'main';
    countRequest();
    if (!isOpen(curRegion)) {
      return json({ ok: false, error: { code: 'NOT_OPEN', message: '這一區的行事曆還沒開通，請聯絡該區的管理者' } });
    }
    applySite(); // 這一區的網站設定（SITE_JSON）蓋在 SITE 上
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
    if ((action === 'repairUpload' || action === 'reportUpload' || action === 'albumUpload') && body) { // 帶上網路位址的雜湊（防止亂報名計數）
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
    const pwBefore = store.getProp('ADMIN_PASSWORD');
    const out = gs.doPost({ postData: { contents } }).text;
    // 教全區的總管理者改了密碼：記下舊的，等 Google 端同步時換成新的（見 syncExport）
    if (action === 'adminChangeMyPassword' && curRegion === 'main' && pwBefore && store.getProp('ADMIN_PASSWORD') !== pwBefore && !store.getProp('PREV_ADMIN_PASSWORD')) {
      store.setProp('PREV_ADMIN_PASSWORD', pwBefore);
    }
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
  async function cron(when, region) {
    if (!isOpen(region)) return { skipped: 'not-open' };
    curRegion = region || 'main';
    countRequest();
    flushUsage();
    // 宏教分壇：每天早上 7 點，報名截止前 3 天自動提醒沒處理、沒報滿的區（推播由各區自己送，2026/11/23）
    let hqRemind = null;
    if (curRegion === 'hq' && when === 'today') {
      applySite();
      try { hqRemind = await hq.autoRemind(); } catch (e) { console.error('分壇提醒', e); }
    }
    if (store.getProp('LIVE') !== '1') return hqRemind ? { skipped: 'not-live', hqRemind } : { skipped: 'not-live' };
    applySite();
    if (when === 'plans') { // 每 5 分鐘：排定時間到了的後台推播
      const res = gs.runDuePushPlans_();
      await flushPush();
      return res;
    }
    const res = await A.sendPushAll(gs, when);
    if (when === 'tomorrow') { // 晚上 8 點：順便送管理者的報名彙整（SignupDigest.gs）
      try { gs.sendSignupDigest_(); await flushPush(); } catch (e) { console.error('報名彙整', e); }
    }
    return res;
  }

  /** 已開通的區（只有教全區 main 記這個，排程用） */
  function openRegions() {
    let list = [];
    try { list = JSON.parse(store.getProp('OPEN_REGIONS') || '[]'); } catch (e) { /* 壞掉就當沒有 */ }
    return (Array.isArray(list) ? list : []).filter((r) => Object.prototype.hasOwnProperty.call(REGIONS, r));
  }

  return { gs, handle, cron, openRegions, vapidKeys, openRegion, addOpenRegion, snapshot, restore, usageToday, usageCheck, hqRpc };
}
