/**
 * 防止亂報名（2026/10/6）：公開的寫入動作，同一個網路位址 10 分鐘內最多 RATE_LIMIT 次。
 *   - Cloudflare 版把網路位址的雜湊放在 body._client（見 worker/src/app.js），這裡只用來計數，存在快取 10 分鐘，不寫進試算表。
 *   - 沒有 _client（Apps Script 版、測試）就不限制。管理者後台的動作不經過這裡。
 *   - 第一次擋下時通知開啟系統通知的總管理者（一小時最多一次）。
 */

var RATE_LIMIT = 20;
var RATE_WINDOW_SEC = 600;
var RATE_ACTIONS = ['signup', 'cancel', 'reschedule', 'requestVenue', 'cancelVenue', 'venueWatch', 'reportRepair', 'repairWatch', 'repairUpload', 'pushSubscribe', 'pushUnsubscribe', 'pushSetName', 'pushTest', 'rollcallSet'];
var MAX_SIGNUP_NAMES = 20;

function rateLimit_(body) {
  if (body.action === 'signup' && Array.isArray(body.entries) && body.entries.length > MAX_SIGNUP_NAMES) {
    throw new ApiError_('BAD_REQUEST', '一次最多報 ' + MAX_SIGNUP_NAMES + ' 個名字，請分開報名');
  }
  var client = String(body._client || '');
  if (!client || RATE_ACTIONS.indexOf(body.action) === -1) return;
  var cache = CacheService.getScriptCache();
  var bucket = Math.floor(Date.now() / (RATE_WINDOW_SEC * 1000));
  var key = 'rl:' + client + ':' + bucket;
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), RATE_WINDOW_SEC + 60);
  if (n <= RATE_LIMIT) return;
  if (!cache.get('rl-alerted')) {
    cache.put('rl-alerted', '1', 3600);
    withSignupLock_(function () {
      pushMessageTo_(pushTargets_('系統通知'), '⚠️ 有人短時間大量操作', '同一個網路在 10 分鐘內送出超過 ' + RATE_LIMIT + ' 次報名或取消，已經先暫停他 10 分鐘。\n請到後台「操作紀錄」看看有沒有奇怪的報名。', '#/admin/logs');
    });
  }
  throw new ApiError_('BUSY', '操作太頻繁了，請 10 分鐘後再試，感恩您 🙏');
}
