/**
 * 報名 API。
 * 用 LockService 鎖住「讀取 → 檢查 → 寫入」整段，避免兩人同時搶最後一個名額造成超收。
 * 任何一筆有錯，整批都不寫入。
 */

var MAX_ENTRIES_PER_SIGNUP = 20;
var MAX_DATES_PER_SIGNUP = 31;

/**
 * body = { dutyId, positionId | positionIds: [..]（可兼任的勤務可多個）, dates: ['yyyy-MM-dd'], entries: [{ name, identity, accompany }] }
 */
function signup_(body) {
  var dates = uniqueList_(body.dates);
  var entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length > MAX_ENTRIES_PER_SIGNUP) {
    throw new ApiError_('BAD_REQUEST', '一次最多報名 ' + MAX_ENTRIES_PER_SIGNUP + ' 人');
  }
  if (dates.length > MAX_DATES_PER_SIGNUP) {
    throw new ApiError_('BAD_REQUEST', '一次最多選 ' + MAX_DATES_PER_SIGNUP + ' 天');
  }

  // 勤務與了愿項目在報名過程中不會變動，在排隊前先讀，縮短每筆佔用鎖的時間（壓力測試：每筆約 0.9 秒）
  // 成員名單上已登記身分的人，一律以名單為準（報名者不能改，統計才一致）
  entries = withMemberIdentity_(entries);

  var duty = readTableCached_(SHEETS.DUTIES).filter(function (d) { return d['勤務ID'] === body.dutyId; })[0];
  var positions = duty ? readTableCached_(SHEETS.POSITIONS).filter(function (p) { return p['勤務ID'] === duty['勤務ID']; }) : [];

  // 同時報名的人多時要排隊；最多等 30 秒，等不到就回 BUSY（確定沒寫入，前端會自動重試）
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new ApiError_('BUSY', '目前報名的人較多，請稍後再試一次');
  }
  try {
    var signups = duty ? readTable_(SHEETS.SIGNUPS).filter(function (s) { return s['勤務ID'] === duty['勤務ID']; }) : [];

    // 每個名字可以各自選了愿項目（entry.positionIds），沒選的用整批的 positionIds／positionId。
    // 可兼任的勤務每人可以報好幾項；其他勤務每人只能一項（不同人可以不同項）。
    var defaults = uniqueList_(Array.isArray(body.positionIds) && body.positionIds.length ? body.positionIds : [body.positionId]);
    var multi = !!(duty && duty['可兼任'] === '是');
    var entryPids = entries.map(function (e) {
      return uniqueList_(e && Array.isArray(e.positionIds) && e.positionIds.length ? e.positionIds : defaults);
    });
    if (entryPids.some(function (p) { return p.length > 1; }) && !multi) {
      throw new ApiError_('BAD_REQUEST', '這個勤務一次只能報一個了愿項目');
    }
    // 依勤務裡的項目順序處理；每個項目只檢查報這一項的人
    var positionIds = positions.map(function (p) { return p['了愿項目ID']; })
      .filter(function (id) { return entryPids.some(function (p) { return p.indexOf(id) !== -1; }); });
    entryPids.forEach(function (p) { p.forEach(function (id) { if (positionIds.indexOf(id) === -1) positionIds.push(id); }); });
    var now = nowString_();
    var signupRows = [];
    var logRows = [];
    var created = [];
    var errors = [];
    positionIds.forEach(function (pid) {
      var group = entries.filter(function (e, i) { return entryPids[i].indexOf(pid) !== -1; });
      // 前面幾個項目這次要新增的也算進去（名額、重複檢查才正確）
      var errs = validateSignup_({
        duty: duty,
        positions: positions,
        signups: signups.concat(signupRows),
        positionId: pid,
        dates: dates,
        entries: group,
        today: todayString_()
      });
      var position = positions.filter(function (p) { return p['了愿項目ID'] === pid; })[0];
      if (positionIds.length > 1 && position) {
        errs.forEach(function (e) { e.message = '「' + position['了愿項目名稱'] + '」' + e.message; });
      }
      errors = errors.concat(errs);
      if (errs.length || !position) return;

      dates.forEach(function (date) {
        group.forEach(function (e) {
          var name = normalizeName_(e.name);
          var accompany = !!e.accompany;
          var id = newId_('S');
          var row = {
            '報名ID': id,
            '勤務ID': duty['勤務ID'],
            '日期': date,
            '了愿項目ID': position['了愿項目ID'],
            '姓名': name,
            '身分': e.identity,
            '陪同': accompany ? '是' : '否',
            '出席': '出席',
            '狀態': '有效',
            '建立時間': now,
            '更新時間': now
          };
          signupRows.push(row);
          logRows.push({
            '時間': now,
            '動作': '報名',
            '報名ID': id,
            '內容摘要': [name + '（' + e.identity + (accompany ? '・陪同' : '') + '）', date, duty['名稱'], position['了愿項目名稱']].join('｜'),
            '還原用的前一版資料': ''
          });
          created.push({ id: id, date: date, name: name, identity: e.identity, accompany: accompany, positionId: position['了愿項目ID'] });
        });
      });
    });
    if (errors.length) {
      throw new ApiError_('VALIDATION', '報名沒有完成，請看下面的說明', errors);
    }

    appendRows_(SHEETS.SIGNUPS, signupRows);
    appendRows_(SHEETS.LOGS, logRows);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);

    var all = signups.concat(signupRows);
    return {
      created: created,
      days: daysStatus_(duty, positions, all.filter(function (s) { return s['狀態'] !== '已取消'; }), dates)
    };
  } finally {
    lock.releaseLock();
  }
}

function uniqueList_(list) {
  var seen = {};
  return (Array.isArray(list) ? list : []).map(String).filter(function (x) {
    if (seen[x]) return false;
    seen[x] = true;
    return true;
  });
}

/** 報名的每個名字：成員名單（啟用中）上完全同名且有登記身分的，身分改用名單上的 */
function withMemberIdentity_(entries) {
  var map = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (m['啟用中'] !== '否' && OPTIONS.identity.indexOf(m['身分']) !== -1) map[normalizeName_(m['姓名'])] = m['身分'];
  });
  return entries.map(function (e) {
    var fixed = map[normalizeName_(e && e.name)];
    return fixed ? Object.assign({}, e, { identity: fixed }) : e;
  });
}
