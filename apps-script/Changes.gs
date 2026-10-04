/**
 * 取消、改期（規格第 7 節第 5–7 條）。
 *   - 一般使用者：勤務當天（含）之後不能自己取消或改期。管理者（opts.admin）不受此限。
 *   - 改期只能改到「同名勤務」的其他日期，可換了愿項目；新日期與一般報名一樣檢查名額、同日重複、是否已過。
 *   - 改期＝原報名改為已取消＋建立一筆新報名，在同一次鎖定內完成；新日期不能報就整筆不動。
 *   - 每次都寫入操作紀錄（含還原用的前一版資料）。
 */

/** body = { signupId } */
function cancelSignup_(body, opts) {
  opts = opts || {};
  var duties = readTableCached_(SHEETS.DUTIES);
  var positions = readTableCached_(SHEETS.POSITIONS);

  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    if (!opts.admin && !canSelfChange_(row['日期'], todayString_())) {
      throw new ApiError_('FORBIDDEN', '勤務當天（含）之後不能自己取消，請聯絡管理者');
    }
    var duty = findById_(duties, '勤務ID', row['勤務ID']);
    var position = findById_(positions, '了愿項目ID', row['了愿項目ID']);
    var before = rowSnapshot_(SHEETS.SIGNUPS, row);
    var now = nowString_();

    updateRow_(SHEETS.SIGNUPS, row, { '狀態': '已取消', '更新時間': now });
    appendRows_(SHEETS.LOGS, [{
      '時間': now,
      '動作': '取消',
      '報名ID': row['報名ID'],
      '內容摘要': signupSummary_(row, duty, position) + (opts.admin ? adminTag_() : ''),
      '還原用的前一版資料': JSON.stringify(before)
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);

    return {
      signupId: row['報名ID'],
      dutyId: row['勤務ID'],
      date: row['日期'],
      days: dutyDays_(duty, positions, signups, [row['日期']])
    };
  });
}

/** body = { signupId, dutyId, date, positionId }：目標勤務（須與原勤務同名）、日期、了愿項目 */
function rescheduleSignup_(body, opts) {
  opts = opts || {};
  var duties = readTableCached_(SHEETS.DUTIES);
  var positions = readTableCached_(SHEETS.POSITIONS);

  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    var today = todayString_();
    if (!opts.admin && !canSelfChange_(row['日期'], today)) {
      throw new ApiError_('FORBIDDEN', '勤務當天（含）之後不能自己改期，請聯絡管理者');
    }

    var fromDuty = findById_(duties, '勤務ID', row['勤務ID']);
    var toDuty = findById_(duties, '勤務ID', body.dutyId);
    if (fromDuty && fromDuty['性質'] === '活動') {
      throw new ApiError_('FORBIDDEN', '活動不能個別改期；活動本身改日期時，名單會一起移過去');
    }
    if (!toDuty || !fromDuty || toDuty['名稱'] !== fromDuty['名稱']) {
      throw new ApiError_('BAD_REQUEST', '只能改到同一個勤務的其他日期');
    }
    if (toDuty['勤務ID'] === row['勤務ID'] && body.date === row['日期'] && body.positionId === row['了愿項目ID']) {
      throw new ApiError_('BAD_REQUEST', '日期和了愿項目都沒有變更');
    }

    var toPositions = positions.filter(function (p) { return p['勤務ID'] === toDuty['勤務ID']; });
    // 檢查新日期時排除原本這筆（例如同一天只換了愿項目，不算重複）
    var toSignups = signups.filter(function (s) {
      return s['勤務ID'] === toDuty['勤務ID'] && s['報名ID'] !== row['報名ID'];
    });
    var errors = validateSignup_({
      duty: toDuty,
      positions: toPositions,
      signups: toSignups,
      positionId: body.positionId,
      dates: [body.date],
      entries: [{ name: row['姓名'], identity: row['身分'], accompany: row['陪同'] === '是' }],
      today: today
    });
    if (errors.length) {
      throw new ApiError_('VALIDATION', '改期沒有完成，請看下面的說明', errors);
    }

    var fromPosition = findById_(positions, '了愿項目ID', row['了愿項目ID']);
    var toPosition = findById_(toPositions, '了愿項目ID', body.positionId);
    var before = rowSnapshot_(SHEETS.SIGNUPS, row);
    var now = nowString_();
    var newRow = {
      '報名ID': newId_('S'),
      '勤務ID': toDuty['勤務ID'],
      '日期': body.date,
      '了愿項目ID': body.positionId,
      '姓名': row['姓名'],
      '身分': row['身分'],
      '陪同': row['陪同'],
      '出席': '出席',
      '狀態': '有效',
      '建立時間': now,
      '更新時間': now
    };

    updateRow_(SHEETS.SIGNUPS, row, { '狀態': '已取消', '更新時間': now });
    appendRows_(SHEETS.SIGNUPS, [newRow]);
    appendRows_(SHEETS.LOGS, [{
      '時間': now,
      '動作': '改期',
      '報名ID': newRow['報名ID'],
      '內容摘要': signupSummary_(row, fromDuty, fromPosition) + ' → ' + body.date + '｜' + toPosition['了愿項目名稱'] +
        (opts.admin ? adminTag_() : ''),
      '還原用的前一版資料': JSON.stringify({ from: before, toSignupId: newRow['報名ID'] })
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);

    var all = signups.concat([newRow]);
    return {
      signupId: newRow['報名ID'],
      from: { dutyId: row['勤務ID'], date: row['日期'], days: dutyDays_(fromDuty, positions, all, [row['日期']]) },
      to: { dutyId: toDuty['勤務ID'], date: body.date, days: dutyDays_(toDuty, positions, all, [body.date]) }
    };
  });
}

