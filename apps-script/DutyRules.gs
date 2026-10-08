/**
 * 勤務新增、修改的純邏輯判斷（規格第 8 節管理者後台第 2、3 項）。
 * 本檔不呼叫任何 Apps Script 服務，可在 Node 直接測試（tests/duty-admin.test.js）。
 * 用到 Rules.gs 的 isDateString_、datesInRange_、parseLimit_、normalizeName_。
 *
 * 前端送來的勤務格式（與 dutyToJson_ 相同的英文欄位）：
 *   { name, nature, mode, start, end, startTime, endTime, location, groupType, group, attire, description,
 *     positions: [{ id?, name, slot, min, max }] }   min／max 空白代表預設（最少 2、最多不限）
 */

var MAX_DUTY_DAYS = 60;
var MAX_LIMIT = 999;

/** 英文欄位 → 「勤務」分頁欄位 */
var DUTY_FIELD_MAP_ = {
  name: '名稱', nature: '性質', mode: '模式', start: '開始日', end: '結束日',
  startTime: '開始時間', endTime: '結束時間', location: '地點',
  groupType: '分組類型', group: '負責組', attire: '服裝', description: '說明', deadline: '報名截止日', multi: '可兼任', totalNeed: '共需人數', leaderTitle: '組長職稱', category: '類別', dm: 'DM',
  layout: '版面', stages: '階段', teachers: '師資', merge: '合併顯示',
  lecturers: '講師', leaders: '帶班', assistants: '助理帶班'
};

// 道務的負責人員欄位（統計「負責人員」用）
var STAFF_FIELDS_ = ['講師', '帶班', '助理帶班'];

/** 人名清單：逗號、頓號、空白都當分隔，統一用「、」 */
function cleanNames_(v) {
  return cleanText_(v).split(/[、，,／\/\s]+/).filter(Boolean).join('、');
}

/**
 * 同名勤務一次改可以套用的欄位（日期不行；負責組要和分組類型一起改）。
 * 「同名」以 seriesKey_ 比對，所以每月名稱不同的「九月初一拜香輪值」「十月初一拜香輪值」也算同名。
 */
var BULK_FIELDS_ = ['name', 'nature', 'mode', 'time', 'location', 'group', 'attire', 'description', 'positions', 'teachers', 'dm', 'merge', 'staff'];

function cleanText_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/^[\s　]+|[\s　]+$/g, '');
}

/** 人數欄位：空白 → ''；其他轉成整數字串，格式錯誤回傳 null */
function cleanLimit_(v) {
  var s = cleanText_(v);
  if (s === '') return '';
  if (!/^\d+$/.test(s)) return null;
  var n = Number(s);
  return n > MAX_LIMIT ? null : String(n);
}

function isTimeString_(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 「9:00」→「09:00」，空白不變 */
function cleanTime_(v) {
  var s = cleanText_(v).replace('：', ':');
  var m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2] : s;
}

/**
 * 整理並檢查一筆勤務。
 * ctx: { groups: ['分組類型|組名', ...]（負責組必須存在） }
 * 回傳 { duty: { 名稱: ..., ... }, positions: [{ id, 了愿項目名稱, 時段, 最少, 最多 }], errors: [字串] }
 */
// 每個類別可選的性質（道務、教育是自由參加的法會、課程、活動）
var NATURES_BY_CATEGORY_ = { 勤務: ['勤務', '支援', '烹飪', '活動'], 道務: ['法會', '課程', '會議'], 教育: ['課程', '活動'] };
var DM_MAX = 5;

/** DM 附件清單：[{ id, name, mime }]（最多 5 個）→ 存成 JSON 文字；格式不對的略過 */
function cleanDm_(v) {
  var list = Array.isArray(v) ? v : [];
  if (typeof v === 'string' && v) { try { list = JSON.parse(v); } catch (e) { list = []; } }
  list = list.filter(function (x) {
    return x && /^F-[\w-]{6,40}$/.test(String(x.id)) && /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(String(x.mime));
  }).slice(0, DM_MAX).map(function (x) { return { id: String(x.id), name: cleanText_(x.name).slice(0, 80), mime: String(x.mime) }; });
  return list.length ? JSON.stringify(list) : '';
}

