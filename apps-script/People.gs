/**
 * 管理後台：成員名單管理、分組管理（規格第 8 節管理者後台第 7 項）。
 *   - 成員先「停用」（啟用中＝否，不會出現在報名的名字提示）；已停用的才能刪除。
 *   - 這兩張表沒有 ID 欄，以列號找資料，並核對原本的姓名（組名）避免對錯列。
 *   - 分組改名時，一併更新「勤務」的負責組與「成員」的組別；有勤務指定負責的組不能刪除。
 *   - 全部寫入都排進同一把鎖，並寫入操作紀錄（不提供還原）。
 *   - 這些資料含人名與電話，只透過管理 API（需通行碼）回傳。
 */

var MEMBER_GROUP_COLUMNS = ['勤務了愿組', '打掃組', '拜香輪值組']; // 「成員」分頁的組別欄＝分組類型

/** 全部成員（含停用） */
function adminMembers_() {
  return {
    members: readTable_(SHEETS.MEMBERS).filter(function (m) { return m['姓名']; }).map(memberToJson_),
    groups: groupList_(),
    temples: templeList_()
  };
}

/** 佛堂選項：各佛堂道務目標最新年度的佛堂（依排序）；沒有就用成員名單上已有的 */
function templeList_() {
  var rows = readTableCached_(SHEETS.GOALS).filter(function (r) { return r['佛堂']; });
  var years = rows.map(function (r) { return String(r['年度']); }).sort();
  var latest = years[years.length - 1];
  var list = rows.filter(function (r) { return String(r['年度']) === latest; })
    .sort(function (a, b) { return (Number(a['排序']) || 0) - (Number(b['排序']) || 0); })
    .map(function (r) { return r['佛堂']; });
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) { if (m['佛堂'] && list.indexOf(m['佛堂']) === -1) list.push(m['佛堂']); });
  return list;
}

/** body = { row?, original?, member: { name, identity, groups: { 分組類型: 組名 }, note, active } }；沒有 row 就是新增 */
function adminSaveMember_(body) {
  var input = body.member || {};
  var name = normalizeName_(input.name);
  var identity = cleanText_(input.identity);
  var groupsIn = input.groups || {};
  var errors = [];
  if (!name) errors.push('請填姓名');
  if (identity && OPTIONS.identity.indexOf(identity) === -1) errors.push('身分只能是道親、壇辦、未求道或點傳師');
  if (input.age !== undefined && input.age !== '' && birthYearOf_(input.age) === null) errors.push('年齡請填 0～120 的數字');
  if (input.overseas && SITE.overseas.indexOf(input.overseas) === -1) errors.push('國外只能是' + SITE.overseas.join('、') + '或空白');
  var keys = groupKeys_();
  var groups = {};
  MEMBER_GROUP_COLUMNS.forEach(function (type) {
    var g = cleanText_(groupsIn[type]);
    if (g && keys.indexOf(type + '|' + g) === -1) errors.push('「' + type + '」沒有「' + g + '」這一組');
    groups[type] = g;
  });
  if (errors.length) throw new ApiError_('VALIDATION', '成員資料有錯，沒有存檔', errors.map(function (m) { return { message: m }; }));

  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.MEMBERS);
    var row = body.row ? findRowChecked_(rows, body.row, '姓名', body.original, '成員') : null;
    var temple = cleanText_(input.temple || '');
    // 同名可以，只要佛堂不同（有一位沒填佛堂就分不出來，也擋）
    var dup = rows.filter(function (m) { return m !== row && normalizeName_(m['姓名']) === name && (!temple || !m['佛堂'] || m['佛堂'] === temple); })[0];
    if (dup) throw new ApiError_('VALIDATION', '成員資料有錯，沒有存檔', [{ message: '已經有「' + name + '」' + (dup['佛堂'] ? '（' + dup['佛堂'] + '）' : '') + '這個人了' + (temple || dup['佛堂'] ? '' : '；同名同姓的話，請兩位都填佛堂') }]);

    var values = { '姓名': name, '身分': identity, '備註': cleanText_(input.note), '啟用中': input.active === false ? '否' : '是', '待確認': '' }; // 存檔＝確認過
    if (input.vegetarian !== undefined) values['清口'] = input.vegetarian ? '是' : '';
    if (input.age !== undefined) values['出生年'] = birthYearOf_(input.age);
    if (input.temple !== undefined) values['佛堂'] = temple;
    if (input.overseas !== undefined) values['國外'] = input.overseas || '';
    if (input.aliases !== undefined) {
      var aliases = (Array.isArray(input.aliases) ? input.aliases : splitAliases_(input.aliases)).map(normalizeName_).filter(function (a, i, arr) { return a && a !== name && arr.indexOf(a) === i; });
      var clash = aliasClash_(rows, row, aliases);
      if (clash) throw new ApiError_('VALIDATION', '成員資料有錯，沒有存檔', [{ message: clash }]);
      values['別名'] = aliases.join('、');
    }
    MEMBER_GROUP_COLUMNS.forEach(function (type) { values[type] = groups[type]; });
    var summary;
    if (row) {
      summary = '修改｜' + row['姓名'] + (row['姓名'] !== name ? ' → ' + name : '') +
        (row['啟用中'] !== values['啟用中'] ? (values['啟用中'] === '否' ? '（停用）' : '（重新啟用）') : '');
      updateRow_(SHEETS.MEMBERS, row, values);
    } else {
      summary = '新增｜' + name;
      appendRows_(SHEETS.MEMBERS, [values]);
    }
    writeDutyLog_('成員', summary);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
    return {};
  });
}

