/**
 * 區中心場地借用：家人們申請（2026/10/13 起按小時借，07:00～22:00 一小時一格），管理者同意後才算借到。
 *   - 行事曆上公開：已借出的時段、用途、借用人姓名（電話只有後台看得到）。
 *   - 審核中的時段在借用頁顯示「審核中」，不顯示是誰。
 *   - 一筆申請可以借好幾個小時，每個小時存一列（「時段」＝開始的整點，例 09:00；同一個申請ID）。
 *   - 以前的「早上／下午／晚上」照舊顯示，算重疊時換算成它包含的小時（規則同 js/venue-hours.js）。
 */

var VENUE_NAME = SITE.venue; // 場地名稱在 Config.gs 的 SITE
var VENUE_HOURS = (function () { var a = []; for (var h = 7; h <= 21; h++) a.push((h < 10 ? '0' : '') + h + ':00'); return a; })();
var VENUE_LEGACY = { 早上: ['08:00', '09:00', '10:00', '11:00'], 下午: ['13:00', '14:00', '15:00', '16:00'], 晚上: ['18:00', '19:00', '20:00'] };

/** 某個時段包含的小時（舊的早上／下午／晚上換算） */
function venueHoursOf_(slot) {
  return VENUE_LEGACY[slot] || (VENUE_HOURS.indexOf(slot) !== -1 ? [slot] : []);
}
function venueNextHour_(h) {
  var n = Number(h.slice(0, 2)) + 1;
  return (n < 10 ? '0' : '') + n + ':00';
}
/** 好幾個時段 → 連續的合成一段（例：09:00～12:00、14:00～15:00） */
function venueLabel_(slots) {
  var hours = [];
  slots.forEach(function (s) { venueHoursOf_(s).forEach(function (h) { if (hours.indexOf(h) === -1) hours.push(h); }); });
  hours.sort();
  var out = [];
  hours.forEach(function (h) {
    var last = out[out.length - 1];
    if (last && last[1] === h) last[1] = venueNextHour_(h);
    else out.push([h, venueNextHour_(h)]);
  });
  return out.map(function (x) { return x[0] + '～' + x[1]; }).join('、');
}
function venueOverlap_(a, b) {
  var set = {};
  a.forEach(function (s) { venueHoursOf_(s).forEach(function (h) { set[h] = true; }); });
  return b.some(function (s) { return venueHoursOf_(s).some(function (h) { return set[h]; }); });
}
function venueFirstHour_(slots) {
  var hs = [];
  slots.forEach(function (s) { hs = hs.concat(venueHoursOf_(s)); });
  return hs.sort()[0] || '';
}
var VENUE_STATUS = ['待審核', '已同意', '不同意', '已取消'];
var VENUE_MAX_DAYS_AHEAD = 180;


function venueRows_() {
  return readTable_(SHEETS.VENUE).filter(function (r) { return r['借用ID']; });
}

/** 那幾天在區中心的勤務、課程（地點含「區中心」）：沒寫時間的當作整天 */
function venueActivities_(from, to) {
  return readTableCached_(SHEETS.DUTIES).filter(function (d) {
    return d['勤務ID'] && String(d['地點'] || '').indexOf(VENUE_NAME) !== -1 &&
      d['開始日'] <= to && (d['結束日'] || d['開始日']) >= from;
  });
}

/** 某天某個小時有沒有區中心的活動（時間有重疊就算；沒寫時間的算整天） */
function venueBusyNames_(acts, date, hour) {
  var def = [hour, hour, venueNextHour_(hour)];
  return acts.filter(function (d) {
    if (d['開始日'] > date || (d['結束日'] || d['開始日']) < date) return false;
    var st = d['開始時間'];
    var et = d['結束時間'] || (st ? addMinutesToTime_(st, 120) : '');
    if (!st) return true;
    return st < def[2] && et > def[1];
  }).map(function (d) { return d['名稱']; });
}

