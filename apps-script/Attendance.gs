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
  // 登記張數的勤務：改張數（1～99）
  if (body.tickets !== undefined) {
    if (!/^\d{1,3}$/.test(String(body.tickets).trim()) || Number(body.tickets) < 1) throw new ApiError_('BAD_REQUEST', '張數請填 1～999');
    changes['張數'] = String(Number(body.tickets));
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
    // 有組長職稱的勤務一天只有一位組長：設新的組長時，同一天原本的取消
    var dutyRow = duties.filter(function (d) { return d['勤務ID'] === row['勤務ID']; })[0];
    if (changes['組長'] === '是' && dutyRow && dutyRow['組長職稱']) {
      signups.filter(function (s) { return s !== row && s['勤務ID'] === row['勤務ID'] && s['日期'] === row['日期'] && s['狀態'] !== '已取消' && s['組長'] === '是'; })
        .forEach(function (s) { updateRow_(SHEETS.SIGNUPS, s, { '組長': '', '更新時間': now }); });
    }
    updateRow_(SHEETS.SIGNUPS, row, changes);
    if (changes['出席'] && row['日期'] <= todayString_()) attendOkMark_([{ dutyId: row['勤務ID'], date: row['日期'] }]); // 看過名單了，算確認出席
    var what = [];
    if (changes['出席'] && changes['出席'] !== before['出席']) what.push('改為' + changes['出席']);
    if (changes['陪同'] && changes['陪同'] !== before['陪同']) what.push(changes['陪同'] === '是' ? '改為陪同' : '改為了愿');
    if (changes['組長'] !== undefined && changes['組長'] !== (before['組長'] || '')) what.push(changes['組長'] ? '設為組長' : '取消組長');
    if (changes['張數'] !== undefined && changes['張數'] !== (before['張數'] || '')) what.push('張數：' + (before['張數'] || '0') + ' → ' + changes['張數']);
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
    // 成員名單上已登記身分的人，以名單為準（和一般報名相同）
    var entry = withMemberIdentity_([{ name: body.name, identity: body.identity, accompany: !!body.accompany, temple: body.temple, noTemple: !!body.noTemple, birth: body.birth }])[0];
    checkAmbiguous_([entry]);
    checkNewcomers_([entry]);
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
      '姓名': normalizeName_(entry.name), '身分': entry.identity, '佛堂': entry.temple || '', '陪同': entry.accompany ? '是' : '否',
      '出席': '出席', '狀態': '有效', '建立時間': now, '更新時間': now
    };
    if (duty['登記張數'] === '是') row['張數'] = String(ticketCount_(body.tickets));
    if (duty['版面'] === '職司表' && body.note) row['註記'] = cleanText_(body.note).slice(0, 100);
    appendRows_(SHEETS.SIGNUPS, [row]);
    addPendingMembers_([row], duty['名稱'], birthsOf_([entry]));
    appendRows_(SHEETS.LOGS, [{
      '時間': now, '動作': '修正', '報名ID': row['報名ID'],
      '內容摘要': signupSummary_(row, duty, position) + (body.date > todayString_() ? '｜管理者幫人報名' : '｜補登') + (warnings.length ? '（警告：' + warnings.join('；') + '）' : ''),
      '還原用的前一版資料': ''
    }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    if (body.date <= todayString_()) attendOkMark_([{ dutyId: duty['勤務ID'], date: body.date }]); // 補登過，算確認出席
    return { signupId: row['報名ID'], warnings: warnings };
  });
}

/**
 * 匯入出勤名單（後台「📋 匯入出勤名單」）：一次補登好幾場的出席名單，可順便新增還沒有的場次。
 * body = { sessions: [{ dutyId? , create?: { name, category, nature, startTime, location }, date, entries: [{ name, identity, note }] }] }
 *   - dutyId：已經有的勤務；create：沒有就新增（同名、同一天、同類別已經有的就直接用）。
 *   - 同一場已經有的名字跳過（可以重複匯入不會重複）；身分照成員名單為準（同補登）；名額、重複只警告。
 *   - 每個名字記為出席，寫入操作紀錄（動作「修正」，內容「匯入出勤名單」）。
 */
