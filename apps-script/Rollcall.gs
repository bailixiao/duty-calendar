/**
 * 當天點名（2026/10/6）：管理者在後台產生某勤務某一天的「點名連結＋4 位數點名碼」傳給組長，
 * 組長打開 #/rollcall/<勤務ID>?date=… 輸入點名碼，就能把名單上的人改「到／未到」（同出席修正）。
 *   - 連結只有勤務當天能用；點名碼連續錯 5 次鎖 10 分鐘。
 *   - 點名頁只有名字、了愿項目，不回傳電話。
 */

var ROLLCALL_MAX_FAIL = 5;

/** 這個勤務這一天的點名碼（沒有就產生一組） */
function rollcallCode_(dutyId, date, create) {
  var row = readTable_(SHEETS.ROLLCALL).filter(function (r) { return r['勤務ID'] === dutyId && r['日期'] === date; })[0];
  if (row) return row['點名碼'];
  if (!create) return '';
  var code = String(1000 + Math.floor(Math.random() * 9000));
  appendRows_(SHEETS.ROLLCALL, [{ '勤務ID': dutyId, '日期': date, '點名碼': code, '建立時間': nowString_() }]);
  return code;
}

/** 後台：body = { dutyId, date }：取得點名連結用的點名碼 */
function adminRollcallLink_(body) {
  var duty = findDutyById_(body.dutyId);
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
  if (!isDateString_(body.date) || body.date < duty['開始日'] || body.date > (duty['結束日'] || duty['開始日'])) throw new ApiError_('BAD_REQUEST', '日期不在勤務期間');
  if (duty['模式'] === '公告型') throw new ApiError_('BAD_REQUEST', '公告型勤務不用點名');
  return withSignupLock_(function () {
    return { dutyId: duty['勤務ID'], date: body.date, code: rollcallCode_(duty['勤務ID'], body.date, true), name: duty['名稱'] };
  });
}

/** 檢查點名碼（錯太多次會鎖住）；回傳勤務列 */
function rollcallCheck_(body) {
  var dutyId = cleanText_(body.dutyId);
  var date = cleanText_(body.date);
  var duty = findDutyById_(dutyId);
  if (!duty || !isDateString_(date)) throw new ApiError_('NOT_FOUND', '找不到這個點名連結，請向管理者再要一次');
  if (date !== todayString_()) throw new ApiError_('FORBIDDEN', date > todayString_() ? '點名連結要到勤務當天（' + shortDate_(date) + '）才能用' : '這個點名連結已經過期了（只有勤務當天能用）');
  var cache = CacheService.getScriptCache();
  var key = 'rcfail:' + dutyId + ':' + date;
  var fails = Number(cache.get(key) || 0);
  if (fails >= ROLLCALL_MAX_FAIL) throw new ApiError_('BUSY', '點名碼錯太多次，請 10 分鐘後再試');
  var code = rollcallCode_(dutyId, date, false);
  if (!code || String(body.code || '').replace(/\D/g, '') !== code) {
    cache.put(key, String(fails + 1), 600);
    throw new ApiError_('FORBIDDEN', '點名碼不對，請再確認一次（管理者給的 4 位數字）');
  }
  return duty;
}

/** 點名頁的名單：[{ id, name, people: [{ id, name, accompany, attend, leader }] }] */
function rollcallList_(duty, date) {
  var signups = activeSignups_().filter(function (s) { return s['勤務ID'] === duty['勤務ID'] && s['日期'] === date; });
  var positions = readTableCached_(SHEETS.POSITIONS).filter(function (p) { return p['勤務ID'] === duty['勤務ID']; });
  return {
    duty: { id: duty['勤務ID'], name: duty['名稱'], location: duty['地點'] || '', startTime: duty['開始時間'] || '', endTime: duty['結束時間'] || '' },
    date: date,
    positions: positions.map(function (p) {
      return {
        id: p['了愿項目ID'], name: p['了愿項目名稱'],
        people: signups.filter(function (s) { return s['了愿項目ID'] === p['了愿項目ID']; }).map(function (s) {
          return { id: s['報名ID'], name: s['姓名'], accompany: s['陪同'] === '是', attend: s['出席'] || '出席', leader: s['組長'] === '是' };
        })
      };
    })
  };
}

/** body = { dutyId, date, code }：打開點名頁 */
function rollcallGet_(body) {
  var duty = rollcallCheck_(body);
  return rollcallList_(duty, body.date);
}

/** body = { dutyId, date, code, signupId, attend: '出席'|'未到' }：點名 */
function rollcallSet_(body) {
  var duty = rollcallCheck_(body);
  if (OPTIONS.attendance.indexOf(body.attend) === -1) throw new ApiError_('BAD_REQUEST', '只能是出席或未到');
  return withSignupLock_(function () {
    var row = findActiveSignup_(readTable_(SHEETS.SIGNUPS), body.signupId);
    if (row['勤務ID'] !== duty['勤務ID'] || row['日期'] !== body.date) throw new ApiError_('BAD_REQUEST', '這個人不在這次的名單上');
    if (row['出席'] !== body.attend) {
      var before = rowSnapshot_(SHEETS.SIGNUPS, row);
      var now = nowString_();
      updateRow_(SHEETS.SIGNUPS, row, { '出席': body.attend, '更新時間': now });
      // 動作記「修正」（和出席修正一樣可以還原），內容寫明是點名
      appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修正', '報名ID': row['報名ID'],
        '內容摘要': row['姓名'] + '｜' + body.date + '｜' + duty['名稱'] + '｜點名：' + (body.attend === '未到' ? '未到' : '到'), '還原用的前一版資料': JSON.stringify(before) }]);
      SpreadsheetApp.flush();
      invalidateTable_(SHEETS.SIGNUPS);
    }
    return rollcallList_(duty, body.date);
  });
}
