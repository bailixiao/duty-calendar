/**
 * 區中心場地借用：家人們申請（早上／下午／晚上），管理者同意後才算借到。
 *   - 行事曆上公開：已借出的時段、用途、借用人姓名（電話只有後台看得到）。
 *   - 審核中的時段在借用頁顯示「審核中」，不顯示是誰。
 *   - 一筆申請可以勾好幾個時段，每個時段存一列（同一個申請ID）。
 */

var VENUE_NAME = SITE.venue; // 場地名稱在 Config.gs 的 SITE
var VENUE_SLOTS = [['早上', '08:00', '12:00'], ['下午', '13:00', '17:00'], ['晚上', '18:00', '21:00']];
var VENUE_STATUS = ['待審核', '已同意', '不同意', '已取消'];
var VENUE_MAX_DAYS_AHEAD = 180;

function venueSlotNames_() { return VENUE_SLOTS.map(function (s) { return s[0]; }); }

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

/** 某天某時段有沒有區中心的活動（時間有重疊就算；沒寫時間的算整天） */
function venueBusyNames_(acts, date, slot) {
  var def = VENUE_SLOTS.filter(function (s) { return s[0] === slot; })[0];
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
  return venueRows_().filter(function (r) { return r['狀態'] === '已同意' && r['日期'] >= from && r['日期'] <= to; })
    .map(function (r) { return { date: r['日期'], slot: r['時段'], name: r['姓名'], purpose: r['用途'] }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : venueSlotNames_().indexOf(a.slot) - venueSlotNames_().indexOf(b.slot); });
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
    days[date] = VENUE_SLOTS.map(function (s) {
      var mine = rows.filter(function (r) { return r['日期'] === date && r['時段'] === s[0]; });
      var ok = mine.filter(function (r) { return r['狀態'] === '已同意'; })[0];
      var pending = mine.some(function (r) { return r['狀態'] === '待審核'; });
      return {
        slot: s[0], from: s[1], to: s[2],
        status: ok ? '已借出' : pending ? '審核中' : '可以借',
        name: ok ? ok['姓名'] : '', purpose: ok ? ok['用途'] : '',
        activities: venueBusyNames_(acts, date, s[0])
      };
    });
  });
  return { today: todayString_(), venue: VENUE_NAME, slots: VENUE_SLOTS.map(function (s) { return { slot: s[0], from: s[1], to: s[2] }; }), days: days };
}

/**
 * body = { date | dates: [...], slots: [...], name, phone, purpose, people }：送出申請（待審核）。
 * 可以一次申請好幾天（每週固定、每月、自己挑的日期），每一天都借同樣的時段；全部用同一個申請ID。
 */
var VENUE_MAX_DATES = 60;
function requestVenue_(body) {
  var errors = [];
  var today = todayString_();
  var dates = (Array.isArray(body.dates) && body.dates.length ? body.dates : [body.date]).map(cleanText_)
    .filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort();
  var slots = (Array.isArray(body.slots) ? body.slots : []).map(cleanText_).filter(function (s, i, a) { return a.indexOf(s) === i; });
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
  if (!slots.length) errors.push('請勾要借的時段');
  if (slots.some(function (s) { return venueSlotNames_().indexOf(s) === -1; })) errors.push('時段不對');
  if (!name) errors.push('請填姓名');
  if (phone.replace(/\D/g, '').length < 8) errors.push('請填聯絡電話（管理者會用這支電話聯絡您）');
  if (!purpose) errors.push('請填用途');
  if (people && !/^\d{1,4}$/.test(people)) errors.push('人數請填數字');
  if (errors.length) throw new ApiError_('VALIDATION', '申請沒有送出，請看下面的說明', errors.map(function (m) { return { message: m }; }));

  return withSignupLock_(function () {
    var rows = venueRows_();
    var taken = [];
    dates.forEach(function (d) {
      slots.forEach(function (s) {
        if (rows.some(function (r) { return r['日期'] === d && r['時段'] === s && r['狀態'] === '已同意'; })) taken.push(shortDate_(d) + ' ' + s);
      });
    });
    if (taken.length) throw new ApiError_('VALIDATION', '申請沒有送出', [{ message: taken.join('、') + '已經借出了，請把這幾天拿掉或換時段' }]);
    var id = newId_('V');
    var now = nowString_();
    var out = [];
    dates.forEach(function (d, di) {
      slots.forEach(function (s) {
        out.push({ '借用ID': id + '-' + (di + 1) + '-' + (venueSlotNames_().indexOf(s) + 1), '申請ID': id, '日期': d, '時段': s, '姓名': name, '電話': phone,
          '用途': purpose, '人數': people, '狀態': '待審核', '建立時間': now, '審核時間': '', '審核人': '', '備註': '', '申請備註': applicantNote });
      });
    });
    appendRows_(SHEETS.VENUE, out);
    notifyVenueAdmins_('🏠 有新的場地申請', name + '｜' + dates.slice(0, 3).map(shortDate_).join('、') + (dates.length > 3 ? ' 等 ' + dates.length + ' 天' : '') + ' ' + slots.join('、') + '｜' + purpose + '\n請到後台審核 🙏');
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '場地申請', '報名ID': '', '內容摘要': name + '｜' + dates.join('、') + ' ' + slots.join('、') + '｜' + purpose, '還原用的前一版資料': '' }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return { id: id, date: dates[0], dates: dates, slots: slots };
  });
}

