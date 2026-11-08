/**
 * 活動回報（2026/11/8）：活動結束後，管理者在後台產生「回報連結＋4 位數回報碼」傳給負責的人（組長、召集人或任何一位參加的人，不一定要有組長），
 * 對方打開 #/report/<勤務ID>?date=… 輸入回報碼，填「整體狀況、遇到的問題、下次改進」，可附照片（最多 5 張）。
 *   - 同一勤務同一天一份回報（一組回報碼），填過可以再打開修改。
 *   - 連結從勤務那天起 REPORT_OPEN_DAYS 天內能用；回報碼連續錯 5 次鎖 10 分鐘。
 *   - 回報只在後台顯示（勤務名單下面；同名勤務以前的回報也列出來，辦下一次時參考）。
 *   - 第一次送出時通知開啟「報名彙整通知」的管理者手機（類別帳號只收自己類別的）。
 *   - 照片由 Cloudflare 版的 reportUpload 先上傳（worker/src/app.js），這裡只存檔案代號。
 */

var REPORT_OPEN_DAYS = 30;
var REPORT_MAX_FAIL = 5;
var REPORT_TEXT_MAX = 1000;
var REPORT_PHOTO_MAX = 5;

function reportRow_(dutyId, date) {
  return readTable_(SHEETS.REPORTS).filter(function (r) { return r['勤務ID'] === dutyId && r['日期'] === date; })[0] || null;
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

/** 後台：body = { dutyId, date }：取得（沒有就產生）回報碼 */
function adminReportLink_(body) {
  var duty = findDutyById_(body.dutyId);
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
  if (!isDateString_(body.date) || body.date < duty['開始日'] || body.date > (duty['結束日'] || duty['開始日'])) throw new ApiError_('BAD_REQUEST', '日期不在勤務期間');
  return withSignupLock_(function () {
    var row = reportRow_(duty['勤務ID'], body.date);
    var code = row ? row['回報碼'] : String(1000 + Math.floor(Math.random() * 9000));
    if (!row) {
      appendRows_(SHEETS.REPORTS, [{ '回報ID': newId_('P'), '勤務ID': duty['勤務ID'], '日期': body.date, '回報碼': code, '整體狀況': '', '遇到的問題': '',
        '下次改進': '', '照片': '', '填寫人': '', '建立時間': nowString_(), '更新時間': '' }]);
    }
    return { dutyId: duty['勤務ID'], date: body.date, code: code, name: duty['名稱'], openDays: REPORT_OPEN_DAYS };
  });
}

/** 檢查回報碼（錯太多次會鎖住）；回傳 { duty, row } */
function reportCheck_(body) {
  var dutyId = cleanText_(body.dutyId);
  var date = cleanText_(body.date);
  var duty = findDutyById_(dutyId);
  if (!duty || !isDateString_(date)) throw new ApiError_('NOT_FOUND', '找不到這個回報連結，請向管理者再要一次');
  var today = todayString_();
  if (date > today) throw new ApiError_('FORBIDDEN', '回報連結要到活動當天（' + shortDate_(date) + '）才能用');
  if (addDaysStr_(date, REPORT_OPEN_DAYS) < today) throw new ApiError_('FORBIDDEN', '這個回報連結已經過期了（活動後 ' + REPORT_OPEN_DAYS + ' 天內能用），請向管理者再要一次');
  var cache = CacheService.getScriptCache();
  var key = 'rpfail:' + dutyId + ':' + date;
  var fails = Number(cache.get(key) || 0);
  if (fails >= REPORT_MAX_FAIL) throw new ApiError_('BUSY', '回報碼錯太多次，請 10 分鐘後再試');
  var row = reportRow_(dutyId, date);
  if (!row || String(body.code || '').replace(/\D/g, '') !== String(row['回報碼'])) {
    cache.put(key, String(fails + 1), 600);
    throw new ApiError_('FORBIDDEN', '回報碼不對，請再確認一次（管理者給的 4 位數字）');
  }
  return { duty: duty, row: row };
}

function reportView_(duty, row) {
  return {
    duty: { id: duty['勤務ID'], name: duty['名稱'], location: duty['地點'] || '', startTime: duty['開始時間'] || '', endTime: duty['結束時間'] || '' },
    report: reportOut_(row)
  };
}

/** body = { dutyId, date, code }：打開回報頁（填過的會帶出來） */
function reportGet_(body) {
  var c = reportCheck_(body);
  return reportView_(c.duty, c.row);
}

/** body = { dutyId, date, code, overall, problems, improve, name, photos: [檔案代號] }：送出（或修改）回報 */
function reportSave_(body) {
  var c = reportCheck_(body);
  var text = function (v) { return String(v || '').replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, REPORT_TEXT_MAX); };
  var overall = text(body.overall);
  var problems = text(body.problems);
  var improve = text(body.improve);
  var name = normalizeName_(body.name).slice(0, 20);
  var photos = (Array.isArray(body.photos) ? body.photos : []).filter(function (id) { return /^F-[\w-]{6,40}$/.test(String(id)); }).slice(0, REPORT_PHOTO_MAX);
  var errors = [];
  if (!overall && !problems && !improve) errors.push('請至少寫一格（整體狀況、遇到的問題或下次改進）');
  if (!name) errors.push('請填您的名字');
  if (errors.length) throw new ApiError_('VALIDATION', '回報沒有送出，請看下面的說明', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var row = reportRow_(c.duty['勤務ID'], body.date);
    var first = !reportHasContent_(row);
    var now = nowString_();
    updateRow_(SHEETS.REPORTS, row, { '整體狀況': overall, '遇到的問題': problems, '下次改進': improve, '照片': photos.join(','), '填寫人': name, '更新時間': now });
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '活動回報', '報名ID': '', '內容摘要': name + '｜' + body.date + '｜' + c.duty['名稱'] + (first ? '' : '｜修改'), '還原用的前一版資料': '' }]);
    if (first) notifyReport_(c.duty, body.date, name, problems || overall || improve);
    SpreadsheetApp.flush();
    return reportView_(c.duty, reportRow_(c.duty['勤務ID'], body.date));
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
  var rows = readTable_(SHEETS.REPORTS).filter(reportHasContent_);
  var mine = rows.filter(function (r) { return r['勤務ID'] === duty['勤務ID']; }).map(reportOut_)
    .sort(function (a, b) { return a.date.localeCompare(b.date); });
  var sameName = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (d['勤務ID'] !== duty['勤務ID'] && d['名稱'] === duty['名稱'] && d['開始日'] < duty['開始日']) sameName[d['勤務ID']] = d;
  });
  var before = rows.filter(function (r) { return sameName[r['勤務ID']]; }).map(reportOut_)
    .sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
  var links = {};
  readTable_(SHEETS.REPORTS).forEach(function (r) { if (r['勤務ID'] === duty['勤務ID']) links[r['日期']] = true; });
  return { reports: mine, pastReports: before, reportLinks: Object.keys(links).sort() };
}
