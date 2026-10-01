/**
 * 管理後台 API（規格第 8 節管理者後台、第 7 節第 7 條還原）。
 *   - 登入：密碼存在 Script Properties 的 ADMIN_PASSWORD（不寫進程式碼）。成功後發一組通行碼（存在 CacheService，6 小時）。
 *   - 密碼連續錯 10 次鎖 10 分鐘（Apps Script 取不到來源 IP，以全域次數計算）。
 *   - 所有管理 API 都用 POST，通行碼放在內容（不放網址）。
 *   - 組長電話只在這裡回傳。
 */

var ADMIN_TOKEN_TTL_SEC = 21600; // 6 小時（CacheService 上限）
var ADMIN_MAX_FAILS = 10;
var ADMIN_LOCK_SEC = 600;
var RESTORABLE_ACTIONS = ['報名', '取消', '改期'];

function adminLogin_(body) {
  var password = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!password) throw new ApiError_('CONFIG', '尚未設定管理密碼，請依部署說明在「指令碼屬性」設定 ADMIN_PASSWORD');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('admin-fails') || 0);
  if (fails >= ADMIN_MAX_FAILS) throw new ApiError_('LOCKED', '密碼錯誤太多次，請 10 分鐘後再試');
  if (String(body.password || '') !== password) {
    cache.put('admin-fails', String(fails + 1), ADMIN_LOCK_SEC);
    throw new ApiError_('UNAUTHORIZED', '密碼不正確');
  }
  cache.remove('admin-fails');
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('admin-token:' + token, '1', ADMIN_TOKEN_TTL_SEC);
  return { token: token, expiresInSec: ADMIN_TOKEN_TTL_SEC };
}

function adminLogout_(body) {
  if (body.token) CacheService.getScriptCache().remove('admin-token:' + body.token);
  return {};
}

function requireAdmin_(body) {
  var token = String(body.token || '');
  if (!token || !CacheService.getScriptCache().get('admin-token:' + token)) {
    throw new ApiError_('UNAUTHORIZED', '登入已過期，請重新登入');
  }
}

/** 近期勤務：今天起 N 天（預設 14） */
function adminRecent_(body) {
  var days = Math.min(Math.max(Number(body.days) || 14, 1), 60);
  var today = todayString_();
  return getEvents_({ from: today, to: datesInRange_(today, '9999-12-31').slice(0, days).pop() });
}

/** 勤務名單（管理用）：比一般詳情多了身分、報名時間、負責組組長電話 */
function adminDuty_(body) {
  var data = getDuty_({ id: body.id });
  var byId = {};
  readTable_(SHEETS.SIGNUPS).forEach(function (s) { byId[s['報名ID']] = s; });
  data.signups.forEach(function (s) {
    var row = byId[s.id] || {};
    s.identity = row['身分'] || '';
    s.createdAt = row['建立時間'] || '';
  });
  data.groupContact = adminGroupContact_(data.groupType, data.group);
  return data;
}

function adminGroupContact_(groupType, groupName) {
  if (!groupType || !groupName) return null;
  var g = readTable_(SHEETS.GROUPS).filter(function (x) {
    return x['分組類型'] === groupType && x['組名'] === groupName;
  })[0];
  if (!g) return null;
  return { name: g['組名'], leader: g['組長或召集人'], phone: g['組長電話'] };
}

/** 操作紀錄：新到舊，offset／limit 分頁 */
function adminLogs_(body) {
  var limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
  var offset = Math.max(Number(body.offset) || 0, 0);
  var logs = readTable_(SHEETS.LOGS).reverse();
  return {
    total: logs.length,
    logs: logs.slice(offset, offset + limit).map(function (l) {
      return {
        row: l._row,
        time: l['時間'],
        action: l['動作'],
        signupId: l['報名ID'],
        summary: l['內容摘要'],
        restoredAt: l['還原時間'],
        restorable: RESTORABLE_ACTIONS.indexOf(l['動作']) !== -1 && !l['還原時間']
      };
    })
  };
}

/**
 * 還原一筆操作紀錄。body = { row, signupId }（以列號找紀錄，並核對報名ID避免對錯列）
 *   報名 → 取消該筆；取消 → 恢復該筆；改期 → 取消新的一筆、恢復原本那筆。
 *   恢復時若超過名額或同日重複，照樣恢復，回傳 warnings。
 */
