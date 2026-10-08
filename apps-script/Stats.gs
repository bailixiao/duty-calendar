/**
 * 自動統計表（規格第 10 節）。
 *   - 只算「出席」且「非陪同」的有效報名；陪同者放備註。
 *   - 統計記在勤務當天日期（多天勤務每天各算一次）；只算今天（含）以前，未來的報名還不算出勤。
 *   - 年度以國曆 1–12 月計。
 *   - adminStats：回傳每一場（勤務×日期）的出勤名單，由前端計算各月、各季、各年與比較。
 *   - updateStatsSheet：寫入試算表「統計」分頁（全年彙總＋各季＋每月明細），可下載成 .xlsx。
 */

/** 每一場的出勤資料：[{ date, dutyId, name, series, nature, category, teachers, tan: [], dao: [], unknown: [], accompany: [], absent, absentNames: [], short }] */
function statsEvents_() {
  var today = todayString_();
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) { duties[d['勤務ID']] = d; });
  var positionsByDuty = groupBy_(readTableCached_(SHEETS.POSITIONS), '勤務ID');
  var byKey = {};
  var order = [];
  var multiTemple = statsMultiTempleNames_();
  // 報名沒有身分（例：匯入的舊出勤）：用成員名單上目前的身分（同名只有一位時）
  var memberIdentity = {};
  var memberCount = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (!m['姓名'] || m['待確認'] === '是') return;
    var n = normalizeName_(m['姓名']);
    memberCount[n] = (memberCount[n] || 0) + 1;
    if (m['身分']) memberIdentity[n] = m['身分'];
  });
  var identityOf = function (s) {
    if (s['身分']) return s['身分'];
    var n = normalizeName_(s['姓名']);
    return memberCount[n] === 1 ? memberIdentity[n] || '' : '';
  };
  readTableCached_(SHEETS.SIGNUPS).forEach(function (s) {
    if (s['狀態'] === '已取消' || !s['日期'] || s['日期'] > today) return;
    var duty = duties[s['勤務ID']];
    if (!duty || duty['性質'] === '活動') return; // 活動只記錄參加者，不算勤務統計
    var key = s['勤務ID'] + '|' + s['日期'];
    var ev = byKey[key];
    if (!ev) {
      ev = byKey[key] = {
        date: s['日期'], dutyId: s['勤務ID'], name: duty['名稱'], series: seriesKey_(duty['名稱']) || duty['名稱'],
        nature: duty['性質'] || '勤務', category: dutyCategory_(duty), teachers: duty['師資'] || '', tan: [], dao: [], unknown: [], accompany: [], absent: 0, absentNames: [], short: 0
      };
      order.push(key);
    }
    var name = normalizeName_(s['姓名']);
    if (s['佛堂'] && multiTemple[name]) name += '（' + s['佛堂'] + '）'; // 同名不同佛堂：分開算
    // 可兼任的勤務：同一人在同一場兼好幾個了愿項目，只算一次
    var counted = ev.tan.indexOf(name) !== -1 || ev.dao.indexOf(name) !== -1 || ev.unknown.indexOf(name) !== -1;
    if (counted && s['出席'] !== '未到') return;
    if (s['出席'] === '未到') { ev.absent++; if (ev.absentNames.indexOf(name) === -1) ev.absentNames.push(name); }
    else if (s['陪同'] === '是') ev.accompany.push(name);
    else if (identityOf(s) === '壇辦' || identityOf(s) === '點傳師') ev.tan.push(name); // 點傳師算在壇辦那邊
    else if (identityOf(s) === '道親' || identityOf(s) === '未求道') ev.dao.push(name); // 未求道算進道親
    else ev.unknown.push(name);
  });
  var signupsByDuty = groupBy_(readTableCached_(SHEETS.SIGNUPS).filter(function (s) { return s['狀態'] !== '已取消'; }), '勤務ID');
  return order.map(function (key) {
    var ev = byKey[key];
    var st = dayStatus_(positionsByDuty[ev.dutyId] || [], signupsByDuty[ev.dutyId] || [], ev.date);
    ev.short = st.shortage;
    return ev;
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name); });
}

function adminStats_() {
  return { today: todayString_(), events: statsEvents_(), eduSessions: eduSessions_(), sheetUpdatedAt: PropertiesService.getScriptProperties().getProperty('STATS_UPDATED_AT') || '' };
}

/**
 * 教育的課程、道務的課程與法會（今天以前，沒人報名的也列）：[{ date, dutyId, name, series, nature, category, teachers, lecturers, leaders, assistants }]
 * 同名（seriesKey_）的多筆＝同一個課程，每個日期一堂。給教育統計算堂數、出缺勤表、師資。
 */
