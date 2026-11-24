/**
 * 💬 意見回饋（2026/11/24）：家人們在「❓ 常見問題」最下面寫給管理者（有問題、建議、哪裡不好用）。
 *   - 分頁「意見回饋」：ID、時間、姓名（選填）、內容、頁面（從哪一頁寫的）、狀態（未讀／已讀／已處理）、處理說明、處理人、處理時間。
 *   - 不收電話；要聯絡的話請在內容寫或在 LINE 群組問。
 *   - 送出時通知收「系統通知」的手機；後台「⚙️ 更多 → 💬 意見回饋」看（只有總管理者），首頁「📌 要處理的事」寫幾則未讀。
 */
var FEEDBACK_STATUS = ['未讀', '已讀', '已處理'];

function feedbackRows_() {
  return readTable_(SHEETS.FEEDBACK).filter(function (r) { return r['ID']; });
}

/** 公開：body = { text, name, page } */
function sendFeedback_(body) {
  var text = String(body.text || '').replace(/\r\n/g, '\n').replace(/^\s+|\s+$/g, '').slice(0, 500);
  var name = normalizeName_(body.name || '').slice(0, 20);
  var page = String(body.page || '').replace(/[^\w#/?=&.%-]/g, '').slice(0, 80);
  if (text.length < 2) throw new ApiError_('VALIDATION', '請寫一下想說的話');
  return withSignupLock_(function () {
    var now = nowString_();
    var id = newId_('FB');
    appendRows_(SHEETS.FEEDBACK, [{ 'ID': id, '時間': now, '姓名': name, '內容': text, '頁面': page, '狀態': '未讀', '處理說明': '', '處理人': '', '處理時間': '' }]);
    invalidateTable_(SHEETS.FEEDBACK);
    pushMessageTo_(pushTargets_('系統通知'), '💬 有新的意見回饋', (name ? name + '：' : '') + text.slice(0, 60), '#/admin/feedback');
    return { id: id };
  });
}

function feedbackOut_(r) {
  return { id: r['ID'], at: r['時間'], name: r['姓名'] || '', text: r['內容'] || '', page: r['頁面'] || '', status: r['狀態'] || '未讀',
    note: r['處理說明'] || '', by: r['處理人'] || '', doneAt: r['處理時間'] || '' };
}

function requireFeedbackAdmin_() {
  if (!ADMIN_SESSION_ || ADMIN_SESSION_.role !== SUPER_ACCOUNT) throw new ApiError_('FORBIDDEN', '意見回饋只有總管理者能看');
}

/** 後台：最近一年的意見回饋（新的在前） */
function adminFeedbackList_() {
  requireFeedbackAdmin_();
  var since = addDaysStr_(todayString_(), -365);
  var items = feedbackRows_().filter(function (r) { return String(r['時間']).slice(0, 10) >= since; }).map(feedbackOut_)
    .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  return { items: items };
}

/** 後台：body = { id, status, note }：改狀態、寫處理說明 */
function adminFeedbackSet_(body) {
  requireFeedbackAdmin_();
  var status = FEEDBACK_STATUS.indexOf(body.status) !== -1 ? body.status : '';
  var note = body.note === undefined ? undefined : String(body.note || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  return withSignupLock_(function () {
    var row = feedbackRows_().filter(function (r) { return r['ID'] === String(body.id || ''); })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這則意見');
    var changes = {};
    if (status) changes['狀態'] = status;
    if (note !== undefined) changes['處理說明'] = note;
    if (status === '已處理' || note) { changes['處理人'] = ADMIN_SESSION_.account || ADMIN_SESSION_.role; changes['處理時間'] = nowString_(); }
    updateRow_(SHEETS.FEEDBACK, row, changes);
    invalidateTable_(SHEETS.FEEDBACK);
    return adminFeedbackList_();
  });
}

/** 未讀幾則（要處理的事用） */
function feedbackUnread_() {
  return feedbackRows_().filter(function (r) { return (r['狀態'] || '未讀') === '未讀'; }).length;
}