/** 全部分組（含組長電話）與各組被幾筆勤務指定負責 */
function adminGroups_() {
  var usage = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (d['負責組']) usage[d['分組類型'] + '|' + d['負責組']] = (usage[d['分組類型'] + '|' + d['負責組']] || 0) + 1;
  });
  return {
    groups: readTable_(SHEETS.GROUPS).filter(function (g) { return g['組名']; }).map(function (g) {
      return {
        row: g._row, type: g['分組類型'], name: g['組名'], leader: g['組長或召集人'], assistant: g['佐理'],
        members: splitNames_(g['組員']), phone: g['組長電話'],
        duties: usage[g['分組類型'] + '|' + g['組名']] || 0
      };
    })
  };
}

/**
 * body = { row?, original?: 原組名, group: { type, name, leader, assistant, members: [..] | 文字, phone } }
 * 改組名時一併更新勤務的負責組與成員的組別（分組類型不能改，要改請新增一組）。
 */
function adminSaveGroup_(body) {
  var input = body.group || {};
  var type = cleanText_(input.type);
  var name = cleanText_(input.name);
  var errors = [];
  if (OPTIONS.groupType.indexOf(type) === -1) errors.push('請選分組類型');
  if (!name) errors.push('請填組名');
  if (errors.length) throw new ApiError_('VALIDATION', '分組資料有錯，沒有存檔', errors.map(function (m) { return { message: m }; }));
  var members = (Array.isArray(input.members) ? input.members : splitNames_(input.members)).map(normalizeName_).filter(function (x) { return x; });

  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.GROUPS);
    var row = body.row ? findRowChecked_(rows, body.row, '組名', body.original, '分組') : null;
    if (row && row['分組類型'] !== type) throw new ApiError_('BAD_REQUEST', '分組類型不能修改，要換類型請新增一組');
    var dup = rows.filter(function (g) { return g !== row && g['分組類型'] === type && g['組名'] === name; })[0];
    if (dup) throw new ApiError_('VALIDATION', '分組資料有錯，沒有存檔', [{ message: '「' + type + '」已經有「' + name + '」了' }]);

    var values = {
      '分組類型': type, '組名': name, '組長或召集人': normalizeName_(input.leader), '佐理': cleanText_(input.assistant),
      '組員': members.join(NAME_LIST_SEPARATOR), '組長電話': cleanText_(input.phone)
    };
    var renamed = { duties: 0, members: 0 };
    var summary;
    if (row) {
      var oldName = row['組名'];
      updateRow_(SHEETS.GROUPS, row, values);
      if (oldName !== name) renamed = renameGroupRefs_(type, oldName, name);
      summary = '修改｜' + type + ' ' + oldName + (oldName !== name ? ' → ' + name + '（勤務 ' + renamed.duties + ' 筆、成員 ' + renamed.members + ' 人一併更新）' : '');
    } else {
      appendRows_(SHEETS.GROUPS, [values]);
      summary = '新增｜' + type + ' ' + name;
    }
    writeDutyLog_('分組', summary);
    SpreadsheetApp.flush();
    invalidateAllTables_();
    return { renamed: renamed };
  });
}

