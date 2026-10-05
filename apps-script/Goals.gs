/**
 * 各佛堂道務目標（道務統計下方的表）：每個佛堂每年各項目的「目標」與「目前」，加上「立愿」備註。
 *   - 數字不是從報名算的（安壇、渡人⋯），由總管理者或道務帳號在後台填寫。
 *   - 渡人可以幾個佛堂共用一個目標（例：陸、韓國合計 21）：同一個「渡人合併」名稱的佛堂，數字存在第一個佛堂那列。
 *   - 佛堂名稱只存在試算表（儲存庫不放人名）。
 */

var GOAL_ITEMS = ['安壇', '清口立愿', '壇辦立愿', '渡人', '明道班', '敦化班'];

function goalRowToJson_(r) {
  var values = {};
  GOAL_ITEMS.forEach(function (k) { values[k] = { target: r[k + '目標'] || '', current: r[k + '目前'] || '' }; });
  return { name: r['佛堂'], order: Number(r['排序']) || 0, values: values, vow: r['立愿'] || '', group: r['渡人合併'] || '' };
}

/** body = { year }：回傳這一年的表與有資料的年度 */
function adminGoals_(body) {
  var year = String(Number(body.year) || Number(todayString_().slice(0, 4)));
  var all = readTable_(SHEETS.GOALS);
  var years = {};
  all.forEach(function (r) { if (r['年度']) years[r['年度']] = true; });
  var rows = all.filter(function (r) { return String(r['年度']) === year && r['佛堂']; })
    .map(goalRowToJson_)
    .sort(function (a, b) { return a.order - b.order; });
  return { year: Number(year), items: GOAL_ITEMS, rows: rows, years: Object.keys(years).map(Number).sort() };
}

/** 數字欄：空白或 0 以上的整數 */
function cleanGoalNumber_(v, label, errors) {
  var s = cleanText_(v);
  if (s === '') return '';
  if (!/^\d{1,5}$/.test(s)) { errors.push(label + '要填數字'); return ''; }
  return String(Number(s));
}

/** body = { year, rows: [{ name, values: { 項目: { target, current } }, vow, group }] }：整年的表一次存（取代這一年原本的） */
function adminSaveGoals_(body) {
  var year = Number(body.year);
  if (!(year >= 2000 && year <= 2100)) throw new ApiError_('BAD_REQUEST', '年度不對');
  var input = Array.isArray(body.rows) ? body.rows : [];
  if (input.length > 200) throw new ApiError_('BAD_REQUEST', '佛堂太多（最多 200 個）');
  var errors = [];
  var seen = {};
  var rows = input.map(function (r, i) {
    var name = cleanText_(r.name);
    if (!name) { errors.push('第 ' + (i + 1) + ' 列：請填佛堂名稱'); return null; }
    if (seen[name]) errors.push('「' + name + '」重複了');
    seen[name] = true;
    var row = { '年度': String(year), '佛堂': name, '排序': String(i + 1), '立愿': cleanText_(r.vow).slice(0, 100), '渡人合併': cleanText_(r.group).slice(0, 20) };
    GOAL_ITEMS.forEach(function (k) {
      var v = (r.values && r.values[k]) || {};
      row[k + '目標'] = cleanGoalNumber_(v.target, name + '的' + k + '目標', errors);
      row[k + '目前'] = cleanGoalNumber_(v.current, name + '的' + k + '目前', errors);
    });
    return row;
  }).filter(Boolean);
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存檔，請看下面的說明', errors.map(function (m) { return { message: m }; }));

  return withSignupLock_(function () {
    var old = readTable_(SHEETS.GOALS).filter(function (r) { return String(r['年度']) === String(year); });
    if (old.length) deleteRows_(SHEETS.GOALS, old.map(function (r) { return r._row; }));
    if (rows.length) appendRows_(SHEETS.GOALS, rows);
    writeDutyLog_('修改勤務', (year - 1911) + ' 年各佛堂道務目標｜' + rows.length + ' 個佛堂', null);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.GOALS);
    return adminGoals_({ year: year });
  });
}