function adminRestore_(body) {
  var duties = readTable_(SHEETS.DUTIES);
  var positions = readTable_(SHEETS.POSITIONS);

  return withSignupLock_(function () {
    var log = readTable_(SHEETS.LOGS).filter(function (l) { return l._row === Number(body.row); })[0];
    if (!log || log['報名ID'] !== body.signupId) throw new ApiError_('NOT_FOUND', '找不到這筆操作紀錄，請重新整理');
    if (log['還原時間']) throw new ApiError_('ALREADY', '這筆紀錄已經還原過了（' + log['還原時間'] + '）');
    if (RESTORABLE_ACTIONS.indexOf(log['動作']) === -1) throw new ApiError_('BAD_REQUEST', '這種紀錄不能還原');

    var signups = readTable_(SHEETS.SIGNUPS);
    var now = nowString_();
    var warnings = [];
    var touched = [];

    function cancelRow(id) {
      var row = findById_(signups, '報名ID', id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到相關的報名資料，可能已在試算表被刪除');
      if (row['狀態'] === '已取消') throw new ApiError_('ALREADY', '這筆報名目前已經是取消狀態，不需還原');
      updateRow_(SHEETS.SIGNUPS, row, { '狀態': '已取消', '更新時間': now });
      touched.push(row);
    }

    function reactivateRow(id) {
      var row = findById_(signups, '報名ID', id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到相關的報名資料，可能已在試算表被刪除');
      if (row['狀態'] !== '已取消') throw new ApiError_('ALREADY', '這筆報名目前已經是有效狀態，不需還原');
      warnings = warnings.concat(restoreWarnings_(row, duties, positions, signups));
      updateRow_(SHEETS.SIGNUPS, row, { '狀態': '有效', '更新時間': now });
      touched.push(row);
    }

    if (log['動作'] === '報名') {
      cancelRow(log['報名ID']);
    } else if (log['動作'] === '取消') {
      reactivateRow(log['報名ID']);
    } else {
      var prev = JSON.parse(log['還原用的前一版資料'] || '{}');
      if (!prev.from || !prev.toSignupId) throw new ApiError_('BAD_REQUEST', '這筆改期紀錄缺少還原資料');
      cancelRow(prev.toSignupId);
      reactivateRow(prev.from['報名ID']);
    }

    updateRow_(SHEETS.LOGS, log, { '還原時間': now });
    appendRows_(SHEETS.LOGS, [{
      '時間': now,
      '動作': '還原',
      '報名ID': log['報名ID'],
      '內容摘要': '還原「' + log['動作'] + '」：' + log['內容摘要'] + (warnings.length ? '（警告：' + warnings.join('；') + '）' : ''),
      '還原用的前一版資料': JSON.stringify({ logRow: log._row, action: log['動作'] })
    }]);
    SpreadsheetApp.flush();

    return {
      warnings: warnings,
      affected: touched.map(function (r) { return { signupId: r['報名ID'], dutyId: r['勤務ID'], date: r['日期'], status: r['狀態'] }; })
    };
  });
}

/** 恢復一筆報名時，檢查名額與同日重複（只產生警告，不擋） */
function restoreWarnings_(row, duties, positions, signups) {
  var duty = findById_(duties, '勤務ID', row['勤務ID']);
  if (!duty) return ['找不到勤務資料'];
  var errors = validateSignup_({
    duty: duty,
    positions: positions.filter(function (p) { return p['勤務ID'] === duty['勤務ID']; }),
    signups: signups.filter(function (s) { return s['勤務ID'] === duty['勤務ID'] && s['報名ID'] !== row['報名ID']; }),
    positionId: row['了愿項目ID'],
    dates: [row['日期']],
    entries: [{ name: row['姓名'], identity: row['身分'] || '道親', accompany: row['陪同'] === '是' }],
    today: '0000-00-00' // 管理者還原不受「已過去」限制
  });
  return errors.map(function (e) { return (e.name ? e.name + '：' : '') + e.message; });
}

/** 指定日期的名單（明日名單用）：當天所有勤務、各了愿項目的名字；公告型附輪值組（不含電話） */
function adminDay_(body) {
  var date = body.date;
  if (!isDateString_(date)) throw new ApiError_('BAD_REQUEST', '日期格式錯誤');
  var events = getEvents_({ from: date, to: date });
  var signupsByDuty = groupBy_(activeSignups_().filter(function (s) { return s['日期'] === date; }), '勤務ID');
  return {
    date: date,
    duties: events.duties.map(function (d) {
      var rows = signupsByDuty[d.id] || [];
      return {
        id: d.id,
        name: d.name,
        mode: d.mode,
        start: d.start,
        end: d.end,
        startTime: d.startTime,
        endTime: d.endTime,
        location: d.location,
        group: d.group,
        groupInfo: d.mode === '公告型' ? findGroup_(d.groupType, d.group) : null,
        positions: d.positions.map(function (p) {
          return {
            name: p.name,
            min: p.min,
            max: p.max,
            people: rows.filter(function (s) { return s['了愿項目ID'] === p.id; }).map(function (s) {
              return { name: s['姓名'], accompany: s['陪同'] === '是' };
            })
          };
        })
      };
    })
  };
}

/** 管理 API 分派：除了登入，都要先驗證通行碼 */
function adminDispatch_(body) {
  if (body.action === 'adminLogin') return adminLogin_(body);
  requireAdmin_(body);
  switch (body.action) {
    case 'adminLogout': return adminLogout_(body);
    case 'adminRecent': return adminRecent_(body);
    case 'adminDuty': return adminDuty_(body);
    case 'adminCancel': return cancelSignup_(body, { admin: true });
    case 'adminReschedule': return rescheduleSignup_(body, { admin: true });
    case 'adminLogs': return adminLogs_(body);
    case 'adminRestore': return adminRestore_(body);
    case 'adminDay': return adminDay_(body);
    default: throw new ApiError_('BAD_REQUEST', '未知的 action：' + body.action);
  }
}
