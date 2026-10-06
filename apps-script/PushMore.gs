/**
 * 推播的進階用途（2026/10/5）：
 *   1. 借場地：有人送出申請、申請取消時通知管理者（總管理者、場管開啟「場地申請通知」的手機）；
 *      審核後通知申請人（申請時允許通知的那支手機）。
 *   2. 後台推播：總管理者、勤務、道務、教育帳號選活動或自己寫公告，現在推播或排定時間（每 5 分鐘檢查）。
 *
 * 推播一樣不帶內容（見 Push.gs）：手機收到後回來問 pushSummary_，依序回：測試通知 → 給這支手機的訊息（推播訊息分頁，
 * 拿過就刪）→ 剛送出的後台推播（推播排程分頁，60 分鐘內、這支手機還沒拿過的）→ 今天／明天的勤務。
 *
 * 要送給哪些手機先放進 PENDING_PUSH_，由 Cloudflare 版在回應前一起送出（async-actions.js 的 sendPushTo）。
 * 分頁裡只有推播網址與申請ID，不存姓名、電話。
 */

var PENDING_PUSH_ = [];
var PUSH_BROADCAST_WINDOW_MIN = 60;
var PUSH_PLAN_ROLES = [SUPER_ACCOUNT, '勤務', '道務', '教育'];

/** 排進待送清單（同一支手機只送一次） */
function queuePush_(endpoints) {
  endpoints.forEach(function (ep) { if (ep && PENDING_PUSH_.indexOf(ep) === -1) PENDING_PUSH_.push(ep); });
}

/** Cloudflare 版取走待送清單 */
function takePendingPush_() {
  var list = PENDING_PUSH_;
  PENDING_PUSH_ = [];
  return list;
}

/** 送出結果：失效的（404／410）把各分頁裡這支手機停用或刪掉 */
function markPushResults_(results) {
  var gone = results.filter(function (r) { return r.gone; }).map(function (r) { return r.endpoint; });
  var okEps = results.filter(function (r) { return r.ok; }).map(function (r) { return r.endpoint; });
  if (!gone.length && !okEps.length) return;
  var now = nowString_();
  readTable_(SHEETS.PUSH).forEach(function (r) {
    if (gone.indexOf(r['端點']) !== -1 && r['啟用'] !== '否') updateRow_(SHEETS.PUSH, r, { '啟用': '否' });
    else if (okEps.indexOf(r['端點']) !== -1) updateRow_(SHEETS.PUSH, r, { '最後成功': now });
  });
  if (gone.length) {
    var dead = readTable_(SHEETS.PUSH_TARGETS).filter(function (r) { return gone.indexOf(r['端點']) !== -1; });
    if (dead.length) deleteRows_(SHEETS.PUSH_TARGETS, dead.map(function (r) { return r._row; }));
  }
}

/** 給某些手機留訊息並排進待送 */
function pushMessageTo_(targets, title, body, url) {
  if (!targets.length) return;
  var now = nowString_();
  appendRows_(SHEETS.PUSH_INBOX, targets.map(function (t) {
    return { '訊息ID': newId_('M'), '裝置ID': t['裝置ID'], '標題': title, '內容': body, '網址': url || '', '建立時間': now };
  }));
  queuePush_(targets.map(function (t) { return t['端點']; }));
}

function pushTargets_(type, target) {
  return readTable_(SHEETS.PUSH_TARGETS).filter(function (r) {
    return r['類型'] === type && (target === undefined || r['對象'] === target) && r['端點'];
  });
}

/** 新增一筆推播對象（同一支手機、同類型、同對象只留一筆） */
function addPushTarget_(endpoint, type, target) {
  if (!validEndpoint_(endpoint)) throw new ApiError_('BAD_REQUEST', '推播網址格式不對');
  var rows = readTable_(SHEETS.PUSH_TARGETS);
  if (rows.some(function (r) { return r['端點'] === endpoint && r['類型'] === type && r['對象'] === target; })) return;
  appendRows_(SHEETS.PUSH_TARGETS, [{ '裝置ID': pushIdOf_(endpoint), '端點': endpoint, '類型': type, '對象': target, '建立時間': nowString_() }]);
}

// ---------- 借場地 ----------