function addMinutesToTime_(t, mins) {
  var h = Number(t.slice(0, 2));
  var m = Number(t.slice(3, 5)) + mins;
  h += Math.floor(m / 60);
  m %= 60;
  if (h > 23) return '23:59';
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/** 公開：已同意的借用（行事曆用）：[{ date, slot, name, purpose }] */
function venueApproved_(from, to) {
  var groups = {};
  var order = [];
  venueRows_().filter(function (r) { return r['狀態'] === '已同意' && r['日期'] >= from && r['日期'] <= to; }).forEach(function (r) {
    var k = r['申請ID'] + '|' + r['日期'];
    if (!groups[k]) { groups[k] = { date: r['日期'], slots: [], name: r['姓名'], purpose: r['用途'] }; order.push(k); }
    groups[k].slots.push(r['時段']);
  });
  return order.map(function (k) {
    var g = groups[k];
    return { date: g.date, slot: venueLabel_(g.slots), from: venueFirstHour_(g.slots), name: g.name, purpose: g.purpose };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.from < b.from ? -1 : 1; });
}

/** params = { from, to }：借用頁每天每個時段的狀態 */
function getVenue_(params) {
  var from = params.from;
  var to = params.to;
  if (!isDateString_(from) || !isDateString_(to) || from > to || datesInRange_(from, to).length > 62) {
    throw new ApiError_('BAD_REQUEST', '日期區間格式錯誤');
  }
  var rows = venueRows_();
  var acts = venueActivities_(from, to);
  var days = {};
  datesInRange_(from, to).forEach(function (date) {
    days[date] = VENUE_HOURS.map(function (h) {
      var mine = rows.filter(function (r) { return r['日期'] === date && venueHoursOf_(r['時段']).indexOf(h) !== -1; });
      var ok = mine.filter(function (r) { return r['狀態'] === '已同意'; })[0];
      var pending = mine.some(function (r) { return r['狀態'] === '待審核'; });
      return {
        slot: h, from: h, to: venueNextHour_(h),
        status: ok ? '已借出' : pending ? '審核中' : '可以借',
        name: ok ? ok['姓名'] : '', purpose: ok ? ok['用途'] : '',
        activities: venueBusyNames_(acts, date, h)
      };
    });
  });
  return { today: todayString_(), venue: VENUE_NAME, slots: VENUE_HOURS.map(function (h) { return { slot: h, from: h, to: venueNextHour_(h) }; }), days: days };
}

/**
 * body = { date | dates: [...], slots: ['09:00', '10:00', ...]（要借的小時）, name, phone, purpose, people }：送出申請（待審核）。
 * 可以一次申請好幾天（每週固定、每月、自己挑的日期），每一天都借同樣的時段；全部用同一個申請ID。
 */
var VENUE_MAX_DATES = 60;
function requestVenue_(body) {
  var errors = [];
  var today = todayString_();
  var dates = (Array.isArray(body.dates) && body.dates.length ? body.dates : [body.date]).map(cleanText_)
    .filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort();
  var slots = (Array.isArray(body.slots) ? body.slots : []).map(cleanText_).filter(function (s, i, a) { return a.indexOf(s) === i; }).sort();
  var name = normalizeName_(body.name);
  var phone = cleanText_(body.phone).replace(/[^\d+\-() ]/g, '');
  var purpose = cleanText_(body.purpose).slice(0, 60);
  var people = cleanText_(body.people);
  var applicantNote = cleanText_(body.note).slice(0, 100);
  if (!dates.length) errors.push('請選日期');
  if (dates.length > VENUE_MAX_DATES) errors.push('一次最多申請 ' + VENUE_MAX_DATES + ' 天');
  if (dates.some(function (d) { return !isDateString_(d); })) errors.push('日期格式不對');
  else if (dates.some(function (d) { return d <= today; })) errors.push('最早只能借明天');
  else if (dates.some(function (d) { return datesInRange_(today, d).length > VENUE_MAX_DAYS_AHEAD; })) errors.push('最多只能借半年內的日期');
  if (!slots.length) errors.push('請選要借的時間');
  if (slots.some(function (s) { return VENUE_HOURS.indexOf(s) === -1; })) errors.push('時間不對（只能借 07:00～22:00，一小時一格）');
  if (!name) errors.push('請填姓名');
  if (phone.replace(/\D/g, '').length < 8) errors.push('請填聯絡電話（管理者會用這支電話聯絡您）');
  if (!purpose) errors.push('請填用途');
  if (people && !/^\d{1,4}$/.test(people)) errors.push('人數請填數字');
  if (errors.length) throw new ApiError_('VALIDATION', '申請沒有送出，請看下面的說明', errors.map(function (m) { return { message: m }; }));

  return withSignupLock_(function () {
    var rows = venueRows_();
    var taken = [];
    dates.forEach(function (d) {
      var used = rows.filter(function (r) { return r['日期'] === d && r['狀態'] === '已同意' && venueOverlap_([r['時段']], slots); });
      if (used.length) taken.push(shortDate_(d) + ' ' + venueLabel_(used.map(function (r) { return r['時段']; })));
    });
    if (taken.length) throw new ApiError_('VALIDATION', '申請沒有送出', [{ message: taken.join('、') + '已經借出了，請把這幾天拿掉或換時間' }]);
    var id = newId_('V');
    var now = nowString_();
    var out = [];
    dates.forEach(function (d, di) {
      slots.forEach(function (s) {
        out.push({ '借用ID': id + '-' + (di + 1) + '-' + s.slice(0, 2), '申請ID': id, '日期': d, '時段': s, '姓名': name, '電話': phone,
          '用途': purpose, '人數': people, '狀態': '待審核', '建立時間': now, '審核時間': '', '審核人': '', '備註': '', '申請備註': applicantNote });
      });
    });
    appendRows_(SHEETS.VENUE, out);
    notifyVenueAdmins_('🏠 有新的場地申請', name + '｜' + dates.slice(0, 3).map(shortDate_).join('、') + (dates.length > 3 ? ' 等 ' + dates.length + ' 天' : '') + ' ' + venueLabel_(slots) + '｜' + purpose + '\n請到後台審核 🙏');
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '場地申請', '報名ID': '', '內容摘要': name + '｜' + dates.join('、') + ' ' + venueLabel_(slots) + '｜' + purpose, '還原用的前一版資料': '' }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return { id: id, date: dates[0], dates: dates, slots: slots, label: venueLabel_(slots) };
  });
}

