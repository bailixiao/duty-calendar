/**
 * 操作紀錄的還原與「刪掉這筆」（2026/11/26）。
 *   報名、取消、改期、換項目、調整職司：原本的還原（Admin.gs adminRestore_）。
 *   新增勤務、新增成員、新增分組：按「刪掉」把那筆資料刪掉（新增勤務只能在沒有別人報名時刪）。
 *   刪除勤務／成員／分組、修改勤務、放到首頁、勤務搬日期、出席確認、修改成員／分組：按「還原」改回原本的樣子。
 * 紀錄的「還原用的前一版資料」寫成 { undo: 種類, ... }；2026/11/26 以前的刪除勤務、刪除成員、刪除分組、勤務搬日期
 * 已經有存資料，照舊的格式也能還原。其他舊紀錄沒有存資料，不能還原。
 * 只有總管理者看得到操作紀錄（Accounts.gs）。
 */

/** 存進紀錄的資料太大（一次改很多筆同名勤務）就不存，那筆不能還原（試算表一格最多 5 萬字） */
var UNDO_MAX_CHARS = 45000;

function undoSnap_(obj) {
  var s = JSON.stringify(obj);
  return s.length > UNDO_MAX_CHARS ? null : obj;
}

/** 這筆紀錄能不能還原／刪掉：{ kind, label, note } 或 null */
function logUndoInfo_(l) {
  var action = l['動作'];
  if (action === '還原') return null;
  var SIGNUP_NOTE = {
    '報名': '這筆報名會被取消。',
    '取消': '這筆報名會恢復為有效。',
    '改期': '會取消改期後的那筆，並恢復原本的日期。',
    '換項目': '會換回原本的項目。',
    '調整職司': '會放回原本的日期和項目。'
  };
  if (SIGNUP_NOTE[action]) {
    return { kind: 'signup', label: action === '報名' ? '取消這筆報名' : '還原', note: SIGNUP_NOTE[action] };
  }
  var p = null;
  try { p = JSON.parse(l['還原用的前一版資料'] || 'null'); } catch (e) { p = null; }
  if (!p || typeof p !== 'object') return null;
  var summary = String(l['內容摘要'] || '');
  var kind = p.undo;
  // 2026/11/26 以前的紀錄
  if (!kind) {
    if (action === '刪除勤務' && p.duty) kind = 'dutyDelete';
    else if (action === '勤務搬日期' && p.id && p.from && p.to) kind = 'dutyMove';
    else if (action === '成員' && summary.indexOf('刪除｜') === 0 && p['姓名'] !== undefined) { kind = 'memberDelete'; p = { undo: kind, row: p }; }
    else if (action === '分組' && summary.indexOf('刪除｜') === 0 && p['組名'] !== undefined) { kind = 'groupDelete'; p = { undo: kind, row: p }; }
  }
  var INFO = {
    dutyCreate: ['刪掉', '會把這次新增的勤務（含了愿項目）刪掉；這次一起分配的人員一起取消。已經有其他人報名的話不能刪。'],
    dutyDelete: ['還原', '會把刪掉的勤務和它的了愿項目放回來。'],
    dutyEdit: ['還原', '勤務會改回修改前的樣子（名稱、日期、時間、了愿項目等）；跟著移動的名單一起移回去。'],
    dutyMove: ['還原', '勤務和報名會一起搬回原本的日期。'],
    attendOk: ['還原', '出席確認會改回原本的狀態。'],
    memberNew: ['刪掉', '會把這位成員從成員名單刪掉（過去的報名紀錄不受影響）。'],
    memberEdit: ['還原', '這位成員的資料會改回修改前的樣子。'],
    memberDelete: ['還原', '會把刪掉的成員放回成員名單。'],
    groupNew: ['刪掉', '會把這一組刪掉；還有勤務由這一組負責的話不能刪。'],
    groupEdit: ['還原', '這一組的資料會改回修改前的樣子（改過組名的話，勤務和成員的組別一起改回來）。'],
    groupDelete: ['還原', '會把刪掉的組放回來，當時一起清空組別的成員也會放回這一組。']
  };
  if (!INFO[kind]) return null;
  return { kind: kind, label: INFO[kind][0], note: INFO[kind][1], data: p };
}

