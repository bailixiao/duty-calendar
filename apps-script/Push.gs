/**
 * 手機推播（簡單版）：開啟提醒的手機，每天晚上 8 點收到「明天的勤務」、早上 7 點收到「今天的勤務」（沒有勤務不通知）。
 *   - 不需要名字：「推播」分頁只記每支手機的推播網址（瀏覽器產生的亂數網址），沒有任何個資。
 *   - 通知不帶內容（省掉加密）：手機收到後由 sw.js 回來問 pushSummary，再顯示通知。
 *   - 推播服務要求 VAPID 簽章（ES256，P-256 橢圓曲線）。Apps Script 沒有內建，下面用 BigInt 自己實作，
 *     測試（tests/push.test.js）用 Node 內建的 crypto 驗證簽章正確。
 *   - 第一次請在 Apps Script 編輯器執行 setupPush：建立「推播」分頁、產生金鑰、設定每天兩次的排程。
 */

var PUSH_SUBJECT = SITE.siteUrl; // 推播服務聯絡用（網站網址，不放 email；在 Config.gs 的 SITE）
var PUSH_TTL_SEC = 43200;
var PUSH_HOURS = { today: 7, tomorrow: 20 };

// ---------- P-256 橢圓曲線（ES256 簽章用） ----------

var EC_ = (function () {
  var B = function (hex) { return BigInt('0x' + hex); };
  return {
    p: B('ffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
    n: B('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    b: B('5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
    G: [B('6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
      B('4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')],
    ZERO: BigInt(0), ONE: BigInt(1), TWO: BigInt(2), THREE: BigInt(3)
  };
})();

function ecMod_(a, m) {
  var r = a % m;
  return r < EC_.ZERO ? r + m : r;
}

function ecInv_(a, m) {
  var lm = EC_.ONE, hm = EC_.ZERO, low = ecMod_(a, m), high = m;
  while (low > EC_.ONE) {
    var r = high / low;
    var nm = hm - lm * r, nw = high - low * r;
    hm = lm; high = low; lm = nm; low = nw;
  }
  return ecMod_(lm, m);
}

/** 點相加（null 代表無窮遠點） */
function ecAdd_(P, Q) {
  if (!P) return Q;
  if (!Q) return P;
  var p = EC_.p, l;
  if (P[0] === Q[0]) {
    if (ecMod_(P[1] + Q[1], p) === EC_.ZERO) return null;
    l = ecMod_(EC_.THREE * (P[0] * P[0] - EC_.ONE) * ecInv_(EC_.TWO * P[1], p), p); // a = -3
  } else {
    l = ecMod_((Q[1] - P[1]) * ecInv_(Q[0] - P[0], p), p);
  }
  var x = ecMod_(l * l - P[0] - Q[0], p);
  return [x, ecMod_(l * (P[0] - x) - P[1], p)];
}

function ecMul_(k, P) {
  var R = null, A = P;
  while (k > EC_.ZERO) {
    if (k & EC_.ONE) R = ecAdd_(R, A);
    A = ecAdd_(A, A);
    k = k >> EC_.ONE;
  }
  return R;
}

/** Apps Script 的 byte 陣列是有正負號的（-128～127），一律轉成 0～255 */
function bytesU_(arr) {
  return arr.map(function (b) { return b & 255; });
}

function bytesToBig_(bytes) {
  return BigInt('0x' + (bytesU_(bytes).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('') || '0'));
}

function bigToBytes_(n, len) {
  var hex = n.toString(16);
  while (hex.length < len * 2) hex = '0' + hex;
  var out = [];
  for (var i = 0; i < len * 2; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes.map(function (b) { return b > 127 ? b - 256 : b; })).replace(/=+$/, '');
}

function hmac_(key, data) {
  return bytesU_(Utilities.computeHmacSha256Signature(
    data.map(function (b) { return b > 127 ? b - 256 : b; }),
    key.map(function (b) { return b > 127 ? b - 256 : b; })));
}

/** ES256 簽章：k 依 RFC 6979 決定（不靠亂數），回傳 r‖s 共 64 bytes */
function ecSign_(msgBytes, d) {
  var n = EC_.n;
  var h = bytesU_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, msgBytes.map(function (b) { return b > 127 ? b - 256 : b; })));
  var z = bytesToBig_(h);
  var x = bigToBytes_(d, 32);
  var h1 = bigToBytes_(ecMod_(z, n), 32);
  var V = [], K = [];
  for (var i = 0; i < 32; i++) { V.push(1); K.push(0); }
  K = hmac_(K, V.concat([0], x, h1)); V = hmac_(K, V);
  K = hmac_(K, V.concat([1], x, h1)); V = hmac_(K, V);
  for (;;) {
    V = hmac_(K, V);
    var k = bytesToBig_(V);
    if (k >= EC_.ONE && k < n) {
      var R = ecMul_(k, EC_.G);
      var r = ecMod_(R[0], n);
      var s = ecMod_(ecInv_(k, n) * (z + r * d), n);
      if (r !== EC_.ZERO && s !== EC_.ZERO) return bigToBytes_(r, 32).concat(bigToBytes_(s, 32));
    }
    K = hmac_(K, V.concat([0])); V = hmac_(K, V);
  }
}

function utf8Bytes_(s) {
  return bytesU_(Utilities.newBlob(s).getBytes());
}

/** VAPID 用的 JWT（aud = 推播服務的網址開頭） */
function vapidJwt_(audience, d, nowSec) {
  var head = b64url_(utf8Bytes_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  var body = b64url_(utf8Bytes_(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: PUSH_SUBJECT })));
  var input = head + '.' + body;
  return input + '.' + b64url_(ecSign_(utf8Bytes_(input), d));
}