/** body = { row, original }：有勤務指定負責就不能刪；成員的組別一併清空 */
function adminDeleteGroup_(body) {
  return withSignupLock_(function () {
    var row = findRowChecked_(readTable_(SHEETS.GROUPS), body.row, '組名', body.original, '分組');
    var type = row['分組類型'];
    var name = row['組名'];
    var used = readTable_(SHEETS.DUTIES).filter(function (d) { return d['分組類型'] === type && d['負責組'] === name; });
    if (used.length) {
      throw new ApiError_('FORBIDDEN', '還有 ' + used.length + ' 筆勤務由「' + name + '」負責，不能刪除；請先把這些勤務改成其他組');
    }
    var cleared = 0;
    if (MEMBER_GROUP_COLUMNS.indexOf(type) !== -1) {
      readTable_(SHEETS.MEMBERS).forEach(function (m) {
        if (m[type] === name) { var c = {}; c[type] = ''; updateRow_(SHEETS.MEMBERS, m, c); cleared++; }
      });
    }
    deleteRows_(SHEETS.GROUPS, [row._row]);
    writeDutyLog_('分組', '刪除｜' + type + ' ' + name + (cleared ? '（' + cleared + ' 位成員的組別一併清空）' : ''),
      rowSnapshot_(SHEETS.GROUPS, row));
    SpreadsheetApp.flush();
    invalidateAllTables_();
    return { clearedMembers: cleared };
  });
}

// ---- 共用 ----

function memberToJson_(m) {
  var groups = {};
  MEMBER_GROUP_COLUMNS.forEach(function (t) { groups[t] = m[t]; });
  var by = Number(m['出生年']) || 0;
  return { row: m._row, name: m['姓名'], identity: m['身分'], groups: groups, note: m['備註'], active: m['啟用中'] !== '否', pending: m['待確認'] === '是',
    vegetarian: m['清口'] === '是', birthYear: by || '', age: by ? Number(todayString_().slice(0, 4)) - by : '', temple: m['佛堂'] || '', aliases: splitAliases_(m['別名']), overseas: m['國外'] || '', careNote: m['成全紀錄'] || '' };
}

/** 以列號找資料並核對原本的值（姓名或組名），不符代表資料已被移動或修改 */
function findRowChecked_(rows, rowNumber, key, original, label) {
  var row = rows.filter(function (r) { return r._row === Number(rowNumber); })[0];
  if (!row || row[key] !== String(original || '')) {
    throw new ApiError_('CONFLICT', label + '資料已經被修改過，請重新整理後再試');
  }
  return row;
}

/** 分組改名：勤務的負責組、成員的組別一併改成新名字 */
function renameGroupRefs_(type, oldName, newName) {
  var count = { duties: 0, members: 0 };
  readTable_(SHEETS.DUTIES).forEach(function (d) {
    if (d['分組類型'] === type && d['負責組'] === oldName) { updateRow_(SHEETS.DUTIES, d, { '負責組': newName }); count.duties++; }
  });
  if (MEMBER_GROUP_COLUMNS.indexOf(type) !== -1) {
    readTable_(SHEETS.MEMBERS).forEach(function (m) {
      if (m[type] === oldName) { var c = {}; c[type] = newName; updateRow_(SHEETS.MEMBERS, m, c); count.members++; }
    });
  }
  return count;
}

/**
 * 從出勤紀錄加入成員：列出報名紀錄（有效）裡出現、但成員名單還沒有的名字。
 * 身分取報名紀錄裡出現最多次的（壇辦／道親，都沒有就空白）；和現有成員名字相近的附上 similar，讓管理者確認。
 */
function adminMemberCandidates_() {
  var existing = readTable_(SHEETS.MEMBERS).map(function (m) { return normalizeName_(m['姓名']); }).filter(function (n) { return n; });
  var has = {};
  existing.forEach(function (n) { has[n] = true; });
  readTable_(SHEETS.MEMBERS).forEach(function (m) { if (m['姓名']) has[normalizeName_(m['姓名']) + '|' + (m['佛堂'] || '')] = true; });
  ignoredCandidates_().forEach(function (n) { has[n] = true; }); // 清掉過的不再列出
  var map = {};
  readTableCached_(SHEETS.SIGNUPS).forEach(function (s) {
    if (s['狀態'] === '已取消') return;
    var name = normalizeName_(s['姓名']);
    var temple = s['佛堂'] || '';
    if (!name || has[name + '|' + temple] || (!temple && has[name])) return;
    var key = name + '|' + temple;
    var c = map[key] || (map[key] = { name: name, temple: temple, count: 0, tan: 0, dao: 0, wei: 0, dian: 0, last: '' });
    c.count++;
    if (s['身分'] === '壇辦') c.tan++;
    if (s['身分'] === '道親') c.dao++;
    if (s['身分'] === '未求道') c.wei++;
    if (s['身分'] === '點傳師') c.dian++;
    if (s['日期'] > c.last) c.last = s['日期'];
  });
  var list = Object.keys(map).map(function (k) {
    var c = map[k];
    return {
      name: c.name, temple: c.temple, count: c.count, last: c.last,
      identity: c.dian ? '點傳師' : !(c.tan || c.dao || c.wei) ? '' : c.wei > c.dao && c.wei > c.tan ? '未求道' : c.dao > c.tan ? '道親' : '壇辦',
      similar: existing.filter(function (n) { return sameName_(n, c.name); }).slice(0, 3)
    };
  });
  list.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  return { candidates: list };
}

