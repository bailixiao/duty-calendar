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
      canChange: canSelfChange_(s['日期'], today)
    };
  });
  items.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.startTime).localeCompare(String(b.startTime));
  });
  return { name: name, today: today, items: items.slice(0, MINE_MAX) };
}

/** 比對用：去掉名字裡所有半形與全形空白 */
function mineKey_(name) {
  return canonicalName_(normalizeName_(name).replace(/[\s　]+/g, '')); // 打別名也查得到
}
