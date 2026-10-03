// （這段會被 tools/build-worker.js 接在 apps-script/*.gs 後面，在同一個範圍裡執行）
// Cloudflare 版和 Google 版不同的地方：

// 資料本來就在 Durable Object 的記憶體裡，不需要另外的讀取快取；回應快取也不需要（每次都很快、而且一定是最新的）
readTableCached_ = function (def) { return readTable_(def); };
cachedRead_ = function (action, params, fn) { return fn(); };

// 保溫排程：Cloudflare 不需要
keepWarm = function () {};

// 統計分頁在 Google 試算表端產生（每 10 分鐘同步時順便更新）；這裡只回報上次更新時間
adminUpdateStatsSheet_ = function (body) {
  var year = Number(body.year) || Number(todayString_().slice(0, 4));
  return { year: year, updatedAt: PropertiesService.getScriptProperties().getProperty('STATS_UPDATED_AT') };
};

// 給非同步版（async-actions.js）用：取得 .gs 裡的設定與服務
function cacheForAsync_() { return CacheService.getScriptCache(); }
function propsForAsync_() { return PropertiesService.getScriptProperties(); }
function aiDefaultModels_() { return AI_DEFAULT_MODELS.slice(); }