/** body = { members: [{ name, identity }] }：一次加入多位成員（已存在的略過） */
function adminAddMembers_(body) {
  var input = Array.isArray(body.members) ? body.members : [];
  if (!input.length) throw new ApiError_('BAD_REQUEST', '沒有要加入的成員');
  if (input.length > 1000) throw new ApiError_('BAD_REQUEST', '一次最多加入 1000 位');
  return withSignupLock_(function () {
    var has = {};
    readTable_(SHEETS.MEMBERS).forEach(function (m) { has[normalizeName_(m['姓名']) + '|' + (m['佛堂'] || '')] = true; });
    var rows = [];
    var skipped = 0;
    input.forEach(function (m) {
      var name = normalizeName_(m && m.name);
      var key = name + '|' + cleanText_((m && m.temple) || '');
      if (!name || has[key]) { skipped++; return; }
      has[key] = true;
      rows.push({ '姓名': name, '身分': OPTIONS.identity.indexOf(m.identity) !== -1 ? m.identity : '', '佛堂': cleanText_((m && m.temple) || ''), '啟用中': '是' });
    });
    appendRows_(SHEETS.MEMBERS, rows);
    if (rows.length) writeDutyLog_('成員', '從出勤紀錄加入 ' + rows.length + ' 位');
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
    return { added: rows.length, skipped: skipped };
  });
}

/**
 * 合併同一人的不同寫法：把「報名」分頁裡 from 這些名字改成 to（含已取消的紀錄），統計才不會算成兩個人。
 * body = { merges: [{ from: ['小明'], to: '王小明' }] }
 */
function adminMergeNames_(body) {
  var merges = (Array.isArray(body.merges) ? body.merges : []).map(function (m) {
    return {
      to: normalizeName_(m && m.to),
      from: (Array.isArray(m && m.from) ? m.from : []).map(normalizeName_).filter(function (n) { return n; })
    };
  }).filter(function (m) { return m.to && m.from.length; });
  if (!merges.length) throw new ApiError_('BAD_REQUEST', '沒有要合併的名字');
  var map = {};
  merges.forEach(function (m) { m.from.forEach(function (n) { if (n !== m.to) map[n] = m.to; }); });

  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.SIGNUPS);
    var headers = SHEETS.SIGNUPS.headers;
    var nameCol = headers.indexOf('姓名') + 1;
    var statusCol = headers.indexOf('狀態') + 1;
    var changed = 0;
    var dropped = 0;
    if (rows.length) {
      // 同一場同一天已經有統一後的名字（例如「小明」「王小明」都記在同一場）→ 改名的那筆改成已取消，避免算兩次
      var key = function (r, name) { return r['勤務ID'] + '|' + r['日期'] + '|' + name; };
      var present = {};
      rows.forEach(function (r) { if (r['狀態'] !== '已取消') present[key(r, normalizeName_(r['姓名']))] = true; });
      var first = rows[0]._row;
      var count = rows[rows.length - 1]._row - first + 1;
      var sheet = getSheet_(SHEETS.SIGNUPS);
      // 整欄讀出來改完一次寫回（逐列寫太慢）；空白列保留原值
      var nameRange = sheet.getRange(first, nameCol, count, 1);
      var statusRange = sheet.getRange(first, statusCol, count, 1);
      var names = nameRange.getDisplayValues();
      var statuses = statusRange.getDisplayValues();
      rows.forEach(function (r) {
        var to = map[normalizeName_(r['姓名'])];
        if (!to) return;
        var i = r._row - first;
        names[i][0] = to;
        changed++;
        if (r['狀態'] !== '已取消') {
          if (present[key(r, to)]) { statuses[i][0] = '已取消'; dropped++; } else present[key(r, to)] = true;
        }
      });
      if (changed) nameRange.setValues(names);
      if (dropped) statusRange.setValues(statuses);
    }
    writeDutyLog_('修正', '合併同一人寫法：' + merges.map(function (m) { return m.from.join('／') + ' → ' + m.to; }).join('；') +
      '（' + changed + ' 筆報名' + (dropped ? '，其中 ' + dropped + ' 筆同一場重複、改為已取消' : '') + '）');
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { changed: changed, dropped: dropped };
  });
}

