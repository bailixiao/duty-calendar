/**
 * 讀取 API 的回應快取：行事曆、打包、勤務詳情算好的結果存在 CacheService，下一個人來直接給，不用再算一次（約省 1 秒）。
 *   - 快取的名稱包含相關分頁的版本號與今天日期：有人報名、取消、改勤務（會換版本號）或過了午夜，自然就用新的。
 *   - 保溫排程 keepWarm 每 5 分鐘先把今年的打包資料算好。
 */

var RESP_CACHE_TTL_SEC = 300;
var RESP_CACHE_CHUNK = 90000; // CacheService 單一值上限 100KB，切塊存
var RESP_CACHE_TABLES = ['DUTIES', 'POSITIONS', 'SIGNUPS', 'GROUPS', 'VENUE']; // VENUE：行事曆上的「區中心已借出」

/** 分頁目前的版本號（沒有就建一個，與 readTableCached_ 共用） */
function tableVer_(def) {
  var cache = CacheService.getScriptCache();
  var ver = cache.get('ver:' + def.name);
  if (!ver) {
    ver = Utilities.getUuid().slice(0, 8);
    cache.put('ver:' + def.name, ver, 21600);
  }
  return ver;
}

/** 有快取就直接回傳，沒有就執行 fn() 並存起來（fn 丟出錯誤時不存） */
function cachedRead_(action, params, fn) {
  var cache = CacheService.getScriptCache();
  var vers = RESP_CACHE_TABLES.map(function (k) { return tableVer_(SHEETS[k]); }).join('.');
  var base = ['resp', action, params.id || '', params.from || '', params.to || '', vers, todayString_()].join(':');
  var count = cache.get(base);
  if (count !== null) {
    var keys = [];
    for (var i = 0; i < Number(count); i++) keys.push(base + ':' + i);
    var parts = cache.getAll(keys);
    if (keys.every(function (k) { return parts[k] !== undefined && parts[k] !== null; })) {
      return JSON.parse(keys.map(function (k) { return parts[k]; }).join(''));
    }
  }
  var data = fn();
  var json = JSON.stringify(data);
  var chunks = {};
  var n = 0;
  for (var start = 0; start < json.length || n === 0; start += RESP_CACHE_CHUNK) {
    chunks[base + ':' + n] = json.slice(start, start + RESP_CACHE_CHUNK);
    n++;
  }
  try {
    cache.putAll(chunks, RESP_CACHE_TTL_SEC);
    cache.put(base, String(n), RESP_CACHE_TTL_SEC);
  } catch (e) {
    // 快取寫不進去不影響結果
  }
  return data;
}

/** 前端一次載入一整年（前後各多 7 天），與 calendar.js 的 windowRange 相同 */
function yearWindow_(year) {
  return { from: (year - 1) + '-12-25', to: (year + 1) + '-01-07' };
}

/**
 * 健檢（在 Apps Script 編輯器執行，不會寫入任何資料、不用部署）：
 * 檢查每個 .gs 檔案的代表函式是不是都在（貼錯檔案時會少），並模擬一次一定會被擋下的報名與讀取，記下錯誤原因。
 */
function checkProject() {
  var expect = {
    'Admin.gs': 'adminDispatch_', 'Ai.gs': 'adminDraftFromImages_', 'Attendance.gs': 'adminSetAttendance_',
    'Backup.gs': 'backupSpreadsheet', 'Changes.gs': 'cancelSignup_', 'Code.gs': 'doPost',
    'Duties.gs': 'getDuty_', 'DutyAdmin.gs': 'adminCreateDuties_', 'DutyRules.gs': 'normalizeDutyInput_',
    'History.gs': 'adminImportHistory_', 'Mine.gs': 'mySignups_', 'People.gs': 'adminMembers_',
    'ReadCache.gs': 'cachedRead_', 'Rules.gs': 'validateSignup_', 'Seed.gs': 'seedInitialDuties',
    'Setup.gs': 'setupSheets', 'Sheets.gs': 'readTable_', 'Signup.gs': 'signup_', 'Stats.gs': 'adminStats_',
    'Push.gs': 'sendPushAll_'
  };
  var self = typeof globalThis !== 'undefined' ? globalThis : this;
  var missing = Object.keys(expect).filter(function (f) { return typeof self[expect[f]] !== 'function'; });
  if (typeof SHEETS !== 'object' || typeof OPTIONS !== 'object') missing.push('Config.gs');
  Logger.log(missing.length ? '❌ 這些檔案的內容不對（找不到代表函式）：' + missing.map(function (f) { return expect[f] ? f + '（' + expect[f] + '）' : f; }).join('、') : '✅ 每個檔案的代表函式都在');
  try {
    var w = yearWindow_(Number(todayString_().slice(0, 4)));
    var b = getBundle_(w);
    Logger.log('✅ 讀取正常：' + b.duties.length + ' 筆勤務');
    var d = b.duties.filter(function (x) { return x.mode === '報名型' && x.start > b.today && x.positions.length; })[0];
    if (d) {
      try {
        signup_({ dutyId: d.id, positionId: d.positions[0].id, dates: [d.start], entries: [{ name: '測試甲', identity: '', accompany: false }] });
        Logger.log('⚠️ 測試報名沒有被擋下（不應該發生）');
      } catch (e) {
        Logger.log(e instanceof ApiError_ ? '✅ 報名檢查正常（' + e.code + '）' : '❌ 報名出錯：' + (e && e.stack ? e.stack : e));
      }
    }
  } catch (e) {
    Logger.log('❌ 讀取出錯：' + (e && e.stack ? e.stack : e));
  }
}
