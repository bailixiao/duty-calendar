/**
 * 活動回報（2026/11/8）：每個勤務預設都能回報。
 *   - 活動當天起 REPORT_OPEN_DAYS 天內，家人們的勤務頁自動出現「📝 活動回報」按鈕，打開 #/report/<勤務ID>?date=…
 *   - 用名字填：名字要在這個勤務的報名名單上（任何一天、沒取消），或是負責組的家人、組長；公告型勤務成員名單上的家人都可以。
 *     同一天每人一份，同名字再填就是修改自己那份。
 *   - 用回報碼填（備用）：管理者在後台產生「回報連結＋4 位數回報碼」傳給沒報名的人（例：負責的師兄姐）；同一勤務同一天一組回報碼、一份回報。
 *     回報碼連續錯 5 次鎖 10 分鐘。
 *   - 每份填「整體狀況、遇到的問題、下次改進」（至少一格），可附照片（最多 5 張）。
 *   - 回報只在後台顯示（勤務名單下面；同名勤務以前的回報也列出來，辦下一次時參考）。
 *   - 每份第一次送出時通知開啟「報名彙整通知」的管理者手機（類別帳號只收自己類別的）。
 *   - 照片由 Cloudflare 版的 reportUpload 先上傳（worker/src/app.js），這裡只存檔案代號。
 */

var REPORT_OPEN_DAYS = 30;
var REPORT_MAX_FAIL = 5;
var REPORT_TEXT_MAX = 1000;
var REPORT_PHOTO_MAX = 5;

function reportRows_(dutyId, date) {
  return readTable_(SHEETS.REPORTS).filter(function (r) { return r['勤務ID'] === dutyId && r['日期'] === date; });
}

/** 回報碼那一份 */
function reportCodeRow_(dutyId, date) {
  return reportRows_(dutyId, date).filter(function (r) { return r['回報碼']; })[0] || null;
}

/** 用名字填的那一份 */
function reportNameRow_(dutyId, date, name) {
  var key = mineKey_(name);
  return reportRows_(dutyId, date).filter(function (r) { return !r['回報碼'] && mineKey_(r['填寫人']) === key; })[0] || null;
}

function reportHasContent_(r) {
  return !!(r && (r['整體狀況'] || r['遇到的問題'] || r['下次改進'] || r['照片']));
}

function reportOut_(r) {
  return {
    date: r['日期'], overall: r['整體狀況'] || '', problems: r['遇到的問題'] || '', improve: r['下次改進'] || '',
    photos: String(r['照片'] || '').split(',').filter(Boolean), name: r['填寫人'] || '', updatedAt: r['更新時間'] || ''
  };
}

/** 這個勤務現在能回報的日期（活動當天起 30 天內，新的在前） */
function reportDates_(duty) {
  var today = todayString_();
  var out = [];
  var d = duty['開始日'];
  var end = duty['結束日'] || d;
  for (var i = 0; d <= end && i < 400; i++, d = addDaysStr_(d, 1)) {
    if (d <= today && addDaysStr_(d, REPORT_OPEN_DAYS) >= today) out.push(d);
  }
  return out.reverse();
}

/** 這個名字能不能用名字填回報 */
function reportEligible_(duty, name) {
  var key = mineKey_(name);
  if (!key) return false;
  if (activeSignups_().some(function (s) { return s['勤務ID'] === duty['勤務ID'] && mineKey_(s['姓名']) === key; })) return true;
  if (duty['負責組'] && duty['分組類型']) {
    if (inDutyGroup_(duty, name)) return true;
    var g = findGroup_(duty['分組類型'], duty['負責組']);
    if ([g.leader, g.assistant].some(function (n) { return n && mineKey_(n) === key; })) return true;
  }
  if (duty['模式'] === '公告型') {
    return readTableCached_(SHEETS.MEMBERS).some(function (m) { return m['待確認'] !== '是' && m['啟用中'] !== '否' && mineKey_(m['姓名']) === key; });
  }
  return false;
}