function eduSessions_() {
  var today = todayString_();
  var out = [];
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    var cat = dutyCategory_(d);
    // 教育：課程；道務：課程、法會、會議
    var ok = (cat === '教育' && d['性質'] === '課程') || (cat === '道務' && ['課程', '法會', '會議'].indexOf(d['性質']) !== -1);
    if (!d['勤務ID'] || !ok || d['模式'] === '公告型') return;
    datesInRange_(d['開始日'], d['結束日'] || d['開始日']).forEach(function (date) {
      if (date > today) return;
      out.push({ date: date, dutyId: d['勤務ID'], name: d['名稱'], series: seriesKey_(d['名稱']) || d['名稱'], nature: d['性質'], category: cat,
        teachers: d['師資'] || '', lecturers: d['講師'] || '', leaders: d['帶班'] || '', assistants: d['助理帶班'] || '' });
    });
  });
  return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/** 管理後台按鈕：更新試算表「統計」分頁。body = { year? }（預設今年） */
function adminUpdateStatsSheet_(body) {
  var year = Number(body.year) || Number(todayString_().slice(0, 4));
  writeStatsSheet_(year);
  return { year: year, updatedAt: PropertiesService.getScriptProperties().getProperty('STATS_UPDATED_AT') };
}

/** 在 Apps Script 編輯器執行，或設定每天的時間觸發條件：更新今年的「統計」分頁 */
function updateStatsSheet() {
  writeStatsSheet_(Number(todayString_().slice(0, 4)));
}

/**
 * 依年份彙總（純計算，可測試）。回傳
 *   { months: [{ month, events, tan, dao, unknown, total, ratio }]（12 個月）, quarters: [...4], year: {...}, details: [每場] }
 */
function summarizeYear_(events, year) {
  var prefix = String(year);
  var list = events.filter(function (e) { return e.date.slice(0, 4) === prefix; });
  function sum(items) {
    var r = { events: items.length, tan: 0, dao: 0, unknown: 0 };
    items.forEach(function (e) { r.tan += e.tan.length; r.dao += e.dao.length; r.unknown += e.unknown.length; });
    r.total = r.tan + r.dao + r.unknown;
    r.ratio = r.total ? r.dao / r.total : 0;
    return r;
  }
  var months = [];
  for (var m = 1; m <= 12; m++) {
    var mm = (m < 10 ? '0' : '') + m;
    months.push(Object.assign({ month: m }, sum(list.filter(function (e) { return e.date.slice(5, 7) === mm; }))));
  }
  var quarters = [1, 2, 3, 4].map(function (q) {
    return Object.assign({ quarter: q }, sum(list.filter(function (e) { var mo = Number(e.date.slice(5, 7)); return mo > (q - 1) * 3 && mo <= q * 3; })));
  });
  return { months: months, quarters: quarters, year: sum(list), details: list };
}