// ---------- 金鑰與排程 ----------

function pushKeys_() {
  var props = PropertiesService.getScriptProperties();
  var d = props.getProperty('VAPID_PRIVATE');
  var pub = props.getProperty('VAPID_PUBLIC');
  if (!d || !pub) return null;
  return { d: BigInt('0x' + d), pub: pub };
}

/** 在 Apps Script 編輯器執行一次：建立「推播」分頁、產生金鑰（已有就沿用）、設定每天早上 7 點與晚上 8 點的排程 */
function setupPush() {
  setupSheets();
  ensurePushKeys_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sendPushToday', 'sendPushTomorrow'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendPushToday').timeBased().everyDays(1).atHour(PUSH_HOURS.today).create();
  ScriptApp.newTrigger('sendPushTomorrow').timeBased().everyDays(1).atHour(PUSH_HOURS.tomorrow).create();
  Logger.log('推播設定完成：每天早上 ' + PUSH_HOURS.today + ' 點通知今天、晚上 ' + PUSH_HOURS.tomorrow + ' 點通知明天的勤務');
}

/** 產生 VAPID 金鑰（已有就沿用；換金鑰會讓所有手機都要重新開啟提醒） */
function ensurePushKeys_() {
  var props = PropertiesService.getScriptProperties();
  if (!pushKeys_()) {
    var seed = [];
    for (var i = 0; i < 8; i++) seed.push(Utilities.getUuid());
    seed.push(String(Date.now()));
    var d = ecMod_(bytesToBig_(bytesU_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed.join('|')))), EC_.n - EC_.ONE) + EC_.ONE;
    var P = ecMul_(d, EC_.G);
    props.setProperty('VAPID_PRIVATE', d.toString(16));
    props.setProperty('VAPID_PUBLIC', b64url_([4].concat(bigToBytes_(P[0], 32), bigToBytes_(P[1], 32))));
  }
  return pushKeys_();
}

// ---------- API ----------

/** 推播網址的代號：SHA-256 前 16 個十六進位字（sw.js 用同樣方法算，回來問內容時用） */
function pushIdOf_(endpoint) {
  return bytesU_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(endpoint)))
    .slice(0, 8).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function pushKey_() {
  var k = pushKeys_();
  if (!k) throw new ApiError_('CONFIG', '推播尚未設定，請管理者在 Apps Script 執行 setupPush');
  return { publicKey: k.pub };
}

function validEndpoint_(endpoint) {
  return /^https:\/\/[^\s]{10,800}$/.test(String(endpoint || ''));
}

/** body = { endpoint }：開啟提醒 */
function pushSubscribe_(body) {
  if (!validEndpoint_(body.endpoint)) throw new ApiError_('BAD_REQUEST', '推播網址格式不對');
  pushKey_();
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.PUSH);
    var row = rows.filter(function (r) { return r['端點'] === body.endpoint; })[0];
    if (row) updateRow_(SHEETS.PUSH, row, { '啟用': '是' });
    else appendRows_(SHEETS.PUSH, [{ '裝置ID': pushIdOf_(body.endpoint), '端點': body.endpoint, '建立時間': nowString_(), '最後成功': '', '啟用': '是' }]);
    return { id: pushIdOf_(body.endpoint) };
  });
}

/** body = { endpoint }：關閉提醒 */
function pushUnsubscribe_(body) {
  return withSignupLock_(function () {
    readTable_(SHEETS.PUSH).forEach(function (r) {
      if (r['端點'] === body.endpoint && r['啟用'] !== '否') updateRow_(SHEETS.PUSH, r, { '啟用': '否' });
    });
    return {};
  });
}

