// 測試共用：以記憶體模擬 SpreadsheetApp 等 Apps Script 服務，載入 apps-script/*.gs 並匯入初始資料。
// 測試用的名字一律用假名，本儲存庫不放真實人名。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createEnv(fixedNow) {
  const sheets = {};
  function makeSheet(name) {
    const data = [];
    const sheet = {
      name,
      data,
      getLastRow: () => data.length,
      deleteRow: (n) => { data.splice(n - 1, 1); },
      formats: [],
      clear: () => { data.length = 0; },
      getRange(row, col, numRows = 1, numCols = 1) {
        const range = {
          getDisplayValues: () => Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numCols }, (_, j) => String((data[row - 1 + i] || [])[col - 1 + j] ?? ''))),
          setValues(values) {
            values.forEach((r, i) => {
              data[row - 1 + i] = data[row - 1 + i] || [];
              r.forEach((v, j) => { data[row - 1 + i][col - 1 + j] = v; });
            });
            return proxy;
          },
          setNumberFormats(f) { sheet.formats = f; return proxy; }
        };
        // 字型、顏色等格式設定：測試不檢查，一律回傳自己方便串接
        const proxy = new Proxy(range, { get: (t, k) => (k in t ? t[k] : () => proxy) });
        return proxy;
      }
    };
    // 欄寬、凍結列等：測試不檢查
    ['setColumnWidth', 'setColumnWidths', 'setFrozenRows', 'clearConditionalFormatRules'].forEach((k) => { sheet[k] = () => sheet; });
    sheets[name] = sheet;
    return sheet;
  }

  const clock = { now: fixedNow };
  // 假的外部連線（Gemini）：預設回一筆假勤務草稿，測試可用 setFetch 換掉
  const fakeAi = { calls: [], handler: null };
  const defaultAi = () => ({
    code: 200,
    body: { candidates: [{ content: { parts: [{ text: JSON.stringify([{ name: '測試活動', nature: '活動', mode: '報名型', start: '2026-10-25', end: '2026-10-25', startTime: '09:00', endTime: '12:00', location: '宏宗', attire: '', description: '', deadline: '', multi: false, positions: [{ name: '了愿', min: 2, max: '' }], assign: {}, uncertain: ['服裝沒寫'] }]) }] } }] }
  });
  const env = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null }),
      flush() {}
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      sleep() {},
      DigestAlgorithm: { SHA_256: 'sha256' },
      // Apps Script 回傳有正負號的 byte 陣列，這裡照樣模擬
      computeDigest: (alg, v) => [...crypto.createHash('sha256').update(typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => b & 255))).digest()].map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', Buffer.from(k.map(b => b & 255))).update(Buffer.from(v.map(b => b & 255))).digest()].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map(b => b & 255)).toString('base64url') + '='.repeat((3 - (bytes.length % 3)) % 3),
      newBlob: (s) => ({ getBytes: () => [...Buffer.from(s, 'utf8')].map(b => (b > 127 ? b - 256 : b)) }),
      getUuid: () => crypto.randomUUID(),
      formatDate(date, tz, pattern) {
        const d = clock.now ? new Date(clock.now) : date;
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(d).map(p => [p.type, p.value]));
        return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
          .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    PropertiesService: (() => {
      const props = { ADMIN_PASSWORD: 'test-pass', ADMIN_CONTACT: '測試管理者', GEMINI_API_KEY: 'test-key' };
      return { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) };
    })(),
    CacheService: (() => {
      const store = new Map();
      return {
        getScriptCache: () => ({
          get: (k) => (store.has(k) ? store.get(k) : null),
          put: (k, v) => store.set(k, v),
          remove: (k) => store.delete(k),
          getAll: (keys) => Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)])),
          putAll: (obj) => Object.entries(obj).forEach(([k, v]) => store.set(k, v))
        })
      };
    })(),
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: () => { const t = { timeBased: () => t, everyDays: () => t, atHour: () => t, onWeekDay: () => t, create: () => t }; return t; },
      WeekDay: { SUNDAY: 'SUNDAY' }
    },
    UrlFetchApp: {
      fetchAll(reqs) { return reqs.map((r) => this.fetch(r.url, r)); },
      fetch(url, opts) {
        fakeAi.calls.push({ url, opts });
        const r = (fakeAi.handler || defaultAi)(url, opts);
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      }
    },
    Logger: { log() {} },
    // 設環境變數 DEBUG_GS=1 可以看到 Apps Script 內部錯誤
    console: { error: (...a) => { if (process.env.DEBUG_GS) process.stderr.write(a.join(' ') + '\n'); }, log() {} }
  };

  const dir = path.join(__dirname, '..', 'apps-script');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.gs'));
  const source = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const names = Object.keys(env);
  const api = new Function(...names,
    source + '\nreturn { SHEETS, seedInitialDuties, doGet, doPost, onEdit, keepWarm, fn: function (n) { return eval(n); } };')(...names.map(n => env[n]));

  Object.values(api.SHEETS).forEach(def => {
    const s = makeSheet(def.name);
    if (def.headers.length) s.data.push(def.headers.slice());
  });
  api.seedInitialDuties();

  return {
    sheets,
    clock,
    fakeAi,
    setFetch(fn) { fakeAi.handler = fn; },
    get(params) { return JSON.parse(api.doGet({ parameter: params }).text); },
    // 報名的 entries 沒寫身分的，預設「道親」
    post(body) {
      if (Array.isArray(body.entries)) body = { ...body, entries: body.entries.map(e => ({ identity: '道親', ...e })) };
      return this.postRaw(JSON.stringify(body));
    },
    postRaw(text) { return JSON.parse(api.doPost({ postData: { contents: text } }).text); },
    onEdit: () => api.onEdit(),
    keepWarm: () => api.keepWarm(),
    // 測試用：取得 Apps Script 內部函式
    fn: (name) => api.fn(name)
  };
}

module.exports = { createEnv };
