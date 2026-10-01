/**
 * 建立 Sheet 結構。可重複執行：已存在的分頁不會被清空，只補上缺少的分頁與欄位標題。
 * 規格新增欄位時一律加在最後；既有分頁的標題若是新標題的前段，會自動補上新欄位。
 * 在 Apps Script 編輯器選 setupSheets 後按「執行」。
 */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TIME_ZONE);

  Object.keys(SHEETS).forEach(function (key) {
    var def = SHEETS[key];
    var sheet = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    if (!def.headers.length) return;

    if (sheet.getMaxColumns() < def.headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), def.headers.length - sheet.getMaxColumns());
    }
    var headerRange = sheet.getRange(1, 1, 1, def.headers.length);
    var current = headerRange.getValues()[0];
    var filled = current.filter(function (v) { return v !== ''; }).length;
    var isPrefix = current.slice(0, filled).join('|') === def.headers.slice(0, filled).join('|') &&
      current.slice(filled).every(function (v) { return v === ''; });
    if (!isPrefix) {
      throw new Error('「' + def.name + '」分頁的欄位標題與規格不符，請檢查第一列：' + current.join('、'));
    }
    if (filled < def.headers.length) headerRange.setValues([def.headers]);

    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    // 整張表設為純文字，避免日期、時間、ID 被 Sheet 自動轉換格式
    sheet.getRange(1, 1, sheet.getMaxRows(), def.headers.length).setNumberFormat('@');
  });

  applyValidations_(ss);

  // 刪掉新試算表預設的空白分頁
  var defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }
}

/** 下拉選單。allowInvalid 設 true，讓管理者之後可直接在 Sheet 擴充選項。 */
function applyValidations_(ss) {
  var rules = [
    [SHEETS.MEMBERS, '身分', OPTIONS.identity],
    [SHEETS.MEMBERS, '啟用中', OPTIONS.yesNo],
    [SHEETS.GROUPS, '分組類型', OPTIONS.groupType],
    [SHEETS.DUTIES, '性質', OPTIONS.nature],
    [SHEETS.DUTIES, '模式', OPTIONS.mode],
    [SHEETS.DUTIES, '地點', OPTIONS.location],
    [SHEETS.DUTIES, '分組類型', OPTIONS.groupType],
    [SHEETS.DUTIES, '服裝', OPTIONS.attire],
    [SHEETS.SIGNUPS, '陪同', OPTIONS.yesNo],
    [SHEETS.SIGNUPS, '出席', OPTIONS.attendance],
    [SHEETS.SIGNUPS, '狀態', OPTIONS.signupStatus],
    [SHEETS.SIGNUPS, '身分', OPTIONS.identity],
    [SHEETS.LOGS, '動作', OPTIONS.logAction]
  ];
  rules.forEach(function (r) {
    var sheet = ss.getSheetByName(r[0].name);
    var col = r[0].headers.indexOf(r[1]) + 1;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(r[2], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  });
}
