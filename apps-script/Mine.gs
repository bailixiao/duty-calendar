/**
 * 「我的報名」：輸入名字，列出這個人今天起還有效的報名（可取消或改期）。
 *   - 名字用 POST 送（不放網址）。只比對完全同名（去掉所有空白），不做模糊比對，避免列出別人的。
 *   - 只回傳行事曆上本來就公開的資料（勤務、日期、了愿項目），不回傳電話、身分。
 */

var MINE_MAX = 100;

/** body = { name } */
function mySignups_(body) {
  var name = mineKey_(body.name);
  if (name.length < 2) throw new ApiError_('BAD_REQUEST', '請輸入完整的名字（至少 2 個字）');
  var today = todayString_();
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) { duties[d['勤務ID']] = d; });
  var positions = {};
  readTableCached_(SHEETS.POSITIONS).forEach(function (p) { positions[p['了愿項目ID']] = p; });

  var items = readTableCached_(SHEETS.SIGNUPS).filter(function (s) {
    return s['狀態'] !== '已取消' && s['日期'] >= today && mineKey_(s['姓名']) === name && duties[s['勤務ID']];
  }).map(function (s) {
    var d = duties[s['勤務ID']];
    var p = positions[s['了愿項目ID']];
    return {
      signupId: s['報名ID'],
      dutyId: d['勤務ID'],
      dutyName: d['名稱'],
      nature: d['性質'],
      date: s['日期'],
      start: d['開始日'],
      end: d['結束日'],
      startTime: d['開始時間'],
      endTime: d['結束時間'],
      location: d['地點'],
      positionId: s['了愿項目ID'],
      temple: s['佛堂'] || '',
      positionName: p ? p['了愿項目名稱'] : '',
      accompany: s['陪同'] === '是',
      grid: d['版面'] === '職司表', // 職司表的報名可以改註記
      note: s['註記'] || '',
      canChange: canSelfChange_(s['日期'], today)
    };
  });
  items.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.startTime).localeCompare(String(b.startTime));
  });
  return { name: name, today: today, items: items.slice(0, MINE_MAX), record: myRecord_(name, today, duties), lead: myLead_(name, today, duties) };
}

/**
 * 我的成全紀錄（2026/10/13）：今年（到今天為止）參加了幾次、各類別幾次、最常參加哪一種，和去年比。
 * 同一場（勤務＋日期）兼好幾個了愿項目只算一次；點名「未到」的不算；陪同也算（有來就算）。
 */
function myRecord_(name, today, duties) {
  var year = today.slice(0, 4);
  var lastYear = String(Number(year) - 1);
  var seen = {};
  var byCat = {};
  var series = {};
  var total = 0;
  var last = 0;
  var since = '';
  readTableCached_(SHEETS.SIGNUPS).forEach(function (s) {
    if (s['狀態'] === '已取消' || s['出席'] === '未到' || !s['日期'] || s['日期'] > today) return;
    var d = duties[s['勤務ID']];
    if (!d || mineKey_(s['姓名']) !== name) return;
    var key = s['勤務ID'] + '|' + s['日期'];
    if (seen[key]) return;
    seen[key] = true;
    if (!since || s['日期'] < since) since = s['日期'];
    var y = s['日期'].slice(0, 4);
    if (y === lastYear) last++;
    if (y !== year) return;
    total++;
    var c = dutyCategory_(d);
    byCat[c] = (byCat[c] || 0) + 1;
    var k = seriesKey_(d['名稱']) || d['名稱'];
    series[k] = (series[k] || 0) + 1;
  });
  var top = Object.keys(series).sort(function (a, b) { return series[b] - series[a] || a.localeCompare(b); })[0] || '';
  return { year: Number(year), total: total, byCat: byCat, top: top, topTimes: top ? series[top] : 0, lastYear: last, since: since };
}

var LEAD_DAYS = 60;
var LEAD_MAX = 30;

/**
 * 組長專區（2026/10/13）：這個人今天起 60 天內負責的勤務。
 *   - 報名時勾了組長（報名的「組長」欄）
 *   - 分組名單上是那一組的組長或召集人（勤務的負責組）：每個勤務最多列 10 天
 * 只回傳勤務ID、日期、名稱、職稱；名單和缺幾人前端用公開的勤務資料讀。
 */
function myLead_(name, today, duties) {
  var until = addDaysStr_(today, LEAD_DAYS - 1);
  var out = {};
  var add = function (d, date, title) {
    var key = d['勤務ID'] + '|' + date;
    if (!out[key]) out[key] = { dutyId: d['勤務ID'], date: date, dutyName: d['名稱'], title: title };
  };
  activeSignups_().forEach(function (s) {
    var d = duties[s['勤務ID']];
    if (!d || s['組長'] !== '是' || s['日期'] < today || s['日期'] > until || mineKey_(s['姓名']) !== name) return;
    add(d, s['日期'], d['組長職稱'] || '組長');
  });
  Object.keys(duties).forEach(function (id) {
    var d = duties[id];
    var end = d['結束日'] || d['開始日'];
    if (!d['負責組'] || !d['開始日'] || end < today || d['開始日'] > until) return;
    var leader = groupLeader_(d['分組類型'], d['負責組']);
    if (!leader || !String(leader).split(/[、,，\/／\s　]+/).some(function (x) { return x && mineKey_(x) === name; })) return; // 可能寫好幾位
    datesInRange_(d['開始日'] > today ? d['開始日'] : today, end < until ? end : until).slice(0, 10).forEach(function (date) { add(d, date, d['負責組'] + '組長'); });
  });
  return Object.keys(out).map(function (k) { return out[k]; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.dutyName.localeCompare(b.dutyName); })
    .slice(0, LEAD_MAX);
}

/** 比對用：去掉名字裡所有半形與全形空白 */
function mineKey_(name) {
  return canonicalName_(normalizeName_(name).replace(/[\s　]+/g, '')); // 打別名也查得到
}

/** 查我的報名：改職司表報名的註記。body = { signupId, name, note }（今天以後的都可以，當天也可以） */
function setMyNote_(body) {
  var note = cleanText_(body.note).replace(/\s*\n\s*/g, ' ');
  if (note.length > 100) throw new ApiError_('BAD_REQUEST', '註記最多 100 字');
  var duties = readTableCached_(SHEETS.DUTIES);
  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    if (mineKey_(row['姓名']) !== mineKey_(body.name)) throw new ApiError_('FORBIDDEN', '只能改自己查到的報名');
    var duty = findById_(duties, '勤務ID', row['勤務ID']);
    if (!duty || duty['版面'] !== '職司表') throw new ApiError_('BAD_REQUEST', '這個勤務沒有註記');
    if (row['日期'] < todayString_()) throw new ApiError_('FORBIDDEN', '已經過了的報名不能改註記');
    var now = nowString_();
    var before = row['註記'] || '';
    updateRow_(SHEETS.SIGNUPS, row, { '註記': note, '更新時間': now });
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修正', '報名ID': row['報名ID'],
      '內容摘要': [row['姓名'], row['日期'], duty['名稱']].join('｜') + '｜' + (note ? '註記：' + note : '刪除註記') + '（查我的報名）',
      '還原用的前一版資料': JSON.stringify({ '註記': before }) }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { signupId: row['報名ID'], note: note };
  });
}
