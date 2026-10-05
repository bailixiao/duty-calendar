/**
 * 管理後台：勤務的新增、修改、刪除（規格第 8 節管理者後台第 2、3 項）。
 *   - 全部寫入都排進報名的同一把鎖，避免改勤務時剛好有人報名。
 *   - 檢查不通過就整批不寫入，並列出原因。
 *   - 每次都寫入操作紀錄（這幾類紀錄不提供還原）。
 */

var MAX_CREATE_DUTIES = 400;

/** 勤務列表（管理用）：全部勤務的基本資料與有效報名數，由前端篩選月份、搜尋名稱 */
function adminDutyList_() {
  var counts = {};
  activeSignups_().forEach(function (s) { counts[s['勤務ID']] = (counts[s['勤務ID']] || 0) + 1; });
  var duties = readTableCached_(SHEETS.DUTIES).filter(function (d) { return d['勤務ID']; });
  duties.sort(function (a, b) { return a['開始日'] < b['開始日'] ? -1 : a['開始日'] > b['開始日'] ? 1 : 0; });
  return {
    today: todayString_(),
    groups: groupList_(),
    duties: duties.map(function (d) {
      return {
        id: d['勤務ID'], name: d['名稱'], mode: d['模式'] || '報名型', category: dutyCategory_(d),
        start: d['開始日'], end: d['結束日'] || d['開始日'], startTime: d['開始時間'],
        location: d['地點'], groupType: d['分組類型'], group: d['負責組'],
        signups: counts[d['勤務ID']] || 0
      };
    })
  };
}

/** 編輯用：勤務的原始欄位（了愿項目的最少、最多照 Sheet 原樣，空白就是空白），以及其他同名勤務（seriesKey_ 比對） */
function adminDutyForEdit_(body) {
  var duties = readTableCached_(SHEETS.DUTIES);
  var duty = findById_(duties, '勤務ID', body.id);
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務');
  var positions = readTableCached_(SHEETS.POSITIONS).filter(function (p) { return p['勤務ID'] === duty['勤務ID']; });
  var counts = {};
  var signupCount = {};
  activeSignups_().forEach(function (s) {
    signupCount[s['勤務ID']] = (signupCount[s['勤務ID']] || 0) + 1;
    if (s['勤務ID'] === duty['勤務ID']) counts[s['了愿項目ID']] = (counts[s['了愿項目ID']] || 0) + 1;
  });
  return {
    duty: dutyInputFromRow_(duty, positions, counts),
    signups: Object.keys(counts).reduce(function (n, k) { return n + counts[k]; }, 0),
    siblings: duties
      .filter(function (d) { return d['勤務ID'] !== duty['勤務ID'] && seriesKey_(d['名稱']) === seriesKey_(duty['名稱']); })
      .map(function (d) { return { id: d['勤務ID'], name: d['名稱'], start: d['開始日'], end: d['結束日'] || d['開始日'], location: d['地點'], group: d['負責組'], category: dutyCategory_(d), signups: signupCount[d['勤務ID']] || 0, teachers: d['師資'] || '',
        lecturers: d['講師'] || '', leaders: d['帶班'] || '', assistants: d['助理帶班'] || '', description: d['說明'] || '' }; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; }),
    groups: groupList_()
  };
}