/** 有新的申請或取消申請：通知開啟「場地申請通知」的管理者手機 */
function notifyVenueAdmins_(title, body) {
  pushMessageTo_(pushTargets_('場地審核'), title, body, '#/admin/venue');
}

/** body = { endpoint, id }：申請人允許通知，審核結果送到這支手機（id = 申請ID） */
function venueWatch_(body) {
  var group = cleanText_(body.id);
  if (!group || !venueRows_().some(function (r) { return r['申請ID'] === group; })) throw new ApiError_('NOT_FOUND', '找不到這筆申請');
  return withSignupLock_(function () {
    addPushTarget_(body.endpoint, '場地申請', group);
    return { ok: true };
  });
}

/** 管理者：body = { endpoint, on }：這支手機要不要收「場地申請通知」；on 省略＝只查狀態 */
function adminVenueWatch_(body) {
  if (!validEndpoint_(body.endpoint)) throw new ApiError_('BAD_REQUEST', '推播網址格式不對');
  return withSignupLock_(function () {
    if (body.on === true) addPushTarget_(body.endpoint, '場地審核', '');
    if (body.on === false) {
      var mine = readTable_(SHEETS.PUSH_TARGETS).filter(function (r) { return r['端點'] === body.endpoint && r['類型'] === '場地審核'; });
      if (mine.length) deleteRows_(SHEETS.PUSH_TARGETS, mine.map(function (r) { return r._row; }));
    }
    return { on: pushTargets_('場地審核').some(function (r) { return r['端點'] === body.endpoint; }) };
  });
}

/** 審核後通知申請人：rows = 這次處理的列（審核後的狀態），依申請ID分開送 */
function notifyVenueApplicants_(rows, decision, note) {
  var byGroup = {};
  rows.forEach(function (r) { (byGroup[r['申請ID']] = byGroup[r['申請ID']] || []).push(r); });
  Object.keys(byGroup).forEach(function (group) {
    var targets = pushTargets_('場地申請', group);
    if (!targets.length) return;
    var list = byGroup[group];
    var when = list.slice(0, 4).map(function (r) { return shortDate_(r['日期']) + ' ' + r['時段']; }).join('、') + (list.length > 4 ? ' 等 ' + list.length + ' 個時段' : '');
    var text = decision === '已同意' ? '✅ ' + when + ' 區中心借到了，感恩您 🙏'
      : decision === '不同意' ? '❌ ' + when + ' 沒有借到' + (note ? '，原因：' + note : '') + '，感謝您的體諒 🙏'
      : decision === '同意取消' ? '✅ ' + when + ' 已經幫您取消了，感恩您告訴我們 🙏'
      : decision === '不同意取消' ? '⚠️ ' + when + ' 的取消申請沒有通過，場地還是幫您保留' + (note ? '，原因：' + note : '')
      : '⚠️ ' + when + ' 的借用已取消' + (note ? '，原因：' + note : '') + '，有問題請聯絡管理者';
    pushMessageTo_(targets, '🏠 區中心場地審核結果', text, '#/venue');
  });
}

// ---------- 後台推播（排程） ----------

function pushPlanRows_() {
  return readTable_(SHEETS.PUSH_PLANS).filter(function (r) { return r['推播ID']; });
}

function pushPlanOut_(r) {
  return { id: r['推播ID'], category: r['類別'], dutyId: r['勤務ID'], date: r['日期'], title: r['標題'], body: r['內容'], url: r['網址'],
    at: r['預定時間'], status: r['狀態'], sentAt: r['送出時間'], devices: r['手機數'], by: r['建立帳號'], createdAt: r['建立時間'], note: r['備註'] };
}

function pushPlanCategory_(session) {
  return session.role === SUPER_ACCOUNT ? '' : session.role;
}