/** 後台：body = { dutyId, date }：取得（沒有就產生）回報碼（給沒報名的人用） */
function adminReportLink_(body) {
  var duty = findDutyById_(body.dutyId);
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
  if (!isDateString_(body.date) || body.date < duty['開始日'] || body.date > (duty['結束日'] || duty['開始日'])) throw new ApiError_('BAD_REQUEST', '日期不在勤務期間');
  return withSignupLock_(function () {
    var row = reportCodeRow_(duty['勤務ID'], body.date);
    var code = row ? row['回報碼'] : String(1000 + Math.floor(Math.random() * 9000));
    if (!row) {
      appendRows_(SHEETS.REPORTS, [{ '回報ID': newId_('P'), '勤務ID': duty['勤務ID'], '日期': body.date, '回報碼': code, '整體狀況': '', '遇到的問題': '',
        '下次改進': '', '照片': '', '填寫人': '', '建立時間': nowString_(), '更新時間': '' }]);
    }
    return { dutyId: duty['勤務ID'], date: body.date, code: code, name: duty['名稱'], openDays: REPORT_OPEN_DAYS };
  });
}

/**
 * 檢查身分：有 code 用回報碼（錯太多次會鎖住），否則用名字。
 * 回傳 { duty, date, row（可能是 null）, name（用名字時）, byCode }
 */
function reportCheck_(body) {
  var dutyId = cleanText_(body.dutyId);
  var date = cleanText_(body.date);
  var duty = findDutyById_(dutyId);
  if (!duty || !isDateString_(date) || date < duty['開始日'] || date > (duty['結束日'] || duty['開始日'])) throw new ApiError_('NOT_FOUND', '找不到這個活動，請回行事曆再點一次');
  var today = todayString_();
  if (date > today) throw new ApiError_('FORBIDDEN', '活動當天（' + shortDate_(date) + '）起才能回報');
  if (addDaysStr_(date, REPORT_OPEN_DAYS) < today) throw new ApiError_('FORBIDDEN', '已經超過回報期限了（活動後 ' + REPORT_OPEN_DAYS + ' 天內能填），要補充請找管理者');
  if (body.code) {
    var cache = CacheService.getScriptCache();
    var key = 'rpfail:' + dutyId + ':' + date;
    var fails = Number(cache.get(key) || 0);
    if (fails >= REPORT_MAX_FAIL) throw new ApiError_('BUSY', '回報碼錯太多次，請 10 分鐘後再試');
    var row = reportCodeRow_(dutyId, date);
    if (!row || String(body.code).replace(/\D/g, '') !== String(row['回報碼'])) {
      cache.put(key, String(fails + 1), 600);
      throw new ApiError_('FORBIDDEN', '回報碼不對，請再確認一次（管理者給的 4 位數字）');
    }
    return { duty: duty, date: date, row: row, byCode: true };
  }
  var name = normalizeName_(body.name).slice(0, 20);
  if (!name) throw new ApiError_('BAD_REQUEST', '請填您的名字');
  if (!reportEligible_(duty, name)) {
    throw new ApiError_('FORBIDDEN', '報名名單上找不到「' + name + '」。請打報名時用的名字；沒有報名但有參加的，請向管理者要回報碼');
  }
  return { duty: duty, date: date, row: reportNameRow_(dutyId, date, name), name: name, byCode: false };
}

function reportView_(c) {
  var r = c.row ? reportOut_(c.row) : { date: c.date, overall: '', problems: '', improve: '', photos: [], name: c.name || '', updatedAt: '' };
  return {
    duty: { id: c.duty['勤務ID'], name: c.duty['名稱'], location: c.duty['地點'] || '', startTime: c.duty['開始時間'] || '', endTime: c.duty['結束時間'] || '' },
    dates: reportDates_(c.duty),
    byCode: c.byCode,
    report: r
  };
}

/** body = { dutyId, date, code 或 name }：打開回報（填過的會帶出來） */
function reportGet_(body) {
  return reportView_(reportCheck_(body));
}