/** body = { duties: [勤務 input, ...] }：新增一筆或多筆（農曆規則、批次匯入、另存新勤務都用這個） */
function adminCreateDuties_(body) {
  var inputs = body.duties || [];
  if (!inputs.length) throw new ApiError_('BAD_REQUEST', '沒有要新增的勤務');
  if (inputs.length > MAX_CREATE_DUTIES) throw new ApiError_('BAD_REQUEST', '一次最多新增 ' + MAX_CREATE_DUTIES + ' 筆');

  var ctx = { groups: groupKeys_() };
  var normalized = inputs.map(function (input) { return normalizeDutyInput_(input, ctx); });
  var errors = [];
  normalized.forEach(function (n, i) {
    n.errors.forEach(function (msg) { errors.push({ index: i, message: msg }); });
    // 已分配好的人員：assign = { 了愿項目名稱: [姓名] }（草稿匯入用）
    var assign = inputs[i].assign || {};
    Object.keys(assign).forEach(function (pname) {
      if (!n.positions.some(function (p) { return p['了愿項目名稱'] === cleanText_(pname); })) {
        errors.push({ index: i, message: '分配人員的「' + pname + '」不是這個勤務的了愿項目' });
      }
    });
  });
  if (errors.length) throw new ApiError_('VALIDATION', '勤務資料有錯，沒有新增任何一筆', errors);

  return withSignupLock_(function () {
    // 已經有同類別、同名、同日的勤務：先回報，確認後（allowDuplicate）才新增，避免按兩次或回應卡住時重複建立
    // （道務的「闡道班」課程和勤務的「闡道班」幫忙是不同的，類別不同不算重複）
    if (!body.allowDuplicate) {
      var have = {};
      readTable_(SHEETS.DUTIES).forEach(function (d) { have[dutyCategory_(d) + '|' + d['名稱'] + '|' + d['開始日']] = true; });
      var dups = normalized.filter(function (n) { return have[(n.duty['類別'] || '勤務') + '|' + n.duty['名稱'] + '|' + n.duty['開始日']]; })
        .map(function (n) { return n.duty['名稱'] + '（' + n.duty['開始日'] + '）'; });
      if (dups.length) throw new ApiError_('DUPLICATE', '已經有同名、同一天的勤務', dups.map(function (m) { return { message: m }; }));
    }
    var dutyRows = [];
    var positionRows = [];
    var signupRows = [];
    var ids = [];
    var identity = memberIdentityMap_();
    var now = nowString_();
    normalized.forEach(function (n, i) {
      var id = newId_('D');
      ids.push(id);
      dutyRows.push(Object.assign({ '勤務ID': id }, n.duty));
      var assign = inputs[i].assign || {};
      n.positions.forEach(function (p) {
        var row = positionRow_(p, id);
        positionRows.push(row);
        // 分配好的人記在第一天，身分照成員名單（沒有就空白）
        var people = assign[p['了愿項目名稱']] || [];
        people.map(normalizeName_).filter(function (x) { return x; }).forEach(function (name) {
          signupRows.push({
            '報名ID': newId_('S'), '勤務ID': id, '日期': n.duty['開始日'], '了愿項目ID': row['了愿項目ID'], '姓名': name,
            '身分': identity[name] || '', '陪同': '否', '出席': '出席', '狀態': '有效', '建立時間': now, '更新時間': now
          });
        });
      });
    });
    appendRows_(SHEETS.DUTIES, dutyRows);
    appendRows_(SHEETS.POSITIONS, positionRows);
    appendRows_(SHEETS.SIGNUPS, signupRows);
    if (signupRows.length) invalidateTable_(SHEETS.SIGNUPS);
    writeDutyLog_('新增勤務', createSummary_(dutyRows) + (signupRows.length ? '｜含分配人員 ' + signupRows.length + ' 人' : ''));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    invalidateTable_(SHEETS.POSITIONS);
    return { ids: ids };
  });
}

/**
 * body = { id, duty: 勤務 input, alsoIds?: [同名勤務ID], fields?: [BULK_FIELDS_ 的子集合] }
 * 修改一筆勤務；有 alsoIds 時，把 fields 指定的欄位一起套用到其他同名勤務（日期不動）。
 * 任何一筆不通過就全部不寫入。
 */