/** 後台推播分頁：排定中與最近送出的推播、可以選的活動（今天起 60 天） */
function adminPushList_() {
  var cat = pushPlanCategory_(ADMIN_SESSION_);
  var today = todayString_();
  var to = addDaysStr_(today, 59);
  var events = getEvents_({ from: today, to: to });
  var duties = [];
  events.duties.forEach(function (d) {
    if (cat && (d.category || '勤務') !== cat) return;
    var dates = Object.keys(d.days).length ? Object.keys(d.days) : [d.start >= today ? d.start : today];
    dates.filter(function (x) { return x >= today && x <= to; }).forEach(function (date) {
      duties.push({ id: d.id, date: date, name: d.name, category: d.category || '勤務', startTime: d.startTime, endTime: d.endTime,
        start: d.start, end: d.end, location: d.location, mode: d.mode, positions: d.positions, day: d.days[date] || null });
    });
  });
  duties.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.startTime || '').localeCompare(String(b.startTime || '')); });
  var plans = pushPlanRows_().filter(function (r) { return !cat || r['類別'] === cat; }).map(pushPlanOut_);
  var devices = readTable_(SHEETS.PUSH).filter(function (r) { return r['啟用'] !== '否' && r['端點']; }).length;
  return { today: today, now: nowString_(), devices: devices, duties: duties, plans: plans.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).slice(0, 80) };
}

/**
 * body = { plan: { id?, dutyId, date, title, body, at | now: true } }：新增或修改推播。
 * at 格式 yyyy-MM-dd HH:mm（台北時間）；now＝馬上送。只能改還沒送出的。
 */
function adminPushSave_(body) {
  var p = body.plan || {};
  var cat = pushPlanCategory_(ADMIN_SESSION_);
  var title = cleanText_(p.title).slice(0, 60);
  var text = cleanText_(p.body).slice(0, 300);
  var at = cleanText_(p.at).replace('T', ' ');
  var errors = [];
  if (!title) errors.push('請填標題');
  if (!text) errors.push('請填內容');
  var duty = null;
  if (p.dutyId) {
    duty = findDutyById_(p.dutyId);
    if (!duty) errors.push('找不到這個活動，可能已經刪除');
    else if (cat && dutyCategory_(duty) !== cat) throw new ApiError_('FORBIDDEN', '這是「' + dutyCategory_(duty) + '」的活動，這個帳號不能推播');
    if (p.date && !isDateString_(p.date)) errors.push('日期格式不對');
  }
  if (!p.now) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) errors.push('請選推播的日期和時間');
    else if (at <= nowString_().slice(0, 16)) errors.push('推播時間要在現在之後（要馬上送請按「現在推播」）');
  }
  if (errors.length) throw new ApiError_('VALIDATION', '推播沒有存起來', errors.map(function (m) { return { message: m }; }));
  var url = duty ? '#/duty/' + encodeURIComponent(duty['勤務ID']) + (p.date ? '?date=' + p.date + '&go=signup' : '') : '#/';
  return withSignupLock_(function () {
    var now = nowString_();
    var who = ADMIN_SESSION_.role === SUPER_ACCOUNT ? '總管理者' : ADMIN_SESSION_.account;
    var fields = { '類別': duty ? dutyCategory_(duty) : (cat || '全部'), '勤務ID': duty ? duty['勤務ID'] : '', '日期': duty ? (p.date || '') : '',
      '標題': title, '內容': text, '網址': url, '預定時間': p.now ? now.slice(0, 16) : at };
    var row;
    if (p.id) {
      row = pushPlanRows_().filter(function (r) { return r['推播ID'] === p.id; })[0];
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這則推播，請重新整理');
      if (cat && row['類別'] !== cat) throw new ApiError_('FORBIDDEN', '這則推播不是這個帳號的類別');
      if (row['狀態'] !== '排定') throw new ApiError_('VALIDATION', '這則推播已經「' + row['狀態'] + '」，不能修改');
      updateRow_(SHEETS.PUSH_PLANS, row, fields);
    } else {
      row = Object.assign({ '推播ID': newId_('P'), '狀態': '排定', '送出時間': '', '手機數': '', '建立帳號': who, '建立時間': now, '備註': '' }, fields);
      appendRows_(SHEETS.PUSH_PLANS, [row]);
      row = pushPlanRows_().filter(function (r) { return r['推播ID'] === row['推播ID']; })[0];
    }
    appendRows_(SHEETS.LOGS, [{ '時間': now, '動作': p.now ? '推播' : '排定推播', '報名ID': '', '內容摘要': who + '｜' + (p.now ? '現在' : at) + '｜' + title, '還原用的前一版資料': '' }]);
    if (p.now) sendPushPlan_(row);
    SpreadsheetApp.flush();
    return adminPushList_();
  });
}

