/**
 * 宏教分壇分派（2026/11/22）：各區這一邊。
 *
 * 分壇（Cloudflare 的 hq）開一個「分派」送給各區 → 這一區的「📥 分壇分派」收件匣（指令碼屬性 HQ_INBOX）
 * → 那一類（總務・勤務／道務／教育）的組長或總管理者看過，按「放到本區行事曆」才新增成一筆勤務（「來源」欄＝HQ:分派代號），
 *   或按「本區不參加」（寫原因）。
 * 分壇改了內容：已經放上去的勤務跟著改（名稱、日期、時間、地點、說明、項目），收件匣標「分壇有更新」。
 * 分壇的總表來問：這一區的狀態、名額、報名人數與名字（不含電話）。
 *
 * 只有 Cloudflare 版會用（hqDeliver_／hqWithdraw_／hqReport_ 由 worker/src/hq.js 從分壇叫過來）。
 */
var HQ_INBOX_PROP = 'HQ_INBOX';
var HQ_SOURCE_PREFIX = 'HQ:';
var HQ_NAME = '宏教分壇';
var HQ_INTERNAL_ = false; // 分壇同步時改勤務：不擋「分壇分派的勤務不能改」

/** 各類別可以用的性質（分壇開分派時檢查用） */
function hqNatures_() { return NATURES_BY_CATEGORY_; }