/** 不要再列在「從出勤紀錄加入成員」的名字（存在指令碼屬性 MEMBER_IGNORE，名字只存在 Google 端） */
function ignoredCandidates_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('MEMBER_IGNORE') || '[]');
  } catch (e) {
    return [];
  }
}

/**
 * 清掉「從出勤紀錄加入成員」剩下的名字。body = { names: [], cancelSignups: true|false }
 *   cancelSignups=false：只是不要再列出（出勤紀錄保留，統計照算）
 *   cancelSignups=true ：這些名字的有效出勤紀錄也改成已取消（統計不再算；紀錄還在，可在試算表改回）
 */
function adminClearCandidates_(body) {
  var names = (Array.isArray(body.names) ? body.names : []).map(normalizeName_).filter(function (n) { return n; });
  if (!names.length) throw new ApiError_('BAD_REQUEST', '沒有要清掉的名字');
  return withSignupLock_(function () {
    var list = ignoredCandidates_();
    names.forEach(function (n) { if (list.indexOf(n) === -1) list.push(n); });
    PropertiesService.getScriptProperties().setProperty('MEMBER_IGNORE', JSON.stringify(list));
    var cancelled = 0;
    if (body.cancelSignups) {
      var set = {};
      names.forEach(function (n) { set[n] = true; });
      var now = nowString_();
      readTable_(SHEETS.SIGNUPS).forEach(function (s) {
        if (s['狀態'] === '已取消' || !set[normalizeName_(s['姓名'])]) return;
        updateRow_(SHEETS.SIGNUPS, s, { '狀態': '已取消', '更新時間': now });
        cancelled++;
      });
      invalidateTable_(SHEETS.SIGNUPS);
    }
    writeDutyLog_('修正', '清掉出勤紀錄裡的名字：' + names.join('、') + (body.cancelSignups ? '（取消 ' + cancelled + ' 筆出勤紀錄）' : '（只是不再列出）'));
    SpreadsheetApp.flush();
    return { ignored: names.length, cancelled: cancelled };
  });
}

/** body = { row, original }：刪除成員（只能刪已停用的；過去的報名紀錄不受影響） */
function adminDeleteMember_(body) {
  return withSignupLock_(function () {
    var row = findRowChecked_(readTable_(SHEETS.MEMBERS), body.row, '姓名', body.original, '成員');
    if (row['啟用中'] !== '否' && row['待確認'] !== '是') throw new ApiError_('FORBIDDEN', '只能刪除已停用的成員，請先停用'); // 待確認的可以直接刪
    deleteRows_(SHEETS.MEMBERS, [row._row]);
    writeDutyLog_('成員', '刪除｜' + row['姓名'], rowSnapshot_(SHEETS.MEMBERS, row));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
    return {};
  });
}

// ---------- 新名字自動加入（待確認） ----------

/** 報名、補登、匯入後呼叫（已在鎖定內）：名單上沒有的名字加一列「待確認」 */
function addPendingMembers_(signupRows, dutyName) {
  if (!signupRows || !signupRows.length) return 0;
  var has = {};
  readTable_(SHEETS.MEMBERS).forEach(function (m) { if (m['姓名']) { has[normalizeName_(m['姓名'])] = true; has[normalizeName_(m['姓名']) + '|' + (m['佛堂'] || '')] = true; } });
  var add = [];
  signupRows.forEach(function (r) {
    var name = normalizeName_(r['姓名']);
    var temple = r['佛堂'] || '';
    // 名單上已經有這個名字（沒選佛堂）或同名同佛堂的，不再加
    if (!name || has[name + '|' + temple] || (!temple && has[name])) return;
    has[name + '|' + temple] = true;
    has[name] = true;
    add.push({ '姓名': name, '身分': OPTIONS.identity.indexOf(r['身分']) !== -1 ? r['身分'] : '', '佛堂': temple, '備註': '自動加入：' + r['日期'] + ' ' + (dutyName || ''), '啟用中': '是', '待確認': '是' });
  });
  if (!add.length) return 0;
  appendRows_(SHEETS.MEMBERS, add);
  invalidateTable_(SHEETS.MEMBERS);
  return add.length;
}

