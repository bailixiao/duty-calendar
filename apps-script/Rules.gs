/**
 * 報名規則的純邏輯判斷。
 * 本檔不呼叫任何 Apps Script 服務（SpreadsheetApp、Utilities 等），可在 Node 直接測試（tests/rules.test.js）。
 * 資料一律以字串處理：日期 yyyy-MM-dd、陪同「是／否」、狀態「有效／已取消」。
 */

var IDENTITIES_ = ['壇辦', '道親', '未求道', '點傳師']; // 點傳師只由成員名單帶入（報名頁按鈕仍是三種）

/** 去掉名字前後的半形與全形空白 */
function normalizeName_(name) {
  return String(name === undefined || name === null ? '' : name).replace(/^[\s　]+|[\s　]+$/g, '');
}

/**
 * 兩個名字是否視為同一人（同日重複檢查用）：
 * 三個字以上先去掉第一個字（姓），剩下的部分只要有連續兩個字相同就算同一人。
 * 例：「小明」與「王小明」、「王小明」與「林小明」都視為同一人；一個字的名字只比對完全相同。
 */
function sameName_(a, b) {
  a = normalizeName_(a).replace(/[\s　]/g, '');
  b = normalizeName_(b).replace(/[\s　]/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  var kb = nameKeys_(b);
  return nameKeys_(a).some(function (k) { return kb.indexOf(k) !== -1; });
}

// 名字裡出現這些符號＝把好幾個人打在同一格（例：王小明.測試甲）
var NAME_SEPARATORS_ = /[、,，.。．\/／;；|]/;

function trimTemple_(t) { return String(t || '').replace(/^[\s　]+|[\s　]+$/g, ''); }

/** 名字＋佛堂：兩邊都有佛堂且不同就不是同一人，其餘照名字規則（sameName_） */
function samePerson_(nameA, templeA, nameB, templeB) {
  var ta = trimTemple_(templeA);
  var tb = trimTemple_(templeB);
  if (ta && tb && ta !== tb) return false;
  return sameName_(nameA, nameB);
}

function nameKeys_(name) {
  var n = name.length >= 3 ? name.slice(1) : name;
  var keys = [];
  for (var i = 0; i + 1 < n.length; i++) keys.push(n.substr(i, 2));
  return keys;
}

function isDateString_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

/** 開始日到結束日（含）的每一天，回傳 yyyy-MM-dd 陣列 */
function datesInRange_(start, end) {
  var result = [];
  var p = String(start).split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  var last = end || start;
  for (var i = 0; i < 400; i++) {
    var s = d.toISOString().slice(0, 10);
    if (s > last) break;
    result.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

/** 空白代表不限，回傳 null */
function parseLimit_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (s === '') return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

/** 「最少」留空時的預設最少人數（規格第 6 節）；「最多」小於此數時以最多為準 */
var DEFAULT_MIN_PEOPLE = 2;

/** 某了愿項目實際採用的最少人數 */
function effectiveMin_(p) {
  var min = parseLimit_(p['最少']);
  if (min !== null) return min;
  var max = parseLimit_(p['最多']);
  return max !== null ? Math.min(DEFAULT_MIN_PEOPLE, max) : DEFAULT_MIN_PEOPLE;
}

/** 有效、非陪同的報名才佔名額 */
function countsTowardQuota_(signup) {
  return signup['狀態'] !== '已取消' && signup['陪同'] !== '是';
}

/**
 * 某勤務某天各了愿項目的人數狀態。
 * signups：該勤務的報名資料（可含其他日期，函式內會過濾）。
 * 回傳 { positions: [{ id, count, min, max, full, shortage }], total, shortage, full }
 *   full：所有了愿項目都設了最多人數且都已額滿。
 */
function dayStatus_(positions, signups, date) {
  var result = { positions: [], total: 0, shortage: 0, full: positions.length > 0 };
  positions.forEach(function (p) {
    var id = p['了愿項目ID'];
    var count = signups.filter(function (s) {
      return s['日期'] === date && s['了愿項目ID'] === id && countsTowardQuota_(s);
    }).length;
    var min = effectiveMin_(p);
    var max = parseLimit_(p['最多']);
    var full = max !== null && count >= max;
    var shortage = min !== null && count < min ? min - count : 0;
    result.positions.push({ id: id, count: count, min: min, max: max, full: full, shortage: shortage });
    result.total += count;
    result.shortage += shortage;
    if (!full) result.full = false;
  });
  return result;
}

/**
 * 檢查一次報名請求，回傳錯誤陣列（空陣列代表可以報名）。
 * 規則見規格第 7 節：
 *   - 勤務當天（含）之後不能報名（與取消、改期一致，today 為台北時間的 yyyy-MM-dd）。
 *   - 同一人同一天在同一個勤務內只能報一個了愿項目；陪同者不受此限制。
 *   - 陪同者不佔名額。
 *   - 每個名字都要選身分（壇辦／道親），統計道親佔比用。
 *   - 只有壇辦可以選「陪同」；道親一律是了愿。
 *   - 任何一筆有錯，整批都不寫入（由呼叫端負責）。
 *
 * req = {
 *   duty: 勤務列物件, positions: 該勤務的了愿項目列, signups: 該勤務的報名列,
 *   positionId, dates: [yyyy-MM-dd], entries: [{ name, identity: '壇辦'|'道親', accompany: boolean }], today
 * }
 * 錯誤格式：{ name?, date?, message }
 */
function validateSignup_(req) {
  var errors = [];
  var duty = req.duty;

  if (!duty) return [{ message: '找不到這個勤務' }];
  if (duty['模式'] === '公告型') return [{ message: '公告型勤務不需要報名' }];

  var position = (req.positions || []).filter(function (p) { return p['了愿項目ID'] === req.positionId; })[0];
  if (!position) return [{ message: '請選擇了愿項目' }];

  var dates = req.dates || [];
  if (!dates.length) return [{ message: '請選擇日期' }];

  var entries = (req.entries || []).map(function (e) {
    return { name: normalizeName_(e && e.name), identity: e && e.identity, accompany: !!(e && e.accompany), temple: trimTemple_(e && e.temple) };
  });
  if (!entries.length) return [{ message: '請填寫名字' }];
  if (entries.some(function (e) { return e.name === ''; })) return [{ message: '名字不可空白' }];
  entries.forEach(function (e) {
    if (NAME_SEPARATORS_.test(e.name) || /^[一-鿿]{2,}([\s　]+[一-鿿]{2,})+$/.test(e.name)) { errors.push({ name: e.name, message: '「' + e.name + '」看起來是好幾個名字，請一個名字加一次' }); return; }
    if (IDENTITIES_.indexOf(e.identity) === -1) errors.push({ name: e.name, message: '請選擇身分（道親、壇辦或未求道）' });
    else if (e.accompany && e.identity !== '壇辦') errors.push({ name: e.name, message: '只有壇辦可以選「陪同」' });
  });

  // 同一批不可重複填同一個人（名字視為同一人的規則見 sameName_）
  entries.forEach(function (e, i) {
    var prev = entries.slice(0, i).filter(function (x) { return samePerson_(x.name, x.temple, e.name, e.temple); })[0];
    if (prev) {
      errors.push({ name: e.name, message: prev.name === e.name ? '名字重複填寫' : '「' + prev.name + '」與「' + e.name + '」視為同一人，名字重複填寫' });
    }
  });

  var dutyDates = datesInRange_(duty['開始日'], duty['結束日']);
  var uniqueDates = {};
  dates.forEach(function (date) {
    if (uniqueDates[date]) return;
    uniqueDates[date] = true;

    if (!isDateString_(date) || dutyDates.indexOf(date) === -1) {
      errors.push({ date: date, message: '這個日期不在勤務期間內' });
      return;
    }
    if (duty['報名截止日'] && req.today > duty['報名截止日'] && req.today !== '0000-00-00') {
      errors.push({ date: date, message: '報名已截止，請聯絡管理者' });
      return;
    }
    if (date <= req.today) {
      errors.push({ date: date, message: date === req.today ? '勤務當天不能報名，請聯絡管理者' : '勤務已經過去，不能報名' });
      return;
    }

    var active = (req.signups || []).filter(function (s) {
      return s['日期'] === date && s['狀態'] !== '已取消';
    });

    // 同一人同一天在同一個勤務內只能報一個了愿項目（陪同不受限）
    entries.forEach(function (e) {
      if (e.accompany) return;
      var dup = active.filter(function (s) {
        // 可兼任的勤務：同一人可報不同了愿項目，只擋同一個項目重複
        if (duty['可兼任'] === '是' && s['了愿項目ID'] !== req.positionId) return false;
        return s['陪同'] !== '是' && samePerson_(s['姓名'], s['佛堂'], e.name, e.temple);
      })[0];
      if (dup) {
        var posName = positionName_(req.positions, dup['了愿項目ID']);
        var dupName = normalizeName_(dup['姓名']);
        var who = dupName === e.name ? '' : '（已有「' + dupName + '」，視為同一人）';
        errors.push({ name: e.name, date: date, message: '這天已報名「' + posName + '」' + who + '，同一勤務同一天只能報一個了愿項目' });
      }
    });

    // 名額（陪同不佔名額）
    var max = parseLimit_(position['最多']);
    if (max !== null) {
      var current = active.filter(function (s) {
        return s['了愿項目ID'] === req.positionId && s['陪同'] !== '是';
      }).length;
      var adding = entries.filter(function (e) { return !e.accompany; }).length;
      if (current + adding > max) {
        var left = Math.max(max - current, 0);
        errors.push({
          date: date,
          message: left === 0 ? '「' + position['了愿項目名稱'] + '」已額滿'
            : '「' + position['了愿項目名稱'] + '」只剩 ' + left + ' 個名額，這次要報 ' + adding + ' 人'
        });
      }
    }
  });

  return errors;
}

/** 一般使用者能不能自己取消、改期：勤務當天（含）之後不行（today 為台北時間 yyyy-MM-dd） */
function canSelfChange_(date, today) {
  return isDateString_(date) && date > today;
}

function positionName_(positions, id) {
  var p = (positions || []).filter(function (x) { return x['了愿項目ID'] === id; })[0];
  return p ? p['了愿項目名稱'] : '其他了愿項目';
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizeName_: normalizeName_, sameName_: sameName_, datesInRange_: datesInRange_, parseLimit_: parseLimit_, effectiveMin_: effectiveMin_,
    dayStatus_: dayStatus_, validateSignup_: validateSignup_, canSelfChange_: canSelfChange_
  };
}