function hqInbox_() {
  var raw = PropertiesService.getScriptProperties().getProperty(HQ_INBOX_PROP);
  try { var o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function hqInboxSave_(o) {
  PropertiesService.getScriptProperties().setProperty(HQ_INBOX_PROP, JSON.stringify(o));
}
function isHqDuty_(d) { return !!(d && String(d['來源'] || '').indexOf(HQ_SOURCE_PREFIX) === 0); }

/** 分壇改不到、只能用分派改的勤務：一般的修改、刪除擋下來 */
function guardHqDuty_(d, verb) {
  if (!HQ_INTERNAL_ && isHqDuty_(d)) {
    throw new ApiError_('FORBIDDEN', '「' + d['名稱'] + '」是' + HQ_NAME + '分派的，內容由分壇統一改，這裡不能' + verb + '。本區的補充說明、負責組、名額請到後台首頁「📥 分壇分派」修改；不參加請按「本區不參加」。');
  }
}

/** 這個帳號能處理哪一類的分派：總管理者全部；總務・勤務／道務／教育只看自己那一類 */
function hqCanSee_(entry) {
  var role = ADMIN_SESSION_ ? ADMIN_SESSION_.role : '';
  if (role === SUPER_ACCOUNT) return true;
  return CATEGORIES.indexOf(role) !== -1 && entry.c.category === role;
}

/** 分派的名額寫法：「不限」「30 位」 */
function hqQuotaText_(entry) {
  return entry.quota ? entry.quota + ' 位' : '不限';
}

/** 分派 → 勤務的 input（新增、同步都用）。positions 有舊的就帶 ID（改名的當新的） */
function hqDutyInput_(entry, oldPositions) {
  var c = entry.c;
  var desc = [c.description || ''];
  if (entry.quota) desc.push('本區名額：' + entry.quota + ' 位');
  if (entry.note) desc.push('【本區補充】' + entry.note);
  var ps = (c.positions && c.positions.length ? c.positions : [{ name: '參加' }]);
  var single = ps.length === 1;
  return {
    name: c.title, category: c.category, nature: c.nature || '', mode: '報名型',
    start: c.start, end: c.end || c.start, startTime: c.startTime || '', endTime: c.endTime || '',
    location: c.location || '', attire: c.attire || '', description: desc.filter(Boolean).join('\n\n'),
    deadline: c.deadline || '', groupType: entry.groupType || '', group: entry.group || '',
    positions: ps.map(function (p) {
      var old = (oldPositions || []).filter(function (o) { return o['了愿項目名稱'] === p.name; })[0];
      return { id: old ? old['了愿項目ID'] : undefined, name: p.name, slot: '', min: '', max: single && entry.quota ? entry.quota : (p.max || '') };
    })
  };
}

/** 已經放到行事曆的勤務：照分派的最新內容改（以總管理者身分；失敗記在 syncError） */
function hqSyncDuty_(entry) {
  var duty = findById_(readTable_(SHEETS.DUTIES), '勤務ID', entry.dutyId);
  if (!duty) { entry.dutyId = ''; entry.status = 'seen'; return; }
  var oldPs = positionsOf_(readTable_(SHEETS.POSITIONS), duty['勤務ID']);
  var keepSession = ADMIN_SESSION_;
  HQ_INTERNAL_ = true;
  ADMIN_SESSION_ = { role: SUPER_ACCOUNT, account: HQ_NAME };
  try {
    adminUpdateDuty_({ id: duty['勤務ID'], duty: hqDutyInput_(entry, oldPs) });
    entry.syncError = '';
  } catch (e) {
    entry.syncError = (e && e.message) || String(e);
  } finally {
    HQ_INTERNAL_ = false;
    ADMIN_SESSION_ = keepSession;
  }
}

/**
 * 分壇送來（新的或改過的）分派。c = { id, title, category, nature, start, end, startTime, endTime, location, attire,
 *   description, positions: [{ name }], quotaMode: 'none'|'assigned'|'self', quota（分壇分配給這一區的）, deadline, version }
 */
function hqDeliver_(c) {
  if (!c || !c.id) throw new ApiError_('BAD_REQUEST', '分派資料不完整');
  return withSignupLock_(function () {
    var inbox = hqInbox_();
    var e = inbox[c.id];
    var now = nowString_();
    if (!e) e = inbox[c.id] = { status: 'new', receivedAt: now, quota: '', note: '', groupType: '', group: '' };
    var changed = !!e.c && e.c.version !== c.version;
    e.c = c;
    e.updatedAt = now;
    if (e.status === 'withdrawn') e.status = e.dutyId ? 'published' : 'new';
    if (c.quotaMode === 'assigned') e.quota = Number(c.quota) || '';
    else if (c.quotaMode === 'none') e.quota = '';
    if (changed && e.status !== 'new') e.updated = true; // 組長看過或放上去之後分壇又改了
    if (e.status === 'published' && e.dutyId) hqSyncDuty_(e);
    hqInboxSave_(inbox);
    return { status: e.status };
  });
}

/** 分壇收回（不送這一區了／刪掉分派）：收件匣標「分壇已收回」；已經放上去的勤務留著（可能有人報名），組長自己決定 */
function hqWithdraw_(id) {
  return withSignupLock_(function () {
    var inbox = hqInbox_();
    if (!inbox[id]) return { status: 'none' };
    inbox[id].status = 'withdrawn';
    inbox[id].updatedAt = nowString_();
    hqInboxSave_(inbox);
    return { status: 'withdrawn' };
  });
}

/** 分壇總表來問這一區：狀態、名額、報名的人（姓名、身分、佛堂、項目、日期；不含電話） */
function hqReport_(id) {
  var e = hqInbox_()[id];
  if (!e) return { status: 'none' };
  var people = [];
  if (e.dutyId) {
    var ps = positionsOf_(readTableCached_(SHEETS.POSITIONS), e.dutyId);
    var pname = {};
    ps.forEach(function (p) { pname[p['了愿項目ID']] = p['了愿項目名稱']; });
    people = readTableCached_(SHEETS.SIGNUPS).filter(function (s) { return s['勤務ID'] === e.dutyId && s['狀態'] !== '已取消'; })
      .map(function (s) { return { name: s['姓名'], identity: s['身分'] || '', temple: s['佛堂'] || '', position: pname[s['了愿項目ID']] || '', date: s['日期'], accompany: s['陪同'] === '是' }; });
  }
  var counted = people.filter(function (p) { return !p.accompany; });
  return {
    status: e.status, quota: e.quota || '', seenAt: e.seenAt || '', seenBy: e.seenBy || '', publishedAt: e.publishedAt || '', publishedBy: e.publishedBy || '',
    declineReason: e.declineReason || '', count: counted.length, people: people, syncError: e.syncError || ''
  };
}

// ---------- 這一區的後台 ----------

/** 「📥 分壇分派」：這個帳號看得到的分派（待處理的排前面） */
function adminHqInbox_() {
  var inbox = hqInbox_();
  var signups = readTableCached_(SHEETS.SIGNUPS);
  var order = { new: 0, seen: 1, published: 2, declined: 3, withdrawn: 4 };
  var items = Object.keys(inbox).map(function (id) { return inbox[id]; }).filter(hqCanSee_).map(function (e) {
    var count = e.dutyId ? signups.filter(function (s) { return s['勤務ID'] === e.dutyId && s['狀態'] !== '已取消' && s['陪同'] !== '是'; }).length : 0;
    return {
      id: e.c.id, c: e.c, status: e.status, quota: e.quota || '', note: e.note || '', groupType: e.groupType || '', group: e.group || '',
      dutyId: e.dutyId || '', count: count, updated: !!e.updated, syncError: e.syncError || '', declineReason: e.declineReason || '',
      receivedAt: e.receivedAt, seenAt: e.seenAt || '', seenBy: e.seenBy || '', publishedAt: e.publishedAt || '', publishedBy: e.publishedBy || ''
    };
  }).sort(function (a, b) { return order[a.status] - order[b.status] || String(a.c.start).localeCompare(String(b.c.start)); });
  return { items: items, pending: items.filter(function (x) { return x.status === 'new' || x.status === 'seen' || x.updated; }).length, hqName: HQ_NAME };
}

function hqEntryFor_(inbox, id) {
  var e = inbox[id];
  if (!e) throw new ApiError_('NOT_FOUND', '找不到這個分派，可能分壇已經刪掉了');
  if (!hqCanSee_(e)) throw new ApiError_('FORBIDDEN', '這是「' + e.c.category + '」的分派，這個帳號不能處理');
  return e;
}
function hqWho_() { return ADMIN_SESSION_ ? (ADMIN_SESSION_.account || ADMIN_SESSION_.role) : ''; }

/** 組長點開看過（「還沒看」→「看過了」；分壇有更新的標記也清掉） */
function adminHqSeen_(body) {
  return withSignupLock_(function () {
    var inbox = hqInbox_();
    var e = hqEntryFor_(inbox, body.id);
    if (e.status === 'new') { e.status = 'seen'; e.seenAt = nowString_(); e.seenBy = hqWho_(); }
    e.updated = false;
    hqInboxSave_(inbox);
    return adminHqInbox_();
  });
}

/**
 * 放到本區行事曆（已經放上去的＝改本區的補充、負責組、名額）。
 * body = { id, note, groupType, group, quota（名額由各區自己報時要填） }
 */
function adminHqPublish_(body) {
  return withSignupLock_(function () {
    var inbox = hqInbox_();
    var e = hqEntryFor_(inbox, body.id);
    if (e.status === 'withdrawn') throw new ApiError_('FORBIDDEN', '分壇已經收回這個分派，不能再放上去');
    e.note = String(body.note || '').replace(/\r/g, '').trim().slice(0, 500);
    e.groupType = cleanText_(body.groupType || '');
    e.group = cleanText_(body.group || '');
    if (e.c.quotaMode === 'self') {
      var q = String(body.quota === undefined || body.quota === null ? '' : body.quota).trim();
      if (!/^\d{1,4}$/.test(q) || Number(q) < 1) throw new ApiError_('VALIDATION', '這個分派要各區自己報名額，請填本區要幾位');
      e.quota = Number(q);
    }
    if (e.status === 'published' && e.dutyId) {
      hqSyncDuty_(e);
      if (e.syncError) throw new ApiError_('VALIDATION', e.syncError);
    } else {
      HQ_INTERNAL_ = true;
      try {
        var res = adminCreateDuties_({ duties: [hqDutyInput_(e, null)], allowDuplicate: true });
        e.dutyId = res.ids[0];
      } finally { HQ_INTERNAL_ = false; }
      var row = findById_(readTable_(SHEETS.DUTIES), '勤務ID', e.dutyId);
      updateRow_(SHEETS.DUTIES, row, { '來源': HQ_SOURCE_PREFIX + e.c.id });
      invalidateTable_(SHEETS.DUTIES);
      e.status = 'published';
      e.publishedAt = nowString_();
      e.publishedBy = hqWho_();
      e.declineReason = '';
      if (!e.seenAt) { e.seenAt = e.publishedAt; e.seenBy = e.publishedBy; }
      writeDutyLog_('新增勤務', HQ_NAME + '分派放到行事曆｜' + e.c.title + '｜' + e.c.start + '｜名額 ' + hqQuotaText_(e));
    }
    e.updated = false;
    hqInboxSave_(inbox);
    return Object.assign(adminHqInbox_(), { dutyId: e.dutyId });
  });
}

/** 本區不參加（要寫原因）；已經放上去又沒人報名的，從行事曆拿下來 */
function adminHqDecline_(body) {
  var reason = String(body.reason || '').trim().slice(0, 200);
  if (!reason) throw new ApiError_('VALIDATION', '請寫不參加的原因（分壇會看到）');
  return withSignupLock_(function () {
    var inbox = hqInbox_();
    var e = hqEntryFor_(inbox, body.id);
    if (e.dutyId) {
      var active = readTable_(SHEETS.SIGNUPS).filter(function (s) { return s['勤務ID'] === e.dutyId && s['狀態'] !== '已取消'; }).length;
      if (active) throw new ApiError_('FORBIDDEN', '已經有 ' + active + ' 位報名，不能改成不參加；請先取消這些報名');
      HQ_INTERNAL_ = true;
      try { adminDeleteDuty_({ id: e.dutyId }); } finally { HQ_INTERNAL_ = false; }
      e.dutyId = '';
    }
    e.status = 'declined';
    e.declineReason = reason;
    e.declinedAt = nowString_();
    e.declinedBy = hqWho_();
    e.updated = false;
    if (!e.seenAt) { e.seenAt = e.declinedAt; e.seenBy = e.declinedBy; }
    writeDutyLog_('修改勤務', HQ_NAME + '分派本區不參加｜' + e.c.title + '｜' + reason);
    hqInboxSave_(inbox);
    return adminHqInbox_();
  });
}
