/**
 * Web App 進入點。
 *
 * 讀取：GET  ?action=ping | getEvents&from=yyyy-MM-dd&to=yyyy-MM-dd | getDuty&id=勤務ID
 *           | searchMembers&q=輸入的字[&groupType=分組類型&group=負責組]
 * 寫入：POST，內容為 JSON 字串（前端以 Content-Type: text/plain 送出，避免 CORS 預檢），
 *       { "action": "signup", ... }
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
      case 'getEvents': return getEvents_(p);
      case 'getDuty': return getDuty_(p);
      case 'searchMembers': return searchMembers_(p);
      default: throw new ApiError_('BAD_REQUEST', '未知的 action：' + (p.action || '（空白）'));
    }
  });
}

function doPost(e) {
  return respond_(function () {
    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new ApiError_('BAD_REQUEST', '請求內容不是正確的 JSON');
    }
    switch (body.action) {
      case 'signup': return signup_(body);
      default: throw new ApiError_('BAD_REQUEST', '未知的 action：' + (body.action || '（空白）'));
    }
  });
}

function ApiError_(code, message, details) {
  this.code = code;
  this.message = message;
  this.details = details;
}

function respond_(fn) {
  var result;
  try {
    result = { ok: true, data: fn() };
  } catch (err) {
    if (err instanceof ApiError_) {
      result = { ok: false, error: { code: err.code, message: err.message, details: err.details } };
    } else {
      console.error(err && err.stack ? err.stack : err);
      result = { ok: false, error: { code: 'INTERNAL', message: '系統發生錯誤，請稍後再試' } };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