/** body = { dutyId, date, code 或 name, overall, problems, improve, name, photos: [檔案代號] }：送出（或修改）回報 */
function reportSave_(body) {
  var c = reportCheck_(body);
  var text = function (v) { return String(v || '').replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, REPORT_TEXT_MAX); };
  var overall = text(body.overall);
  var problems = text(body.problems);
  var improve = text(body.improve);
  var name = c.byCode ? normalizeName_(body.name).slice(0, 20) : c.name;
  var photos = (Array.isArray(body.photos) ? body.photos : []).filter(function (id) { return /^F-[\w-]{6,40}$/.test(String(id)); }).slice(0, REPORT_PHOTO_MAX);
  var errors = [];
  if (!overall && !problems && !improve) errors.push('請至少寫一格（整體狀況、遇到的問題或下次改進）');
  if (!name) errors.push('請填您的名字');
  if (errors.length) throw new ApiError_('VALIDATION', '回報沒有送出，請看下面的說明', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var dutyId = c.duty['勤務ID'];
    var row = c.byCode ? reportCodeRow_(dutyId, c.date) : reportNameRow_(dutyId, c.date, name);
    var first = !reportHasContent_(row);
    var now = nowString_();
    var values = { '整體狀況': overall, '遇到的問題': problems, '下次改進': improve, '照片': photos.join(','), '填寫人': name, '更新時間': now };
    if (row) updateRow_(SHEETS.REPORTS, row, values);
    else appendRows_(SHEETS.REPORTS, [Object.assign({ '回報ID': newId_('P'), '勤務ID': dutyId, '日期': c.date, '回報碼': '', '建立時間': now }, values)]);
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '活動回報', '報名ID': '', '內容摘要': name + '｜' + c.date + '｜' + c.duty['名稱'] + (first ? '' : '｜修改'), '還原用的前一版資料': '' }]);
    if (first) notifyReport_(c.duty, c.date, name, problems || overall || improve);
    SpreadsheetApp.flush();
    var saved = c.byCode ? reportCodeRow_(dutyId, c.date) : reportNameRow_(dutyId, c.date, name);
    return reportView_({ duty: c.duty, date: c.date, row: saved, name: name, byCode: c.byCode });
  });
}

/** 第一次有人回報：通知開啟「報名彙整通知」的管理者（類別帳號只收自己類別的） */
function notifyReport_(duty, date, name, text) {
  var cat = dutyCategory_(duty);
  var targets = pushTargets_('報名彙整').filter(function (t) { var r = t['對象'] || SUPER_ACCOUNT; return r === SUPER_ACCOUNT || r === cat; });
  pushMessageTo_(targets, '📝 ' + duty['名稱'] + '（' + shortDate_(date) + '）有活動回報', name + '：' + String(text).slice(0, 80), '#/admin/duty/' + encodeURIComponent(duty['勤務ID']) + '?date=' + date);
}

/** 後台勤務頁：這個勤務的回報＋同名勤務以前的回報（最近 5 份） */
function dutyReports_(duty) {
  var all = readTable_(SHEETS.REPORTS);
  var rows = all.filter(reportHasContent_);
  var mine = rows.filter(function (r) { return r['勤務ID'] === duty['勤務ID']; }).map(reportOut_)
    .sort(function (a, b) { return a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt); });
  var sameName = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (d['勤務ID'] !== duty['勤務ID'] && d['名稱'] === duty['名稱'] && d['開始日'] < duty['開始日']) sameName[d['勤務ID']] = d;
  });
  var before = rows.filter(function (r) { return sameName[r['勤務ID']]; }).map(reportOut_)
    .sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
  var links = {};
  all.forEach(function (r) { if (r['勤務ID'] === duty['勤務ID'] && r['回報碼']) links[r['日期']] = true; });
  return { reports: mine, pastReports: before, reportLinks: Object.keys(links).sort(), reportDates: reportDates_(duty) };
}