/** body = { name }：查自己的申請（不回電話） */
function myVenue_(body) {
  var name = normalizeName_(body.name);
  if (name.length < 2) throw new ApiError_('BAD_REQUEST', '請輸入完整姓名');
  var today = todayString_();
  return {
    requests: (function () {
      var groups = {};
      var order = [];
      venueRows_().filter(function (r) { return normalizeName_(r['姓名']) === name && r['日期'] >= today; }).forEach(function (r) {
        var active = r['狀態'] === '待審核' || r['狀態'] === '已同意';
        var ask = active ? venueChangeAsk_(r) : null;
        var k = [r['申請ID'], r['日期'], r['狀態'], active && r['申請取消'] ? 'c' : '', ask ? 'm' : ''].join('|');
        if (!groups[k]) {
          groups[k] = { ids: [], slots: [], date: r['日期'], purpose: r['用途'], status: r['狀態'], note: r['備註'] || '',
            cancelPending: active && !!r['申請取消'], canCancel: active && !r['申請取消'] && r['日期'] > today,
            changeAsk: ask, canChange: active && !r['申請取消'] && !ask && r['日期'] > today };
          order.push(k);
        }
        groups[k].ids.push(r['借用ID']);
        groups[k].slots.push(r['時段']);
      });
      return order.map(function (k) {
        var g = groups[k];
        return { id: g.ids[0], ids: g.ids, date: g.date, slot: venueLabel_(g.slots), from: venueFirstHour_(g.slots), purpose: g.purpose, status: g.status,
          note: g.note, cancelPending: g.cancelPending, canCancel: g.canCancel, changeAsk: g.changeAsk, canChange: g.canChange };
      });
    })().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.from < b.from ? -1 : 1; })
  };
}

/**
 * body = { ids: [...], name, phone }：申請人申請取消（待審核或已同意、明天以後）。
 * 不會直接取消：只填「申請取消」欄，狀態不變，要管理者同意取消才算。
 * 要對得上申請時的姓名和電話，別人打名字查得到也申請不了。
 */