function adminUpdateDuty_(body) {
  var ctx = { groups: groupKeys_() };
  var fields = (body.fields || []).filter(function (f) { return BULK_FIELDS_.indexOf(f) !== -1; });
  var alsoIds = fields.length ? (body.alsoIds || []) : [];

  return withSignupLock_(function () {
    var duties = readTable_(SHEETS.DUTIES);
    var positions = readTable_(SHEETS.POSITIONS);
    var signups = readTable_(SHEETS.SIGNUPS);
    var source = findById_(duties, '勤務ID', body.id);
    if (!source) throw new ApiError_('NOT_FOUND', '找不到這個勤務，可能已被刪除');
    var sourceOldPositions = positionsOf_(positions, source['勤務ID']);

    var next = normalizeDutyInput_(body.duty, ctx);
    var foreign = next.positions.filter(function (p) {
      return p.id && !sourceOldPositions.some(function (o) { return o['了愿項目ID'] === p.id; });
    });
    if (foreign.length) throw new ApiError_('BAD_REQUEST', '了愿項目資料不一致，請重新整理後再改');

    var plans = [{ row: source, oldPositions: sourceOldPositions, next: next }];
    alsoIds.forEach(function (id) {
      var d = findById_(duties, '勤務ID', id);
      if (!d || d['勤務ID'] === source['勤務ID']) return;
      if (seriesKey_(d['名稱']) !== seriesKey_(source['名稱'])) throw new ApiError_('BAD_REQUEST', '只能一起修改同名的勤務');
      var oldPs = positionsOf_(positions, id);
      var merged = mergeBulkInput_(d, oldPs, source['名稱'], sourceOldPositions, next, fields);
      plans.push({ row: d, oldPositions: oldPs, next: normalizeDutyInput_(merged, ctx) });
    });

    // 單日活動本身改日期：名單一起移到新日期（活動的參加者不能個別改期）
    var moveTo = null;
    var oldStart = source['開始日']; // 存檔後 source 會被更新，先記住原本的日期
    var wasSingle = (source['結束日'] || source['開始日']) === source['開始日'];
    if (source['性質'] === '活動' && next.duty['性質'] === '活動' && wasSingle &&
        next.duty['開始日'] === next.duty['結束日'] && next.duty['開始日'] !== source['開始日']) {
      moveTo = next.duty['開始日'];
    }

    var errors = [];
    var warnings = [];
    plans.forEach(function (plan) {
      var label = plans.length > 1 ? shortDate_(plan.row['開始日']) + '：' : '';
      var rows = signupsOf_(signups, plan.row['勤務ID']);
      if (moveTo && plan.row === source) {
        rows = rows.map(function (s) { return Object.assign({}, s, { '日期': moveTo }); }); // 檢查時視為已移到新日期
      }
      var change = checkDutyChange_(plan.oldPositions, plan.next, rows);
      plan.next.errors.concat(change.errors).forEach(function (m) { errors.push({ message: label + m }); });
      change.warnings.forEach(function (m) { warnings.push(label + m); });
    });
    if (errors.length) throw new ApiError_('VALIDATION', '勤務沒有存檔，請看下面的說明', errors);

    var deletions = [];
    var appends = [];
    plans.forEach(function (plan) {
      var id = plan.row['勤務ID'];
      updateRow_(SHEETS.DUTIES, plan.row, plan.next.duty);
      var keep = {};
      plan.next.positions.forEach(function (p) {
        var old = p.id ? findById_(plan.oldPositions, '了愿項目ID', p.id) : null;
        if (old) {
          keep[p.id] = true;
          updateRow_(SHEETS.POSITIONS, old, { '了愿項目名稱': p['了愿項目名稱'], '時段': p['時段'], '最少': p['最少'], '最多': p['最多'] });
        } else {
          appends.push(positionRow_(p, id));
        }
      });
      plan.oldPositions.forEach(function (p) {
        if (!keep[p['了愿項目ID']]) deletions.push(p._row);
      });
    });
    appendRows_(SHEETS.POSITIONS, appends);
    deleteRows_(SHEETS.POSITIONS, deletions);
    var moved = 0;
    if (moveTo) {
      var now = nowString_();
      signupsOf_(signups, source['勤務ID']).forEach(function (s) {
        updateRow_(SHEETS.SIGNUPS, s, { '日期': moveTo, '更新時間': now });
        moved++;
      });
      invalidateTable_(SHEETS.SIGNUPS);
    }

    var summary = source['名稱'] + '｜' + oldStart + (moveTo ? ' → ' + moveTo + '（名單 ' + moved + ' 筆一起移過去）' : '') + (plans.length > 1 ? '（連同其他 ' + (plans.length - 1) + ' 筆同名勤務：' + fields.map(bulkFieldLabel_).join('、') + '）' : '');
    writeDutyLog_('修改勤務', summary);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    invalidateTable_(SHEETS.POSITIONS);
    return { id: source['勤務ID'], updated: plans.length, warnings: warnings, moved: moved };
  });
}

