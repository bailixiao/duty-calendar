/**
 * 2026/11/24 優化（三）：
 *   - 後台首頁「📌 要處理的事」（adminTodo_）：新成員待確認、場地申請待審（含取消／改期申請）、修繕待處理的件數。
 *   - 「不是同一人」大家共用（adminDupIgnore_）：指令碼屬性 DUP_IGNORE ＝ [配對代號]（js/member-dups.js 的 pairKey），成員名單一起回傳。
 *   - 🎂 生日祝福推播（birthdayPush_）：成員生日（月日）當天早上，推給手機填了這個名字的人；總管理者在「📣 推播」開關（BDAY_PUSH）。
 */

// ---------- 📌 要處理的事 ----------

/** 依帳號回傳要處理的件數（看不到的項目不回傳） */
function adminTodo_() {
  var role = ADMIN_SESSION_ ? ADMIN_SESSION_.role : '';
  var out = {};
  if (role === SUPER_ACCOUNT || PEOPLE_EDIT_ROLES.indexOf(role) !== -1) {
    out.members = readTableCached_(SHEETS.MEMBERS).filter(function (m) { return m['姓名'] && m['待確認'] === '是'; }).length;
  }
  if (role === SUPER_ACCOUNT || role === '場管') {
    var today = todayString_();
    var asks = {}, ids = {};
    venueRows_().forEach(function (r) {
      if (r['日期'] < today) return;
      if (r['狀態'] === '待審核') ids[r['申請ID'] || r['借用ID']] = true;
      if ((r['狀態'] === '待審核' || r['狀態'] === '已同意') && (r['申請取消'] || r['申請改期'])) asks[r['申請ID'] || r['借用ID']] = true;
    });
    out.venue = Object.keys(ids).length;
    out.venueAsk = Object.keys(asks).length;
    out.repairs = repairRows_().filter(function (r) { return r['狀態'] === '待處理'; }).length;
  }
  return out;
}

// ---------- 「不是同一人」大家共用 ----------

var DUP_IGNORE_PROP = 'DUP_IGNORE';

function dupIgnoreList_() {
  try { var a = JSON.parse(PropertiesService.getScriptProperties().getProperty(DUP_IGNORE_PROP) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

/** body = { keys: [配對代號], undo }：記「不是同一人」（最多留 1000 組） */
function adminDupIgnore_(body) {
  var keys = (body.keys || []).map(function (k) { return String(k || '').slice(0, 120); }).filter(function (k) { return k; }).slice(0, 200);
  if (!keys.length) throw new ApiError_('BAD_REQUEST', '沒有要記的名字');
  return withSignupLock_(function () {
    var list = dupIgnoreList_();
    keys.forEach(function (k) {
      var i = list.indexOf(k);
      if (body.undo) { if (i !== -1) list.splice(i, 1); }
      else if (i === -1) list.push(k);
    });
    list = list.slice(-1000);
    PropertiesService.getScriptProperties().setProperty(DUP_IGNORE_PROP, JSON.stringify(list));
    if (!body.undo) writeDutyLog_('成員', '可能重複的成員｜不是同一人：' + keys.join('；').slice(0, 200));
    return { dupIgnore: list };
  });
}

// ---------- 🎂 生日祝福推播 ----------

var BDAY_PUSH_PROP = 'BDAY_PUSH';

function bdayPushOn_() {
  return PropertiesService.getScriptProperties().getProperty(BDAY_PUSH_PROP) === '1';
}

/** body = { on }：總管理者開關生日祝福推播 */
function adminBdayPushSave_(body) {
  if (ADMIN_SESSION_.role !== SUPER_ACCOUNT) throw new ApiError_('FORBIDDEN', '只有總管理者能設定生日祝福推播');
  PropertiesService.getScriptProperties().setProperty(BDAY_PUSH_PROP, body.on ? '1' : '');
  withSignupLock_(function () { writeDutyLog_('推播設定', '生日祝福推播｜' + (body.on ? '開啟' : '關閉')); });
  return adminPushList_();
}

/**
 * 每天早上：今天生日的成員（啟用中、有填生日月日），推一則祝福給手機填了這個名字的人（一支手機一天一則）。
 * 同名的人（不同佛堂）一樣都會收到（手機只記名字）。
 */
function birthdayPush_() {
  if (!bdayPushOn_()) return { skipped: 'off' };
  var today = todayString_();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BDAY_PUSH_DAY') === today) return { skipped: 'done' };
  props.setProperty('BDAY_PUSH_DAY', today);
  var md = today.slice(5);
  var names = {};
  readTableCached_(SHEETS.MEMBERS).forEach(function (m) {
    if (m['姓名'] && m['啟用中'] !== '否' && m['待確認'] !== '是' && birthdayOf_(m['生日']) === md) names[normalizeName_(m['姓名'])] = m['姓名'];
  });
  if (!Object.keys(names).length) return { people: 0, phones: 0 };
  var sent = 0, seen = {};
  readTable_(SHEETS.PUSH).forEach(function (p) {
    if (p['啟用'] === '否' || !p['端點'] || !p['名字']) return;
    var name = names[normalizeName_(p['名字'])];
    var id = p['裝置ID'] || pushIdOf_(p['端點']);
    if (!name || seen[id]) return;
    seen[id] = true;
    pushMessageTo_([{ '裝置ID': id, '端點': p['端點'] }], '🎂 ' + name + '，生日快樂！',
      '祝您生日快樂，身體健康、平安喜樂 🙏\n' + (SITE.org || '') + ' 全體家人敬上', '#/');
    sent++;
  });
  return { people: Object.keys(names).length, phones: sent };
}
