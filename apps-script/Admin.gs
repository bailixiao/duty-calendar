/**
 * 管理後台 API（規格第 8 節管理者後台、第 7 節第 7 條還原）。
 *   - 登入：帳號＋密碼（帳號與權限見 Accounts.gs；總管理者沿用 ADMIN_PASSWORD）。成功後發一組通行碼（存在 CacheService，6 小時），
 *     通行碼記著是哪個帳號、什麼角色。
 *   - 每個帳號一次只能一台裝置登入：最新一次登入的通行碼記在 Script Properties（總管理者 ADMIN_CURRENT_TOKEN，
 *     其他帳號 ADMIN_CURRENT_TOKEN:帳號），同帳號其他裝置舊的通行碼就失效（畫面會自動登出並說明原因）。
 *   - 密碼連續錯 10 次鎖 10 分鐘（Apps Script 取不到來源 IP，以全域次數計算）。
 *   - 所有管理 API 都用 POST，通行碼放在內容（不放網址）。
 *   - 組長電話只在這裡回傳。
 */

var ADMIN_TOKEN_TTL_SEC = 21600; // 6 小時（CacheService 上限）
var ADMIN_MAX_FAILS = 10;
var ADMIN_LOCK_SEC = 600;
var RESTORABLE_ACTIONS = ['報名', '取消', '改期'];

function adminLogin_(body) {
  var who = checkLogin_(body.account, body.password);
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('admin-token:' + token, JSON.stringify(who), ADMIN_TOKEN_TTL_SEC);
  PropertiesService.getScriptProperties().setProperty(currentTokenKey_(who.account), token);
  return { token: token, expiresInSec: ADMIN_TOKEN_TTL_SEC, account: who.account, role: who.role };
}

function adminLogout_(body) {
  if (body.token) {
    CacheService.getScriptCache().remove('admin-token:' + body.token);
    var props = PropertiesService.getScriptProperties();
    var key = currentTokenKey_(ADMIN_SESSION_ ? ADMIN_SESSION_.account : SUPER_ACCOUNT);
    if (props.getProperty(key) === body.token) props.deleteProperty(key);
  }
  return {};
}

/** 驗證通行碼，回傳 { account, role }（舊版通行碼沒有帳號資訊的，視為總管理者） */
function requireAdmin_(body) {
  var token = String(body.token || '');
  var raw = token ? CacheService.getScriptCache().get('admin-token:' + token) : null;
  if (!raw) throw new ApiError_('UNAUTHORIZED', '登入已過期，請重新登入');
  var who;
  try { who = raw === '1' ? null : JSON.parse(raw); } catch (e) { who = null; }
  who = who && who.account ? who : { account: SUPER_ACCOUNT, role: SUPER_ACCOUNT };
  var current = PropertiesService.getScriptProperties().getProperty(currentTokenKey_(who.account));
  if (current && current !== token) {
    throw new ApiError_('UNAUTHORIZED', /^revoked-/.test(current) ? '帳號設定已變更，請重新登入' : '管理後台已在其他裝置登入，這台已自動登出');
  }
  if (who.account !== SUPER_ACCOUNT) {
    var row = accountRows_().filter(function (r) { return r['帳號'] === who.account; })[0];
    if (!row || row['啟用'] === '否') throw new ApiError_('UNAUTHORIZED', '這個帳號已停用，請聯絡總管理者');
  }
  return who;
}

/** 近期勤務：今天起 N 天（預設 14） */
function adminRecent_(body) {
  var days = Math.min(Math.max(Number(body.days) || 14, 1), 60);
  var today = todayString_();
  return getEvents_({ from: today, to: datesInRange_(today, '9999-12-31').slice(0, days).pop() });
}

