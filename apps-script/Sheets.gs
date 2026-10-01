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