function adminImportAttendance_(body) {
  var sessions = Array.isArray(body.sessions) ? body.sessions : [];
  if (!sessions.length) throw new ApiError_('BAD_REQUEST', '沒有要匯入的場次');
  if (sessions.length > 60) throw new ApiError_('BAD_REQUEST', '一次最多 60 場');
  var results = [];
  sessions.forEach(function (s, i) {
    var label = '第 ' + (i + 1) + ' 場';
    var date = cleanText_(s.date);
    if (!isDateString_(date)) throw new ApiError_('VALIDATION', label + '的日期格式不對');
    var duty = s.dutyId ? findDutyById_(s.dutyId) : null;
    var created = false;
    if (!duty && s.create) {
      var c = s.create;
      var cat = ADMIN_SESSION_.role === SUPER_ACCOUNT ? (CATEGORIES.indexOf(c.category) !== -1 ? c.category : '勤務') : ADMIN_SESSION_.role;
      duty = readTable_(SHEETS.DUTIES).filter(function (d) { return d['勤務ID'] && d['名稱'] === c.name && d['開始日'] === date && dutyCategory_(d) === cat; })[0] || null;
      if (!duty) {
        // 性質照類別（表上有寫且合法就用）；從檔案帶入舊資料（2026/11/26）多帶結束日、結束時間
        var natures = NATURES_BY_CATEGORY_[cat] || ['勤務'];
        var nature = natures.indexOf(c.nature) !== -1 ? c.nature : natures[0];
        var end = isDateString_(cleanText_(c.end)) && cleanText_(c.end) > date ? cleanText_(c.end) : '';
        adminCreateDuties_({ allowDuplicate: true, duties: [{ name: c.name, category: cat, nature: nature, mode: '報名型', start: date, end: end, startTime: c.startTime || '', endTime: c.endTime || '', location: c.location || '',
          positions: [{ name: cat === '勤務' ? '出勤' : '參加', min: 0, max: null }] }] });
        created = true;
        duty = readTable_(SHEETS.DUTIES).filter(function (d) { return d['勤務ID'] && d['名稱'] === c.name && d['開始日'] === date && dutyCategory_(d) === cat; })[0];
      }
    }
    if (!duty) throw new ApiError_('NOT_FOUND', label + '找不到勤務（' + date + '）');
    if (ADMIN_SESSION_.role !== SUPER_ACCOUNT && dutyCategory_(duty) !== ADMIN_SESSION_.role) throw new ApiError_('FORBIDDEN', label + '是「' + dutyCategory_(duty) + '」的，這個帳號不能匯入');
    if (date < duty['開始日'] || date > (duty['結束日'] || duty['開始日'])) throw new ApiError_('VALIDATION', label + '的日期不在「' + duty['名稱'] + '」期間');
    var positions = readTable_(SHEETS.POSITIONS).filter(function (p) { return p['勤務ID'] === duty['勤務ID']; });
    if (!positions.length) throw new ApiError_('VALIDATION', label + '「' + duty['名稱'] + '」沒有了愿項目');
    var position = positions[0];
    results.push(withSignupLock_(function () {
      var signups = readTable_(SHEETS.SIGNUPS).filter(function (r) { return r['勤務ID'] === duty['勤務ID'] && r['狀態'] === '有效' && r['日期'] === date; });
      var have = signups.map(function (r) { return normalizeName_(r['姓名']) + '|' + (r['佛堂'] || ''); });
      var raw = (Array.isArray(s.entries) ? s.entries : []).filter(function (e) { return e && cleanText_(e.name); });
      var multi = raw.filter(function (e) { return NAME_SEPARATORS_.test(e.name); });
      if (multi.length) throw new ApiError_('VALIDATION', label + '有名字看起來是好幾個人，請分開', multi.map(function (e) { return { message: e.name }; }));
      var skipped = [];
      var fresh = raw.filter(function (e) {
        var n = normalizeName_(e.name);
        var k = n + '|' + cleanText_(e.temple || '');
        if (have.indexOf(k) !== -1) { skipped.push(n); return false; }
        have.push(k);
        return true;
      });
      var entries = withMemberIdentity_(fresh.map(function (e) { return { name: e.name, identity: e.identity, accompany: false, temple: e.temple }; }));
      checkAmbiguous_(entries);
      // 身分可以空白（成員名單還沒填的；統計時用成員名單上的身分），填了就要是正確的
      var bad = entries.filter(function (e) { return e.identity && OPTIONS.identity.indexOf(e.identity) === -1; });
      if (bad.length) throw new ApiError_('VALIDATION', label + '（' + duty['名稱'] + ' ' + date + '）有人沒有身分', bad.map(function (e) { return { message: e.name + '：請填道親、壇辦或未求道' }; }));
      var now = nowString_();
      var rows = entries.map(function (e, k) {
        return { '報名ID': newId_('S'), '勤務ID': duty['勤務ID'], '日期': date, '了愿項目ID': position['了愿項目ID'], '姓名': normalizeName_(e.name), '身分': e.identity,
          '佛堂': e.temple || '', '陪同': '否', '出席': '出席', '狀態': '有效', '建立時間': now, '更新時間': now, '註記': cleanText_(fresh[k].note || '').slice(0, 100) };
      });
      if (rows.length) {
        appendRows_(SHEETS.SIGNUPS, rows);
        addPendingMembers_(rows, duty['名稱']);
        appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修正', '報名ID': '', '內容摘要': duty['名稱'] + '｜' + date + '｜匯入出勤名單 ' + rows.length + ' 位：' + rows.map(function (r) { return r['姓名']; }).join('、'), '還原用的前一版資料': JSON.stringify({ undo: 'attendImport', dutyId: duty['勤務ID'], created: created, signupIds: rows.map(function (r) { return r['報名ID']; }) }) }]);
        SpreadsheetApp.flush();
        invalidateTable_(SHEETS.SIGNUPS);
      }
      return { dutyId: duty['勤務ID'], name: duty['名稱'], date: date, added: rows.length, skipped: skipped };
    }));
  });
  return { results: results };
}