/** 勤務的 DM 欄位（JSON 文字）→ 陣列 */
function parseDm_(text) {
  if (!text) return [];
  try { var v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function normalizeDutyInput_(input, ctx) {
  input = input || {};
  ctx = ctx || {};
  var errors = [];
  var duty = {};
  Object.keys(DUTY_FIELD_MAP_).forEach(function (k) { duty[DUTY_FIELD_MAP_[k]] = cleanText_(input[k]); });
  duty['開始時間'] = cleanTime_(duty['開始時間']);
  duty['結束時間'] = cleanTime_(duty['結束時間']);
  // 可兼任：同一人同一天可報多個了愿項目（是／空白）
  duty['可兼任'] = input.multi === true || input.multi === '是' || input.multi === 'true' ? '是' : '';
  // 共需人數：可兼任時這一天總共需要幾位（不重複的人）；空白＝照各項目最少人數
  var need = String(input.totalNeed === undefined || input.totalNeed === null ? '' : input.totalNeed).trim();
  if (need && !/^\d{1,3}$/.test(need)) errors.push('共需人數請填數字');
  duty['共需人數'] = duty['可兼任'] && /^\d{1,3}$/.test(need) && Number(need) > 0 ? String(Number(need)) : '';
  // 組長職稱：每天要一位組長（例：勤務組長）；只有總務・勤務的報名型
  duty['組長職稱'] = cleanText_(input.leaderTitle || '').slice(0, 10);
  if (duty['模式'] === '公告型' || (duty['類別'] || '勤務') !== '勤務') duty['組長職稱'] = '';
  duty['DM'] = cleanDm_(input.dm);
  if (!duty['類別']) duty['類別'] = '勤務';
  if (!duty['性質']) duty['性質'] = (NATURES_BY_CATEGORY_[duty['類別']] || ['勤務'])[0];
  if (!duty['模式']) duty['模式'] = '報名型';
  if (!duty['結束日']) duty['結束日'] = duty['開始日'];

  if (!duty['名稱']) errors.push('請填勤務名稱');
  var natures = NATURES_BY_CATEGORY_[duty['類別']] || NATURES_BY_CATEGORY_['勤務'];
  if (natures.indexOf(duty['性質']) === -1) errors.push('「' + (duty['類別'] || '勤務') + '」的性質只能是' + natures.join('、'));
  if (duty['報名截止日'] && !isDateString_(duty['報名截止日'])) errors.push('報名截止日格式錯誤');
  if (['報名型', '公告型'].indexOf(duty['模式']) === -1) errors.push('模式只能是報名型或公告型');
  if (['勤務', '道務', '教育'].indexOf(duty['類別']) === -1) errors.push('類別只能是勤務、道務或教育');
  if (['', '職司表'].indexOf(duty['版面']) === -1) errors.push('版面只能是空白或職司表');
  // 師資：只有教育；逗號、頓號、空白都當分隔，統一用「、」
  duty['師資'] = duty['類別'] === '教育' ? duty['師資'].split(/[、，,／\/\s]+/).filter(Boolean).join('、') : '';
  if (duty['師資'].length > 200) errors.push('師資太長（最多 200 字）');
  if (duty['合併顯示'].length > 20) errors.push('「和哪個項目合併顯示」最多 20 字');
  STAFF_FIELDS_.forEach(function (k) {
    duty[k] = duty['類別'] === '道務' ? cleanNames_(duty[k]) : '';
    if (duty[k].length > 200) errors.push(k + '太長（最多 200 字）');
  });
  if (duty['階段'].length > 1000) errors.push('階段太長（最多 1000 字）');

  if (!isDateString_(duty['開始日'])) errors.push('開始日格式錯誤');
  else if (!isDateString_(duty['結束日'])) errors.push('結束日格式錯誤');
  else if (duty['結束日'] < duty['開始日']) errors.push('結束日不能早於開始日');
  else if (datesInRange_(duty['開始日'], duty['結束日']).length > MAX_DUTY_DAYS) errors.push('一筆勤務最多 ' + MAX_DUTY_DAYS + ' 天');

  if (duty['開始時間'] && !isTimeString_(duty['開始時間'])) errors.push('開始時間格式錯誤，請用 08:00 這種寫法');
  if (duty['結束時間'] && !isTimeString_(duty['結束時間'])) errors.push('結束時間格式錯誤，請用 08:00 這種寫法');

  if (duty['負責組'] && !duty['分組類型']) errors.push('有負責組時要選分組類型');
  if (duty['分組類型'] && ['勤務了愿組', '打掃組', '拜香輪值組'].indexOf(duty['分組類型']) === -1) errors.push('分組類型不正確');
  if (duty['負責組'] && ctx.groups && ctx.groups.indexOf(duty['分組類型'] + '|' + duty['負責組']) === -1) {
    errors.push('「' + duty['分組類型'] + '」沒有「' + duty['負責組'] + '」這一組');
  }
  // 道務、教育的公告型只是公告（例：月會），不用負責組
  if (duty['模式'] === '公告型' && !duty['負責組'] && (duty['類別'] || '勤務') === '勤務') errors.push('公告型勤務要選輪值的負責組');

  var positions = [];
  if (duty['模式'] === '報名型') {
    var seen = {};
    (input.positions || []).forEach(function (p, i) {
      var name = cleanText_(p && p.name);
      var min = cleanLimit_(p && p.min);
      var max = cleanLimit_(p && p.max);
      var label = name ? '了愿項目「' + name + '」' : '第 ' + (i + 1) + ' 個了愿項目';
      if (!name) errors.push(label + '沒有名稱');
      else if (seen[name]) errors.push('了愿項目「' + name + '」重複');
      seen[name] = true;
      if (min === null) errors.push(label + '的最少人數要是整數');
      if (max === null) errors.push(label + '的最多人數要是整數');
      if (max === '0') errors.push(label + '的最多人數不能是 0');
      if (min && max && Number(min) > Number(max)) errors.push(label + '的最少人數不能大於最多人數');
      positions.push({
        id: cleanText_(p && p.id), '了愿項目名稱': name, '時段': cleanText_(p && p.slot),
        '最少': min || '', '最多': max || ''
      });
    });
    if (!positions.length) errors.push('報名型勤務至少要有一個了愿項目');
  }
  return { duty: duty, positions: positions, errors: errors };
}

/**
 * 修改已有報名的勤務時的限制（規格：有人報名的了愿項目不能刪、有人報名的日期不能移出期間）。
 * oldPositions：這個勤務原本的了愿項目（Sheet 列）；next：normalizeDutyInput_ 的結果；
 * signups：這個勤務的有效報名（Sheet 列）。
 * 回傳 { errors, warnings }（warnings 照樣存檔，只提醒）
 */
function checkDutyChange_(oldPositions, next, signups) {
  var errors = [];
  var warnings = [];
  var active = (signups || []).filter(function (s) { return s['狀態'] !== '已取消'; });
  if (!active.length) return { errors: errors, warnings: warnings };

  if (next.duty['模式'] === '公告型') {
    errors.push('已有 ' + active.length + ' 筆報名，不能改成公告型；請先取消或改期這些報名');
    return { errors: errors, warnings: warnings };
  }

  var keptIds = next.positions.map(function (p) { return p.id; }).filter(function (id) { return id; });
  oldPositions.forEach(function (p) {
    if (keptIds.indexOf(p['了愿項目ID']) !== -1) return;
    var n = active.filter(function (s) { return s['了愿項目ID'] === p['了愿項目ID']; }).length;
    if (n) errors.push('了愿項目「' + p['了愿項目名稱'] + '」已有 ' + n + ' 筆報名，不能刪除；請先取消或改期');
  });

  var byDate = {};
  active.forEach(function (s) { byDate[s['日期']] = (byDate[s['日期']] || 0) + 1; });
  Object.keys(byDate).sort().forEach(function (date) {
    if (date < next.duty['開始日'] || date > next.duty['結束日']) {
      errors.push(shortDate_(date) + ' 已有 ' + byDate[date] + ' 筆報名，不能移出勤務期間；請先取消或改期');
    }
  });

  next.positions.forEach(function (p) {
    if (!p.id || p['最多'] === '') return;
    var counts = {};
    active.forEach(function (s) {
      if (s['了愿項目ID'] === p.id && s['陪同'] !== '是') counts[s['日期']] = (counts[s['日期']] || 0) + 1;
    });
    Object.keys(counts).sort().forEach(function (date) {
      if (counts[date] > Number(p['最多'])) {
        warnings.push(shortDate_(date) + '「' + p['了愿項目名稱'] + '」已有 ' + counts[date] + ' 人，超過新的最多人數 ' + p['最多'] + ' 人');
      }
    });
  });
  return { errors: errors, warnings: warnings };
}

/**
 * 同名勤務一次改：把來源勤務改過的欄位套到另一筆勤務（日期不動）。
 *   target、targetPositions：要套用的勤務（Sheet 列）
 *   sourceOldName、sourceOldPositions：來源勤務修改前的名稱與了愿項目（用來對應改名、刪除）
 *   next：來源勤務修改後（normalizeDutyInput_ 的結果）
 *   fields：BULK_FIELDS_ 的子集合
 * 了愿項目依「修改前的名稱」對應：有對應的更新名稱與人數、來源新增的加上去、來源刪掉的也刪掉。
 * 回傳與前端格式相同的勤務 input，再交給 normalizeDutyInput_ 檢查。
 */
function mergeBulkInput_(target, targetPositions, sourceOldName, sourceOldPositions, next, fields) {
  var has = function (f) { return fields.indexOf(f) !== -1; };
  var src = next.duty;
  var pick = function (field, key) { return has(field) ? src[key] : target[key]; };
  var input = {
    name: has('name') ? renameLike_(target['名稱'], sourceOldName, src['名稱']) : target['名稱'],
    nature: pick('nature', '性質'),
    mode: pick('mode', '模式'),
    start: target['開始日'],
    end: target['結束日'] || target['開始日'],
    startTime: pick('time', '開始時間'),
    endTime: pick('time', '結束時間'),
    location: pick('location', '地點'),
    groupType: pick('group', '分組類型'),
    group: pick('group', '負責組'),
    attire: pick('attire', '服裝'),
    description: pick('description', '說明'),
    deadline: target['報名截止日'] || '', // 報名截止日每筆各自設定，一起改時不動
    // 類別、DM、職司表設定照各筆原本的（沒帶的話會被當成預設值洗掉）
    category: target['類別'] || '勤務',
    dm: has('dm') ? parseDm_(src['DM']) : parseDm_(target['DM']),
    layout: target['版面'] || '',
    stages: target['階段'] || '',
    teachers: pick('teachers', '師資'),
    merge: pick('merge', '合併顯示'),
    lecturers: pick('staff', '講師'),
    leaders: pick('staff', '帶班'),
    assistants: pick('staff', '助理帶班'),
    multi: has('positions') ? src['可兼任'] : target['可兼任'], // 可兼任跟著了愿項目一起改
    totalNeed: has('positions') ? src['共需人數'] : target['共需人數'],
    leaderTitle: has('positions') ? src['組長職稱'] : target['組長職稱']
  };

  var current = targetPositions.map(function (p) {
    return { id: p['了愿項目ID'], name: p['了愿項目名稱'], slot: p['時段'], min: p['最少'], max: p['最多'] };
  });
  if (has('positions')) {
    var oldNameById = {};
    sourceOldPositions.forEach(function (p) { oldNameById[p['了愿項目ID']] = p['了愿項目名稱']; });
    var keptOldNames = {};
    next.positions.forEach(function (p) {
      var oldName = p.id ? oldNameById[p.id] : undefined;
      if (oldName !== undefined) keptOldNames[oldName] = true;
      var match = current.filter(function (c) { return c.name === (oldName !== undefined ? oldName : p['了愿項目名稱']); })[0];
      var values = { name: p['了愿項目名稱'], slot: p['時段'], min: p['最少'], max: p['最多'] };
      if (match) Object.keys(values).forEach(function (k) { match[k] = values[k]; });
      else current.push(values);
    });
    var removedNames = sourceOldPositions
      .map(function (p) { return p['了愿項目名稱']; })
      .filter(function (n) { return !keptOldNames[n]; });
    current = current.filter(function (c) { return !c.id || removedNames.indexOf(c.name) === -1; });
  }
  input.positions = current;
  return input;
}

/**
 * 同名勤務的比對名稱：去掉開頭的農曆日期與結尾的括號說明。
 * 例：「九月初一拜香輪值」「十月十五拜香輪值（大典）」都是「拜香輪值」。
 */
function seriesKey_(name) {
  return cleanText_(name)
    .replace(/^閏?[正一二三四五六七八九十冬臘腊]{1,2}月(初[一二三四五六七八九十]|十[一二三四五六七八九]?|二十[一二三四五六七八九]?|廿[一二三四五六七八九]?|三十)/, '')
    .replace(/[（(][^）)]*[）)]$/, '')
    .replace(/^[\s　]+|[\s　]+$/g, '');
}

/**
 * 同名勤務一起改名：只換掉來源名稱實際改動的那一段。
 * 例：「九月初一拜香輪值」改成「九月初一拜香開課」→「十月初一拜香輪值」變成「十月初一拜香開課」。
 * 對方名稱裡找不到改動的那一段就不改。
 */
function renameLike_(targetName, oldName, newName) {
  if (oldName === newName) return targetName;
  if (targetName === oldName) return newName;
  var p = 0;
  while (p < oldName.length && p < newName.length && oldName[p] === newName[p]) p++;
  var s = 0;
  while (s < oldName.length - p && s < newName.length - p &&
    oldName[oldName.length - 1 - s] === newName[newName.length - 1 - s]) s++;
  var oldMid = oldName.slice(p, oldName.length - s);
  var newMid = newName.slice(p, newName.length - s);
  if (!oldMid) {
    // 純加字：只處理加在最後或最前面
    if (s === 0) return targetName + newMid;
    if (p === 0) return newMid + targetName;
    return targetName;
  }
  return targetName.indexOf(oldMid) !== -1 ? targetName.replace(oldMid, newMid) : targetName;
}

/** 'yyyy-MM-dd' → 'M/D' */
function shortDate_(date) {
  return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10));
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizeDutyInput_: normalizeDutyInput_, checkDutyChange_: checkDutyChange_, mergeBulkInput_: mergeBulkInput_,
    seriesKey_: seriesKey_, renameLike_: renameLike_, cleanTime_: cleanTime_, BULK_FIELDS_: BULK_FIELDS_
  };
}
