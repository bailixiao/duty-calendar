/**
 * 讀取用 API：行事曆勤務、勤務詳情、成員名單。
 * 回傳資料一律逐欄挑選，絕不回傳電話等個資。
 */

var MAX_RANGE_DAYS = 400;

/**
 * 管理者聯絡人（例如「○○○ 後學」）。存在 Script Properties 的 ADMIN_CONTACT，不寫進程式碼（儲存庫公開，不可放人名）。
 * 畫面上「請聯絡管理者」會接上這個名字。
 */
function adminContact_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_CONTACT') || '';
}

/** 負責組的組長或召集人（不含電話）；同一次執行只讀一次分組表 */
var groupLeaderMemo_ = null;
function groupLeader_(groupType, groupName) {
  if (!groupType || !groupName) return '';
  if (!groupLeaderMemo_) {
    groupLeaderMemo_ = {};
    readTableCached_(SHEETS.GROUPS).forEach(function (g) {
      groupLeaderMemo_[g['分組類型'] + '|' + g['組名']] = g['組長或召集人'];
    });
  }
  return groupLeaderMemo_[groupType + '|' + groupName] || '';
}

/** 行事曆區間內的勤務與每日人數（不含名字） */
function getEvents_(params) {
  var from = params.from;
  var to = params.to;
  if (!isDateString_(from) || !isDateString_(to) || from > to) {
    throw new ApiError_('BAD_REQUEST', '日期區間格式錯誤，請用 yyyy-MM-dd');
  }
  if (datesInRange_(from, to).length >= MAX_RANGE_DAYS) {
    throw new ApiError_('BAD_REQUEST', '日期區間太長');
  }

  var duties = readTableCached_(SHEETS.DUTIES).filter(function (d) {
    return d['勤務ID'] && d['開始日'] <= to && (d['結束日'] || d['開始日']) >= from;
  });
  var positionsByDuty = groupBy_(readTableCached_(SHEETS.POSITIONS), '勤務ID');
  var signupsByDuty = groupBy_(activeSignups_(), '勤務ID');

  return {
    from: from,
    to: to,
    today: todayString_(),
    contact: adminContact_(),
    venue: venueApproved_(from, to), // 區中心場地已借出的時段（姓名、用途；不含電話）
    duties: duties.map(function (d) {
      var positions = positionsByDuty[d['勤務ID']] || [];
      var signups = signupsByDuty[d['勤務ID']] || [];
      var json = dutyToJson_(d, positions);
      var start = d['開始日'] > from ? d['開始日'] : from;
      var end = (d['結束日'] || d['開始日']) < to ? (d['結束日'] || d['開始日']) : to;
      json.days = daysStatus_(d, positions, signups, datesInRange_(start, end));
      return json;
    })
  };
}

/** 勤務詳情：說明、了愿項目、每日人數，以及報名名單（名字只在這裡出現） */
function getDuty_(params) {
  var duty = readTableCached_(SHEETS.DUTIES).filter(function (d) { return d['勤務ID'] === params.id; })[0];
  if (!duty) throw new ApiError_('NOT_FOUND', '找不到這個勤務');

  var positions = readTableCached_(SHEETS.POSITIONS).filter(function (p) { return p['勤務ID'] === duty['勤務ID']; });
  var signups = activeSignups_().filter(function (s) { return s['勤務ID'] === duty['勤務ID']; });
  return dutyDetail_(duty, positions, signups);
}

/** 勤務詳情（getDuty 與 getBundle 共用）：positions、signups 為這個勤務的了愿項目與有效報名 */
function dutyDetail_(duty, positions, signups) {
  var json = dutyToJson_(duty, positions);
  json.description = duty['說明'];
  json.stages = duty['階段'] || '';
  json.mergeHost = mergeHost_(duty);
  json.today = todayString_();
  json.contact = adminContact_();
  json.days = daysStatus_(duty, positions, signups, datesInRange_(duty['開始日'], duty['結束日']));
  json.signups = signups.map(function (s) {
    return {
      id: s['報名ID'],
      date: s['日期'],
      positionId: s['了愿項目ID'],
      name: s['姓名'],
      temple: s['佛堂'] || '',
      accompany: s['陪同'] === '是',
      leader: s['組長'] === '是', // 職司表的組長 ★
      note: s['註記'] || ''
    };
  });

  if (duty['模式'] === '公告型' && duty['負責組']) {
    json.groupInfo = findGroup_(duty['分組類型'], duty['負責組']);
  }
  return json;
}

