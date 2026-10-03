/**
 * 讀取 API 的回應快取：行事曆、打包、勤務詳情算好的結果存在 CacheService，下一個人來直接給，不用再算一次（約省 1 秒）。
 *   - 快取的名稱包含相關分頁的版本號與今天日期：有人報名、取消、改勤務（會換版本號）或過了午夜，自然就用新的。
 *   - 保溫排程 keepWarm 每 5 分鐘先把今年的打包資料算好。
 */

var RESP_CACHE_TTL_SEC = 300;
var RESP_CACHE_CHUNK = 90000; // CacheService 單一值上限 100KB，切塊存
var RESP_CACHE_TABLES = ['DUTIES', 'POSITIONS', 'SIGNUPS', 'GROUPS'];

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