/** body = { rows: [{ row, original }] }：待確認的人一次保留 */
function adminConfirmMembers_(body) {
  var list = Array.isArray(body.rows) ? body.rows : [];
  if (!list.length) throw new ApiError_('BAD_REQUEST', '沒有要保留的人');
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.MEMBERS);
    var names = [];
    list.forEach(function (x) {
      var row = findRowChecked_(rows, x.row, '姓名', x.original, '成員');
      if (row['待確認'] === '是') { updateRow_(SHEETS.MEMBERS, row, { '待確認': '' }); names.push(row['姓名']); }
    });
    if (names.length) writeDutyLog_('成員', '確認新成員 ' + names.length + ' 位：' + names.join('、'));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
    return { confirmed: names.length };
  });
}

/** body = { row, original, to }：待確認的名字其實是名單上的 to：報名紀錄改成 to，再刪掉這一列 */
function adminMergePendingMember_(body) {
  var to = normalizeName_(body.to);
  if (!to) throw new ApiError_('BAD_REQUEST', '請選要合併到哪一位');
  var rows = readTable_(SHEETS.MEMBERS);
  var row = findRowChecked_(rows, body.row, '姓名', body.original, '成員');
  if (row['待確認'] !== '是') throw new ApiError_('BAD_REQUEST', '這位不是待確認的新成員');
  var target = rows.filter(function (m) { return normalizeName_(m['姓名']) === to && m !== row; })[0];
  if (!target) throw new ApiError_('NOT_FOUND', '成員名單上沒有「' + to + '」');
  var from = normalizeName_(row['姓名']);
  var res = adminMergeNames_({ merges: [{ from: [from], to: to }] });
  withSignupLock_(function () {
    var fresh = findRowChecked_(readTable_(SHEETS.MEMBERS), body.row, '姓名', body.original, '成員');
    deleteRows_(SHEETS.MEMBERS, [fresh._row]);
    writeDutyLog_('成員', '待確認的「' + from + '」合併到「' + to + '」');
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
  });
  return res;
}

// ---------- 清口、年齡 ----------

/** 年齡 → 出生年（西元）；空白回 ''，不合理回 null */
function birthYearOf_(age) {
  var t = String(age === undefined || age === null ? '' : age).replace(/[\s歲]/g, '');
  if (!t) return '';
  if (!/^\d{1,3}$/.test(t) || Number(t) > 120) return null;
  return String(Number(todayString_().slice(0, 4)) - Number(t));
}

/**
 * body = { items: [{ row, original, vegetarian?, age? }] }：改清口、年齡（總管理者、道務帳號；道務只能改這兩項）
 */
function adminSetMemberExtra_(body) {
  var role = ADMIN_SESSION_.role;
  if (role !== SUPER_ACCOUNT && role !== '道務') throw new ApiError_('FORBIDDEN', '只有總管理者、道務帳號能改清口、年齡、佛堂、身分和成全紀錄');
  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new ApiError_('BAD_REQUEST', '沒有要修改的成員');
  var bad = items.filter(function (x) { return x.age !== undefined && birthYearOf_(x.age) === null; });
  if (bad.length) throw new ApiError_('VALIDATION', '年齡請填 0～120 的數字', bad.map(function (x) { return { message: (x.original || '') + '：' + x.age }; }));
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.MEMBERS);
    var done = [];
    items.forEach(function (x) {
      var row = findRowChecked_(rows, x.row, '姓名', x.original, '成員');
      var ch = {};
      if (x.vegetarian !== undefined) ch['清口'] = x.vegetarian ? '是' : '';
      if (x.age !== undefined) ch['出生年'] = birthYearOf_(x.age);
      if (x.temple !== undefined) ch['佛堂'] = cleanText_(x.temple).slice(0, 30);
      if (x.identity !== undefined) {
        if (x.identity && OPTIONS.identity.indexOf(x.identity) === -1) throw new ApiError_('VALIDATION', '身分只能是' + OPTIONS.identity.join('、'));
        ch['身分'] = x.identity || '';
      }
      if (x.careNote !== undefined) ch['成全紀錄'] = String(x.careNote || '').replace(/\r/g, '').trim().slice(0, 300);
      if (!Object.keys(ch).length) return;
      updateRow_(SHEETS.MEMBERS, row, ch);
      done.push(row['姓名'] + (ch['清口'] !== undefined ? (ch['清口'] ? ' 已清口' : ' 還沒清口') : '') + (ch['出生年'] !== undefined ? (ch['出生年'] ? ' ' + x.age + ' 歲' : ' 清掉年齡') : '') + (ch['佛堂'] !== undefined ? ' 佛堂：' + (ch['佛堂'] || '（空白）') : '') + (ch['身分'] !== undefined ? ' 身分：' + (ch['身分'] || '（空白）') : '') + (ch['成全紀錄'] !== undefined ? ' 更新成全紀錄' : ''));
    });
    if (done.length) writeDutyLog_('成員', (role === SUPER_ACCOUNT ? '總管理者' : ADMIN_SESSION_.account) + '｜' + done.join('、'));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
    return adminMembers_();
  });
}

