// Cloudflare 版的「Apps Script 底層」：提供 SpreadsheetApp、CacheService、PropertiesService 等同名物件，
// 讓 apps-script/*.gs 不用改就能在 Worker 裡執行（見 gs.generated.js）。
//   - 試算表：每個分頁是記憶體裡的二維陣列，改過的分頁由 store.markDirty 記下，請求結束時寫回 SQLite。
//   - 快取、指令碼屬性：直接存在 SQLite（Durable Object 重新啟動也不會掉，例如管理者登入通行碼）。
//   - 對外連線（UrlFetchApp）在 Worker 裡只能非同步，這裡不提供；推播、AI 讀照片另外寫非同步版（async-actions.js）。
import { createHash, createHmac, randomUUID } from 'node:crypto';

const TZ = 'Asia/Taipei';

/** Apps Script 的 Utilities.formatDate（只用到 yyyy MM dd HH H mm ss） */
export function formatDate(date, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const map = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, H: String(Number(parts.hour)), mm: parts.minute, ss: parts.second };
  return pattern.replace(/yyyy|MM|dd|HH|H|mm|ss/g, (t) => map[t]);
}

const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => b & 255));

/**
 * store：{ sheets: { 分頁名: 二維陣列 }, markDirty(name), getProp(k), setProp(k, v), deleteProp(k),
 *          cacheGet(k), cachePut(k, v, ttlSec), cacheRemove(k) }
 */
export function createRuntime(store, opts = {}) {
  // 測試可以固定「現在時間」（opts.now 回傳毫秒）
  const fmt = (date, tz, pattern) => formatDate(opts.now ? new Date(opts.now()) : date, tz, pattern);
  function makeSheet(name) {
    if (!store.sheets[name]) store.sheets[name] = [];
    const data = () => store.sheets[name];
    const dirty = () => store.markDirty(name);
    const sheet = {
      getName: () => name,
      getLastRow: () => data().length,
      getMaxColumns: () => Math.max(26, ...data().map((r) => r.length)),
      getMaxRows: () => Math.max(1000, data().length),
      deleteRow: (n) => { data().splice(n - 1, 1); dirty(); },
      deleteRows: (n, count) => { data().splice(n - 1, count); dirty(); },
      clear: () => { data().length = 0; dirty(); return sheet; },
      appendRow: (row) => { data().push(row.map((v) => (v === undefined || v === null ? '' : String(v)))); dirty(); return sheet; },
      getRange(row, col, numRows = 1, numCols = 1) {
        const range = {
          getDisplayValues: () => Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numCols }, (_, j) => String((data()[row - 1 + i] || [])[col - 1 + j] ?? ''))),
          getValues: () => range.getDisplayValues(),
          setValues(values) {
            values.forEach((r, i) => {
              const d = data();
              while (d.length < row - 1 + i) d.push([]);
              d[row - 1 + i] = d[row - 1 + i] || [];
              r.forEach((v, j) => { d[row - 1 + i][col - 1 + j] = v === undefined || v === null ? '' : String(v); });
            });
            dirty();
            return proxy;
          },
          setValue(v) { return range.setValues([[v]]); }
        };
        // 字型、顏色、格式等：Cloudflare 版不需要（統計分頁的格式由 Google 端同步時處理）
        const proxy = new Proxy(range, { get: (t, k) => (k in t ? t[k] : () => proxy) });
        return proxy;
      }
    };
    return new Proxy(sheet, { get: (t, k) => (k in t ? t[k] : () => sheet) });
  }
  const sheetObjs = {};
  const getSheet = (name) => (store.sheets[name] ? (sheetObjs[name] = sheetObjs[name] || makeSheet(name)) : null);

  const chain = () => { const p = new Proxy(() => p, { get: () => () => p }); return p; };
  const cacheObj = {
    get: (k) => store.cacheGet(k),
    put: (k, v, ttl) => store.cachePut(k, String(v), ttl || 600),
    remove: (k) => store.cacheRemove(k),
    getAll: (keys) => Object.fromEntries(keys.map((k) => [k, store.cacheGet(k)]).filter(([, v]) => v !== null)),
    putAll: (obj, ttl) => Object.entries(obj).forEach(([k, v]) => store.cachePut(k, String(v), ttl || 600))
  };
  const propsObj = {
    getProperty: (k) => store.getProp(k),
    setProperty: (k, v) => { store.setProp(k, String(v)); return propsObj; },
    deleteProperty: (k) => { store.deleteProp(k); return propsObj; }
  };
  const googleOnly = (what) => () => { throw new Error(what + ' 只在 Google 試算表端執行'); };

  return {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: getSheet,
        insertSheet: (name) => { store.sheets[name] = store.sheets[name] || []; store.markDirty(name); return getSheet(name); },
        getSheets: () => Object.keys(store.sheets).map(getSheet),
        setSpreadsheetTimeZone() {},
        getId: () => 'cloudflare',
        getName: () => 'duty-calendar'
      }),
      flush() {},
      newDataValidation: chain,
      DataValidationCriteria: {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) }, // Durable Object 依序處理請求，等同鎖定
    Utilities: {
      sleep() {},
      getUuid: () => randomUUID(),
      formatDate: fmt,
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, v) => signed(createHash('sha256').update(typeof v === 'string' ? Buffer.from(v, 'utf8') : unsigned(v)).digest()),
      computeHmacSha256Signature: (v, k) => signed(createHmac('sha256', unsigned(k)).update(unsigned(v)).digest()),
      base64EncodeWebSafe: (bytes) => unsigned(bytes).toString('base64url') + '='.repeat((3 - (bytes.length % 3)) % 3),
      newBlob: (s) => ({ getBytes: () => signed(Buffer.from(s, 'utf8')) })
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    Session: { getScriptTimeZone: () => TZ },
    PropertiesService: { getScriptProperties: () => propsObj },
    CacheService: { getScriptCache: () => cacheObj },
    UrlFetchApp: { fetch: googleOnly('同步的對外連線'), fetchAll: googleOnly('同步的對外連線') },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: googleOnly('排程'), WeekDay: {} },
    DriveApp: new Proxy({}, { get: () => googleOnly('雲端硬碟') }),
    Logger: { log: (...a) => console.log(...a) },
    console
  };
}
