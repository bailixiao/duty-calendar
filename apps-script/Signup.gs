/**
 * 報名 API。
 * 用 LockService 鎖住「讀取 → 檢查 → 寫入」整段，避免兩人同時搶最後一個名額造成超收。
 * 任何一筆有錯，整批都不寫入。
 */

var MAX_ENTRIES_PER_SIGNUP = 20;
var MAX_DATES_PER_SIGNUP = 31;

/**
 * body = { dutyId, positionId | positionIds: [..]（可兼任的勤務可多個）, dates: ['yyyy-MM-dd'], entries: [{ name, identity, accompany, note, leader }] }
 * leader：勤務有組長職稱時，這次報名的其中一位當組長（一天一位）
 * note：職司表的勤務才收（例：8:00-19:00、代理人），最多 100 字
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
  checkAmbiguous_(entries);

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
            '佛堂': e.temple || '',
            '陪同': accompany ? '是' : '否',
            '出席': '出席',
            '狀態': '有效',
            '建立時間': now,
            '更新時間': now
          };
          if (duty['版面'] === '職司表' && e.note) row['註記'] = cleanText_(e.note).replace(/[\r\n]+/g, ' ').slice(0, 100);
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
    // 組長：一次只能一位、那天已經有組長就擋；標在這個人那天的第一筆
    var leaders = entries.filter(function (e) { return e && e.leader; });
    if (leaders.length) {
      var title = duty['組長職稱'] || '';
      if (!title) errors.push({ message: '這個勤務不需要選組長' });
      else if (leaders.length > 1) errors.push({ message: title + '只要一位，請只選一位' });
      else if (leaders[0].accompany) errors.push({ message: '陪同的人不能當' + title });
      else {
        var lname = normalizeName_(leaders[0].name);
        dates.forEach(function (date) {
          var has = signups.filter(function (s) { return s['日期'] === date && s['狀態'] !== '已取消' && s['組長'] === '是'; })[0];
          if (has) { errors.push({ message: Fmt_shortDate_(date) + '已經有' + title + '（' + has['姓名'] + '）了' }); return; }
          var first = signupRows.filter(function (r) { return r['日期'] === date && r['姓名'] === lname; })[0];
          if (first) {
            first['組長'] = '是';
            created.forEach(function (c) { if (c.id === first['報名ID']) c.leader = true; });
          }
        });
      }
    }
    if (errors.length) {
      throw new ApiError_('VALIDATION', '報名沒有完成，請看下面的說明', errors);
    }

    appendRows_(SHEETS.SIGNUPS, signupRows);
    appendRows_(SHEETS.LOGS, logRows);
    addPendingMembers_(signupRows, duty['名稱']);
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

/** 'yyyy-MM-dd' → 'M/D'（錯誤訊息用） */
function Fmt_shortDate_(date) {
  return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10));
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
  // 名字 → 名單上的人（同名可能好幾位，用佛堂分）
  var map = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (m['啟用中'] === '否' || m['待確認'] === '是' || !m['姓名']) return;
    var n = normalizeName_(m['姓名']);
    (map[n] = map[n] || []).push(m);
  });
  var alias = memberAliasMap_();
  return entries.map(function (e) {
    // 打的是別名（而且不是別人的本名）：換成主要名字
    var typed = normalizeName_(e && e.name);
    if (!map[typed] && alias[typed]) e = Object.assign({}, e, { name: alias[typed].name, temple: (e && e.temple) || alias[typed].temple });
    var list = map[normalizeName_(e && e.name)] || [];
    var temple = cleanText_((e && e.temple) || '');
    var m = temple ? list.filter(function (x) { return x['佛堂'] === temple; })[0] : list.length === 1 ? list[0] : null;
    var out = Object.assign({}, e, { temple: temple || (m ? m['佛堂'] || '' : '') });
    if (m && OPTIONS.identity.indexOf(m['身分']) !== -1) out.identity = m['身分'];
    // 名單上有好幾位同名、又沒說是哪個佛堂的：標記起來，由呼叫的地方擋下
    if (!temple && list.length > 1) out.ambiguous = list.map(function (x) { return x['佛堂'] || '未填佛堂'; });
    return out;
  });
}

/** 有同名又沒選佛堂的：擋下並說明 */
function checkAmbiguous_(entries) {
  var bad = entries.filter(function (e) { return e.ambiguous; });
  if (bad.length) throw new ApiError_('VALIDATION', '名單上有同名的人，請選是哪一位', bad.map(function (e) {
    return { name: normalizeName_(e.name), message: '名單上有 ' + e.ambiguous.length + ' 位「' + normalizeName_(e.name) + '」（' + e.ambiguous.join('、') + '），請從名字提示點選是哪個佛堂的' };
  }));
}

/** 別名 → { name: 主要名字, temple }（啟用中、非待確認的成員） */
function memberAliasMap_() {
  var out = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (!m['姓名'] || m['啟用中'] === '否' || m['待確認'] === '是' || !m['別名']) return;
    splitAliases_(m['別名']).forEach(function (a) { out[a] = { name: normalizeName_(m['姓名']), temple: m['佛堂'] || '' }; });
  });
  return out;
}

function splitAliases_(text) {
  return String(text || '').split(/[、，,\s]+/).map(function (x) { return normalizeName_(x); }).filter(Boolean);
}

/** 名字如果是某人的別名，換成主要名字（查我的報名、手機提醒的「我是誰」用） */
function canonicalName_(name) {
  var n = normalizeName_(name);
  var isMember = readTableCached_(SHEETS.MEMBERS).some(function (m) { return normalizeName_(m['姓名']) === n; });
  if (isMember) return n;
  var a = memberAliasMap_()[n];
  return a ? a.name : n;
}