function cancelVenue_(body) {
  var name = normalizeName_(body.name);
  var digits = String(body.phone || '').replace(/\D/g, '');
  var ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) throw new ApiError_('BAD_REQUEST', '請勾要取消的日期時段');
  if (!name || digits.length < 8) throw new ApiError_('BAD_REQUEST', '請輸入申請時留的電話');
  var today = todayString_();
  return withSignupLock_(function () {
    var rows = venueRows_();
    var targets = ids.map(function (id) {
      var r = rows.filter(function (x) { return x['借用ID'] === id; })[0];
      if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆申請，請重新查詢');
      return r;
    });
    var mismatch = targets.some(function (r) { return normalizeName_(r['姓名']) !== name || String(r['電話']).replace(/\D/g, '') !== digits; });
    if (mismatch) throw new ApiError_('FORBIDDEN', '電話和申請時留的不一樣，沒有送出。忘記的話請聯絡管理者。');
    var bad = targets.filter(function (r) { return ['待審核', '已同意'].indexOf(r['狀態']) === -1 || r['日期'] <= today || r['申請取消']; });
    if (bad.length) throw new ApiError_('VALIDATION', '取消申請沒有送出', bad.map(function (r) {
      return { message: r['日期'] + ' ' + venueLabel_([r['時段']]) + '：' + (r['日期'] <= today ? '當天（含）之後要取消，請聯絡管理者' : r['申請取消'] ? '已經申請取消了，等管理者審核' : '這筆已經是「' + r['狀態'] + '」') };
    }));
    var now = nowString_();
    targets.forEach(function (r) { updateRow_(SHEETS.VENUE, r, { '申請取消': now }); });
    notifyVenueAdmins_('🏠 有人申請取消場地', name + '｜' + venueGroupText_(targets) + '\n請到後台審核 🙏');
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '場地申請取消', '報名ID': '', '內容摘要': name + '｜' + venueGroupText_(targets, 99), '還原用的前一版資料': '' }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return myVenue_({ name: name });
  });
}

/** 後台：所有申請（含電話）：今天以後的全部＋最近 30 天內過去的 */
function adminVenue_() {
  var today = todayString_();
  var past = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 30)).toISOString().slice(0, 10);
  var rows = venueRows_().filter(function (r) { return r['日期'] >= past; });
  var acts = venueActivities_(past, '9999-12-31');
  return {
    today: today,
    hours: VENUE_HOURS,
    requests: rows.map(function (r) {
      var busy = [];
      venueHoursOf_(r['時段']).forEach(function (h) { venueBusyNames_(acts, r['日期'], h).forEach(function (n) { if (busy.indexOf(n) === -1) busy.push(n); }); });
      return { id: r['借用ID'], group: r['申請ID'], date: r['日期'], slot: r['時段'], label: venueLabel_([r['時段']]), busy: busy, name: r['姓名'], phone: r['電話'], purpose: r['用途'],
        people: r['人數'], status: r['狀態'], createdAt: r['建立時間'], decidedAt: r['審核時間'], decidedBy: r['審核人'], note: r['備註'],
        applicantNote: r['申請備註'] || '',
        changeAsk: (r['狀態'] === '待審核' || r['狀態'] === '已同意') ? venueChangeAsk_(r) : null,
        cancelAsk: (r['狀態'] === '待審核' || r['狀態'] === '已同意') ? (r['申請取消'] || '') : '' };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : venueFirstHour_([a.slot]) < venueFirstHour_([b.slot]) ? -1 : 1; })
  };
}

/**
 * body = { ids: [...], decision: '已同意'|'不同意'|'已取消'|'同意取消'|'不同意取消', note }：審核（同一時段已經有人借到就不能再同意）。
 * 同意取消＝申請人申請的取消照准（狀態變已取消）；不同意取消＝維持原狀態，原因寫在備註。審核後「申請取消」清空。
 */
function adminVenueDecide_(body) {
  var decision = cleanText_(body.decision);
  if (['已同意', '不同意', '已取消', '同意取消', '不同意取消'].indexOf(decision) === -1) throw new ApiError_('BAD_REQUEST', '審核結果不對');
  var ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) throw new ApiError_('BAD_REQUEST', '沒有選要審核的申請');
  var note = cleanText_(body.note).slice(0, 100);
  return withSignupLock_(function () {
    var rows = venueRows_();
    var targets = ids.map(function (id) {
      var r = rows.filter(function (x) { return x['借用ID'] === id; })[0];
      if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆申請，請重新整理');
      return r;
    });
    if (decision === '已同意') {
      var clash = targets.filter(function (t, i) {
        return rows.some(function (r) { return r !== t && r['日期'] === t['日期'] && r['狀態'] === '已同意' && venueOverlap_([r['時段']], [t['時段']]); }) ||
          targets.slice(0, i).some(function (o) { return o['日期'] === t['日期'] && venueOverlap_([o['時段']], [t['時段']]); }); // 一次同意兩筆同時間也不行
      });
      if (clash.length) throw new ApiError_('VALIDATION', '沒有同意', [{ message: venueGroupText_(clash, 99) + ' 已經借給別人了' }]);
    }
    var now = nowString_();
    var who = !ADMIN_SESSION_ ? '' : ADMIN_SESSION_.role === SUPER_ACCOUNT ? '總管理者' : ADMIN_SESSION_.account;
    targets.forEach(function (t) {
      var patch = decision === '同意取消' ? { '狀態': '已取消', '備註': note || '申請人申請取消，已同意' }
        : decision === '不同意取消' ? { '備註': '不同意取消' + (note ? '：' + note : '') }
        : { '狀態': decision, '備註': note };
      patch['審核時間'] = now;
      patch['審核人'] = who;
      patch['申請取消'] = '';
      updateRow_(SHEETS.VENUE, t, patch);
    });
    notifyVenueApplicants_(targets, decision, note);
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '場地' + decision.replace('已', ''), '報名ID': '', '內容摘要': targets[0]['姓名'] + '｜' + venueGroupText_(targets, 99) + (note ? '｜' + note : ''), '還原用的前一版資料': '' }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return adminVenue_();
  });
}

