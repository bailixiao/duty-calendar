/**
 * 試算表每週自動備份。
 *   - 整份試算表複製到雲端硬碟的「勤務行事曆備份」資料夾，檔名加上日期。
 *   - 只保留最近 BACKUP_KEEP 份，更舊的移到垃圾桶（Google 雲端硬碟垃圾桶 30 天內還能救回）。
 *   - 第一次請在 Apps Script 編輯器執行 setupBackup：會要求雲端硬碟權限、建立每週日凌晨 3 點的排程，並立刻備份一次。
 */

var BACKUP_FOLDER_NAME = '勤務行事曆備份';
var BACKUP_KEEP = 12; // 每週一份，約保留 3 個月

/** 排程每週執行；也可以在編輯器手動執行，立刻備份一次 */
function backupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = backupFolder_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  var copy = DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + '（備份 ' + stamp + '）', folder);

  // 只留最近幾份
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });

  PropertiesService.getScriptProperties().setProperty('BACKUP_LAST', nowString_());
  return { name: copy.getName(), kept: Math.min(files.length, BACKUP_KEEP) };
}

/** 建立（或重建）每週日凌晨 3 點的備份排程，並立刻備份一次 */
function setupBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupSpreadsheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupSpreadsheet').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  var r = backupSpreadsheet();
  Logger.log('已設定每週日凌晨 3 點自動備份，剛剛也備份了一份：' + r.name);
}

/** 備份資料夾：記住 ID；第一次（或資料夾被刪掉時）在雲端硬碟最上層建立 */
function backupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 找不到就重建 */ }
  }
  var folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}
