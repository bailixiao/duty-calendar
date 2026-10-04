/**
 * 搬家到 Cloudflare 與之後的同步（規格第 3 節）。
 *   - exportToWorker：把試算表的資料（和指令碼屬性）整個複製到 Cloudflare。測試期間可以重複執行（會覆蓋 Cloudflare 上的測試資料）。
 *   - switchToWorker：正式切換。再複製一次最新資料、讓 Cloudflare 開始送推播、這裡停止接受寫入（舊網頁按報名會請他重新整理）、
 *     刪掉這裡的推播與保溫排程、建立每 10 分鐘的同步排程。
 *   - syncFromWorker：（排程）向 Cloudflare 拿最新資料寫回試算表，並更新「統計」分頁。試算表從此是副本，改資料請用管理後台。
 *   - switchBackToGoogle：緊急退回 Google 版。
 *   驗證用管理密碼（兩邊同一組，存在指令碼屬性，不寫進程式碼）。
 */

var WORKER_URL = 'https://duty-calendar-api.duty-calendar-worker.workers.dev/';
var SYNC_SKIP_PROPS = ['BACKUP_FOLDER_ID', 'BACKUP_LAST', 'MIGRATED'];

function syncSheetDefs_() {
  // 帳號只存在 Cloudflare（含密碼雜湊），不在兩邊之間複製，避免覆蓋
  return Object.keys(SHEETS).map(function (k) { return SHEETS[k]; }).filter(function (d) { return d.headers.length && d !== SHEETS.ACCOUNTS; });
}

function workerPost_(payload) {
  var resp = UrlFetchApp.fetch(WORKER_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var json;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { throw new Error('Cloudflare 回應不正確（' + resp.getResponseCode() + '）'); }
  if (!json.ok) throw new Error('Cloudflare：' + json.error.message);
  return json.data;
}

/** 複製試算表資料到 Cloudflare（live = true 時 Cloudflare 開始負責推播） */
function exportToWorker(live) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = {};
  syncSheetDefs_().forEach(function (def) {
    var sh = ss.getSheetByName(def.name);
    if (!sh || sh.getLastRow() === 0) return;
    sheets[def.name] = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  });
  var all = PropertiesService.getScriptProperties().getProperties();
  var props = {};
  Object.keys(all).forEach(function (k) { if (SYNC_SKIP_PROPS.indexOf(k) === -1) props[k] = all[k]; });
  var res = workerPost_({ action: 'import', password: all.ADMIN_PASSWORD, sheets: sheets, props: props, live: live === true ? true : undefined });
  Logger.log('已複製到 Cloudflare：' + Object.keys(res.sheets).map(function (n) { return n + ' ' + res.sheets[n] + ' 列'; }).join('、') +
    (res.live ? '（已正式切換，Cloudflare 負責推播）' : '（測試中）'));
  return res;
}

/** 正式切換到 Cloudflare（前端網址同時改成 Cloudflare） */
function switchToWorker() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('MIGRATED', '1'); // 先停止這裡的寫入，再複製最後一次，避免漏掉
  exportToWorker(true);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sendPushToday', 'sendPushTomorrow', 'keepWarm', 'syncFromWorker'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncFromWorker').timeBased().everyMinutes(10).create();
  Logger.log('已切換到 Cloudflare：試算表每 10 分鐘自動同步，改資料請用管理後台。');
}

/** （排程，每 10 分鐘）Cloudflare → 試算表 */
function syncFromWorker() {
  var props = PropertiesService.getScriptProperties();
  var data = workerPost_({ action: 'syncExport', password: props.getProperty('ADMIN_PASSWORD'), statsUpdatedAt: props.getProperty('STATS_UPDATED_AT') || '' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(data.sheets).forEach(function (name) {
    var rows = data.sheets[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
    var padded = rows.map(function (r) { var c = r.slice(); while (c.length < width) c.push(''); return c; });
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    if (sh.getMaxRows() < padded.length) sh.insertRowsAfter(sh.getMaxRows(), padded.length - sh.getMaxRows());
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(width, sh.getLastColumn() || 1)).clearContent();
    if (padded.length) {
      var range = sh.getRange(1, 1, padded.length, width);
      range.setNumberFormat('@');
      range.setValues(padded);
    }
  });
  SpreadsheetApp.flush();
  invalidateAllTables_();
  writeStatsSheet_(Number(todayString_().slice(0, 4)));
}

/** 緊急退回 Google 版：先把 Cloudflare 的最新資料寫回試算表，再恢復這裡的寫入與排程（前端網址也要改回 Google） */
function switchBackToGoogle() {
  syncFromWorker();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('MIGRATED');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncFromWorker') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendPushToday').timeBased().everyDays(1).atHour(PUSH_HOURS.today).create();
  ScriptApp.newTrigger('sendPushTomorrow').timeBased().everyDays(1).atHour(PUSH_HOURS.tomorrow).create();
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  try { workerPost_({ action: 'import', password: props.getProperty('ADMIN_PASSWORD'), sheets: {}, live: false }); } catch (e) { /* Cloudflare 連不上也沒關係 */ }
  Logger.log('已退回 Google 版。');
}
