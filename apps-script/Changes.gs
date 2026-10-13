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

/**
 * 大張職司表拖曳調整（大家都可以，規則同自己改期）：body = { signupId, date, positionId, swapId? }
 *   - 拖到空格：這筆改到那天、那個項目；拖到有人的格子（swapId）：兩筆互換日期與項目。
 *   - 原本那筆直接改（註記、組長、佛堂都保留）；當天（含）以前不能動；名額、同日重複照報名規則。
 *   - 操作紀錄「調整職司」，還原用的前一版資料 { moves: [{ id, date, positionId }] }。
 */
function gridMove_(body, opts) {
  opts = opts || {};
  var duties = readTableCached_(SHEETS.DUTIES);
  var positions = readTableCached_(SHEETS.POSITIONS);
  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var a = findActiveSignup_(signups, body.signupId);
    var duty = findById_(duties, '勤務ID', a['勤務ID']);
    if (!duty || duty['版面'] !== '職司表') throw new ApiError_('BAD_REQUEST', '只有職司表可以拖曳調整');
    var dutyPositions = positions.filter(function (p) { return p['勤務ID'] === duty['勤務ID']; });
    var toPos = dutyPositions.filter(function (p) { return p['了愿項目ID'] === body.positionId; })[0];
    if (!toPos || !isDateString_(body.date) || body.date < duty['開始日'] || body.date > (duty['結束日'] || duty['開始日'])) throw new ApiError_('BAD_REQUEST', '放的位置不在這個勤務裡');
    var today = todayString_();
    var b = body.swapId ? findActiveSignup_(signups, body.swapId) : null;
    if (b && b['勤務ID'] !== a['勤務ID']) throw new ApiError_('BAD_REQUEST', '只能和同一個勤務的人互換');
    if (b && (b['日期'] !== body.date || b['了愿項目ID'] !== body.positionId)) throw new ApiError_('CONFLICT', '名單剛剛有變動，請重新整理再拖一次');
    [a['日期'], body.date].forEach(function (d) {
      if (!opts.admin && !canSelfChange_(d, today)) throw new ApiError_('FORBIDDEN', Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) + ' 已經是當天或過了，不能自己調整，請聯絡管理者');
    });
    if (!b && a['日期'] === body.date && a['了愿項目ID'] === body.positionId) throw new ApiError_('BAD_REQUEST', '位置沒有變');
    gridLockCheck_(duty, opts);
    var multi = duty['可兼任'] === '是';
    var who = function (s) { return normalizeName_(s['姓名']) + '|' + (s['佛堂'] || ''); };
    var others = signups.filter(function (s) { return s['勤務ID'] === duty['勤務ID'] && s['狀態'] !== '已取消' && s !== a && s !== b; });
    var errors = [];
    // 同一天重複：不可兼任＝那天已經有報；可兼任＝那天同一個項目已經有報
    var dupCheck = function (s, date, pid) {
      var dup = others.filter(function (o) { return who(o) === who(s) && o['日期'] === date && (!multi || o['了愿項目ID'] === pid); })[0];
      if (dup) errors.push(s['姓名'] + ' 在 ' + Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10)) + ' 已經有報名了');
    };
    dupCheck(a, body.date, body.positionId);
    if (b) dupCheck(b, a['日期'], a['了愿項目ID']);
    if (!b && a['陪同'] !== '是') {
      var max = parseLimit_(toPos['最多']);
      var count = others.filter(function (o) { return o['日期'] === body.date && o['了愿項目ID'] === body.positionId && countsTowardQuota_(o); }).length;
      if (max !== null && count >= max) errors.push(toPos['了愿項目名稱'] + ' 那天已經額滿了');
    }
    if (errors.length) throw new ApiError_('VALIDATION', '沒有調整，請看下面的說明', errors.map(function (m) { return { message: m }; }));
    var now = nowString_();
    var moves = [{ id: a['報名ID'], date: a['日期'], positionId: a['了愿項目ID'] }];
    var posName = function (id) { var x = dutyPositions.filter(function (q) { return q['了愿項目ID'] === id; })[0]; return x ? x['了愿項目名稱'] : ''; };
    var md = function (d) { return Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)); };
    var summary;
    if (b) {
      moves.push({ id: b['報名ID'], date: b['日期'], positionId: b['了愿項目ID'] });
      updateRow_(SHEETS.SIGNUPS, a, { '日期': b['日期'], '了愿項目ID': b['了愿項目ID'], '更新時間': now });
      updateRow_(SHEETS.SIGNUPS, b, { '日期': moves[0].date, '了愿項目ID': moves[0].positionId, '更新時間': now });
      summary = a['姓名'] + '（' + md(moves[0].date) + ' ' + posName(moves[0].positionId) + '）和 ' + b['姓名'] + '（' + md(moves[1].date) + ' ' + posName(moves[1].positionId) + '）互換';
    } else {
      updateRow_(SHEETS.SIGNUPS, a, { '日期': body.date, '了愿項目ID': body.positionId, '更新時間': now });
      summary = a['姓名'] + '：' + md(moves[0].date) + ' ' + posName(moves[0].positionId) + ' → ' + md(body.date) + ' ' + posName(body.positionId);
    }
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '調整職司', '報名ID': a['報名ID'], '內容摘要': duty['名稱'] + '｜' + summary + (opts.admin ? adminTag_() : '（職司表拖曳）'),
      '還原用的前一版資料': JSON.stringify({ moves: moves }) }]);
    notifyGridLeaders_(duty, moves.map(function (mv) { return mv.date; }).concat([body.date]).filter(function (d, i, arr) { return arr.indexOf(d) === i; }), summary);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { ok: true };
  });
}