/** body = { id }：沒有有效報名才能刪除；勤務與它的了愿項目一起刪掉 */
/** body = { id, alsoIds?: [...] }：刪除勤務；alsoIds＝一起刪的其他同名勤務。全部檢查過才刪，任一筆還有報名就整批不刪 */
function adminDeleteDuty_(body) {
  return withSignupLock_(function () {
    var duties = readTable_(SHEETS.DUTIES);
    var signups = readTable_(SHEETS.SIGNUPS);
    var allPositions = readTable_(SHEETS.POSITIONS);
    var ids = [body.id].concat(body.alsoIds || []).filter(function (id, i, a) { return id && a.indexOf(id) === i; });
    if (ids.length > MAX_CREATE_DUTIES) throw new ApiError_('BAD_REQUEST', '一次最多刪除 ' + MAX_CREATE_DUTIES + ' 筆');
    var targets = ids.map(function (id) {
      var duty = findById_(duties, '勤務ID', id);
      if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務，可能已被刪除');
      return duty;
    });
    var busy = targets.map(function (duty) {
      var n = signupsOf_(signups, duty['勤務ID']).filter(function (s) { return s['狀態'] !== '已取消'; }).length;
      return n ? { message: duty['開始日'] + ' ' + duty['名稱'] + '：還有 ' + n + ' 筆報名' } : null;
    }).filter(Boolean);
    if (busy.length) {
      throw new ApiError_('FORBIDDEN', targets.length > 1 ? '有 ' + busy.length + ' 筆還有報名，整批都沒有刪除；請先取消或改期這些報名，或把它們的勾拿掉' : '這個勤務還有報名，不能刪除；請先取消或改期這些報名', busy);
    }
    var positionRows = [];
    targets.forEach(function (duty) {
      var positions = positionsOf_(allPositions, duty['勤務ID']);
      positions.forEach(function (p) { positionRows.push(p._row); });
      writeDutyLog_('刪除勤務', duty['名稱'] + '｜' + duty['開始日'] + (duty['結束日'] && duty['結束日'] !== duty['開始日'] ? '～' + duty['結束日'] : ''),
        { duty: rowSnapshot_(SHEETS.DUTIES, duty), positions: positions.map(function (p) { return rowSnapshot_(SHEETS.POSITIONS, p); }) });
    });
    deleteRows_(SHEETS.POSITIONS, positionRows);
    deleteRows_(SHEETS.DUTIES, targets.map(function (d) { return d._row; }));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    invalidateTable_(SHEETS.POSITIONS);
    return { id: body.id, deleted: targets.length };
  });
}

/**
 * body = { items: [{ id, teachers }] }：安排整年的師資，一次改好幾堂（只改師資欄，其他不動）。
 * 只能改教育的勤務；任何一筆不通過就全部不寫入。
 */
function adminSetTeachers_(body) {
  // 教育：teachers（師資）；道務：lecturers（講師）、leaders（帶班）、assistants（助理帶班），沒帶的欄位不動
  var KEYS = { teachers: '師資', lecturers: '講師', leaders: '帶班', assistants: '助理帶班' };
  var ALLOW = { 教育: ['teachers'], 道務: ['lecturers', 'leaders', 'assistants'] };
  var items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new ApiError_('BAD_REQUEST', '沒有要修改的人員');
  if (items.length > MAX_CREATE_DUTIES) throw new ApiError_('BAD_REQUEST', '一次最多 ' + MAX_CREATE_DUTIES + ' 堂');
  return withSignupLock_(function () {
    var duties = readTable_(SHEETS.DUTIES);
    var plans = items.map(function (it) {
      var d = findById_(duties, '勤務ID', it.id);
      if (!d) throw new ApiError_('NOT_FOUND', '找不到其中一堂，可能已被刪除，請重新整理');
      var allow = ALLOW[dutyCategory_(d)];
      if (!allow) throw new ApiError_('BAD_REQUEST', '只有教育、道務有負責人員');
      var changes = {};
      allow.forEach(function (k) {
        if (it[k] === undefined) return;
        var v = cleanNames_(it[k]);
        if (v.length > 200) throw new ApiError_('BAD_REQUEST', shortDate_(d['開始日']) + '：' + KEYS[k] + '太長（最多 200 字）');
        if (v !== (d[KEYS[k]] || '')) changes[KEYS[k]] = v;
      });
      return { row: d, changes: changes };
    }).filter(function (p) { return Object.keys(p.changes).length; });
    plans.forEach(function (p) { updateRow_(SHEETS.DUTIES, p.row, p.changes); });
    if (plans.length) {
      writeDutyLog_('修改勤務', plans[0].row['名稱'] + '｜安排人員 ' + plans.length + ' 堂：' + plans.map(function (p) {
        return shortDate_(p.row['開始日']) + ' ' + Object.keys(p.changes).map(function (k) { return k + ' ' + (p.changes[k] || '（空白）'); }).join('，');
      }).join('、'), null);
    }
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.DUTIES);
    return { updated: plans.length };
  });
}