/** body = { id }：刪除還沒送出的推播（送出過的留著當紀錄） */
function adminPushDelete_(body) {
  var cat = pushPlanCategory_(ADMIN_SESSION_);
  return withSignupLock_(function () {
    var row = pushPlanRows_().filter(function (r) { return r['推播ID'] === body.id; })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這則推播，請重新整理');
    if (cat && row['類別'] !== cat) throw new ApiError_('FORBIDDEN', '這則推播不是這個帳號的類別');
    if (row['狀態'] !== '排定') throw new ApiError_('VALIDATION', '已經送出的推播不能刪除');
    deleteRows_(SHEETS.PUSH_PLANS, [row].map(function (r) { return r._row; }));
    return adminPushList_();
  });
}

/** 送出一則後台推播：所有開啟手機提醒的手機 */
function sendPushPlan_(row) {
  var eps = readTable_(SHEETS.PUSH).filter(function (r) { return r['啟用'] !== '否' && r['端點']; }).map(function (r) { return r['端點']; });
  updateRow_(SHEETS.PUSH_PLANS, row, { '狀態': '已送出', '送出時間': nowString_(), '手機數': String(eps.length) });
  queuePush_(eps);
}

/** 每 5 分鐘：送出時間到了的排定推播；活動刪除或日期已過的不送 */
function runDuePushPlans_() {
  var now = nowString_().slice(0, 16);
  var today = todayString_();
  var sent = 0;
  withSignupLock_(function () {
    pushPlanRows_().filter(function (r) { return r['狀態'] === '排定' && r['預定時間'] && r['預定時間'] <= now; }).forEach(function (r) {
      if (r['勤務ID'] && !findDutyById_(r['勤務ID'])) {
        updateRow_(SHEETS.PUSH_PLANS, r, { '狀態': '沒有送出', '備註': '活動已經刪除' });
      } else if (r['日期'] && r['日期'] < today) {
        updateRow_(SHEETS.PUSH_PLANS, r, { '狀態': '沒有送出', '備註': '活動日期已經過去' });
      } else {
        sendPushPlan_(r);
        sent++;
      }
    });
    SpreadsheetApp.flush();
  });
  return { sent: sent };
}

// ---------- 手機回來問內容 ----------

/** 給這支手機的訊息（拿過就刪）或剛送出的後台推播；都沒有回 null */
function pushMessageFor_(id) {
  if (!id) return null;
  var inbox = readTable_(SHEETS.PUSH_INBOX).filter(function (r) { return r['裝置ID'] === id; });
  if (inbox.length) {
    var m = inbox[0];
    withSignupLock_(function () {
      var fresh = readTable_(SHEETS.PUSH_INBOX).filter(function (r) { return r['訊息ID'] === m['訊息ID']; });
      if (fresh.length) deleteRows_(SHEETS.PUSH_INBOX, fresh.map(function (r) { return r._row; }));
    });
    return { id: m['訊息ID'], title: m['標題'], body: m['內容'], url: m['網址'] };
  }
  // 60 分鐘前（用台北時間的字串直接算，不受時區影響）
  var n = nowString_();
  var base = Date.UTC(Number(n.slice(0, 4)), Number(n.slice(5, 7)) - 1, Number(n.slice(8, 10)), Number(n.slice(11, 13)), Number(n.slice(14, 16)), Number(n.slice(17, 19)));
  var sinceStr = new Date(base - PUSH_BROADCAST_WINDOW_MIN * 60000).toISOString().slice(0, 19).replace('T', ' ');
  var cache = CacheService.getScriptCache();
  var plan = pushPlanRows_().filter(function (r) { return r['狀態'] === '已送出' && r['送出時間'] >= sinceStr; })
    .sort(function (a, b) { return String(a['送出時間']).localeCompare(String(b['送出時間'])); })
    .filter(function (r) { return !cache.get('pushseen:' + r['推播ID'] + ':' + id); })[0];
  if (!plan) return null;
  cache.put('pushseen:' + plan['推播ID'] + ':' + id, '1', PUSH_BROADCAST_WINDOW_MIN * 60 + 600);
  return { id: plan['推播ID'], title: plan['標題'], body: plan['內容'], url: plan['網址'] };
}
