/**
 * 匯入歷史資料（規格第 10 節：1–8 月既有手動紀錄）。
 *   - 前端讀舊的統計 Excel、確認疑似同一人後，把每一場送來；這裡建立已過去的勤務與出席紀錄，統計表就能一起算。
 *   - 每一場建一筆勤務（說明註明「歷史資料匯入」）與一個了愿項目「出勤」（最少 0，不會顯示缺人）。
 *   - 壇辦、道親記為出席（不知道身分的記為出席、身分空白，統計會提醒補上）；備註的陪同者記為壇辦＋陪同（不算人數）。多天勤務每人只記在第一天（與原 Excel 相同）。
 *   - 同名同日的勤務已經存在就略過，重複匯入不會變兩倍；但如果是之前匯入的歷史資料，會補上這次多讀到的人（名字不重複）。
 */

var MAX_HISTORY_EVENTS = 1500;
var HISTORY_NOTE = '歷史資料匯入（舊統計表）';

/** body = { events: [{ date, end?, name, nature, tan: [], dao: [], unknown?: [], accompany: [] }], source? }（unknown：算人數但不知道身分） */
function adminImportHistory_(body) {
  var events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) throw new ApiError_('BAD_REQUEST', '沒有要匯入的資料');
  if (events.length > MAX_HISTORY_EVENTS) throw new ApiError_('BAD_REQUEST', '一次最多匯入 ' + MAX_HISTORY_EVENTS + ' 場');

  var errors = [];
  var clean = events.map(function (e, i) {
    var names = function (list) { return (Array.isArray(list) ? list : []).map(normalizeName_).filter(function (n) { return n; }); };
    var x = {
      date: cleanText_(e.date), end: cleanText_(e.end) || cleanText_(e.date), name: cleanText_(e.name),
      nature: ['勤務', '支援', '烹飪', '活動'].indexOf(e.nature) !== -1 ? e.nature : '勤務',
      tan: names(e.tan), dao: names(e.dao), unknown: names(e.unknown), accompany: names(e.accompany)
    };
    if (!isDateString_(x.date) || !isDateString_(x.end) || x.end < x.date) errors.push({ index: i, message: '第 ' + (i + 1) + ' 場日期格式錯誤' });
    if (!x.name) errors.push({ index: i, message: '第 ' + (i + 1) + ' 場沒有名稱' });
    return x;
  });
  if (errors.length) throw new ApiError_('VALIDATION', '資料有錯，沒有匯入', errors);

  // 同一批裡同名同日的兩場（原 Excel 分兩段寫）合併成一場，名字不重複
  var merged = [];
  var byKey = {};
  clean.forEach(function (e) {
    var key = e.name + '|' + e.date;
    var into = byKey[key];
    if (!into) { byKey[key] = e; merged.push(e); return; }
    ['tan', 'dao', 'unknown', 'accompany'].forEach(function (k) {
      e[k].forEach(function (n) { if (into[k].indexOf(n) === -1) into[k].push(n); });
    });
    if (e.end > into.end) into.end = e.end;
  });
  clean = merged;

  return withSignupLock_(function () {
    var existing = {}; // 名稱|開始日 → 勤務列；這一批新建的記成 true
    readTable_(SHEETS.DUTIES).forEach(function (d) { existing[d['名稱'] + '|' + d['開始日']] = d; });
    var positions = readTable_(SHEETS.POSITIONS);
    var signups = readTable_(SHEETS.SIGNUPS);
    var now = nowString_();
    var dutyRows = [];
    var positionRows = [];
    var signupRows = [];
    var skipped = 0;
    var updated = 0;
    clean.forEach(function (e) {
      var key = e.name + '|' + e.date;
      var dutyId;
      var positionId;
      var present = {}; // 這一場已經有的名字（補匯入時不重複加）
      var old = existing[key];
      if (old && old !== true) {
        // 之前匯入過的歷史資料：補上這次多讀到的人（例如備註裡的人），不重複
        if (old['說明'] !== HISTORY_NOTE) { skipped++; return; }
        var pos = positionsOf_(positions, old['勤務ID'])[0];
        if (!pos) { skipped++; return; }
        dutyId = old['勤務ID'];
        positionId = pos['了愿項目ID'];
        signupsOf_(signups, dutyId).forEach(function (s) { if (s['狀態'] !== '已取消') present[normalizeName_(s['姓名'])] = true; });
        var before = signupRows.length;
        existing[key] = true; // 同一批不會再處理第二次
        addPeople(e, dutyId, positionId, present);
        if (signupRows.length > before) updated++;
        else skipped++;
        return;
      }
      if (old === true) { skipped++; return; }
      existing[key] = true;
      dutyId = newId_('D');
      positionId = newId_('P');
      dutyRows.push({ '勤務ID': dutyId, '名稱': e.name, '性質': e.nature, '模式': '報名型', '開始日': e.date, '結束日': e.end, '說明': HISTORY_NOTE });
      positionRows.push({ '了愿項目ID': positionId, '勤務ID': dutyId, '了愿項目名稱': '出勤', '最少': '0', '最多': '' });
      addPeople(e, dutyId, positionId, present);
    });

    function addPeople(e, dutyId, positionId, present) {
      var add = function (name, identity, accompany) {
        if (present[name]) return;
        present[name] = true;
        signupRows.push({
          '報名ID': newId_('S'), '勤務ID': dutyId, '日期': e.date, '了愿項目ID': positionId, '姓名': name, '身分': identity,
          '陪同': accompany ? '是' : '否', '出席': '出席', '狀態': '有效', '建立時間': now, '更新時間': now
        });
      };
      e.tan.forEach(function (n) { add(n, '壇辦', false); });
      e.dao.forEach(function (n) { add(n, '道親', false); });
      e.unknown.forEach(function (n) { add(n, '', false); });
      e.accompany.forEach(function (n) { add(n, '壇辦', true); });
    }
    appendRows_(SHEETS.DUTIES, dutyRows);
    appendRows_(SHEETS.POSITIONS, positionRows);
    appendRows_(SHEETS.SIGNUPS, signupRows);
    var dates = dutyRows.map(function (d) { return d['開始日']; }).sort();
    appendRows_(SHEETS.LOGS, [{
      '時間': now, '動作': '匯入歷史', '報名ID': '',
      '內容摘要': (body.source ? cleanText_(body.source) + '｜' : '') + '匯入 ' + dutyRows.length + ' 場、' + signupRows.length + ' 筆出席' +
        (dates.length ? '｜' + dates[0] + '～' + dates[dates.length - 1] : '') + (updated ? '｜補上 ' + updated + ' 場之前漏掉的人' : '') +
        (skipped ? '｜略過已存在的 ' + skipped + ' 場' : ''),
      '還原用的前一版資料': ''
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    invalidateTable_(SHEETS.POSITIONS);
    invalidateTable_(SHEETS.SIGNUPS);
    return { duties: dutyRows.length, signups: signupRows.length, skipped: skipped, updated: updated };
  });
}