/** 合併顯示：同一天名稱含「合併顯示」文字的項目（例：初一十五班 → 當天的拜香輪值），報名頁放在上面一起看 */
function mergeHost_(duty) {
  var key = cleanText_(duty['合併顯示']);
  var date = duty['開始日'];
  if (!key || (duty['結束日'] && duty['結束日'] !== date)) return null;
  var host = readTableCached_(SHEETS.DUTIES).filter(function (d) {
    return d['勤務ID'] !== duty['勤務ID'] && String(d['名稱']).indexOf(key) !== -1 &&
      d['開始日'] <= date && (d['結束日'] || d['開始日']) >= date;
  })[0];
  if (!host) return null;
  return {
    id: host['勤務ID'], name: host['名稱'], mode: host['模式'] || '報名型', startTime: host['開始時間'], endTime: host['結束時間'],
    location: host['地點'], group: host['負責組'], groupLeader: groupLeader_(host['分組類型'], host['負責組']), attire: host['服裝']
  };
}

var BUNDLE_DETAIL_DAYS = 30;

/**
 * 開網站時一次拿回：行事曆區間（同 getEvents）＋今天起 30 天內每個勤務的詳情與名單（同 getDuty）。
 * Apps Script 每次回應固定約 2 秒，一次打包比點進每個勤務各等一次快很多。名單本來就公開在勤務頁。
 */
function getBundle_(params) {
  var events = getEvents_(params);
  var today = events.today;
  var until = datesInRange_(today, '9999-12-31').slice(0, BUNDLE_DETAIL_DAYS).pop();
  var positionsByDuty = groupBy_(readTableCached_(SHEETS.POSITIONS), '勤務ID');
  var signupsByDuty = groupBy_(activeSignups_(), '勤務ID');
  var details = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) {
    if (!d['勤務ID'] || d['開始日'] > until || (d['結束日'] || d['開始日']) < today) return;
    details[d['勤務ID']] = dutyDetail_(d, positionsByDuty[d['勤務ID']] || [], signupsByDuty[d['勤務ID']] || []);
  });
  events.details = details;
  return events;
}

var MEMBER_SEARCH_LIMIT = 10;

/**
 * 報名時的名字自動提示。至少輸入一個字才回傳，只回名字含有該字串的成員（最多 10 筆），
 * 不提供整份名單。只回姓名、身分（壇辦／道親，用來自動帶入報名表）與所屬組別。
 * params: q（輸入的字）、groupType + group（選填，該組組員排最前面）
 */
function searchMembers_(params) {
  var q = normalizeName_(params.q);
  if (!q) return { members: [] };

  var matched = readTableCached_(SHEETS.MEMBERS)
    .filter(function (m) { return m['姓名'] && m['啟用中'] !== '否' && m['待確認'] !== '是'; }) // 待確認的新名字不提示
    .map(function (m) {
      return {
        name: normalizeName_(m['姓名']),
        temple: m['佛堂'] || '',
        aliases: splitAliases_(m['別名']),
        identity: OPTIONS.identity.indexOf(m['身分']) !== -1 ? m['身分'] : '',
        groups: { '勤務了愿組': m['勤務了愿組'], '打掃組': m['打掃組'], '拜香輪值組': m['拜香輪值組'] }
      };
    })
    .filter(function (m) {
      if (m.name.indexOf(q) !== -1) return true;
      var hit = m.aliases.filter(function (a) { return a.indexOf(q) !== -1; })[0];
      if (hit) m.alias = hit; // 用別名找到的：前端顯示「主要名字（別名）」
      return !!hit;
    })
    .map(function (m) { var o = Object.assign({}, m); delete o.aliases; return o; });

  // 同名的人：前端顯示佛堂
  var count = {};
  matched.forEach(function (m) { count[m.name] = (count[m.name] || 0) + 1; });
  matched.forEach(function (m) { m.dup = count[m.name] > 1; });
  matched.sort(function (a, b) {
    return memberRank_(a, q, params) - memberRank_(b, q, params) || a.name.localeCompare(b.name, 'zh-Hant');
  });
  return { members: matched.slice(0, MEMBER_SEARCH_LIMIT) };
}

/** 排序：負責組組員優先，其次名字開頭相符 */
function memberRank_(m, q, params) {
  var inGroup = params.groupType && params.group && m.groups[params.groupType] === params.group;
  // 完全同名＞開頭相同或只差姓（打「榮欽」找「曾榮欽」）＞其他含這幾個字的
  var givenName = q.length >= 2 && m.name.length > q.length && m.name.length <= q.length + 2 && m.name.slice(-q.length) === q;
  return (inGroup ? 0 : 3) + (m.name === q ? 0 : m.name.indexOf(q) === 0 || givenName ? 1 : 2);
}