/**
 * 改期可選的目標：與指定勤務同名、尚未結束的報名型勤務，含明天以後每天的人數狀態（當天不能報名）。
 * params: id（勤務ID）
 */
function getSiblings_(params) {
  var duties = readTableCached_(SHEETS.DUTIES);
  var base = findById_(duties, '勤務ID', params.id);
  if (!base) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
  var today = todayString_();
  var siblings = duties.filter(function (d) {
    return d['名稱'] === base['名稱'] && d['模式'] !== '公告型' && (d['結束日'] || d['開始日']) > today;
  }).sort(function (a, b) { return a['開始日'] < b['開始日'] ? -1 : 1; }).slice(0, 60);

  var positionsByDuty = groupBy_(readTableCached_(SHEETS.POSITIONS), '勤務ID');
  var signupsByDuty = groupBy_(activeSignups_(), '勤務ID');
  return {
    today: today,
    duties: siblings.map(function (d) {
      var positions = positionsByDuty[d['勤務ID']] || [];
      var json = dutyToJson_(d, positions);
      var dates = datesInRange_(d['開始日'], d['結束日']).filter(function (x) { return x > today; });
      json.days = daysStatus_(d, positions, signupsByDuty[d['勤務ID']] || [], dates);
      return json;
    })
  };
}

// ---- 共用 ----

/** 報名相關的寫入一律排隊（同一把鎖），最多等 30 秒 */
function withSignupLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new ApiError_('BUSY', '目前使用的人較多，請稍後再試一次');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function findActiveSignup_(signups, id) {
  var row = findById_(signups, '報名ID', id);
  if (!row) throw new ApiError_('NOT_FOUND', '找不到這筆報名，可能已被刪除');
  if (row['狀態'] === '已取消') throw new ApiError_('ALREADY', '這筆報名已經取消了，請重新整理畫面');
  return row;
}

function findById_(rows, key, id) {
  return rows.filter(function (r) { return r[key] === id; })[0] || null;
}

/** 某勤務某幾天的人數狀態（只算有效報名） */
function dutyDays_(duty, positions, signups, dates) {
  if (!duty) return {};
  var ps = positions.filter(function (p) { return p['勤務ID'] === duty['勤務ID']; });
  var ss = signups.filter(function (s) { return s['勤務ID'] === duty['勤務ID'] && s['狀態'] !== '已取消'; });
  return daysStatus_(duty, ps, ss, dates);
}

/** 操作紀錄的內容摘要：姓名（身分・陪同）｜日期｜勤務｜了愿項目 */
function signupSummary_(row, duty, position) {
  var who = row['姓名'] + '（' + (row['身分'] || '未填身分') + (row['陪同'] === '是' ? '・陪同' : '') + '）';
  return [who, row['日期'], duty ? duty['名稱'] : row['勤務ID'], position ? position['了愿項目名稱'] : row['了愿項目ID']].join('｜');
}