/** 把「好幾個人打在同一格」的名字拆開：王小明.測試甲 → 兩個名字 */
function splitPeople_(name) {
  return String(name || '').split(/[、,，.。．\/／;；|\s]+/).map(function (x) { return normalizeName_(x); }).filter(Boolean);
}

/**
 * body = { signupId }：一筆報名的名字其實是好幾個人 → 拆成好幾筆（同勤務、日期、了愿項目；身分照成員名單，沒有的沿用原本的）
 */
function adminSplitSignup_(body) {
  return withSignupLock_(function () {
    var signups = readTable_(SHEETS.SIGNUPS);
    var row = findActiveSignup_(signups, body.signupId);
    var duty = findDutyById_(row['勤務ID']);
    if (ADMIN_SESSION_.role !== SUPER_ACCOUNT && duty && dutyCategory_(duty) !== ADMIN_SESSION_.role) throw new ApiError_('FORBIDDEN', '這是「' + dutyCategory_(duty) + '」的勤務，這個帳號不能修改');
    var parts = splitPeople_(row['姓名']);
    if (parts.length < 2) throw new ApiError_('BAD_REQUEST', '這個名字看起來只有一個人');
    var entries = withMemberIdentity_(parts.map(function (n) { return { name: n, identity: row['身分'] }; }));
    var now = nowString_();
    var before = rowSnapshot_(SHEETS.SIGNUPS, row);
    updateRow_(SHEETS.SIGNUPS, row, { '姓名': parts[0], '身分': entries[0].identity || row['身分'], '佛堂': entries[0].ambiguous ? '' : (entries[0].temple || ''), '更新時間': now });
    var add = entries.slice(1).map(function (e, i) {
      var r = {};
      SHEETS.SIGNUPS.headers.forEach(function (h) { r[h] = before[h] === undefined ? '' : before[h]; });
      r['報名ID'] = newId_('S');
      r['姓名'] = parts[i + 1];
      r['身分'] = e.identity || row['身分'];
      r['佛堂'] = e.ambiguous ? '' : (e.temple || '');
      r['組長'] = '';
      r['建立時間'] = now;
      r['更新時間'] = now;
      return r;
    });
    appendRows_(SHEETS.SIGNUPS, add);
    addPendingMembers_([row].concat(add).map(function (r) { return { '姓名': r['姓名'], '身分': r['身分'], '佛堂': r['佛堂'], '日期': row['日期'] }; }), duty ? duty['名稱'] : '');
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '修正', '報名ID': row['報名ID'], '內容摘要': '拆成多人｜' + before['姓名'] + ' → ' + parts.join('、') + '｜' + row['日期'] + '｜' + (duty ? duty['名稱'] : ''), '還原用的前一版資料': '' }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { names: parts };
  });
}

// =====================================================================
// 出席確認（2026/11/24）：活動過了，管理者看過名單（沒來的改未到、有來沒報名的補登）就算「確認好了」，
// 統計、關懷名單、年度報表才準。指令碼屬性 ATTEND_OK ＝ { 勤務ID|日期: { by, at } }（只留 60 天）。
//   - 改出席／未到、補登（過去的日期）、點名，都自動算確認。
//   - 後台近期勤務最上面列「最近 14 天還沒確認出席」；勤務名單頁按「✓ 出席確認好了」。
//   - 每天早上 7 點：昨天還沒確認的，推播給收「系統通知」的手機（一天一則）。
// =====================================================================
var ATTEND_OK_PROP = 'ATTEND_OK';
var ATTEND_PENDING_DAYS = 14;