// ---------- 別名、合併成同一人 ----------

/** 別名不能是別人的名字或別名；有衝突回傳說明，沒有回空字串 */
function aliasClash_(rows, self, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    var a = aliases[i];
    var other = rows.filter(function (m) {
      return m !== self && m['姓名'] && (normalizeName_(m['姓名']) === a || splitAliases_(m['別名']).indexOf(a) !== -1);
    })[0];
    if (other) return '別名「' + a + '」已經是「' + other['姓名'] + '」的' + (normalizeName_(other['姓名']) === a ? '名字' : '別名') + '；是同一個人的話，請用「和另一位是同一人」合併';
  }
  return '';
}

/**
 * body = { keep: { row, original }, drop: { row, original } }：兩位其實是同一人，留 keep（主要名字，通常是真名），
 * drop 的名字和別名變成 keep 的別名；keep 沒填的身分、組別、年齡、佛堂、清口、備註用 drop 的補上；
 * 報名紀錄 drop 的名字改成 keep 的（同一場重複只留一筆）；刪掉 drop 那一列。
 */
function adminMergeMembers_(body) {
  var k = body.keep || {};
  var d = body.drop || {};
  var rows = readTable_(SHEETS.MEMBERS);
  var keep = findRowChecked_(rows, k.row, '姓名', k.original, '成員');
  var drop = findRowChecked_(rows, d.row, '姓名', d.original, '成員');
  if (keep === drop) throw new ApiError_('BAD_REQUEST', '請選另一位');
  var keepName = normalizeName_(keep['姓名']);
  var dropName = normalizeName_(drop['姓名']);
  var res = keepName !== dropName ? adminMergeNames_({ merges: [{ from: [dropName].concat(splitAliases_(drop['別名'])), to: keepName }] }) : { changed: 0, dropped: 0 };
  withSignupLock_(function () {
    var fresh = readTable_(SHEETS.MEMBERS);
    var kk = findRowChecked_(fresh, k.row, '姓名', k.original, '成員');
    var dd = findRowChecked_(fresh, d.row, '姓名', d.original, '成員');
    var aliases = splitAliases_(kk['別名']).concat([dropName], splitAliases_(dd['別名']))
      .filter(function (a, i, arr) { return a && a !== keepName && arr.indexOf(a) === i; });
    var ch = { '別名': aliases.join('、') };
    ['身分', '勤務了愿組', '打掃組', '拜香輪值組', '出生年', '佛堂', '清口'].forEach(function (h) { if (!kk[h] && dd[h]) ch[h] = dd[h]; });
    if (dd['備註'] && String(kk['備註'] || '').indexOf(dd['備註']) === -1) ch['備註'] = [kk['備註'], dd['備註']].filter(Boolean).join('；');
    if (dd['待確認'] !== '是' && kk['待確認'] === '是') ch['待確認'] = '';
    updateRow_(SHEETS.MEMBERS, kk, ch);
    deleteRows_(SHEETS.MEMBERS, [dd._row]);
    writeDutyLog_('成員', '合併成同一人｜「' + dropName + '」併入「' + keepName + '」（變成別名；報名紀錄改名 ' + res.changed + ' 筆' + (res.dropped ? '，同一場重複 ' + res.dropped + ' 筆改為已取消' : '') + '）');
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
  });
  return { changed: res.changed, dropped: res.dropped, members: adminMembers_().members };
}

// ---------- 匯入成員資料（佛堂、年齡、身分） ----------

/**
 * body = { items: [{ name, temple?, birthYear? | age?, identity?, vegetarian?, overseas? }], addMissing? }：依名字（或別名）更新成員的佛堂、出生年、身分、清口、國外。
 * 只更新有給的欄位；找不到的回報（addMissing 時新增）；同名好幾位分不出來的不改。
 */
