/**
 * 出席修正（規格第 8 節管理者後台第 4 項）。
 *   - 預設「報名＝出席」；管理者可改「未到」、改「陪同」、補登沒報名但有來的人。
 *   - 補登不受「當天（含）之後不能報名」限制，名額與同日重複只警告不擋（管理者有最終決定權）。
 *   - 每次都寫入操作紀錄（動作「修正」，留前一版資料，不提供還原）。
 */

/** body = { signupId, attend?: '出席'|'未到', accompany?: true|false } */
function adminSetAttendance_(body) {
  var changes = {};
  if (body.attend !== undefined) {
    if (OPTIONS.attendance.indexOf(body.attend) === -1) throw new ApiError_('BAD_REQUEST', '出席只能是出席或未到');
    changes['出席'] = body.attend;
  }
  if (body.accompany !== undefined) changes['陪同'] = body.accompany ? '是' : '否';
  // 職司表：組長 ★、註記（家人們看得到）
  if (body.leader !== undefined) changes['組長'] = body.leader ? '是' : '';
  if (body.note !== undefined) {
    changes['註記'] = cleanText_(body.note).replace(/\s*\n\s*/g, ' ');
    if (changes['註記'].length > 100) throw new ApiError_('BAD_REQUEST', '註記最多 100 字');
  }
  if (!Object.keys(changes).length) throw new ApiError_('BAD_REQUEST', '沒有要修改的內容');

  var duties = readTableCached_(SHEETS.DUTIES);
  var positions = readTableCached_(SHEETS.POSITIONS);
  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    if (changes['陪同'] === '是' && row['身分'] !== '壇辦') throw new ApiError_('BAD_REQUEST', '只有壇辦可以改成陪同');
    var before = rowSnapshot_(SHEETS.SIGNUPS, row);
    var now = nowString_();
    changes['更新時間'] = now;
    updateRow_(SHEETS.SIGNUPS, row, changes);
    var what = [];
    if (changes['出席'] && changes['出席'] !== before['出席']) what.push('改為' + changes['出席']);
    if (changes['陪同'] && changes['陪同'] !== before['陪同']) what.push(changes['陪同'] === '是' ? '改為陪同' : '改為了愿');
    if (changes['組長'] !== undefined && changes['組長'] !== (before['組長'] || '')) what.push(changes['組長'] ? '設為組長' : '取消組長');
    if (changes['註記'] !== undefined && changes['註記'] !== (before['註記'] || '')) what.push(changes['註記'] ? '註記：' + changes['註記'] : '刪除註記');
    appendRows_(SHEETS.LOGS, [{
      '時間': now,
      '動作': '修正',
      '報名ID': row['報名ID'],
      '內容摘要': signupSummary_(row, findById_(duties, '勤務ID', row['勤務ID']), findById_(positions, '了愿項目ID', row['了愿項目ID'])) +
        '｜' + (what.join('、') || '沒有變更'),
      '還原用的前一版資料': JSON.stringify(before)
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { signupId: row['報名ID'], attend: row['出席'], accompany: row['陪同'] === '是' };
  });
}

/**
 * body = { dutyId, positionId, date, name, identity, accompany, note }：管理者加人，直接記為出席。
 * 當天與過去＝補登（沒報名但有來）；未來＝管理者幫人報名（不受截止日、當天不能報的限制）。note：職司表的註記。
 */
function adminAddAttendee_(body) {
  var duty = findById_(readTableCached_(SHEETS.DUTIES), '勤務ID', body.dutyId);
  var positions = duty ? readTableCached_(SHEETS.POSITIONS).filter(function (p) { return p['勤務ID'] === duty['勤務ID']; }) : [];
  return withSignupLock_(function () {
    var signups = duty ? readTable_(SHEETS.SIGNUPS).filter(function (s) { return s['勤務ID'] === duty['勤務ID']; }) : [];
    var entry = { name: body.name, identity: body.identity, accompany: !!body.accompany };
    var problems = validateSignup_({
      duty: duty, positions: positions, signups: signups, positionId: body.positionId,
      dates: [body.date], entries: [entry], today: '0000-00-00' // 補登不受日期限制
    });
    // 資料本身的錯（找不到勤務、沒填名字、身分⋯）要擋；名額、同日重複只警告
    var blocking = problems.filter(function (e) { return !/額滿|名額|同一勤務同一天/.test(e.message); });
    if (blocking.length) throw new ApiError_('VALIDATION', '沒有補登，請看下面的說明', blocking);
    var warnings = problems.filter(function (e) { return blocking.indexOf(e) === -1; }).map(function (e) { return e.message; });

    var position = findById_(positions, '了愿項目ID', body.positionId);
    var now = nowString_();
    var row = {
      '報名ID': newId_('S'), '勤務ID': duty['勤務ID'], '日期': body.date, '了愿項目ID': body.positionId,
      '姓名': normalizeName_(body.name), '身分': body.identity, '陪同': entry.accompany ? '是' : '否',
      '出席': '出席', '狀態': '有效', '建立時間': now, '更新時間': now
    };
    if (duty['版面'] === '職司表' && body.note) row['註記'] = cleanText_(body.note).slice(0, 100);
    appendRows_(SHEETS.SIGNUPS, [row]);
    appendRows_(SHEETS.LOGS, [{
      '時間': now, '動作': '修正', '報名ID': row['報名ID'],
      '內容摘要': signupSummary_(row, duty, position) + (body.date > todayString_() ? '｜管理者幫人報名' : '｜補登') + (warnings.length ? '（警告：' + warnings.join('；') + '）' : ''),
      '還原用的前一版資料': ''
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { signupId: row['報名ID'], warnings: warnings };
  });
}