/** body = { endpoint }：傳一則測試通知給這支手機（30 秒內只能一次） */
function pushTest_(body) {
  if (!validEndpoint_(body.endpoint)) throw new ApiError_('BAD_REQUEST', '推播網址格式不對');
  var id = pushIdOf_(body.endpoint);
  var cache = CacheService.getScriptCache();
  if (cache.get('pushtest-wait:' + id)) throw new ApiError_('BUSY', '剛剛才傳過，請等 30 秒再試');
  cache.put('pushtest-wait:' + id, '1', 30);
  cache.put('pushtest:' + id, '1', 300);
  var res = sendPushTo_([body.endpoint])[0];
  if (!res.ok) throw new ApiError_('PUSH', res.gone ? '這支手機的提醒已失效，請關閉後重新開啟' : '推播服務暫時無法使用（' + res.code + '），請稍後再試');
  return {};
}

/**
 * 手機收到推播後回來問要顯示什麼（params.id = 推播網址代號）。
 * 中午以前回今天的勤務，之後回明天的；剛按過「測試通知」的手機回測試內容。
 */
function pushSummary_(params) {
  var hour = Number(Utilities.formatDate(new Date(), TIME_ZONE, 'H'));
  var when = hour < 12 ? 'today' : 'tomorrow';
  var data = pushItems_(when);
  if (params.id && CacheService.getScriptCache().get('pushtest:' + params.id)) {
    CacheService.getScriptCache().remove('pushtest:' + params.id);
    data.test = true;
    return data;
  }
  // 給這支手機的訊息（借場地通知）或剛送出的後台推播（見 PushMore.gs）
  var msg = pushMessageFor_(params.id);
  if (msg) {
    data.message = msg;
    return data;
  }
  // 填了「我是誰」的手機：只列他報名的，另外附缺人數
  var dev = params.id ? readTable_(SHEETS.PUSH).filter(function (r) { return r['裝置ID'] === params.id && r['啟用'] !== '否'; })[0] : null;
  if (dev && dev['名字']) {
    data.mine = pushMine_(dev['名字'], data.date);
    data.shortItems = data.items.filter(function (it) { return it.short; });
  }
  return data;
}

/** 某人某天報名的勤務：[{ id, name, position, time, location }]（比對完全同名，不含陪同以外的差別） */
function pushMine_(name, date) {
  var who = normalizeName_(name);
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) { duties[d['勤務ID']] = d; });
  var positions = {};
  readTableCached_(SHEETS.POSITIONS).forEach(function (p) { positions[p['了愿項目ID']] = p; });
  return activeSignups_().filter(function (s) { return s['日期'] === date && normalizeName_(s['姓名']) === who && duties[s['勤務ID']]; })
    .map(function (s) {
      var d = duties[s['勤務ID']];
      var p = positions[s['了愿項目ID']];
      var item = { id: d['勤務ID'], name: d['名稱'], position: p ? p['了愿項目名稱'] : '', time: d['開始時間'] || '', location: d['地點'] || '' };
      // 組長：附上職稱、目前報名幾位、點名碼（點名碼在送出前產生，見 ensureLeaderCodes_）
      if (s['組長'] === '是' && d['組長職稱']) {
        var people = {};
        activeSignups_().forEach(function (x) { if (x['勤務ID'] === d['勤務ID'] && x['日期'] === date && x['陪同'] !== '是') people[normalizeName_(x['姓名']) + '|' + (x['佛堂'] || '')] = true; });
        item.leader = d['組長職稱'];
        item.people = Object.keys(people).length;
        item.code = rollcallCode_(d['勤務ID'], date, false);
      }
      return item;
    })
    .filter(function (it, i, arr) { return !it.leader || arr.findIndex(function (o) { return o.id === it.id && o.leader; }) === i; })
    .sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
}

/** body = { endpoint, name }：手機提醒的「我是誰」（空白＝清掉，收全部） */
function pushSetName_(body) {
  if (!validEndpoint_(body.endpoint)) throw new ApiError_('BAD_REQUEST', '推播網址格式不對');
  var name = canonicalName_(String(body.name || '').replace(/[\s　]+/g, '')); // 打別名就換成主要名字
  if (name && name.length < 2) throw new ApiError_('BAD_REQUEST', '請輸入完整的名字');
  return withSignupLock_(function () {
    var row = readTable_(SHEETS.PUSH).filter(function (r) { return r['端點'] === body.endpoint && r['啟用'] !== '否'; })[0];
    if (!row) throw new ApiError_('NOT_FOUND', '這支手機還沒開啟提醒，請先開啟');
    updateRow_(SHEETS.PUSH, row, { '名字': name });
    return { name: name };
  });
}

/**
 * 每日提醒要送給哪些手機：沒填名字的，那天有勤務就送；填了名字的，有他報名的或有缺人才送。
 */