/** 好幾列借用 → 「10/14 09:00～12:00、10/21 09:00～12:00」（同一天合成一段；max 天以後寫「等 N 天」） */
function venueGroupText_(rows, max) {
  max = max || 4;
  var byDate = {};
  var dates = [];
  rows.forEach(function (r) {
    if (!byDate[r['日期']]) { byDate[r['日期']] = []; dates.push(r['日期']); }
    byDate[r['日期']].push(r['時段']);
  });
  dates.sort();
  return dates.slice(0, max).map(function (d) { return shortDate_(d) + ' ' + venueLabel_(byDate[d]); }).join('、') + (dates.length > max ? ' 等 ' + dates.length + ' 天' : '');
}

// ---------- 後台：改日期時間、舊格式換成小時 ----------

/** 新的借用列（照舊那一列的申請人、用途、狀態⋯，換日期和小時） */
function venueCopyRow_(base, date, hour, tag) {
  var o = {};
  SHEETS.VENUE.headers.forEach(function (k) { o[k] = base[k] === undefined ? '' : base[k]; });
  o['借用ID'] = base['申請ID'] + '-' + date.replace(/-/g, '') + '-' + hour.slice(0, 2) + '-' + tag;
  o['日期'] = date;
  o['時段'] = hour;
  o['申請改期'] = '';
  return o;
}
function venueHourRange_(from, to) {
  var a = VENUE_HOURS.indexOf(from);
  var b = VENUE_HOURS.indexOf(to) === -1 && to === '22:00' ? VENUE_HOURS.length : VENUE_HOURS.indexOf(to);
  if (a === -1 || b === -1 || b <= a) return null;
  return VENUE_HOURS.slice(a, b);
}

