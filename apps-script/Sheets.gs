/**
 * 讀寫各分頁的共用函式。
 */

function getSheet_(def) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
  if (!sheet) throw new Error('找不到「' + def.name + '」分頁，請先執行 setupSheets');
  return sheet;
}

/** 產生 ID，例如 D-20261001-a1b2c3 */
function newId_(prefix) {
  var date = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyyMMdd');
  var rand = Utilities.getUuid().replace(/-/g, '').slice(0, 6);
  return prefix + '-' + date + '-' + rand;
}

/** 台北時間的現在時刻，格式 yyyy-MM-dd HH:mm:ss */
function nowString_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
}

/** 台北時間的今天，格式 yyyy-MM-dd */
function todayString_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
}

/** 資料列數（不含標題列） */
function dataRowCount_(def) {
  return Math.max(getSheet_(def).getLastRow() - 1, 0);
}

/**
 * 讀取整個分頁，回傳物件陣列（key 為欄位名稱，值一律為字串）。
 * 每個物件另帶 _row（Sheet 列號），供之後更新使用。空白列略過。
 */
function readTable_(def) {
  var count = dataRowCount_(def);
  if (!count) return [];
  var values = getSheet_(def).getRange(2, 1, count, def.headers.length).getDisplayValues();
  var rows = [];
  values.forEach(function (row, i) {
    if (row.every(function (v) { return v === ''; })) return;
    var obj = { _row: i + 2 };
    def.headers.forEach(function (h, j) { obj[h] = String(row[j]).trim(); });
    rows.push(obj);
  });
  return rows;
}

// ---------- 讀取快取 ----------
// 唯讀的 API（行事曆、詳情、名字提示⋯）先讀快取，每次可省下讀試算表的時間（約 0.3–1 秒／張表）。
//   - 報名、取消、改期、還原寫入後，會清掉「報名」的快取（invalidateTable_）。
//   - 直接在試算表修改時，onEdit 會清掉全部快取；結構變動（刪列等）最晚 10 分鐘後更新。
//   - 檢查名額等需要最新資料的地方（鎖定內）一律直接讀試算表（readTable_），不用快取。
//   - 快取以版本號區分：清快取＝換新版本號，避免讀到一半的舊資料蓋回去。

var TABLE_CACHE_TTL_SEC = 600;
var TABLE_CACHE_CHUNK = 90000; // CacheService 單一值上限 100KB，切塊存

function readTableCached_(def, opts) {
  var cache = CacheService.getScriptCache();
  var ver = cache.get('ver:' + def.name);
  if (!ver) {
    ver = Utilities.getUuid().slice(0, 8);
    cache.put('ver:' + def.name, ver, 21600);
  }
  var base = 'tbl:' + def.name + ':' + ver;
  if (!(opts && opts.refresh)) {
    var count = cache.get(base);
    if (count !== null) {
      var keys = [];
      for (var i = 0; i < Number(count); i++) keys.push(base + ':' + i);
      var parts = cache.getAll(keys);
      if (keys.every(function (k) { return parts[k] !== undefined && parts[k] !== null; })) {
        return JSON.parse(keys.map(function (k) { return parts[k]; }).join(''));
      }
    }
  }
  var rows = readTable_(def);
  var json = JSON.stringify(rows);
  var chunks = {};
  var n = 0;
  for (var start = 0; start < json.length || n === 0; start += TABLE_CACHE_CHUNK) {
    chunks[base + ':' + n] = json.slice(start, start + TABLE_CACHE_CHUNK);
    n++;
  }
  try {
    cache.putAll(chunks, TABLE_CACHE_TTL_SEC);
    cache.put(base, String(n), TABLE_CACHE_TTL_SEC);
  } catch (e) {
    // 快取寫不進去不影響結果，下次再讀試算表即可
  }
  return rows;
}

/** 資料變更後呼叫：換新版本號，舊快取自然失效 */
function invalidateTable_(def) {
  CacheService.getScriptCache().put('ver:' + def.name, Utilities.getUuid().slice(0, 8), 21600);
}

function invalidateAllTables_() {
  Object.keys(SHEETS).forEach(function (k) { invalidateTable_(SHEETS[k]); });
}

/**
 * 更新一列中的部分欄位。row 為 readTable_ 回傳的物件（帶 _row），changes 的 key 為欄位名稱。
 * 只在鎖定（LockService）內呼叫，確保列號在讀取後沒有變動。
 */
function updateRow_(def, row, changes) {
  var values = def.headers.map(function (h) {
    var v = Object.prototype.hasOwnProperty.call(changes, h) ? changes[h] : row[h];
    return v === undefined || v === null ? '' : String(v);
  });
  getSheet_(def).getRange(row._row, 1, 1, def.headers.length).setValues([values]);
  Object.keys(changes).forEach(function (h) { row[h] = String(changes[h]); });
}

/** 去掉 _row 等內部欄位，供寫入操作紀錄的「還原用的前一版資料」 */
function rowSnapshot_(def, row) {
  var obj = {};
  def.headers.forEach(function (h) { obj[h] = row[h] === undefined ? '' : row[h]; });
  return obj;
}

/**
 * 一次寫入多列。rows 為物件陣列，key 為欄位名稱；缺少的欄位寫空字串。
 * 所有值轉成字串寫入，配合整張表的純文字格式。
 */
function appendRows_(def, rows) {
  if (!rows.length) return;
  var values = rows.map(function (obj) {
    return def.headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? '' : String(v);
    });
  });
  var sheet = getSheet_(def);
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, def.headers.length).setValues(values);
}