/** 寫入「統計」分頁：先清空再整頁重寫（字放大、標題粗體、佔比用百分比格式） */
function writeStatsSheet_(year) {
  var events = statsEvents_();
  var cur = summarizeYear_(events, year);
  var prev = summarizeYear_(events, year - 1);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.STATS.name) || ss.insertSheet(SHEETS.STATS.name);
  sheet.clear();
  sheet.clearConditionalFormatRules && sheet.clearConditionalFormatRules();

  var rows = [];
  var styles = []; // [列號(從 1), 類型]
  function push(row, style) { rows.push(row); if (style) styles.push([rows.length, style]); }
  var roc = year - 1911;
  var W = 9;
  function pad(r) { while (r.length < W) r.push(''); return r; }

  push(pad([roc + ' 年勤務統計（' + year + '）']), 'title');
  push(pad(['更新時間：' + nowString_() + '。只算出席、非陪同的人；人次＝每場每人算一次。']), 'note');
  push(pad(['']));

  push(pad(['全年彙總']), 'section');
  push(pad(['月份', '場次', '壇辦人次', '道親人次', '未填身分', '合計人次', '道親佔比', '去年同月合計', '比去年同月']), 'header');
  cur.months.forEach(function (m, i) {
    var p = prev.months[i];
    push([roc + ' 年 ' + m.month + ' 月', m.events, m.tan, m.dao, m.unknown, m.total, { r: m.ratio }, p.total, m.total - p.total]);
  });
  push(['全年合計', cur.year.events, cur.year.tan, cur.year.dao, cur.year.unknown, cur.year.total, { r: cur.year.ratio }, prev.year.total, cur.year.total - prev.year.total], 'total');
  push(pad(['']));

  push(pad(['各季彙總']), 'section');
  push(pad(['季別', '場次', '壇辦人次', '道親人次', '未填身分', '合計人次', '道親佔比', '去年同季合計', '比去年同季']), 'header');
  cur.quarters.forEach(function (q, i) {
    var p = prev.quarters[i];
    push(['第 ' + q.quarter + ' 季（' + ((q.quarter - 1) * 3 + 1) + '–' + q.quarter * 3 + ' 月）', q.events, q.tan, q.dao, q.unknown, q.total, { r: q.ratio }, p.total, q.total - p.total]);
  });
  push(pad(['']));

  cur.months.forEach(function (m) {
    var items = cur.details.filter(function (e) { return Number(e.date.slice(5, 7)) === m.month; });
    push(pad([roc + ' 年 ' + m.month + ' 月明細']), 'section');
    push(pad(['日期', '活動項目', '性質', '壇辦姓名', '壇辦人數', '道親姓名', '道親人數', '道親佔比', '備註']), 'header');
    if (!items.length) push(pad(['（這個月沒有資料）']), 'note');
    items.forEach(function (e) {
      var total = e.tan.length + e.dao.length + e.unknown.length;
      var note = [];
      if (e.accompany.length) note.push('陪同：' + e.accompany.join('、'));
      if (e.unknown.length) note.push('未填身分：' + e.unknown.join('、'));
      if (e.absent) note.push('未到 ' + e.absent + ' 人');
      push([e.date, e.name, e.nature, e.tan.join('、'), e.tan.length, e.dao.join('、'), e.dao.length, { r: total ? e.dao.length / total : 0 }, note.join('；')]);
    });
    if (items.length) push(['小計', '', '', '', m.tan, '', m.dao, { r: m.ratio }, m.unknown ? '未填身分 ' + m.unknown + ' 人' : ''], 'total');
    push(pad(['']));
  });

  // 數字欄用數字格式、佔比用百分比（{ r: 0.58 } 代表佔比），其他一律純文字（避免日期被轉換）
  var values = rows.map(function (r) { return r.map(function (v) { return v && typeof v === 'object' ? v.r : typeof v === 'number' ? v : String(v); }); });
  var formats = rows.map(function (r) { return r.map(function (v) { return v && typeof v === 'object' ? '0%' : typeof v === 'number' ? '0' : '@'; }); });
  var all = sheet.getRange(1, 1, rows.length, W);
  all.setNumberFormats(formats).setValues(values).setFontSize(13).setVerticalAlignment('middle').setWrap(true);
  styles.forEach(function (s) {
    var range = sheet.getRange(s[0], 1, 1, W);
    if (s[1] === 'title') { sheet.getRange(s[0], 1).setFontSize(20).setFontWeight('bold'); }
    if (s[1] === 'section') { sheet.getRange(s[0], 1).setFontSize(16).setFontWeight('bold').setFontColor('#9e3d22'); }
    if (s[1] === 'header') range.setFontWeight('bold').setBackground('#ede6d7');
    if (s[1] === 'total') range.setFontWeight('bold').setBackground('#f6f1e7');
    if (s[1] === 'note') sheet.getRange(s[0], 1).setFontColor('#847d72').setFontSize(11);
  });
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidths(3, 1, 70);
  sheet.setColumnWidth(4, 260);
  sheet.setColumnWidth(6, 260);
  [5, 7, 8].forEach(function (c) { sheet.setColumnWidth(c, 100); });
  sheet.setColumnWidth(9, 220);
  sheet.setFrozenRows(0);
  SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('STATS_UPDATED_AT', nowString_());
}

/** 有不同佛堂的同名者（成員名單或報名紀錄裡）：{ 名字: true }，統計時這些名字加上佛堂分開算 */
function statsMultiTempleNames_() {
  var seen = {};
  var add = function (name, temple) {
    if (!name || !temple) return;
    var n = normalizeName_(name);
    (seen[n] = seen[n] || {})[temple] = true;
  };
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) { add(m['姓名'], m['佛堂']); });
  readTableCached_(SHEETS.SIGNUPS).forEach(function (s) { if (s['狀態'] !== '已取消') add(s['姓名'], s['佛堂']); });
  var out = {};
  Object.keys(seen).forEach(function (n) { if (Object.keys(seen[n]).length > 1) out[n] = true; });
  return out;
}