// ---- 共用 ----

function dutyInputFromRow_(d, positions, counts) {
  var input = {};
  Object.keys(DUTY_FIELD_MAP_).forEach(function (k) { input[k] = d[DUTY_FIELD_MAP_[k]] || ''; });
  input.id = d['勤務ID'];
  input.end = input.end || input.start;
  input.mode = input.mode || '報名型';
  input.category = input.category || '勤務';
  input.dm = parseDm_(d['DM']);
  input.positions = positions.map(function (p) {
    return {
      id: p['了愿項目ID'], name: p['了愿項目名稱'], slot: p['時段'], min: p['最少'], max: p['最多'],
      signups: (counts && counts[p['了愿項目ID']]) || 0
    };
  });
  return input;
}

/** 分組類型與組名（不含組長、電話），表單的負責組選單用 */
function groupList_() {
  return readTableCached_(SHEETS.GROUPS)
    .filter(function (g) { return g['分組類型'] && g['組名']; })
    .map(function (g) { return { type: g['分組類型'], name: g['組名'] }; });
}

/** 成員名單上登記的身分（姓名 → 身分） */
function memberIdentityMap_() {
  var map = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (OPTIONS.identity.indexOf(m['身分']) !== -1) map[normalizeName_(m['姓名'])] = m['身分'];
  });
  return map;
}

function groupKeys_() {
  return readTableCached_(SHEETS.GROUPS).map(function (g) { return g['分組類型'] + '|' + g['組名']; });
}

function positionsOf_(positions, dutyId) {
  return positions.filter(function (p) { return p['勤務ID'] === dutyId; });
}

function signupsOf_(signups, dutyId) {
  return signups.filter(function (s) { return s['勤務ID'] === dutyId; });
}

function positionRow_(p, dutyId) {
  return {
    '了愿項目ID': newId_('P'), '勤務ID': dutyId, '了愿項目名稱': p['了愿項目名稱'],
    '時段': p['時段'], '最少': p['最少'], '最多': p['最多']
  };
}

/** 刪除多列（由下往上刪，列號才不會跑掉）。只在鎖定內呼叫 */
function deleteRows_(def, rowNumbers) {
  var sheet = getSheet_(def);
  rowNumbers.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
}

function writeDutyLog_(action, summary, snapshot) {
  appendRows_(SHEETS.LOGS, [{
    '時間': nowString_(),
    '動作': action,
    '報名ID': '',
    '內容摘要': summary,
    '還原用的前一版資料': snapshot ? JSON.stringify(snapshot) : ''
  }]);
}

/** 新增的摘要：一筆寫名稱與日期，多筆寫筆數與日期範圍 */
function createSummary_(rows) {
  if (rows.length === 1) return rows[0]['名稱'] + '｜' + rows[0]['開始日'];
  var names = [];
  rows.forEach(function (r) { if (names.indexOf(r['名稱']) === -1) names.push(r['名稱']); });
  var dates = rows.map(function (r) { return r['開始日']; }).sort();
  return '共 ' + rows.length + ' 筆｜' + names.slice(0, 3).join('、') + (names.length > 3 ? ' 等' : '') +
    '｜' + dates[0] + '～' + dates[dates.length - 1];
}

function bulkFieldLabel_(f) {
  return ({
    name: '名稱', nature: '性質', mode: '模式', time: '時段', location: '地點', group: '負責組',
    attire: '服裝', description: '說明', positions: '了愿項目'
  })[f] || f;
}
