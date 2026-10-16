/**
 * 組員備註（2026/10/16）：勤務有負責組時，那一組的家人可以在勤務頁留一句備註
 * （例：「10/24 不行，想改到 11/9」），大家、組長、管理者都看得到。
 *   - 存在「勤務」分頁最後一欄「組員備註」（JSON 陣列），不用另開分頁。
 *   - 名字要在成員名單上、而且是這個負責組的；只能刪自己留的。
 *   - 留了備註會通知負責組的組長（手機提醒有填名字的），並寫進操作紀錄。
 *   - 只回傳名字、日期、備註，不回傳電話。
 */

var GROUP_NOTE_MAX = 60; // 一個勤務最多幾則
var GROUP_NOTE_LEN = 100;

function groupNotesOf_(duty) {
  try {
    var list = JSON.parse(duty['組員備註'] || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

/** 勤務頁顯示用：今天以後的備註 */
function publicGroupNotes_(duty) {
  var today = todayString_();
  return groupNotesOf_(duty).filter(function (n) { return n.date >= today; })
    .map(function (n) { return { id: n.id, date: n.date, name: n.name, note: n.note }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/** 這個名字是不是負責組的家人（成員名單的分組欄） */
function inDutyGroup_(duty, name) {
  var key = mineKey_(name);
  return readTableCached_(SHEETS.MEMBERS).some(function (m) {
    return m['待確認'] !== '是' && m['啟用中'] !== '否' && mineKey_(m['姓名']) === key && m[duty['分組類型']] === duty['負責組'];
  });
}

/** body = { dutyId, date, name, note } */
function addGroupNote_(body) {
  var duty = findDutyById_(cleanText_(body.dutyId));
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
  if (!duty['負責組'] || !duty['分組類型']) throw new ApiError_('BAD_REQUEST', '這個勤務沒有負責組，不能留組員備註');
  var name = canonicalName_(String(body.name || '').replace(/[\s　]+/g, ''));
  if (name.length < 2) throw new ApiError_('VALIDATION', '請輸入完整的名字（至少 2 個字）');
  var note = cleanText_(body.note).replace(/\s*\n\s*/g, ' ');
  if (!note) throw new ApiError_('VALIDATION', '請寫備註');
  if (note.length > GROUP_NOTE_LEN) throw new ApiError_('VALIDATION', '備註最多 ' + GROUP_NOTE_LEN + ' 字');
  var date = cleanText_(body.date);
  if (datesInRange_(duty['開始日'], duty['結束日']).indexOf(date) === -1) throw new ApiError_('VALIDATION', '日期不在勤務期間');
  if (date < todayString_()) throw new ApiError_('VALIDATION', '這一天已經過了');
  if (!inDutyGroup_(duty, name)) {
    throw new ApiError_('FORBIDDEN', '成員名單上找不到「' + name + '」，或不是' + duty['負責組'] + '的家人。請確認名字和成員名單寫的一樣（例如有沒有寫姓），或聯絡管理者。');
  }
  return withSignupLock_(function () {
    var row = findById_(readTable_(SHEETS.DUTIES), '勤務ID', duty['勤務ID']);
    var notes = groupNotesOf_(row);
    if (notes.length >= GROUP_NOTE_MAX) throw new ApiError_('VALIDATION', '這個勤務的備註太多了，請聯絡管理者整理');
    notes.push({ id: newId_('GN'), date: date, name: name, note: note, time: nowString_() });
    updateRow_(SHEETS.DUTIES, row, { '組員備註': JSON.stringify(notes) });
    writeDutyLog_('組員備註', name + '｜' + date + '｜' + row['名稱'] + '｜' + note);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    notifyGroupLeader_(row, '📝 組員備註（' + row['名稱'] + '）', name + '｜' + shortDate_(date) + '：' + note, date);
    return { notes: publicGroupNotes_(Object.assign({}, row, { '組員備註': JSON.stringify(notes) })) };
  });
}

/** body = { dutyId, id, name }：刪自己留的備註 */
function deleteGroupNote_(body) {
  var name = String(body.name || '').replace(/[\s　]+/g, '');
  return withSignupLock_(function () {
    var row = findById_(readTable_(SHEETS.DUTIES), '勤務ID', cleanText_(body.dutyId));
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
    var notes = groupNotesOf_(row);
    var target = notes.filter(function (n) { return n.id === body.id; })[0];
    if (!target) throw new ApiError_('NOT_FOUND', '這則備註已經刪掉了');
    if (mineKey_(target.name) !== mineKey_(name)) throw new ApiError_('FORBIDDEN', '只能刪自己留的備註，請打留備註時的名字');
    notes = notes.filter(function (n) { return n.id !== body.id; });
    updateRow_(SHEETS.DUTIES, row, { '組員備註': JSON.stringify(notes) });
    writeDutyLog_('組員備註', target.name + '｜' + target.date + '｜' + row['名稱'] + '｜刪除：' + target.note);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    return { notes: publicGroupNotes_(Object.assign({}, row, { '組員備註': JSON.stringify(notes) })) };
  });
}

/** 通知負責組的組長或召集人（手機提醒有填名字的） */
function notifyGroupLeader_(duty, title, text, date) {
  var leader = groupLeader_(duty['分組類型'], duty['負責組']);
  if (!leader) return;
  var names = {};
  String(leader).split(/[、,，\/／\s　]+/).forEach(function (n) { if (n) names[mineKey_(n)] = true; });
  var devices = readTable_(SHEETS.PUSH).filter(function (r) { return r['啟用'] !== '否' && r['端點'] && r['名字'] && names[mineKey_(r['名字'])]; });
  if (devices.length) pushMessageTo_(devices, title, text, '#/duty/' + encodeURIComponent(duty['勤務ID']) + '?date=' + date);
}
