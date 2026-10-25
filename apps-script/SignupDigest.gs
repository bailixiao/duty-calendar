/**
 * 讓管理者知道誰報名了（2026/10/25）：
 *   1. 後台「近期勤務」最上面的「🆕 最新報名」：最近 3 天的報名、取消、改期（從操作紀錄整理）。
 *   2. 每天晚上 8 點的手機彙整：今天幾位報名、幾位取消（管理者在後台開啟「報名彙整通知」的手機）。
 * 勤務／道務／教育帳號只看得到自己類別的；唯讀帳號不能看（有名字）。
 */

var RECENT_SIGNUP_DAYS = 3;
var RECENT_SIGNUP_MAX = 200;
var RECENT_SIGNUP_ACTIONS = ['報名', '取消', '改期'];

/** 操作紀錄裡 from（yyyy-MM-dd）以後的報名、取消、改期，整理成 [{ time, action, name, date, dutyId, dutyName, position, accompany, category, summary }]，新的在前 */
function signupActivity_(from) {
  var signups = {};
  readTableCached_(SHEETS.SIGNUPS).forEach(function (s) { signups[s['報名ID']] = s; });
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) { duties[d['勤務ID']] = d; });
  var positions = {};
  readTableCached_(SHEETS.POSITIONS).forEach(function (p) { positions[p['了愿項目ID']] = p; });
  var out = [];
  var logs = readTable_(SHEETS.LOGS);
  for (var i = logs.length - 1; i >= 0 && out.length < RECENT_SIGNUP_MAX; i--) {
    var l = logs[i];
    if (String(l['時間']).slice(0, 10) < from) break; // 操作紀錄依時間加在後面，舊的就不用再看
    if (RECENT_SIGNUP_ACTIONS.indexOf(l['動作']) === -1) continue;
    var s = signups[l['報名ID']];
    var d = s ? duties[s['勤務ID']] : null;
    var p = s ? positions[s['了愿項目ID']] : null;
    var summary = String(l['內容摘要'] || '');
    out.push({
      time: l['時間'], action: l['動作'],
      name: s ? s['姓名'] : summary.split('｜')[0].replace(/（.*$/, ''),
      date: s ? s['日期'] : '', dutyId: d ? d['勤務ID'] : '', dutyName: d ? d['名稱'] : '',
      position: p ? p['了愿項目名稱'] : '', accompany: !!s && s['陪同'] === '是',
      category: d ? dutyCategory_(d) : '勤務',
      summary: summary
    });
  }
  return out;
}

/** 後台「最新報名」 */
function adminRecentSignups_() {
  var today = todayString_();
  return { today: today, days: RECENT_SIGNUP_DAYS, items: signupActivity_(addDaysStr_(today, -(RECENT_SIGNUP_DAYS - 1))) };
}

/** 管理者：body = { endpoint, on }：這支手機要不要收每天晚上的報名彙整；on 省略＝只查狀態。對象記帳號角色（類別帳號只彙整自己類別） */
function adminSignupDigestWatch_(body) {
  if (!validEndpoint_(body.endpoint)) throw new ApiError_('BAD_REQUEST', '推播網址格式不對');
  var role = ADMIN_SESSION_.role;
  return withSignupLock_(function () {
    var mine = readTable_(SHEETS.PUSH_TARGETS).filter(function (r) { return r['端點'] === body.endpoint && r['類型'] === '報名彙整'; });
    if (body.on === true && !mine.some(function (r) { return r['對象'] === role; })) addPushTarget_(body.endpoint, '報名彙整', role);
    if (body.on === false && mine.length) deleteRows_(SHEETS.PUSH_TARGETS, mine.map(function (r) { return r._row; }));
    return { on: pushTargets_('報名彙整').some(function (r) { return r['端點'] === body.endpoint; }) };
  });
}

/** 一則彙整的文字；沒有任何異動回傳 '' */
function signupDigestText_(items) {
  var count = { '報名': 0, '取消': 0, '改期': 0 };
  items.forEach(function (x) { count[x.action]++; });
  if (!items.length) return '';
  var head = ['報名', '取消', '改期'].filter(function (a) { return count[a]; }).map(function (a) { return count[a] + ' 筆' + a; }).join('、');
  var lines = items.slice(0, 4).map(function (x) {
    return (x.action === '報名' ? '＋' : x.action === '取消' ? '－' : '↔') + x.name + (x.date ? ' ' + shortDate_(x.date) : '') + (x.dutyName ? ' ' + x.dutyName : '');
  });
  return '今天 ' + head + '\n' + lines.join('\n') + (items.length > 4 ? '\n⋯還有 ' + (items.length - 4) + ' 筆，點我看全部' : '');
}

/** 每天晚上 8 點（Cloudflare 排程，和明天的提醒同一時間）：送出今天的報名彙整 */
function sendSignupDigest_() {
  var targets = pushTargets_('報名彙整');
  if (!targets.length) return { sent: 0 };
  var items = signupActivity_(todayString_());
  var byRole = {};
  targets.forEach(function (t) { (byRole[t['對象'] || SUPER_ACCOUNT] = byRole[t['對象'] || SUPER_ACCOUNT] || []).push(t); });
  var sent = 0;
  Object.keys(byRole).forEach(function (role) {
    var list = CATEGORIES.indexOf(role) === -1 ? items : items.filter(function (x) { return x.category === role; });
    var text = signupDigestText_(list);
    if (!text) return; // 今天沒有異動就不吵
    pushMessageTo_(byRole[role], '📝 今天的報名彙整', text, '#/admin');
    sent += byRole[role].length;
  });
  return { sent: sent };
}