/** 執行還原（在 withSignupLock_ 裡呼叫）；回傳警告 */
function logUndoRun_(info, now) {
  var p = info.data;
  var warnings = [];
  var fn = {
    dutyCreate: function () {
      var duties = readTable_(SHEETS.DUTIES);
      var targets = (p.ids || []).map(function (id) { return findById_(duties, '勤務ID', id); }).filter(Boolean);
      if (!targets.length) throw new ApiError_('ALREADY', '這次新增的勤務都已經刪掉了');
      if (targets.length < (p.ids || []).length) warnings.push('有 ' + ((p.ids || []).length - targets.length) + ' 筆已經刪掉了');
      var mine = {};
      (p.signupIds || []).forEach(function (id) { mine[id] = true; });
      var signups = readTable_(SHEETS.SIGNUPS);
      var others = signups.filter(function (s) {
        return s['狀態'] !== '已取消' && !mine[s['報名ID']] && targets.some(function (d) { return d['勤務ID'] === s['勤務ID']; });
      });
      if (others.length) throw new ApiError_('FORBIDDEN', '已經有 ' + others.length + ' 筆報名，不能刪；請先到勤務名單取消這些報名');
      signups.forEach(function (s) {
        if (mine[s['報名ID']] && s['狀態'] !== '已取消') updateRow_(SHEETS.SIGNUPS, s, { '狀態': '已取消', '更新時間': now });
      });
      var ids = targets.map(function (d) { return d['勤務ID']; });
      deleteRows_(SHEETS.POSITIONS, readTable_(SHEETS.POSITIONS).filter(function (x) { return ids.indexOf(x['勤務ID']) !== -1; }).map(function (x) { return x._row; }));
      deleteRows_(SHEETS.DUTIES, targets.map(function (d) { return d._row; }));
    },
    dutyDelete: function () {
      if (findById_(readTable_(SHEETS.DUTIES), '勤務ID', p.duty['勤務ID'])) throw new ApiError_('ALREADY', '這個勤務已經在了，不用還原');
      appendRows_(SHEETS.DUTIES, [p.duty]);
      appendRows_(SHEETS.POSITIONS, p.positions || []);
    },
    dutyEdit: function () {
      var duties = readTable_(SHEETS.DUTIES);
      var positions = readTable_(SHEETS.POSITIONS);
      var active = {};
      readTable_(SHEETS.SIGNUPS).forEach(function (s) { if (s['狀態'] !== '已取消') active[s['了愿項目ID']] = (active[s['了愿項目ID']] || 0) + 1; });
      var appends = [];
      var deletions = [];
      var done = 0;
      (p.duties || []).forEach(function (snap) {
        var cur = findById_(duties, '勤務ID', snap['勤務ID']);
        if (!cur) { warnings.push(snap['名稱'] + '（' + snap['開始日'] + '）已經刪掉了，沒有改回去'); return; }
        var back = Object.assign({}, snap);
        delete back['勤務ID'];
        updateRow_(SHEETS.DUTIES, cur, back);
        done++;
        var old = p.positions && p.positions[snap['勤務ID']];
        if (!old) return; // 放到首頁：只改勤務這一列
        var curPs = positionsOf_(positions, snap['勤務ID']);
        old.forEach(function (o) {
          var c = findById_(curPs, '了愿項目ID', o['了愿項目ID']);
          if (c) updateRow_(SHEETS.POSITIONS, c, o);
          else appends.push(o);
        });
        curPs.forEach(function (c) {
          if (old.some(function (o) { return o['了愿項目ID'] === c['了愿項目ID']; })) return;
          if (active[c['了愿項目ID']]) warnings.push('「' + c['了愿項目名稱'] + '」已經有人報名，沒有刪掉');
          else deletions.push(c._row);
        });
      });
      if (!done) throw new ApiError_('NOT_FOUND', '這個勤務已經刪掉了，沒辦法改回去');
      appendRows_(SHEETS.POSITIONS, appends);
      deleteRows_(SHEETS.POSITIONS, deletions);
      if (p.moved && p.moved.from) {
        var ids = p.moved.ids || [];
        readTable_(SHEETS.SIGNUPS).forEach(function (s) {
          if (ids.indexOf(s['報名ID']) !== -1) updateRow_(SHEETS.SIGNUPS, s, { '日期': p.moved.from, '更新時間': now });
        });
      }
    },
    dutyMove: function () {
      var duty = findById_(readTable_(SHEETS.DUTIES), '勤務ID', p.id);
      if (!duty) throw new ApiError_('NOT_FOUND', '這個勤務已經刪掉了');
      if (duty['開始日'] !== p.to) throw new ApiError_('CONFLICT', '這個勤務的日期後來又改過了（現在是 ' + duty['開始日'] + '），請到勤務管理改');
      updateRow_(SHEETS.DUTIES, duty, { '開始日': p.from, '結束日': p.from });
      readTable_(SHEETS.SIGNUPS).forEach(function (s) {
        var hit = p.ids ? p.ids.indexOf(s['報名ID']) !== -1 : (s['勤務ID'] === p.id && s['日期'] === p.to);
        if (hit) updateRow_(SHEETS.SIGNUPS, s, { '日期': p.from, '更新時間': now });
      });
    },
    attendOk: function () {
      attendOkMark_([p.item], !p.was);
    },
    memberNew: function () {
      var row = findMember_(readTable_(SHEETS.MEMBERS), p.name, p.temple);
      if (!row) throw new ApiError_('NOT_FOUND', '成員名單裡已經沒有「' + p.name + '」了');
      deleteRows_(SHEETS.MEMBERS, [row._row]);
    },
    memberEdit: function () {
      var rows = readTable_(SHEETS.MEMBERS);
      var row = findMember_(rows, p.name, p.temple);
      if (!row) throw new ApiError_('NOT_FOUND', '成員名單裡找不到「' + p.name + '」，可能後來又改名或刪掉了');
      var oldName = normalizeName_(p.before['姓名']);
      if (oldName !== p.name && rows.some(function (m) { return m !== row && normalizeName_(m['姓名']) === oldName && (!p.before['佛堂'] || !m['佛堂'] || m['佛堂'] === p.before['佛堂']); })) {
        throw new ApiError_('CONFLICT', '已經有另一位「' + oldName + '」了，沒辦法改回這個名字');
      }
      updateRow_(SHEETS.MEMBERS, row, p.before);
      if (oldName !== p.name) renameParentRefs_(rows, p.name, oldName);
    },
    memberDelete: function () {
      var r = p.row;
      if (findMember_(readTable_(SHEETS.MEMBERS), normalizeName_(r['姓名']), r['佛堂'])) throw new ApiError_('ALREADY', '成員名單裡已經有「' + r['姓名'] + '」了，不用還原');
      appendRows_(SHEETS.MEMBERS, [r]);
    },
    groupNew: function () {
      var row = findGroupRow_(p.type, p.name);
      if (!row) throw new ApiError_('NOT_FOUND', '已經沒有「' + p.name + '」這一組了');
      var used = readTable_(SHEETS.DUTIES).filter(function (d) { return d['分組類型'] === p.type && hasDutyGroup_(d['負責組'], p.name); });
      if (used.length) throw new ApiError_('FORBIDDEN', '還有 ' + used.length + ' 筆勤務由「' + p.name + '」負責，不能刪；請先把這些勤務改成其他組');
      if (MEMBER_GROUP_COLUMNS.indexOf(p.type) !== -1) {
        readTable_(SHEETS.MEMBERS).forEach(function (m) { if (m[p.type] === p.name) { var c = {}; c[p.type] = ''; updateRow_(SHEETS.MEMBERS, m, c); } });
      }
      deleteRows_(SHEETS.GROUPS, [row._row]);
    },
    groupEdit: function () {
      var row = findGroupRow_(p.type, p.name);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到「' + p.name + '」這一組，可能後來又改名或刪掉了');
      var oldName = p.before['組名'];
      if (oldName !== p.name && findGroupRow_(p.type, oldName)) throw new ApiError_('CONFLICT', '已經有另一組叫「' + oldName + '」了，沒辦法改回這個組名');
      updateRow_(SHEETS.GROUPS, row, p.before);
      if (oldName !== p.name) renameGroupRefs_(p.type, p.name, oldName);
    },
    groupDelete: function () {
      var r = p.row;
      if (findGroupRow_(r['分組類型'], r['組名'])) throw new ApiError_('ALREADY', '已經有「' + r['組名'] + '」這一組了，不用還原');
      appendRows_(SHEETS.GROUPS, [r]);
      var back = p.cleared || [];
      if (back.length && MEMBER_GROUP_COLUMNS.indexOf(r['分組類型']) !== -1) {
        readTable_(SHEETS.MEMBERS).forEach(function (m) {
          if (back.indexOf(m['姓名']) !== -1 && !m[r['分組類型']]) { var c = {}; c[r['分組類型']] = r['組名']; updateRow_(SHEETS.MEMBERS, m, c); }
        });
      }
    }
  }[info.kind];
  fn();
  return warnings;
}

/** 成員名單裡的這個人（同名時用佛堂分；有一邊沒填佛堂就算同一位） */
function findMember_(rows, name, temple) {
  return rows.filter(function (m) { return normalizeName_(m['姓名']) === name && (!temple || !m['佛堂'] || m['佛堂'] === temple); })[0] || null;
}

function findGroupRow_(type, name) {
  return readTable_(SHEETS.GROUPS).filter(function (g) { return g['分組類型'] === type && g['組名'] === name; })[0] || null;
}