/** 勤務名單（管理用）：比一般詳情多了身分、報名時間、出席、負責組組長電話 */
function adminDuty_(body) {
  var data = getDuty_({ id: body.id });
  var byId = {};
  readTableCached_(SHEETS.SIGNUPS).forEach(function (s) { byId[s['報名ID']] = s; });
  data.signups.forEach(function (s) {
    var row = byId[s.id] || {};
    s.identity = row['身分'] || '';
    s.createdAt = row['建立時間'] || '';
    s.attend = row['出席'] || '出席';
  });
  data.groupContact = adminGroupContact_(data.groupType, data.group);
  return data;
}

function adminGroupContact_(groupType, groupName) {
  if (!groupType || !groupName) return null;
  var g = readTableCached_(SHEETS.GROUPS).filter(function (x) {
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
  // 搜尋：q（名字、勤務、內容）、kind（動作）、from／to（日期 yyyy-MM-dd）
  var q = String(body.q || '').replace(/[\s　]+/g, '');
  var kind = cleanText_(body.kind);
  var from = isDateString_(body.from) ? body.from : '';
  var to = isDateString_(body.to) ? body.to : '';
  var actions = [];
  logs.forEach(function (l) { if (l['動作'] && actions.indexOf(l['動作']) === -1) actions.push(l['動作']); });
  if (q || kind || from || to) {
    logs = logs.filter(function (l) {
      var day = String(l['時間']).slice(0, 10);
      if (kind && l['動作'] !== kind) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
      return !q || String(l['內容摘要'] || '').replace(/[\s　]+/g, '').indexOf(q) !== -1 || String(l['動作']).indexOf(q) !== -1;
    });
  }
  return {
    actions: actions,
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
  var duties = readTableCached_(SHEETS.DUTIES);
  var positions = readTableCached_(SHEETS.POSITIONS);

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
    invalidateTable_(SHEETS.SIGNUPS);

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
        category: d.category,
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

/**
 * 名單（後台「名單」分頁）：今天起一個月，每天有人報名的勤務與名字（不分了愿項目、同名只列一次，依報名順序）。
 * 回傳 { today, days: [{ date, duties: [{ id, name, category, names }] }] }；類別帳號由 adminScope_ 只留自己類別。
 */
var ROSTER_DAYS = 31;

/** yyyy-MM-dd 加幾天 */
function addDaysStr_(date, n) {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);
}

function adminRoster_() {
  var today = todayString_();
  var to = addDaysStr_(today, ROSTER_DAYS - 1);
  var events = getEvents_({ from: today, to: to });
  var byDuty = {};
  events.duties.forEach(function (d) { byDuty[d.id] = d; });
  var rows = activeSignups_().filter(function (s) { return s['日期'] >= today && s['日期'] <= to && byDuty[s['勤務ID']]; })
    .sort(function (a, b) { return String(a['建立時間']).localeCompare(String(b['建立時間'])); });
  var days = {};
  rows.forEach(function (s) {
    var date = s['日期'];
    var d = byDuty[s['勤務ID']];
    if (!days[date]) days[date] = {};
    if (!days[date][d.id]) days[date][d.id] = { id: d.id, name: d.name, category: d.category, startTime: d.startTime, names: [] };
    var list = days[date][d.id].names;
    if (list.indexOf(s['姓名']) === -1) list.push(s['姓名']);
  });
  return {
    today: today,
    days: Object.keys(days).sort().map(function (date) {
      return { date: date, duties: Object.keys(days[date]).map(function (k) { return days[date][k]; })
        .sort(function (a, b) { return String(a.startTime || '').localeCompare(String(b.startTime || '')); }) };
    })
  };
}

/** 管理 API 分派：除了登入，都要先驗證通行碼 */
function adminDispatch_(body) {
  if (body.action === 'adminLogin') return adminLogin_(body);
  var session = requireAdmin_(body);
  ADMIN_SESSION_ = session;
  adminAuthorize_(session, body);
  return adminScope_(session, body.action, adminRun_(body));
}

function adminRun_(body) {
  switch (body.action) {
    case 'adminMe': return { account: ADMIN_SESSION_.account, role: ADMIN_SESSION_.role };
    case 'adminAccounts': return adminAccounts_(body);
    case 'adminSaveAccount': return adminSaveAccount_(body);
    case 'adminLogout': return adminLogout_(body);
    case 'adminPing': return {};
    case 'adminDraftFromImages': return adminDraftFromImages_(body);
    case 'adminRecent': return adminRecent_(body);
    case 'adminDuty': return adminDuty_(body);
    case 'adminCancel': return cancelSignup_(body, { admin: true });
    case 'adminReschedule': return rescheduleSignup_(body, { admin: true });
    case 'adminLogs': return adminLogs_(body);
    case 'adminRestore': return adminRestore_(body);
    case 'adminDay': return adminDay_(body);
    case 'adminRoster': return adminRoster_(body);
    case 'adminVenueWatch': return adminVenueWatch_(body);
    case 'adminFaq': return adminFaq_(body);
    case 'adminFaqSave': return adminFaqSave_(body);
    case 'adminFaqDelete': return adminFaqDelete_(body);
    case 'adminFaqMove': return adminFaqMove_(body);
    case 'adminPushList': return adminPushList_(body);
    case 'adminPushSave': return adminPushSave_(body);
    case 'adminPushDelete': return adminPushDelete_(body);
    case 'adminAutoPushSave': return adminAutoPushSave_(body);
    case 'adminSystemWatch': return adminSystemWatch_(body);
    case 'adminRollcallLink': return adminRollcallLink_(body);
    case 'adminImportAttendance': return adminImportAttendance_(body);
    case 'adminRepairs': return adminRepairs_(body);
    case 'adminSetMemberExtra': return adminSetMemberExtra_(body);
    case 'adminSplitSignup': return adminSplitSignup_(body);
    case 'adminMergeMembers': return adminMergeMembers_(body);
    case 'adminImportMembers': return adminImportMembers_(body);
    case 'adminSameNameSignups': return adminSameNameSignups_();
    case 'adminAssignSignupTemple': return adminAssignSignupTemple_(body);
    case 'adminRepairUpdate': return adminRepairUpdate_(body);
    case 'adminConfirmMembers': return adminConfirmMembers_(body);
    case 'adminMergePendingMember': return adminMergePendingMember_(body);
    case 'adminDutyList': return adminDutyList_(body);
    case 'adminDutyForEdit': return adminDutyForEdit_(body);
    case 'adminCreateDuties': return adminCreateDuties_(body);
    case 'adminUpdateDuty': return adminUpdateDuty_(body);
    case 'adminDeleteDuty': return adminDeleteDuty_(body);
    case 'adminSetAttendance': return adminSetAttendance_(body);
    case 'adminSetTeachers': return adminSetTeachers_(body);
    case 'adminGoals': return adminGoals_(body);
    case 'adminVenue': return adminVenue_(body);
    case 'adminVenueDecide': return adminVenueDecide_(body);
    case 'adminSaveGoals': return adminSaveGoals_(body);
    case 'adminAddAttendee': return adminAddAttendee_(body);
    case 'adminStats': return adminStats_(body);
    case 'adminImportHistory': return adminImportHistory_(body);
    case 'adminUpdateStatsSheet': return adminUpdateStatsSheet_(body);
    case 'adminMembers': return adminMembers_(body);
    case 'adminSaveMember': return adminSaveMember_(body);
    case 'adminDeleteMember': return adminDeleteMember_(body);
    case 'adminMemberCandidates': return adminMemberCandidates_(body);
    case 'adminAddMembers': return adminAddMembers_(body);
    case 'adminMergeNames': return adminMergeNames_(body);
    case 'adminClearCandidates': return adminClearCandidates_(body);
    case 'adminGroups': return adminGroups_(body);
    case 'adminSaveGroup': return adminSaveGroup_(body);
    case 'adminDeleteGroup': return adminDeleteGroup_(body);
    default: throw new ApiError_('BAD_REQUEST', '未知的 action：' + body.action);
  }
}