function attendOkRead_() {
  try { var o = JSON.parse(PropertiesService.getScriptProperties().getProperty(ATTEND_OK_PROP) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}

/** 記「確認好了」（undo＝拿掉）；items＝[{ dutyId, date }] */
function attendOkMark_(items, undo) {
  var ok = attendOkRead_();
  var cut = addDaysStr_(todayString_(), -60);
  Object.keys(ok).forEach(function (k) { if (k.split('|')[1] < cut) delete ok[k]; });
  var who = (ADMIN_SESSION_ && (ADMIN_SESSION_.account || ADMIN_SESSION_.role)) || '點名';
  items.forEach(function (it) {
    var k = it.dutyId + '|' + it.date;
    if (undo) delete ok[k];
    else if (!ok[k]) ok[k] = { by: who, at: nowString_() };
  });
  PropertiesService.getScriptProperties().setProperty(ATTEND_OK_PROP, JSON.stringify(ok));
  return ok;
}

/** 需要確認出席的場次：今天以前（from～昨天）、不是公告型、有人報名、還沒確認的 */
function attendPendingList_(from, to, role) {
  var ok = attendOkRead_();
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (!d['勤務ID'] || d['模式'] === '公告型') return;
    if (role && CATEGORIES.indexOf(role) !== -1 && dutyCategory_(d) !== role) return;
    duties[d['勤務ID']] = d;
  });
  var map = {};
  activeSignups_().forEach(function (s) {
    var d = duties[s['勤務ID']];
    if (!d || !s['日期'] || s['日期'] < from || s['日期'] > to) return;
    var k = s['勤務ID'] + '|' + s['日期'];
    if (ok[k]) return;
    var x = map[k] = map[k] || { dutyId: s['勤務ID'], date: s['日期'], name: d['名稱'], category: dutyCategory_(d), count: 0, absent: 0 };
    x.count++;
    if (s['出席'] === '未到') x.absent++;
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name)); });
}

/** 後台：最近 14 天還沒確認出席的場次（類別帳號只看自己類別） */
function adminAttendPending_() {
  var today = todayString_();
  return { today: today, days: ATTEND_PENDING_DAYS,
    items: attendPendingList_(addDaysStr_(today, -ATTEND_PENDING_DAYS), addDaysStr_(today, -1), ADMIN_SESSION_ && ADMIN_SESSION_.role) };
}

/** 後台：body = { items: [{ dutyId, date }], undo }：確認好了（或取消確認）。只能是今天（含）以前 */
function adminAttendOk_(body) {
  var today = todayString_();
  var items = (body.items || []).filter(function (it) { return it && it.dutyId && /^\d{4}-\d{2}-\d{2}$/.test(String(it.date || '')) && it.date <= today; }).slice(0, 100);
  if (!items.length) throw new ApiError_('BAD_REQUEST', '沒有要確認的場次（活動當天以後才能確認）');
  items.forEach(function (it) { if (!findDutyById_(it.dutyId)) throw new ApiError_('NOT_FOUND', '找不到這個勤務'); });
  return withSignupLock_(function () {
    var ok = attendOkMark_(items, !!body.undo);
    items.forEach(function (it) {
      var d = findDutyById_(it.dutyId);
      writeDutyLog_('修正', (d ? d['名稱'] : it.dutyId) + '｜' + it.date + '｜' + (body.undo ? '取消出席確認' : '出席確認好了'),
        { undo: 'attendOk', item: { dutyId: it.dutyId, date: it.date }, was: !!body.undo });
    });
    return { ok: items.map(function (it) { return ok[it.dutyId + '|' + it.date] || null; }) };
  });
}

/** 這個勤務每一天的確認（勤務名單頁用）：{ 日期: { by, at } } */
function attendOkOfDuty_(dutyId) {
  var ok = attendOkRead_();
  var out = {};
  Object.keys(ok).forEach(function (k) { var p = k.split('|'); if (p[0] === dutyId) out[p[1]] = ok[k]; });
  return out;
}

/** 每天早上：昨天還沒確認出席的，推播給收系統通知的手機（一天一次） */
function attendRemind_() {
  var today = todayString_();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ATTEND_REMIND_DAY') === today) return { items: 0, skipped: 'done' };
  props.setProperty('ATTEND_REMIND_DAY', today);
  var y = addDaysStr_(today, -1);
  var items = attendPendingList_(y, y, '');
  if (!items.length) return { items: 0 };
  var targets = pushTargets_('系統通知');
  if (!targets.length) return { items: items.length, phones: 0 };
  var names = items.map(function (x) { return x.name; });
  withSignupLock_(function () {
    pushMessageTo_(targets, '📋 昨天 ' + items.length + ' 場還沒確認出席',
      names.join('、').slice(0, 60) + '\n沒來的改「未到」、有來沒報名的「補登」，看過沒問題按「✓ 出席確認好了」。', '#/admin');
  });
  return { items: items.length, phones: targets.length };
}
