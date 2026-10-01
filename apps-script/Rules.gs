/**
 * 報名規則的純邏輯判斷。
 * 本檔不呼叫任何 Apps Script 服務（SpreadsheetApp、Utilities 等），可在 Node 直接測試（tests/rules.test.js）。
 * 資料一律以字串處理：日期 yyyy-MM-dd、陪同「是／否」、狀態「有效／已取消」。
 */

/** 去掉名字前後的半形與全形空白 */
function normalizeName_(name) {
  return String(name === undefined || name === null ? '' : name).replace(/^[\s　]+|[\s　]+$/g, '');
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

/** 有效、非陪同的報名才佔名額 */
function countsTowardQuota_(signup) {
  return signup['狀態'] !== '已取消' && signup['陪同'] !== '是';
}

/**
 * 某勤務某天各崗位的人數狀態。
 * signups：該勤務的報名資料（可含其他日期，函式內會過濾）。
 * 回傳 { positions: [{ id, count, min, max, full, shortage }], total, shortage, full }
 *   full：所有崗位都設了最多人數且都已額滿。
 */
function dayStatus_(positions, signups, date) {
  var result = { positions: [], total: 0, shortage: 0, full: positions.length > 0 };
  positions.forEach(function (p) {
    var id = p['崗位ID'];
    var count = signups.filter(function (s) {
      return s['日期'] === date && s['崗位ID'] === id && countsTowardQuota_(s);
    }).length;
    var min = parseLimit_(p['最少']);
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
 *   - 已經過去的勤務不能報名，當天可以（today 為台北時間的 yyyy-MM-dd）。
 *   - 同一人同一天在同一個勤務內只能報一個崗位；陪同者不受此限制。
 *   - 陪同者不佔名額。
 *   - 任何一筆有錯，整批都不寫入（由呼叫端負責）。
 *
 * req = {
 *   duty: 勤務列物件, positions: 該勤務的崗位列, signups: 該勤務的報名列,
 *   positionId, dates: [yyyy-MM-dd], entries: [{ name, accompany: boolean }], today
 * }
 * 錯誤格式：{ name?, date?, message }
 */
function validateSignup_(req) {
  var errors = [];
  var duty = req.duty;

  if (!duty) return [{ message: '找不到這個勤務' }];
  if (duty['模式'] === '公告型') return [{ message: '公告型勤務不需要報名' }];

  var position = (req.positions || []).filter(function (p) { return p['崗位ID'] === req.positionId; })[0];
  if (!position) return [{ message: '請選擇崗位' }];

  var dates = req.dates || [];
  if (!dates.length) return [{ message: '請選擇日期' }];

  var entries = (req.entries || []).map(function (e) {
    return { name: normalizeName_(e && e.name), accompany: !!(e && e.accompany) };
  });
  if (!entries.length) return [{ message: '請填寫名字' }];
  if (entries.some(function (e) { return e.name === ''; })) return [{ message: '名字不可空白' }];

  // 同一批不可重複填同一個名字
  var seen = {};
  entries.forEach(function (e) {
    if (seen[e.name]) errors.push({ name: e.name, message: '名字重複填寫' });
    seen[e.name] = true;
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
    if (date < req.today) {
      errors.push({ date: date, message: '勤務已經過去，不能報名' });
      return;
    }

    var active = (req.signups || []).filter(function (s) {
      return s['日期'] === date && s['狀態'] !== '已取消';
    });

    // 同一人同一天在同一個勤務內只能報一個崗位（陪同不受限）
    entries.forEach(function (e) {
      if (e.accompany) return;
      var dup = active.filter(function (s) {
        return s['陪同'] !== '是' && normalizeName_(s['姓名']) === e.name;
      })[0];
      if (dup) {
        var posName = positionName_(req.positions, dup['崗位ID']);
        errors.push({ name: e.name, date: date, message: '這天已報名「' + posName + '」，同一勤務同一天只能報一個崗位' });
      }
    });

    // 名額（陪同不佔名額）
    var max = parseLimit_(position['最多']);
    if (max !== null) {
      var current = active.filter(function (s) {
        return s['崗位ID'] === req.positionId && s['陪同'] !== '是';
      }).length;
      var adding = entries.filter(function (e) { return !e.accompany; }).length;
      if (current + adding > max) {
        var left = Math.max(max - current, 0);
        errors.push({
          date: date,
          message: left === 0 ? '「' + position['崗位名稱'] + '」已額滿'
            : '「' + position['崗位名稱'] + '」只剩 ' + left + ' 個名額，這次要報 ' + adding + ' 人'
        });
      }
    }
  });

  return errors;
}

function positionName_(positions, id) {
  var p = (positions || []).filter(function (x) { return x['崗位ID'] === id; })[0];
  return p ? p['崗位名稱'] : '其他崗位';
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizeName_: normalizeName_, datesInRange_: datesInRange_, parseLimit_: parseLimit_,
    dayStatus_: dayStatus_, validateSignup_: validateSignup_
  };
}