function dailyPushEndpoints_(when) {
  var info = pushItems_(when);
  if (!info.items.length) return [];
  var shortCount = info.items.filter(function (it) { return it.short; }).length;
  var mineCache = {};
  return readTable_(SHEETS.PUSH).filter(function (r) {
    if (r['啟用'] === '否' || !r['端點']) return false;
    if (!r['名字']) return true;
    if (shortCount) return true;
    if (mineCache[r['名字']] === undefined) mineCache[r['名字']] = pushMine_(r['名字'], info.date).length;
    return mineCache[r['名字']] > 0;
  }).map(function (r) { return r['端點']; });
}

/** 今天或明天的勤務清單（只有行事曆上公開的資料） */
function pushItems_(when) {
  var date = when === 'today' ? todayString_() : addDaysStr_(todayString_(), 1);
  var events = getEvents_({ from: date, to: date });
  var items = events.duties.map(function (d) {
    var day = d.days[date];
    var label = d.mode === '公告型' ? (d.group ? '輪值：' + d.group : '公告')
      : day && day.full ? '額滿' : day && day.shortage > 0 ? '缺 ' + day.shortage + ' 人' : '';
    return {
      id: d.id, name: d.name, nature: d.nature,
      time: d.start === d.end ? (d.startTime || '') : '', location: d.location || '', label: label,
      short: !!(day && day.shortage > 0)
    };
  });
  items.sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
  return { when: when, date: date, items: items };
}

// ---------- 送出 ----------

function sendPushToday() { sendPushAll_('today'); }
function sendPushTomorrow() { sendPushAll_('tomorrow'); }

/** 有勤務才送；送給所有啟用中的手機，失效的（404／410）自動停用 */
/** 送每日提醒前：那天有組長的勤務先產生點名碼（提醒裡附給組長） */
function ensureLeaderCodes_(when) {
  var date = pushItems_(when).date;
  var need = {};
  var duties = {};
  readTableCached_(SHEETS.DUTIES).forEach(function (d) { duties[d['勤務ID']] = d; });
  activeSignups_().forEach(function (s) { if (s['日期'] === date && s['組長'] === '是' && duties[s['勤務ID']] && duties[s['勤務ID']]['組長職稱']) need[s['勤務ID']] = true; });
  var ids = Object.keys(need);
  if (!ids.length) return 0;
  withSignupLock_(function () { ids.forEach(function (id) { rollcallCode_(id, date, true); }); });
  return ids.length;
}

function sendPushAll_(when) {
  if (!pushItems_(when).items.length) return { sent: 0, skipped: 'no-duty' };
  ensureLeaderCodes_(when);
  var eps = dailyPushEndpoints_(when);
  if (!eps.length) return { sent: 0 };
  var results = sendPushTo_(eps);
  var now = nowString_();
  withSignupLock_(function () {
    var fresh = readTable_(SHEETS.PUSH);
    results.forEach(function (res) {
      var row = fresh.filter(function (r) { return r['端點'] === res.endpoint; })[0];
      if (!row) return;
      if (res.ok) updateRow_(SHEETS.PUSH, row, { '最後成功': now });
      else if (res.gone) updateRow_(SHEETS.PUSH, row, { '啟用': '否' });
    });
  });
  return { sent: results.filter(function (r) { return r.ok; }).length, failed: results.filter(function (r) { return !r.ok; }).length };
}

/** 一次送出（並行）；回傳 [{ endpoint, ok, gone, code }] */
function sendPushTo_(endpoints) {
  var keys = pushKeys_();
  if (!keys) throw new ApiError_('CONFIG', '推播尚未設定，請管理者在 Apps Script 執行 setupPush');
  var nowSec = Math.floor(Date.now() / 1000);
  var jwts = {}; // 每個推播服務（Google、Apple、Mozilla⋯）簽一次就好
  var requests = endpoints.map(function (ep) {
    var aud = ep.match(/^https:\/\/[^/]+/)[0];
    if (!jwts[aud]) jwts[aud] = vapidJwt_(aud, keys.d, nowSec);
    return {
      url: ep,
      method: 'post',
      headers: { Authorization: 'vapid t=' + jwts[aud] + ', k=' + keys.pub, TTL: String(PUSH_TTL_SEC), Urgency: 'high' },
      payload: '',
      muteHttpExceptions: true
    };
  });
  return UrlFetchApp.fetchAll(requests).map(function (resp, i) {
    var code = resp.getResponseCode();
    return { endpoint: endpoints[i], ok: code >= 200 && code < 300, gone: code === 404 || code === 410, code: code };
  });
}

/** 在編輯器執行：馬上用目前的勤務送一次（不管有沒有勤務都送，測試用） */
function testPushNow() {
  var rows = readTable_(SHEETS.PUSH).filter(function (r) { return r['啟用'] !== '否'; });
  var res = sendPushTo_(rows.map(function (r) { return r['端點']; }));
  Logger.log('送出 ' + res.length + ' 支手機：' + res.map(function (r) { return r.code; }).join('、'));
}
