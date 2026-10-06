/**
 * Web App 進入點。
 *
 * 讀取：GET  ?action=ping | getEvents&from=yyyy-MM-dd&to=yyyy-MM-dd | getDuty&id=勤務ID
 *           | searchMembers&q=輸入的字[&groupType=分組類型&group=負責組] | getSiblings&id=勤務ID（改期可選的同名勤務）
 * 寫入：POST，內容為 JSON 字串（前端以 Content-Type: text/plain 送出，避免 CORS 預檢），
 *       { "action": "signup" | "cancel" | "reschedule", ... }
 *       管理後台：{ "action": "admin...", "token": 通行碼, ... }（見 Admin.gs）
 *
 * 回應格式：
 *   成功 { ok: true, data: ... }
 *   失敗 { ok: false, error: { code, message, details? } }
 */

function doGet(e) {
  return respond_(function () {
    var p = (e && e.parameter) || {};
    switch (p.action) {
      case 'ping': return { now: nowString_(), today: todayString_(), timeZone: Session.getScriptTimeZone() };
      case 'getEvents': return cachedRead_('getEvents', p, function () { return getEvents_(p); });
      case 'getDuty': return cachedRead_('getDuty', p, function () { return getDuty_(p); });
      case 'getBundle': return cachedRead_('getBundle', p, function () { return getBundle_(p); });
      case 'searchMembers': return searchMembers_(p);
      case 'getSiblings': return getSiblings_(p);
      case 'pushKey': return pushKey_();
      case 'loginAccounts': return loginAccounts_();
      case 'pushSummary': return pushSummary_(p);
      case 'getVenue': return getVenue_(p);
      case 'getFaq': return getFaq_(p);
      case 'getRepairs': return getRepairs_(p);
      case 'pushClick': return pushClick_(p);
      default: throw new ApiError_('BAD_REQUEST', '未知的 action：' + (p.action || '（空白）'));
    }
  });
}

function doPost(e) {
  return respond_(function () {
    // 已搬到 Cloudflare：這裡不再接受寫入（舊網頁還開著的人，請他重新整理）
    if (PropertiesService.getScriptProperties().getProperty('MIGRATED') === '1') {
      throw new ApiError_('MOVED', '系統已更新，請重新整理網頁後再試一次 🙏');
    }
    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new ApiError_('BAD_REQUEST', '請求內容不是正確的 JSON');
    }
    if (String(body.action || '').indexOf('admin') === 0) return adminDispatch_(body);
    rateLimit_(body); // 防止亂報名（RateLimit.gs）
    switch (body.action) {
      case 'signup': return signup_(body);
      case 'cancel': return cancelSignup_(body);
      case 'reschedule': return rescheduleSignup_(body);
      case 'mySignups': return mySignups_(body);
      case 'requestVenue': return requestVenue_(body);
      case 'myVenue': return myVenue_(body);
      case 'cancelVenue': return cancelVenue_(body);
      case 'venueWatch': return venueWatch_(body);
      case 'reportRepair': return reportRepair_(body);
      case 'repairWatch': return repairWatch_(body);
      case 'rollcallGet': return rollcallGet_(body);
      case 'rollcallSet': return rollcallSet_(body);
      case 'pushSubscribe': return pushSubscribe_(body);
      case 'pushUnsubscribe': return pushUnsubscribe_(body);
      case 'pushTest': return pushTest_(body);
      case 'pushSetName': return pushSetName_(body);
      default: throw new ApiError_('BAD_REQUEST', '未知的 action：' + (body.action || '（空白）'));
    }
  });
}

/**
 * 直接在試算表修改資料時（簡單觸發，不用設定）清掉讀取快取，網站馬上讀到新資料。
 */
function onEdit() {
  invalidateAllTables_();
}

/**
 * 定時執行（建議每 5 分鐘，設定方式見部署說明）：預先把常用的表讀進快取，
 * 讓使用者打開網站時直接讀快取；也讓伺服器保持活動，降低「冷啟動」變慢的機會。
 */
function keepWarm() {
  [SHEETS.DUTIES, SHEETS.POSITIONS, SHEETS.SIGNUPS, SHEETS.GROUPS, SHEETS.MEMBERS].forEach(function (def) {
    // 試算表被直接改過（例如插入整列，不會觸發 onEdit）：換版本號，讀取快取跟著失效
    var before = JSON.stringify(readTableCached_(def));
    if (JSON.stringify(readTable_(def)) !== before) invalidateTable_(def);
    readTableCached_(def);
  });
  // 先把今年的打包資料算好，第一個打開網站的人不用等
  var w = yearWindow_(Number(todayString_().slice(0, 4)));
  cachedRead_('getBundle', w, function () { return getBundle_(w); });
}

function ApiError_(code, message, details) {
  this.code = code;
  this.message = message;
  this.details = details;
}

/** 「請聯絡管理者」後面接上管理者聯絡人（ADMIN_CONTACT，未設定就不變） */
function withContact_(message) {
  if (!message || String(message).indexOf('請聯絡管理者') === -1) return message;
  var name = adminContact_();
  return name ? String(message).split('請聯絡管理者').join('請聯絡管理者' + name) : message;
}

function respond_(fn) {
  var result;
  try {
    result = { ok: true, data: fn() };
  } catch (err) {
    if (err instanceof ApiError_) {
      result = { ok: false, error: { code: err.code, message: withContact_(err.message), details: err.details } };
      if (Array.isArray(err.details)) {
        err.details.forEach(function (d) { if (d && d.message) d.message = withContact_(d.message); });
      }
    } else {
      console.error(err && err.stack ? err.stack : err);
      result = { ok: false, error: { code: 'INTERNAL', message: '系統發生錯誤，請稍後再試' } };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
