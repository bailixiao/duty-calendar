/**
 * 🛠 回報網站問題（2026/11/26）：各區回報網站本身的問題給「網站負責人」（宏教分壇後台「🛠 各區回報」）。
 *   - 各區總管理者：在「💬 意見回饋」把家人們寫的轉上去（📤 轉給網站負責人，可以補一句說明）。
 *   - 各區管理者（唯讀以外）：「⚙️ 更多 → 🛠 回報網站問題」直接寫，可以附截圖（最多 3 張）。
 *   - 這一區記在指令碼屬性 SITE_REPORTS（最多 200 筆）；分壇收在 HQ_REPORTS（worker/src/hq.js）。
 *   - 分壇改狀態、寫回覆 → 送回這一區（siteReportReply_），通知收「系統通知」的手機。
 *   - 截圖存在這一區（檔案代號），分壇看的時候用這一區的檔案網址。
 *   - 不收電話；家人們的名字（選填）跟著轉上去，讓負責人知道是誰遇到的。
 */
var SITE_REPORT_PROP = 'SITE_REPORTS';
var SITE_REPORT_STATUS = ['新的', '處理中', '修好了', '不用改'];
var SITE_REPORT_MAX_SHOTS = 3;

function siteReports_() {
  try { var a = JSON.parse(PropertiesService.getScriptProperties().getProperty(SITE_REPORT_PROP) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function saveSiteReports_(a) {
  PropertiesService.getScriptProperties().setProperty(SITE_REPORT_PROP, JSON.stringify(a.slice(-200)));
}

/** 截圖檔案代號（F- 開頭），最多 3 個 */
function cleanShots_(a) {
  return (Array.isArray(a) ? a : []).map(String).filter(function (x, i, all) { return /^F-[0-9a-f]{20}$/.test(x) && all.indexOf(x) === i; }).slice(0, SITE_REPORT_MAX_SHOTS);
}

/**
 * 準備一筆回報（還不存；hq.js 送到分壇成功才存）：body = { text, page, device, version, shots, fbId, note }
 *   fbId：從意見回饋轉上去（只有總管理者），內容、名字、截圖用那一則的，note＝補充說明。
 */
function siteReportBuild_(body) {
  if (!ADMIN_SESSION_ || ADMIN_SESSION_.role === '唯讀') throw new ApiError_('FORBIDDEN', '唯讀帳號不能回報');
  var clip = function (v, n) { return String(v == null ? '' : v).replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, n); };
  var rec = {
    id: newId_('SR'), at: nowString_(), kind: 'direct', text: '', note: clip(body.note, 300), name: '',
    page: String(body.page || '').replace(/[^\w#/?=&.%-]/g, '').slice(0, 80),
    device: clip(body.device, 200), version: clip(body.version, 20),
    by: ADMIN_SESSION_.account || ADMIN_SESSION_.role, role: ADMIN_SESSION_.role,
    shots: cleanShots_(body.shots), fbId: '', status: '新的', reply: '', replyAt: ''
  };
  if (body.fbId) {
    requireFeedbackAdmin_();
    var row = feedbackRows_().filter(function (r) { return r['ID'] === String(body.fbId); })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這則意見');
    if (siteReports_().some(function (x) { return x.fbId === row['ID']; })) throw new ApiError_('VALIDATION', '這則已經轉給網站負責人了');
    rec.kind = 'feedback';
    rec.fbId = row['ID'];
    rec.text = String(row['內容'] || '');
    rec.name = String(row['姓名'] || '');
    rec.page = String(row['頁面'] || '');
    rec.fbAt = String(row['時間'] || '');
    rec.shots = cleanShots_(String(row['截圖'] || '').split(','));
  } else {
    rec.text = clip(body.text, 1000);
    if (rec.text.length < 2) throw new ApiError_('VALIDATION', '請寫一下遇到什麼問題');
  }
  return rec;
}

/** 送到分壇成功後存起來；從意見回饋轉的，那一則還沒讀就改成已讀 */
function siteReportSave_(rec) {
  return withSignupLock_(function () {
    saveSiteReports_(siteReports_().concat([rec]));
    if (rec.fbId) {
      var row = feedbackRows_().filter(function (r) { return r['ID'] === rec.fbId; })[0];
      if (row && (row['狀態'] || '未讀') === '未讀') { updateRow_(SHEETS.FEEDBACK, row, { '狀態': '已讀' }); invalidateTable_(SHEETS.FEEDBACK); }
    }
    return { report: rec };
  });
}

/** 這一區回報過的（新的在前）：唯讀以外的管理者都看得到 */
function adminSiteReportList_() {
  if (!ADMIN_SESSION_ || ADMIN_SESSION_.role === '唯讀') throw new ApiError_('FORBIDDEN', '唯讀帳號不能看回報');
  return { items: siteReports_().slice().reverse() };
}

/** 分壇回覆過來：p = { id, status, reply, at } */
function siteReportReply_(p) {
  var all = siteReports_();
  var r = all.filter(function (x) { return x.id === String((p && p.id) || ''); })[0];
  if (!r) return { ok: false };
  var before = r.status + '|' + r.reply;
  if (SITE_REPORT_STATUS.indexOf(p.status) !== -1) r.status = p.status;
  if (p.reply !== undefined) r.reply = String(p.reply || '').slice(0, 500);
  r.replyAt = String(p.at || nowString_());
  saveSiteReports_(all);
  if (before !== r.status + '|' + r.reply) {
    pushMessageTo_(pushTargets_('系統通知'), '🛠 網站負責人回覆了（' + r.status + '）', (r.reply || r.text).slice(0, 60), '#/admin/sitereport');
  }
  return { ok: true };
}

/** 意見回饋那一頁用：fbId → 轉上去的狀態 */
function siteReportByFeedback_() {
  var m = {};
  siteReports_().forEach(function (x) { if (x.fbId) m[x.fbId] = { status: x.status, reply: x.reply, at: x.at }; });
  return m;
}
