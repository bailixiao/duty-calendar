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

  var json = dutyToJson_(duty, positions);
  json.description = duty['說明'];
  json.today = todayString_();
  json.contact = adminContact_();
  json.days = daysStatus_(duty, positions, signups, datesInRange_(duty['開始日'], duty['結束日']));
  json.signups = signups.map(function (s) {
    return {
      id: s['報名ID'],
      date: s['日期'],
      positionId: s['了愿項目ID'],
      name: s['姓名'],
      accompany: s['陪同'] === '是'
    };
  });

  if (duty['模式'] === '公告型') {
    json.groupInfo = findGroup_(duty['分組類型'], duty['負責組']);
  }
  return json;
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
    .filter(function (m) { return m['姓名'] && m['啟用中'] !== '否'; })
    .map(function (m) {
      return {
        name: normalizeName_(m['姓名']),
        identity: OPTIONS.identity.indexOf(m['身分']) !== -1 ? m['身分'] : '',
        groups: { '佛堂組': m['佛堂組'], '打掃組': m['打掃組'], '班輪值組': m['班輪值組'] }
      };
    })
    .filter(function (m) { return m.name.indexOf(q) !== -1; });

  matched.sort(function (a, b) {
    return memberRank_(a, q, params) - memberRank_(b, q, params) || a.name.localeCompare(b.name, 'zh-Hant');
  });
  return { members: matched.slice(0, MEMBER_SEARCH_LIMIT) };
}

/** 排序：負責組組員優先，其次名字開頭相符 */
function memberRank_(m, q, params) {
  var inGroup = params.groupType && params.group && m.groups[params.groupType] === params.group;
  return (inGroup ? 0 : 2) + (m.name.indexOf(q) === 0 ? 0 : 1);
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
    mode: d['模式'] || '報名型',
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

/** 每一天的人數狀態：{ 'yyyy-MM-dd': { total, shortage, full, counts: { 了愿項目ID: 人數 } } }；公告型回傳空物件 */
function daysStatus_(duty, positions, signups, dates) {
  var days = {};
  if (duty['模式'] === '公告型') return days;
  dates.forEach(function (date) {
    var s = dayStatus_(positions, signups, date);
    var counts = {};
    s.positions.forEach(function (p) { counts[p.id] = p.count; });
    days[date] = { total: s.total, shortage: s.shortage, full: s.full, counts: counts };
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