/** body = { ids: [同一筆申請、同一天的借用ID], date, from, to }：改這一天的日期和時間（狀態不變） */
function adminVenueEdit_(body) {
  var ids = Array.isArray(body.ids) ? body.ids : [];
  var date = cleanText_(body.date);
  var slots = venueHourRange_(cleanText_(body.from), cleanText_(body.to));
  if (!ids.length) throw new ApiError_('BAD_REQUEST', '沒有選要改的借用');
  if (!isDateString_(date)) throw new ApiError_('VALIDATION', '日期格式不對');
  if (!slots) throw new ApiError_('VALIDATION', '時間不對：開始要早於結束，07:00～22:00 之間');
  return withSignupLock_(function () {
    var rows = venueRows_();
    var targets = ids.map(function (id) {
      var r = rows.filter(function (x) { return x['借用ID'] === id; })[0];
      if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆借用，請重新整理');
      return r;
    });
    var base = targets[0];
    if (targets.some(function (t) { return t['申請ID'] !== base['申請ID'] || t['日期'] !== base['日期']; })) throw new ApiError_('BAD_REQUEST', '一次只能改同一筆申請的同一天');
    if (base['狀態'] === '已同意') {
      var clash = rows.filter(function (r) { return targets.indexOf(r) === -1 && r['日期'] === date && r['狀態'] === '已同意' && venueOverlap_([r['時段']], slots); });
      if (clash.length) throw new ApiError_('VALIDATION', '沒有改', [{ message: shortDate_(date) + ' ' + venueLabel_(clash.map(function (r) { return r['時段']; })) + ' 已經借給' + clash[0]['姓名'] + '了' }]);
    }
    var before = shortDate_(base['日期']) + ' ' + venueLabel_(targets.map(function (t) { return t['時段']; }));
    var tag = Date.now().toString(36).slice(-5);
    deleteRows_(SHEETS.VENUE, targets.map(function (t) { return t._row; }));
    invalidateTable_(SHEETS.VENUE);
    appendRows_(SHEETS.VENUE, slots.map(function (h) { return venueCopyRow_(base, date, h, tag); }));
    writeDutyLog_('場地修改', base['姓名'] + '｜' + base['用途'] + '｜' + before + ' → ' + shortDate_(date) + ' ' + venueLabel_(slots) + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return adminVenue_();
  });
}

/** body = { map: { 早上: { from, to }, 下午: {...}, 晚上: {...} } }：舊的時段格式一次換成小時（狀態不變） */
function adminVenueConvert_(body) {
  var map = body.map || {};
  var ranges = {};
  Object.keys(VENUE_LEGACY).forEach(function (k) {
    var m = map[k] || {};
    var r = venueHourRange_(cleanText_(m.from), cleanText_(m.to));
    if (!r) throw new ApiError_('VALIDATION', k + '的時間不對：開始要早於結束，07:00～22:00 之間');
    ranges[k] = r;
  });
  return withSignupLock_(function () {
    var old = venueRows_().filter(function (r) { return VENUE_LEGACY[r['時段']]; });
    if (!old.length) return Object.assign({ converted: 0 }, adminVenue_());
    var tag = Date.now().toString(36).slice(-5);
    var fresh = [];
    old.forEach(function (r) { ranges[r['時段']].forEach(function (h) { fresh.push(venueCopyRow_(r, r['日期'], h, tag)); }); });
    deleteRows_(SHEETS.VENUE, old.map(function (r) { return r._row; }));
    invalidateTable_(SHEETS.VENUE);
    appendRows_(SHEETS.VENUE, fresh);
    writeDutyLog_('場地修改', '舊的時段換成小時｜' + old.length + ' 筆｜' + Object.keys(ranges).map(function (k) { return k + ' ' + venueLabel_(ranges[k]); }).join('、') + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return Object.assign({ converted: old.length }, adminVenue_());
  });
}

/** body = { ids: [同一筆申請、好幾天的借用ID], from, to }：每一天都改成同樣的時間（日期不變、狀態不變） */
function adminVenueEditAll_(body) {
  var ids = Array.isArray(body.ids) ? body.ids : [];
  var slots = venueHourRange_(cleanText_(body.from), cleanText_(body.to));
  if (!ids.length) throw new ApiError_('BAD_REQUEST', '沒有選要改的借用');
  if (!slots) throw new ApiError_('VALIDATION', '時間不對：開始要早於結束，07:00～22:00 之間');
  return withSignupLock_(function () {
    var rows = venueRows_();
    var targets = ids.map(function (id) {
      var r = rows.filter(function (x) { return x['借用ID'] === id; })[0];
      if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆借用，請重新整理');
      return r;
    });
    if (targets.some(function (t) { return t['申請ID'] !== targets[0]['申請ID'] || t['狀態'] !== targets[0]['狀態']; })) throw new ApiError_('BAD_REQUEST', '一次只能改同一筆申請');
    var byDate = {};
    var dates = [];
    targets.forEach(function (t) { if (!byDate[t['日期']]) { byDate[t['日期']] = []; dates.push(t['日期']); } byDate[t['日期']].push(t); });
    dates.sort();
    if (targets[0]['狀態'] === '已同意') {
      var clash = [];
      dates.forEach(function (d) {
        var used = rows.filter(function (r) { return targets.indexOf(r) === -1 && r['日期'] === d && r['狀態'] === '已同意' && venueOverlap_([r['時段']], slots); });
        if (used.length) clash.push(shortDate_(d) + ' ' + venueLabel_(used.map(function (r) { return r['時段']; })) + ' 已經借給' + used[0]['姓名']);
      });
      if (clash.length) throw new ApiError_('VALIDATION', '沒有改（這幾天和別人重疊）', clash.map(function (m) { return { message: m }; }));
    }
    var base = targets[0];
    var before = venueLabel_(byDate[dates[0]].map(function (t) { return t['時段']; }));
    var tag = Date.now().toString(36).slice(-5);
    var fresh = [];
    dates.forEach(function (d) { slots.forEach(function (h) { fresh.push(venueCopyRow_(byDate[d][0], d, h, tag)); }); });
    deleteRows_(SHEETS.VENUE, targets.map(function (t) { return t._row; }));
    invalidateTable_(SHEETS.VENUE);
    appendRows_(SHEETS.VENUE, fresh);
    writeDutyLog_('場地修改', base['姓名'] + '｜' + base['用途'] + '｜' + dates.length + ' 天一起改時間：' + before + ' → ' + venueLabel_(slots) + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return adminVenue_();
  });
}

/** 新增或修改的勤務：地點含區中心、時間和已借出的場地重疊 → 提醒文字（不擋） */
function venueDutyClash_(duties) {
  var rows = venueRows_().filter(function (r) { return r['狀態'] === '已同意'; });
  var out = [];
  duties.forEach(function (d) {
    if (String(d['地點'] || '').indexOf(VENUE_NAME) === -1) return;
    var st = d['開始時間'];
    var et = d['結束時間'] || (st ? addMinutesToTime_(st, 120) : '');
    datesInRange_(d['開始日'], d['結束日'] || d['開始日']).forEach(function (date) {
      var hit = rows.filter(function (r) {
        if (r['日期'] !== date) return false;
        if (!st) return true;
        return venueHoursOf_(r['時段']).some(function (h) { return st < venueNextHour_(h) && et > h; });
      });
      if (!hit.length) return;
      var who = {};
      hit.forEach(function (r) { (who[r['姓名'] + '（' + r['用途'] + '）'] = who[r['姓名'] + '（' + r['用途'] + '）'] || []).push(r['時段']); });
      out.push(shortDate_(date) + ' ' + d['名稱'] + '：這段時間' + VENUE_NAME + '已借給 ' + Object.keys(who).map(function (k) { return k + ' ' + venueLabel_(who[k]); }).join('、'));
    });
  });
  return out.slice(0, 10);
}

// ---------- 申請人申請改時間 ----------

/** 這一列的改期申請：{ date, from, to, label } 或 null */
function venueChangeAsk_(r) {
  if (!r['申請改期']) return null;
  try {
    var a = JSON.parse(r['申請改期']);
    var slots = venueHourRange_(a.from, a.to);
    return slots ? { date: a.date, from: a.from, to: a.to, label: shortDate_(a.date) + ' ' + venueLabel_(slots) } : null;
  } catch (e) { return null; }
}

/** body = { ids: [同一筆申請、同一天], name, phone, date, from, to }：申請改時間（管理者同意才改） */
function requestVenueChange_(body) {
  var name = normalizeName_(body.name);
  var digits = String(body.phone || '').replace(/\D/g, '');
  var ids = Array.isArray(body.ids) ? body.ids : [];
  var date = cleanText_(body.date);
  var slots = venueHourRange_(cleanText_(body.from), cleanText_(body.to));
  var today = todayString_();
  if (!ids.length) throw new ApiError_('BAD_REQUEST', '請選要改的申請');
  if (!name || digits.length < 8) throw new ApiError_('BAD_REQUEST', '請輸入申請時留的電話');
  if (!isDateString_(date) || date <= today) throw new ApiError_('VALIDATION', '新的日期最早只能是明天');
  if (datesInRange_(today, date).length > VENUE_MAX_DAYS_AHEAD) throw new ApiError_('VALIDATION', '最多只能借半年內的日期');
  if (!slots) throw new ApiError_('VALIDATION', '時間不對：開始要早於結束，07:00～22:00 之間');
  return withSignupLock_(function () {
    var rows = venueRows_();
    var targets = ids.map(function (id) {
      var r = rows.filter(function (x) { return x['借用ID'] === id; })[0];
      if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆申請，請重新查詢');
      return r;
    });
    if (targets.some(function (r) { return normalizeName_(r['姓名']) !== name || String(r['電話']).replace(/\D/g, '') !== digits; })) throw new ApiError_('FORBIDDEN', '電話和申請時留的不一樣，沒有送出。忘記的話請聯絡管理者。');
    if (targets.some(function (r) { return ['待審核', '已同意'].indexOf(r['狀態']) === -1 || r['日期'] <= today || r['申請取消'] || r['申請改期']; })) throw new ApiError_('VALIDATION', '這筆現在不能申請改時間（已經過了、已在審核取消或改時間）');
    if (targets.some(function (t) { return t['申請ID'] !== targets[0]['申請ID'] || t['日期'] !== targets[0]['日期']; })) throw new ApiError_('BAD_REQUEST', '一次只能改同一筆申請的同一天');
    var ask = JSON.stringify({ date: date, from: slots[0], to: venueNextHour_(slots[slots.length - 1]) });
    targets.forEach(function (r) { updateRow_(SHEETS.VENUE, r, { '申請改期': ask }); });
    var before = shortDate_(targets[0]['日期']) + ' ' + venueLabel_(targets.map(function (t) { return t['時段']; }));
    var after = shortDate_(date) + ' ' + venueLabel_(slots);
    notifyVenueAdmins_('🏠 有人申請改場地時間', name + '｜' + before + ' → ' + after + '\n請到後台審核 🙏');
    writeDutyLog_('場地申請改期', name + '｜' + targets[0]['用途'] + '｜' + before + ' → ' + after);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return myVenue_({ name: name });
  });
}

/** 後台：body = { ids, ok, note }：同意（照申請改）或不同意改時間 */
function adminVenueChangeDecide_(body) {
  var ids = Array.isArray(body.ids) ? body.ids : [];
  if (!ids.length) throw new ApiError_('BAD_REQUEST', '沒有選要審核的申請');
  var note = cleanText_(body.note).slice(0, 100);
  var rows = venueRows_();
  var targets = ids.map(function (id) {
    var r = rows.filter(function (x) { return x['借用ID'] === id; })[0];
    if (!r) throw new ApiError_('NOT_FOUND', '找不到這筆申請，請重新整理');
    return r;
  });
  var ask = venueChangeAsk_(targets[0]);
  if (!ask) throw new ApiError_('BAD_REQUEST', '這筆沒有改時間的申請');
  var group = targets[0]['申請ID'];
  var before = shortDate_(targets[0]['日期']) + ' ' + venueLabel_(targets.map(function (t) { return t['時段']; }));
  var res;
  if (body.ok) {
    res = adminVenueEdit_({ ids: ids, date: ask.date, from: ask.from, to: ask.to }); // 已借出的和別人重疊會擋
    pushMessageTo_(pushTargets_('場地申請', group), '🏠 ' + SITE.venue + '場地審核結果', '✅ 已經幫您改好了：' + before + ' → ' + ask.label + '，感恩您 🙏', '#/venue');
  } else {
    res = withSignupLock_(function () {
      var fresh = venueRows_();
      ids.forEach(function (id) {
        var r = fresh.filter(function (x) { return x['借用ID'] === id; })[0];
        if (r) updateRow_(SHEETS.VENUE, r, { '申請改期': '', '備註': '不同意改時間' + (note ? '：' + note : '') });
      });
      writeDutyLog_('場地修改', targets[0]['姓名'] + '｜不同意改時間｜' + before + ' → ' + ask.label + (note ? '｜' + note : '') + adminTag_());
      SpreadsheetApp.flush();
      invalidateTable_(SHEETS.VENUE);
      return adminVenue_();
    });
    pushMessageTo_(pushTargets_('場地申請', group), '🏠 ' + SITE.venue + '場地審核結果', '⚠️ ' + before + ' 改時間的申請沒有通過，原本的時間還是幫您保留' + (note ? '，原因：' + note : ''), '#/venue');
  }
  return res;
}

// ---------- 場地使用統計 ----------

/** body = { month: 'yyyy-MM' }：這個月已同意的借用（同一筆申請同一天合成一筆） */
function adminVenueStats_(body) {
  var month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? body.month : todayString_().slice(0, 7);
  var groups = {};
  var order = [];
  venueRows_().filter(function (r) { return r['狀態'] === '已同意' && String(r['日期']).slice(0, 7) === month; }).forEach(function (r) {
    var k = r['申請ID'] + '|' + r['日期'];
    if (!groups[k]) { groups[k] = { date: r['日期'], slots: [], name: r['姓名'], purpose: r['用途'] }; order.push(k); }
    groups[k].slots.push(r['時段']);
  });
  return {
    month: month,
    items: order.map(function (k) {
      var g = groups[k];
      var hours = [];
      g.slots.forEach(function (s) { venueHoursOf_(s).forEach(function (h) { if (hours.indexOf(h) === -1) hours.push(h); }); });
      return { date: g.date, label: venueLabel_(g.slots), hours: hours.sort(), name: g.name, purpose: g.purpose };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
  };
}