// ---- 以下為共用 ----

function activeSignups_() {
  return readTableCached_(SHEETS.SIGNUPS).filter(function (s) { return s['狀態'] !== '已取消'; });
}

function dutyToJson_(d, positions) {
  return {
    id: d['勤務ID'],
    name: d['名稱'],
    nature: d['性質'],
    category: ['勤務', '道務', '教育'].indexOf(d['類別']) !== -1 ? d['類別'] : '勤務',
    dm: parseDm_(d['DM']),
    layout: d['版面'] === '職司表' ? '職司表' : '',
    teachers: d['師資'] || '', // 教育課程的負責師資（報名頁也顯示）
    merge: d['合併顯示'] || '', // 和同一天名稱含這幾個字的項目合在一起顯示（例：拜香輪值）
    lecturers: d['講師'] || '', // 道務的負責人員（報名頁顯示講師、帶班）
    leaders: d['帶班'] || '',
    assistants: d['助理帶班'] || '',
    mode: d['模式'] || '報名型',
    deadline: d['報名截止日'] || '',
    multi: d['可兼任'] === '是',
    leaderTitle: d['組長職稱'] || '', // 每天要一位組長（例：勤務組長），空白＝不需要
    totalNeed: d['可兼任'] === '是' ? Number(d['共需人數']) || 0 : 0, // 可兼任時這一天總共需要幾位（0＝照各項目最少人數）
    start: d['開始日'],
    end: d['結束日'] || d['開始日'],
    startTime: d['開始時間'],
    endTime: d['結束時間'],
    location: d['地點'],
    groupType: d['分組類型'],
    group: d['負責組'],
    groupLeader: groupLeader_(d['分組類型'], d['負責組']),
    attire: d['服裝'],
    positions: positions.map(function (p) {
      return {
        id: p['了愿項目ID'],
        name: p['了愿項目名稱'],
        slot: p['時段'],
        min: effectiveMin_(p), // 留空時預設 2 人
        max: parseLimit_(p['最多'])
      };
    })
  };
}

/** 每一天的人數狀態：{ 'yyyy-MM-dd': { total, people（不重複人數）, shortage, full, counts: { 了愿項目ID: 人數 } } }；公告型回傳空物件 */
function daysStatus_(duty, positions, signups, dates) {
  var days = {};
  if (duty['模式'] === '公告型') return days;
  var free = ['道務', '教育'].indexOf(dutyCategory_(duty)) !== -1; // 道務、教育的活動自由參加，不算缺人
  dates.forEach(function (date) {
    var s = dayStatus_(positions, signups, date);
    var counts = {};
    s.positions.forEach(function (p) { counts[p.id] = p.count; });
    var names = {};
    signups.forEach(function (x) { if (x['日期'] === date && countsTowardQuota_(x)) names[normalizeName_(x['姓名']) + '|' + (x['佛堂'] || '')] = true; });
    var people = Object.keys(names).length;
    // 可兼任且有填共需人數：缺幾人＝共需人數－不重複人數
    var need = duty['可兼任'] === '是' ? Number(duty['共需人數']) || 0 : 0;
    var shortage = free ? 0 : need ? Math.max(need - people, 0) : s.shortage;
    days[date] = { total: s.total, people: people, shortage: shortage, full: s.full, counts: counts };
  });
  return days;
}

/** 公告型勤務的輪值組資訊（不含電話） */
function findGroup_(groupType, groupName) {
  var g = readTableCached_(SHEETS.GROUPS).filter(function (x) {
    return x['分組類型'] === groupType && x['組名'] === groupName;
  })[0];
  if (!g) return { name: groupName, leader: '', assistant: '', members: [] };
  return {
    name: g['組名'],
    leader: g['組長或召集人'],
    assistant: g['佐理'],
    members: splitNames_(g['組員'])
  };
}

/** 「、」「，」「,」或換行分隔的名單 */
function splitNames_(text) {
  return String(text || '').split(/[、，,\n]/).map(normalizeName_).filter(function (s) { return s; });
}

function groupBy_(rows, key) {
  var map = {};
  rows.forEach(function (r) {
    (map[r[key]] = map[r[key]] || []).push(r);
  });
  return map;
}
