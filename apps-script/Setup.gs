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

/**
 * 一次性改名：把試算表裡的「崗位」改為「了愿項目」（115/10 起）。
 *   - 「崗位」分頁 → 「了愿項目」
 *   - 欄位「崗位ID」「崗位名稱」 → 「了愿項目ID」「了愿項目名稱」（含「報名」分頁的「崗位ID」）
 * 只改分頁名稱與第一列標題，資料不動。可重複執行，已改過的會略過。
 * 在 Apps Script 編輯器選 renamePositionsToLiaoyuan 後按「執行」，執行完要馬上部署新版本。
 */
function renamePositionsToLiaoyuan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var changes = [];

  var oldSheet = ss.getSheetByName('崗位');
  if (oldSheet && !ss.getSheetByName(SHEETS.POSITIONS.name)) {
    oldSheet.setName(SHEETS.POSITIONS.name);
    changes.push('分頁「崗位」→「' + SHEETS.POSITIONS.name + '」');
  }

  [SHEETS.POSITIONS, SHEETS.SIGNUPS].forEach(function (def) {
    var sheet = ss.getSheetByName(def.name);
    if (!sheet || sheet.getLastColumn() === 0) return;
    var range = sheet.getRange(1, 1, 1, sheet.getLastColumn());
    var headers = range.getValues()[0];
    var renamed = headers.map(function (h) {
      return String(h).replace(/^崗位(ID|名稱)$/, '了愿項目$1');
    });
    if (renamed.join('|') !== headers.join('|')) {
      range.setValues([renamed]);
      changes.push('「' + def.name + '」分頁的欄位標題');
    }
  });

  Logger.log(changes.length ? '已更改：' + changes.join('、') : '不需要更改（已經改過了）');
}

/**
 * 一次性改名（115/10 起）：
 *   - 分組類型「佛堂組」→「勤務了愿組」、「班輪值組」→「拜香輪值組」（「分組」「勤務」分頁的分組類型欄）
 *   - 勤務名稱「…班輪值」→「…拜香輪值」（例如「九月初一班輪值」→「九月初一拜香輪值」）
 *   - 「成員」分頁的欄位名稱：佛堂組 → 勤務了愿組、班輪值組 → 拜香輪值組
 * 只改這些文字，其他資料不動。可重複執行，已改過的會略過。
 * 在 Apps Script 編輯器選 renameGroupTypeToLiaoyuan 後按「執行」，執行完要馬上部署新版本。
 */
function renameGroupTypeToLiaoyuan() {
  var TYPE_RENAMES = { '佛堂組': '勤務了愿組', '班輪值組': '拜香輪值組' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var changes = [];

  function renameColumn(def, header, fn) {
    var sheet = ss.getSheetByName(def.name);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var col = def.headers.indexOf(header) + 1;
    var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    var values = range.getValues();
    var n = 0;
    values.forEach(function (r) {
      var v = fn(String(r[0]));
      if (v !== r[0]) { r[0] = v; n++; }
    });
    if (n) range.setValues(values);
    return n;
  }

  [SHEETS.GROUPS, SHEETS.DUTIES].forEach(function (def) {
    var n = renameColumn(def, '分組類型', function (v) { return TYPE_RENAMES[v] || v; });
    if (n) changes.push('「' + def.name + '」分頁分組類型 ' + n + ' 列');
  });

  var nameCount = renameColumn(SHEETS.DUTIES, '名稱', function (v) {
    return /班輪值/.test(v) ? v.split('班輪值').join('拜香輪值') : v;
  });
  if (nameCount) changes.push('勤務名稱 ' + nameCount + ' 筆');

  var members = ss.getSheetByName(SHEETS.MEMBERS.name);
  if (members && members.getLastColumn() > 0) {
    var header = members.getRange(1, 1, 1, members.getLastColumn());
    var h = header.getValues()[0];
    var renamed = h.map(function (x) { return TYPE_RENAMES[x] || x; });
    if (renamed.join('|') !== h.join('|')) {
      header.setValues([renamed]);
      changes.push('「成員」分頁的欄位名稱');
    }
  }

  applyValidations_(ss);
  invalidateAllTables_();
  Logger.log(changes.length ? '已更改：' + changes.join('、') : '不需要更改（已經改過了）');
}