/** 大張職司表點名字改註記（大家都可以）：body = { signupId, note }；今天以後的都可以，當天也可以 */
function gridNote_(body, opts) {
  var note = cleanText_(body.note).replace(/\s*\n\s*/g, ' ');
  if (note.length > 100) throw new ApiError_('BAD_REQUEST', '註記最多 100 字');
  var duties = readTableCached_(SHEETS.DUTIES);
  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    var duty = findById_(duties, '勤務ID', row['勤務ID']);
    if (!duty || duty['版面'] !== '職司表') throw new ApiError_('BAD_REQUEST', '這個勤務沒有註記');
    if (!(opts && opts.admin) && row['日期'] < todayString_()) throw new ApiError_('FORBIDDEN', '已經過了的不能改註記');
    gridLockCheck_(duty, opts);
    var now = nowString_();
    var before = row['註記'] || '';
    updateRow_(SHEETS.SIGNUPS, row, { '註記': note, '更新時間': now });
    notifyGridLeaders_(duty, [row['日期']], row['姓名'] + ' ' + Number(row['日期'].slice(5, 7)) + '/' + Number(row['日期'].slice(8, 10)) + '：' + (note ? '註記改成「' + note + '」' : '刪除註記'));
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修正', '報名ID': row['報名ID'],
      '內容摘要': [row['姓名'], row['日期'], duty['名稱']].join('｜') + '｜' + (note ? '註記：' + note : '刪除註記') + '（職司表' + (opts && opts.admin ? adminTag_() : '') + '）',
      '還原用的前一版資料': JSON.stringify({ '註記': before }) }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { signupId: row['報名ID'], note: note };
  });
}

/**
 * 職司表的定案日：階段最後一段的日期（自己填階段時取最後一個日期；沒填＝輪值第一天之前的禮拜一）。
 * 過了這天，家人們不能再拖曳、改註記（管理者可以）。
 */
function gridLockDate_(duty) {
  var start = duty['開始日'];
  if (!isDateString_(start)) return '';
  var text = String(duty['階段'] || '').trim();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  if (text) {
    var all = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/g);
    if (all && all.length) {
      var m = all[all.length - 1].split('/').map(function (x) { return Number(x.trim()); });
      var sy = Number(start.slice(0, 4));
      var sm = Number(start.slice(5, 7));
      var y = m[0] - sm > 6 ? sy - 1 : sm - m[0] > 6 ? sy + 1 : sy;
      return y + '-' + pad(m[0]) + '-' + pad(m[1]);
    }
  }
  var d = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)) - 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function gridLockCheck_(duty, opts) {
  if (opts && opts.admin) return;
  var lock = gridLockDate_(duty);
  if (lock && todayString_() > lock) throw new ApiError_('FORBIDDEN', '職司已在 ' + Number(lock.slice(5, 7)) + '/' + Number(lock.slice(8, 10)) + ' 定案，之後要調整請聯絡管理者');
}

/** 職司表有調整：通知那幾天的組長（手機有開提醒、填了名字的） */
function notifyGridLeaders_(duty, dates, text) {
  var leaders = {};
  activeSignups_().forEach(function (s) {
    if (s['勤務ID'] === duty['勤務ID'] && dates.indexOf(s['日期']) !== -1 && s['組長'] === '是') leaders[normalizeName_(s['姓名'])] = true;
  });
  var names = Object.keys(leaders);
  if (!names.length) return;
  var devices = readTable_(SHEETS.PUSH).filter(function (r) { return r['啟用'] !== '否' && r['端點'] && leaders[normalizeName_(r['名字'] || '')]; });
  if (!devices.length) return;
  pushMessageTo_(devices, '📋 職司有調整（' + duty['名稱'] + '）', text, '#/grid/' + encodeURIComponent(duty['勤務ID']));
}