function adminImportMembers_(body) {
  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new ApiError_('BAD_REQUEST', '沒有要匯入的資料');
  if (items.length > 2000) throw new ApiError_('BAD_REQUEST', '一次最多 2000 筆');
  var year = Number(todayString_().slice(0, 4));
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.MEMBERS).filter(function (m) { return m['姓名']; });
    var updated = [];
    var missing = [];
    var ambiguous = [];
    var added = [];
    items.forEach(function (it) {
      var name = normalizeName_(it && it.name);
      if (!name) return;
      var ch = {};
      var temple = cleanText_(it.temple || '');
      if (temple) ch['佛堂'] = temple;
      var by = Number(it.birthYear) || 0;
      if (!by && it.age !== undefined && it.age !== '') { var b = birthYearOf_(it.age); if (b) by = Number(b); }
      if (by && by > 1900 && by <= year) ch['出生年'] = String(by);
      if (it.identity && OPTIONS.identity.indexOf(it.identity) !== -1) ch['身分'] = it.identity;
      if (it.vegetarian === true) ch['清口'] = '是';
      if (it.overseas && SITE.overseas.indexOf(it.overseas) !== -1) ch['國外'] = it.overseas;
      var hits = rows.filter(function (m) { return normalizeName_(m['姓名']) === name; });
      if (!hits.length) hits = rows.filter(function (m) { return splitAliases_(m['別名']).indexOf(name) !== -1; });
      // 同名好幾位：用佛堂分
      if (hits.length > 1 && temple) hits = hits.filter(function (m) { return m['佛堂'] === temple; });
      if (hits.length > 1) { ambiguous.push(name); return; }
      if (!hits.length) {
        if (body.addMissing) {
          var row = Object.assign({ '姓名': name, '啟用中': '是' }, ch);
          appendRows_(SHEETS.MEMBERS, [row]);
          added.push(name);
        } else missing.push(name);
        return;
      }
      if (!Object.keys(ch).length) return;
      updateRow_(SHEETS.MEMBERS, hits[0], ch);
      updated.push(name);
    });
    if (updated.length || added.length) writeDutyLog_('成員', '匯入成員資料｜更新 ' + updated.length + ' 位' + (added.length ? '、新增 ' + added.length + ' 位' : ''));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.MEMBERS);
    return { updated: updated, added: added, missing: missing, ambiguous: ambiguous };
  });
}

// ---------- 同名的舊報名紀錄：補上是哪個佛堂的那位 ----------

/** 成員名單上同名、不同佛堂的名字 → 佛堂清單 */
function sameNameTemples_() {
  var map = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (!m['姓名'] || !m['佛堂'] || m['待確認'] === '是') return;
    var n = normalizeName_(m['姓名']);
    (map[n] = map[n] || []);
    if (map[n].indexOf(m['佛堂']) === -1) map[n].push(m['佛堂']);
  });
  var out = {};
  Object.keys(map).forEach(function (n) { if (map[n].length > 1) out[n] = map[n]; });
  return out;
}

/** 沒填佛堂、而且名字在成員名單上有同名不同佛堂的報名：[{ name, temples, signups: [{ id, date, duty }] }] */
function adminSameNameSignups_() {
  var multi = sameNameTemples_();
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) { duties[d['勤務ID']] = d['名稱']; });
  var groups = {};
  readTable_(SHEETS.SIGNUPS).forEach(function (s) {
    if (s['狀態'] === '已取消' || s['佛堂']) return;
    var n = normalizeName_(s['姓名']);
    if (!multi[n]) return;
    (groups[n] = groups[n] || []).push({ id: s['報名ID'], date: s['日期'], duty: duties[s['勤務ID']] || '' });
  });
  return {
    items: Object.keys(groups).sort().map(function (n) {
      return { name: n, temples: multi[n], signups: groups[n].sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }) };
    })
  };
}

/** body = { items: [{ id, temple }] }：把舊報名指給某個佛堂的那位 */
function adminAssignSignupTemple_(body) {
  var items = Array.isArray(body.items) ? body.items.filter(function (x) { return x && x.id && x.temple; }) : [];
  if (!items.length) throw new ApiError_('BAD_REQUEST', '沒有要修改的報名');
  if (items.length > 2000) throw new ApiError_('BAD_REQUEST', '一次最多 2000 筆');
  var multi = sameNameTemples_();
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.SIGNUPS);
    var done = 0;
    var names = {};
    items.forEach(function (x) {
      var row = rows.filter(function (r) { return r['報名ID'] === x.id; })[0];
      if (!row) return;
      var n = normalizeName_(row['姓名']);
      var temple = cleanText_(x.temple);
      if (!multi[n] || multi[n].indexOf(temple) === -1) return; // 只能選成員名單上這個名字有的佛堂
      updateRow_(SHEETS.SIGNUPS, row, { '佛堂': temple, '更新時間': nowString_() });
      done++;
      names[n + '（' + temple + '）'] = (names[n + '（' + temple + '）'] || 0) + 1;
    });
    if (done) writeDutyLog_('報名', '同名的舊紀錄補佛堂｜' + Object.keys(names).map(function (k) { return k + ' ' + names[k] + ' 筆'; }).join('、'));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SIGNUPS);
    return { updated: done };
  });
}