/** body = { name }：查自己的申請（不回電話） */
function myVenue_(body) {
  var name = normalizeName_(body.name);
  if (name.length < 2) throw new ApiError_('BAD_REQUEST', '請輸入完整姓名');
  var today = todayString_();
  return {
    requests: venueRows_().filter(function (r) { return normalizeName_(r['姓名']) === name && r['日期'] >= today; })
      .map(function (r) {
        var active = r['狀態'] === '待審核' || r['狀態'] === '已同意';
        return { id: r['借用ID'], date: r['日期'], slot: r['時段'], purpose: r['用途'], status: r['狀態'],
          note: r['備註'] || '',
          cancelPending: active && !!r['申請取消'],
          canCancel: active && !r['申請取消'] && r['日期'] > today };
      })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : venueSlotNames_().indexOf(a.slot) - venueSlotNames_().indexOf(b.slot); })
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
      return { message: r['日期'] + ' ' + r['時段'] + '：' + (r['日期'] <= today ? '當天（含）之後要取消，請聯絡管理者' : r['申請取消'] ? '已經申請取消了，等管理者審核' : '這筆已經是「' + r['狀態'] + '」') };
    }));
    var now = nowString_();
    targets.forEach(function (r) { updateRow_(SHEETS.VENUE, r, { '申請取消': now }); });
    notifyVenueAdmins_('🏠 有人申請取消場地', name + '｜' + targets.slice(0, 4).map(function (r) { return shortDate_(r['日期']) + ' ' + r['時段']; }).join('、') + (targets.length > 4 ? ' 等 ' + targets.length + ' 個時段' : '') + '\n請到後台審核 🙏');
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '場地申請取消', '報名ID': '', '內容摘要': name + '｜' + targets.map(function (r) { return r['日期'] + ' ' + r['時段']; }).join('、'), '還原用的前一版資料': '' }]);
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
  return {
    today: today,
    slots: venueSlotNames_(),
    requests: rows.map(function (r) {
      return { id: r['借用ID'], group: r['申請ID'], date: r['日期'], slot: r['時段'], name: r['姓名'], phone: r['電話'], purpose: r['用途'],
        people: r['人數'], status: r['狀態'], createdAt: r['建立時間'], decidedAt: r['審核時間'], decidedBy: r['審核人'], note: r['備註'],
        applicantNote: r['申請備註'] || '',
        cancelAsk: (r['狀態'] === '待審核' || r['狀態'] === '已同意') ? (r['申請取消'] || '') : '' };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : venueSlotNames_().indexOf(a.slot) - venueSlotNames_().indexOf(b.slot); })
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
        return rows.some(function (r) { return r !== t && r['日期'] === t['日期'] && r['時段'] === t['時段'] && r['狀態'] === '已同意'; }) ||
          targets.slice(0, i).some(function (o) { return o['日期'] === t['日期'] && o['時段'] === t['時段']; }); // 一次同意兩筆同時段也不行
      });
      if (clash.length) throw new ApiError_('VALIDATION', '沒有同意', clash.map(function (t) { return { message: t['日期'] + ' ' + t['時段'] + '已經借給別人了' }; }));
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
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': '場地' + decision.replace('已', ''), '報名ID': '', '內容摘要': targets[0]['姓名'] + '｜' + targets.map(function (t) { return t['日期'] + ' ' + t['時段']; }).join('、') + (note ? '｜' + note : ''), '還原用的前一版資料': '' }]);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.VENUE);
    return adminVenue_();
  });
}
